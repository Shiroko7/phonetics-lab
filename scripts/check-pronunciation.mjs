/** Deterministic reliability regressions; no audio model, network or human accuracy claims. */
import assert from 'node:assert/strict'
import { alignPhones, scoreAlignment } from '../src/lib/align.ts'
import { byWord, extractVariantMap } from '../src/lib/report.ts'
import { playbackSlice } from '../src/lib/playback.ts'
import { alignWordVariants, wordPronunciations } from '../src/lib/wordAlignment.ts'
import { analyze, ANALYSIS_REVISION } from '../src/lib/backend.ts'
import { loadAttempts } from '../src/lib/practice.ts'
import { evaluatePronunciation } from './evaluate-pronunciation.mjs'

const heard = (phones) => phones.split(' ').map((phone, i) => ({ phone, start: i / 10, end: (i + 1) / 10 }))
const word = (text, canonical, ...variants) => ({ text, ipa: canonical, phones: canonical.split(' '), variants })
const was = word('was', 'w ə z', 'wɑz')

assert(scoreAlignment(alignPhones(was.phones, heard('z w ə'), extractVariantMap([was]))).overall < 100)
assert(scoreAlignment(alignWordVariants([was], heard('z w ə'))).overall < 100)
for (const pronunciation of ['w ə z', 'w ɑ z']) {
  assert.equal(scoreAlignment(alignWordVariants([was], heard(pronunciation))).overall, 100)
}
const multiple = word('test', 'p æ t', 'bid')
assert(scoreAlignment(alignWordVariants([multiple], heard('p i d'))).overall < 100, 'cannot create a hybrid pronunciation')
const independent = word('test', 'p æ t', 'pɪt', 'bæt')
assert.equal(extractVariantMap([independent]).size, 0, 'flat compatibility maps cannot combine changes from separate variants')
assert.deepEqual(wordPronunciations(word('and', 'ə n d', 'ən')), [['ə', 'n', 'd']], 'length changes are not silently assigned to wrong slots')
const sentence = [word('he', 'h i'), was, word('happy', 'h æ p i')]
const sentenceAlignment = alignWordVariants(sentence, heard('h i w ɑ z h æ p i'))
assert.equal(scoreAlignment(sentenceAlignment).overall, 100)
assert.deepEqual(sentenceAlignment.map((p) => p.expectedIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8])
assert.equal(byWord(sentence, sentenceAlignment)[1].said, 'w ɑ z')

const scored = [{ expected: 's', actual: 's', verdict: 'correct', distance: 0.27, score: 73, expectedIndex: 0, start: 1, end: 1.4 }]
assert.equal(scoreAlignment(scored).overall, 73, '73 must not display as 100')
assert.equal(byWord([word('sound', 's')], scored)[0].score, 73)
assert.equal(scoreAlignment([{ ...scored[0], verdict: 'wrong', score: 24 }]).overall, 24)
assert.equal(scoreAlignment([{ ...scored[0], score: 0 }]).overall, 0, 'zero is a score, not an absent property')

assert.deepEqual(playbackSlice({ start: 1, end: 1.4 }, 2, 16000), { start: 1, end: 1.4 })
assert.deepEqual(playbackSlice({ start: 1, end: 1.02 }, 2, 16000), { start: 1, end: 1.02 }, 'short words must not be expanded')
assert.equal(playbackSlice({ start: 1, end: 1 }, 2, 16000), null)
assert.equal(playbackSlice({ start: NaN, end: 1 }, 2, 16000), null)
assert.equal(playbackSlice({ start: 3, end: 4 }, 2, 16000), null)
assert.deepEqual(playbackSlice({ start: -1, end: 3 }, 2, 16000), { start: 0, end: 2 })
for (let i = 0; i < 1000; i++) {
  const start = i * 0.003171
  const end = start + 0.003 + (i % 7) * 0.014
  const slice = playbackSlice({ start, end }, 5, 48000)
  assert(slice && slice.start >= start && slice.end <= end, 'no deliberate crossing for arbitrary word durations')
}
const two = [word('one', 's'), word('two', 't')]
const shared = [scored[0], { ...scored[0], expected: 't', expectedIndex: 1 }]
const overlap = byWord(two, shared)
assert(overlap.every((w) => w.span === null && w.timing === 'ambiguous'))
assert.deepEqual(overlap[0].contextSpan, { start: 1, end: 1.4 })
const extra = { expected: null, actual: 'ə', expectedIndex: null, verdict: 'extra', distance: null, start: 1.4, end: 1.6 }
const report = byWord(two, [scored[0], extra, { ...scored[0], expected: 't', expectedIndex: 1, start: 1.6, end: 1.7 }])
assert.equal(report[0].span.end, 1.4, 'an insertion must not extend isolated word replay')
assert.equal(report[0].contextSpan.end, 1.7)

