"""Scoring contract and regression tests. Synthetic emissions; no model downloads.

These verify implementation, not accuracy on human speech. See
docs/pronunciation-roadmap.md for the separate acoustic evaluation protocol.
"""
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from app import align, lattice, phones
from app.main import app, free_decode, MODELS
from app.models import TargetWord, SCORER_REVISION


def inventory():
    names = sorted(set(phones.SINGLE.values()) | {t for _, t in phones.MERGES}
                   | {t for group in phones.VARIANTS.values() for t in group})
    return phones.Inventory({t: i for i, t in enumerate(['<pad>', *names])})


INV = inventory()


def emissions(sequence):
    ids = [0, 0]
    for name in sequence:
        ids.extend([INV.vocab[name]] * 2 + [0, 0])
    lp = np.full((len(ids), len(INV.vocab)), -10.0)
    lp[np.arange(len(ids)), ids] = 0.0
    return lp - np.log(np.exp(lp).sum(axis=1, keepdims=True))


def word(text, canonical, *variants):
    return TargetWord(text=text, phones=canonical.split(), pronunciations=[v.split() for v in variants])


class AlignmentTests(unittest.TestCase):
    def test_ordinary_adjacent_words_keep_distinct_spans(self):
        words = [word('become', 'b ɪ k ʌ m'), word('a', 'ə')]
        result = lattice.align_words(emissions(['b', 'ɪ', 'k', 'ʌ', 'm', 'ə']), words, INV)
        self.assertEqual([i for r in result for i in r.sources], list(range(6)))
        self.assertLessEqual(result[-2].score.end_frame, result[-1].score.start_frame)

    def test_rhotic_merges_cannot_cross_words(self):
        words = [word('saw', 's ɔ'), word('red', 'ɹ ɛ d')]
        result = lattice.align_words(emissions(['s', 'ɔː', 'ɹ', 'ɛ', 'd']), words, INV)
        self.assertEqual([r.sources for r in result], [[0], [1], [2], [3], [4]])
        self.assertTrue(all(align.to_percent(r.score.gop) == 100 for r in result))

    def test_rhotic_merges_within_a_word_still_work(self):
        result = lattice.align_words(emissions(['k', 'ɑːɹ']), [word('car', 'k ɑ ɹ')], INV)
        self.assertEqual([r.sources for r in result], [[0], [1, 2]])

    def test_complete_citation_variant_is_selected_during_alignment(self):
        result = lattice.align_words(emissions(['w', 'ɑː', 'z']), [word('was', 'w ə z', 'w ɑ z')], INV)
        self.assertEqual([p for r in result for p in r.realized], ['w', 'ɑ', 'z'])
        self.assertTrue(all(align.to_percent(r.score.gop) == 100 for r in result))

    def test_reordered_sounds_are_not_a_valid_variant(self):
        result = lattice.align_words(emissions(['z', 'w', 'ə']), [word('was', 'w ə z', 'w ɑ z')], INV)
        self.assertTrue(any(align.to_percent(r.score.gop) < 70 for r in result))

    def test_variants_cannot_mix_parts_of_different_paths(self):
        result = lattice.align_words(emissions(['p', 'iː', 'd']), [word('test', 'p æ t', 'b i d')], INV)
        realized = [p for r in result for p in r.realized]
        self.assertIn(realized, [['p', 'æ', 't'], ['b', 'i', 'd']])
        self.assertTrue(any(align.to_percent(r.score.gop) < 70 for r in result))

    def test_allophone_gets_its_own_acoustic_timing(self):
        result = lattice.align_words(emissions(['ɾ', 'ə']), [word('test', 't ə')], INV)
        self.assertEqual(result[0].score.token, 'ɾ')
        self.assertEqual((result[0].score.start_frame, result[0].score.end_frame), (2, 4))
        self.assertEqual(align.to_percent(result[0].score.gop), 100)

    def test_equal_adjacent_sounds_require_blank_even_across_words(self):
        words = [word('one', 'k'), word('two', 'k')]
        result = lattice.align_words(emissions(['k', 'k']), words, INV)
        self.assertEqual([r.sources for r in result], [[0], [1]])
        self.assertLess(result[0].score.end_frame, result[1].score.start_frame)
        with self.assertRaises(ValueError):
            lattice.align_words(emissions(['k'])[:2], words, INV)
        with self.assertRaises(ValueError):
            align.viterbi_align(emissions(['k'])[:2], [INV.vocab['k']] * 2)

    def test_uniform_or_nonfinite_output_cannot_receive_full_marks(self):
        for lp in [np.full((8, len(INV.vocab)), -np.log(len(INV.vocab))),
                   np.full((8, len(INV.vocab)), np.nan)]:
            with self.assertRaises(ValueError):
                lattice.align_words(lp, [word('a', 'ə')], INV)

    def test_unsupported_variable_length_path_is_explicit(self):
        with self.assertRaisesRegex(ValueError, 'Variable-length'):
            lattice.align_words(emissions(['ə', 'n']), [word('and', 'ə n d', 'ə n')], INV)

    def test_free_decode_retains_full_emission_runs(self):
        result = free_decode(emissions(['s', 's']), INV, 0.02, 0, 0.5)
        self.assertEqual([(r.start, r.end) for r in result], [(0.54, 0.58), (0.62, 0.66)])

    def test_protected_vowel_and_rhotic_contrasts(self):
        self.assertNotIn('ɪ', phones.variants_for('i'))
        self.assertNotIn('ə', phones.variants_for('ɚ'))


class AnalyzeContractTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        wav = io.BytesIO()
        samples = np.concatenate([np.zeros(8000), np.ones(8000) * 0.2, np.zeros(8000)])
        sf.write(wav, samples, 16000, format='WAV', subtype='FLOAT')
        self.audio = wav.getvalue()

    def request(self, words, lp, expected=None):
        model = SimpleNamespace(inventory=INV, blank=0, device='test', log_probs=lambda samples: (lp, 0.02))
        with patch.object(MODELS, 'phonemes', return_value=model):
            return self.client.post('/analyze', files={'audio': ('take.wav', self.audio, 'audio/wav')}, data={
                'expected': json.dumps(expected if expected is not None else [p for w in words for p in w.phones]),
                'words': json.dumps([w.model_dump() for w in words]),
            })

    def test_response_preserves_indices_variant_scores_and_original_offset(self):
        response = self.request([word('was', 'w ə z', 'w ɑ z')], emissions(['w', 'ɑː', 'z']))
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['revision'], SCORER_REVISION)
        self.assertEqual(body['overall'], 100)
        self.assertEqual([p['index'] for p in body['phones']], [0, 1, 2])
        self.assertEqual(body['phones'][1]['expected'], 'ə')
        self.assertEqual(body['phones'][1]['realized'], 'ɑ')
        self.assertGreaterEqual(body['phones'][0]['start'], 0.4)

    def test_mismatched_word_ownership_is_refused(self):
        response = self.request([word('a', 'ə')], emissions(['ə']), expected=['t'])
        self.assertEqual(response.status_code, 400)

    def test_blank_only_audio_is_not_assessed(self):
        response = self.request([word('a', 'ə')], emissions([]))
        self.assertEqual(response.status_code, 400)
        self.assertIn('Nothing was scored', response.json()['detail'])

    def test_health_reports_revision_without_loading_model(self):
        with patch.object(MODELS, '_phonemes', None), patch.object(MODELS, 'phonemes') as load:
            body = self.client.get('/health').json()
            self.assertEqual(body['scorer_revision'], SCORER_REVISION)
            self.assertIsNone(body['phoneme_model_revision'])
            load.assert_not_called()

    def test_health_reports_loaded_model_configuration_commit(self):
        fake = SimpleNamespace(model=SimpleNamespace(config=SimpleNamespace(_commit_hash='a' * 40)))
        with patch.object(MODELS, '_phonemes', fake):
            body = self.client.get('/health').json()
            self.assertEqual(body['phoneme_model_revision'], 'a' * 40)


if __name__ == '__main__':
    unittest.main()