const originalStorage = globalThis.localStorage
try {
  globalThis.localStorage = { getItem: () => JSON.stringify([{ scorer: 'gop', rev: 1, aligned: [{ ...scored[0], score: undefined }], score: { overall: 73 } }]) }
  const restored = loadAttempts()[0]
  assert.equal(restored.aligned[0].score, 73)
  assert.equal(restored.score.overall, 73)
  assert.equal(restored.rev, 1, 'restoring stored numbers is not re-running a new model')
} finally { globalThis.localStorage = originalStorage }

const originalFetch = globalThis.fetch
try {
  let revision = ANALYSIS_REVISION
  globalThis.fetch = async (_, options) => {
    const payload = options.body
    assert.deepEqual(JSON.parse(payload.get('expected')), ['w', 'ə', 'z'])
    assert.deepEqual(JSON.parse(payload.get('words'))[0].pronunciations, [['w', 'ə', 'z'], ['w', 'ɑ', 'z']])
    return Response.json({ revision, phones: [
      { index: 0, expected: 'w', verdict: 'correct', score: 73, posterior: 0.5, gop: -0.57, start: 0, end: 0.1, heard: null },
      { index: 1, expected: 'ə', realized: 'ɑ', verdict: 'correct', score: 100, posterior: 0.9, gop: 0, start: 0.1, end: 0.2, heard: null },
    ], overall: 87, free: [], device: 'test' })
  }
  const response = await analyze(new Float32Array(160), was.phones, [was])
  assert.equal(response.aligned[0].score, 73)
  assert.equal(response.aligned[0].posterior, 0.5)
  assert.equal(response.aligned[1].actual, 'ɑ')
  assert.equal(scoreAlignment(response.aligned).overall, response.overall)
  revision = undefined
  await assert.rejects(analyze(new Float32Array(160), was.phones, [was]), /restarted or updated/)
} finally { globalThis.fetch = originalFetch }

const annotations = [{ id: 'synthetic-check', source: 'synthetic', split: 'test', words: [
  { text: 'one', start: 0.1, end: 0.3, correct: true }, { text: 'two', start: 0.3, end: 0.5, correct: false },
] }]
const predictions = [{ id: 'synthetic-check', scorer: 'test', revision: 1, words: [
  { text: 'one', start: 0.1, end: 0.4, correct: false }, { text: 'two', start: 0.3, end: 0.5, correct: true },
] }]
const metrics = evaluatePronunciation(annotations, predictions)
assert.equal(metrics.boundary.clipsWithNeighborSpeech, 1)
assert(Math.abs(metrics.boundary.meanErrorMs - 25) < 1e-8)
assert.equal(metrics.pronunciation.falseAcceptanceRate, 1)
assert.equal(metrics.pronunciation.falseRejectionRate, 1)
const unscored = evaluatePronunciation(annotations, [])
assert.equal(unscored.pronunciation.coverage, 0)
assert.equal(unscored.pronunciation.falseRejectionRate, null, 'no judgments is not a perfect error rate')
assert.equal(unscored.boundary.meanErrorMs, null)
assert.throws(() => evaluatePronunciation([...annotations, ...annotations], predictions), /Duplicate/)

console.log('Pronunciation reliability regressions passed (synthetic data).')
