/**
 * Regression checks for the transcription pipeline.
 *
 * These pin down the behaviour that is easy to break silently: stress-blocked
 * flapping, syllable boundaries, affix allomorphs and tokenisation. Run with
 * `npm run check` after touching anything under src/lib.
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDictionary } from './build-dict.mjs'
import { isDeepStrictEqual } from 'node:util'
import { analyze } from '../src/lib/analyze.ts'
import { lookupWord } from '../src/lib/lookup.ts'
import { applyFlapping, respell, transcribe } from '../src/lib/phonology.ts'
import { tokenize } from '../src/lib/tokenize.ts'
import { alignPhones, expectedPhones, normalizeRecognized, scoreAlignment } from '../src/lib/align.ts'
import { phoneDistance } from '../src/lib/phonefeatures.ts'
import {
  byWord, comparePhones, compareWords, dominant, extractVariantMap, flatten, focusScore, targetWords,
} from '../src/lib/report.ts'
import {
  isCurrent, lineProgress, mixedScorers, SCORER_REVISION, scorerOf,
} from '../src/lib/practice.ts'
import { pending as pendingRescore } from '../src/lib/rescore.ts'
import { encodeWav } from '../src/lib/backend.ts'
import { buildDrillIndex, findDrills } from '../src/lib/drills.ts'
import { buildDrill, indexPhrases, phrasesFor } from '../src/lib/phrasebank.ts'
import { PHRASE_BANK } from '../src/data/phrases.ts'
import { PHONES } from '../src/lib/phones.ts'
import { CHART, DIPHTHONGS, place, VOWELS } from '../src/data/vowels.ts'
import { examplesFor, spellingGuide } from '../src/lib/vowelref.ts'
import {
  recordWordReports, isStruggleReport, isStrugglingLot, addManualWord,
  removeStruggledWord, togglePinnedWord, buildDrillForWord, buildDrillForStruggledWords,
} from '../src/lib/struggles.ts'
import {
  buildDailyQueue, cardIdForSound, recordDailyReview, startDailySession,
  localDateKey, summaryForDay, syncCandidates,
} from '../src/lib/daily.ts'
import { automaticDailyOutcome } from '../src/lib/dailyDecision.ts'
import {
  advanceRoutine, changeRoutineVoice, contrastsForCard, exposeRoutineStep, markReferenceHeard, planDailyRoutine, refreshLegacyContexts, refreshRoutineVoices, refreshRoutineSentences,
  recordRoutineEvent, referenceVoicePool, routineCardRating, routineSummary, sentenceFitsCard, updateRoutine,
} from '../src/lib/dailyRoutine.ts'
import { DAILY_TRAINING_SENTENCES, DAILY_TRANSFER_SENTENCES, LISTENING_CONTRASTS } from '../src/data/dailyContent.ts'
import { loadDailyState, saveDailyState } from '../src/lib/daily.ts'
import { defaultVoice, stop as stopSpeech, synthesise } from '../src/lib/speech.ts'
import { contextsForWord, isPracticeContext, isWordCarrier } from '../src/lib/context.ts'
import { changeDailySentence, dailySentences, resolveDailySentence, sentenceKey } from '../src/lib/dailySentences.ts'
import { excludeVoice, isExcluded, loadVoicePreferences, saveVoicePreferences, uniqueEnglishVoices, voiceKey, VOICE_PREFERENCES_KEY } from '../src/lib/voicePreferences.ts'
import { analyzeStats, exportStatsReport } from '../src/lib/analytics.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const dict = new Map()
// A local source override validates a fresh transform without changing installed data.
const raw = process.env.PHONETICS_DICTIONARY_SOURCE
  ? buildDictionary(await readFile(process.env.PHONETICS_DICTIONARY_SOURCE, 'utf8'))
  : await readFile(join(ROOT, 'public', 'dict', 'cmudict-ipa.txt'), 'utf8')
for (const line of raw.split('\n')) {
  const tab = line.indexOf('\t')
  if (tab > -1) dict.set(line.slice(0, tab), line.slice(tab + 1).split('|'))
}

const common = (await readFile(join(ROOT, 'public', 'dict', 'common-words.txt'), 'utf8'))
  .split('\n')
  .map((w) => w.trim())
  .filter(Boolean)
const drills = buildDrillIndex(dict, common)

let failures = 0
const cache = new Map()

function check(label, actual, expected) {
  const ok = actual === expected
  if (!ok) {
    failures++
    console.log(`  FAIL ${label}\n       expected ${expected}\n       actual   ${actual}`)
  }
  return ok
}

function group(name, fn) {
  console.log(name)
  // Returned, not discarded, so an async group can be awaited at the call site.
  return fn()
}

group('flapping is blocked by stress on either side', () => {
  const flap = (arpa) => applyFlapping(transcribe(arpa))
  check('atom', flap('AE1 T AH0 M'), 'ˈæɾ.əm')
  check('atomic', flap('AH0 T AA1 M IH0 K'), 'əˈtɑ.mɪk')
  check('attack', flap('AH0 T AE1 K'), 'əˈtæk')
  check('water', flap('W AO1 T ER0'), 'ˈwɔ.ɾɚ')
  check('party', flap('P AA1 R T IY0'), 'ˈpɑɹ.ɾi')
  check('photography', flap('F AH0 T AA1 G R AH0 F IY0'), 'fəˈtɑ.ɡɹə.fi')
})

group('syllabification', () => {
  // Maximal onset, except that a stressed lax vowel must close its syllable.
  check('extra', transcribe('EH1 K S T R AH0'), 'ˈɛk.stɹə')
  check('happy', transcribe('HH AE1 P IY0'), 'ˈhæp.i')
  check('monosyllable carries no stress mark', transcribe('TH R UW1'), 'θɹu')
})

group('lookup cascade', () => {
  const ipa = (w) => lookupWord(w, dict, cache)?.ipa
  const src = (w) => lookupWord(w, dict, cache)?.source

  check('dictionary hit', ipa('through'), 'θɹu')
  check('suffix on a known stem', ipa('debuggable'), 'diˈbʌɡ.ə.bəl')
  check('prefix keeps the stem boundary', ipa('misconfigured'), 'ˌmɪs.kənˈfɪɡ.jɚd')
  check('voiced -s allomorph', ipa('podcasters'), 'ˈpɔdˌkæs.tɚz')
  check('possessive after a sibilant', ipa("Kubernetes's")?.endsWith('sɪz'), true)
  check('plural possessive adds nothing', ipa("dogs'"), 'dɔɡz')
  check('british spelling', ipa('organised'), 'ˈɔɹ.ɡəˌnaɪzd')
  check('irregular british spelling', ipa('ploughman'), 'ˈplaʊ.mən')
  check('numeral', ipa('3rd'), 'θɝd')
  check('initialism reads as letters', src('API'), 'dictionary')
  check('unknown word is flagged', src('Zylphrax'), 'guessed')
})

group('connected speech and contextual reductions', () => {
  const trans = (phrase) => analyze(phrase, dict).tokens.filter((t) => t.isWord && t.pron).map((t) => t.pron.ipa).join(' ')
  check('the before vowel becomes ði', trans('the apple'), 'ði ˈæp.əl')
  check('the before consonant stays ðə', trans('the book'), 'ðə bʊk')
  check('the before silent h vowel onset', trans('the hour'), 'ði ˈaʊ.ɚ')
  check('the before vowel letter with consonant onset', trans('the university'), 'ðə ˌju.nəˈvɝ.sə.ti')
  check('was in running speech reduces to wəz', trans('it was good'), 'ɪt wəz ɡʊd')
  check('was at sentence end retains wɑz', trans('yes it was.'), 'jɛs ɪt wɑz')
  check('as in running speech reduces to əz', trans('as big as that'), 'əz bɪɡ əz ðæt')
  check('an reduces to ən', trans('an apple'), 'ən ˈæp.əl')
  check('can in running speech reduces to kən', trans('I can go'), 'aɪ kən ɡoʊ')
  check('to before vowel becomes tu', trans('to eat'), 'tu it')
  check('to before consonant reduces to tə', trans('to go'), 'tə ɡoʊ')

  // Alignment accepts both citation and weak form without error
  const words = targetWords('he was happy', dict)
  const want = flatten(words)
  const variantMap = extractVariantMap(words)
  // user says weak form: hi wəz hæpi
  const saidWeak = normalizeRecognized('hi wəz hæpi')
  const scoredWeak = alignPhones(want, saidWeak, variantMap)
  check('weak form /wəz/ scores 100', scoreAlignment(scoredWeak).overall, 100)

  // user says strong citation form: hi wɑz hæpi
  const saidStrong = normalizeRecognized('hi wɑz hæpi')
  const scoredStrong = alignPhones(want, saidStrong, variantMap)
  check('strong form /wɑz/ scores 100', scoreAlignment(scoredStrong).overall, 100)
})

group('respelling', () => {
  check('stress becomes capitals', respell('ˈwɔ.tɚ'), 'WAW-ter')
  check('PRICE is y after an onset', respell('faɪv'), 'fyv')
  check('PRICE is eye when bare', respell('aɪ'), 'eye')
  check('word gaps survive', respell('tu pɔɪnt faɪv'), 'too poynt fyv')
})

group('tokenisation', () => {
  const words = (s) => tokenize(s).filter((t) => t.isWord).map((t) => t.text).join('|')
  check('thousands separator', words('1,250 words'), '1,250|words')
  check('decimal', words('about 2.5 kg'), 'about|2.5|kg')
  check('sentence-final period', words('in 1990.'), 'in|1990')
  check('apostrophes and hyphens', words("don't well-known"), "don't|well-known")
})

group('phone distance reflects articulation', () => {
  check('identical is zero', phoneDistance('s', 's'), 0)
  check('θ/s is a near miss', phoneDistance('θ', 's') < 0.35, true)
  check('θ/ɡ is far apart', phoneDistance('θ', 'ɡ') > 0.5, true)
  check('vowel vs consonant is maximal', phoneDistance('i', 'k'), 1)
  check('ɪ/i are close', phoneDistance('ɪ', 'i') < 0.3, true)
})

group('recogniser output folds into our inventory', () => {
  const fold = (raw) => normalizeRecognized(raw).map((h) => h.phone).join(' ')
  check('length marks dropped', fold('iː'), 'i')
  check('stress dropped', fold('ˈwɔtɚ'), 'w ɔ t ɚ')
  check('foreign rhotic becomes ɹ', fold('ʁ'), 'ɹ')
  check('diphthong stays one phone', fold('eɪ'), 'eɪ')
  check('ɐ folds to ʌ', fold('ɐ'), 'ʌ')
})

group('alignment finds the real error', () => {
  const want = expectedPhones('θɪŋk')

  // "think" produced with /s/ for /θ/ — the classic substitution.
  const aligned = alignPhones(want, normalizeRecognized('sɪŋk'))
  check('lengths match', aligned.length, 4)
  check('θ→s is flagged, not excused', aligned[0].verdict !== 'correct', true)
  check('θ→s reads as a near miss', aligned[0].verdict, 'close')
  check('reports what was said', aligned[0].actual, 's')
  check('a distant swap is plainly wrong',
    alignPhones(want, normalizeRecognized('kɪŋk'))[0].verdict, 'wrong')
  check('flapping is not an error',
    alignPhones(expectedPhones('ˈwɔtɚ'), normalizeRecognized('ˈwɔɾɚ')).every((a) => a.verdict === 'correct'), true)
  check('remainder correct', aligned.slice(1).every((a) => a.verdict === 'correct'), true)

  check('perfect scores 100', scoreAlignment(alignPhones(want, normalizeRecognized('θɪŋk'))).overall, 100)
  check('deletion detected', alignPhones(want, normalizeRecognized('θɪk')).some((a) => a.verdict === 'missing'), true)
  check('insertion detected', alignPhones(want, normalizeRecognized('θɪŋkə')).some((a) => a.verdict === 'extra'), true)
})

group('free practice re-scores without re-recording', () => {
  // One recording: the speaker produced /sɪŋk/.
  const produced = normalizeRecognized('sɪŋk')

  // The word recogniser heard "sink", which those sounds match perfectly.
  const asHeard = alignPhones(expectedPhones(lookupWord('sink', dict, cache).ipa), produced)
  check('transcript as recognised scores full marks', scoreAlignment(asHeard).overall, 100)

  // Correcting it to the intended "think" re-scores the same phones instantly.
  const asMeant = alignPhones(expectedPhones(lookupWord('think', dict, cache).ipa), produced)
  check('corrected target exposes the error', scoreAlignment(asMeant).overall < 100, true)
  check('the θ slot is the one flagged', asMeant[0].expected, 'θ')
  check('and reports what was said', asMeant[0].actual, 's')
})

group('results are attributed to the right word', () => {
  const phrase = 'think about this'
  const words = targetWords(phrase, dict)
  check('one report per word', words.length, 3)
  check('flattening loses nothing', flatten(words).length, words.reduce((n, w) => n + w.phones.length, 0))

  // Said with /s/ for the initial /th/, the rest clean.
  const said = normalizeRecognized('sɪŋk əbaʊt ðɪs')
  const report = byWord(words, alignPhones(flatten(words), said))

  check('the faulty word is marked down', report[0].score < 100, true)
  check('the fault is inside the first word', report[0].steps[0].expected, 'θ')
  check('with what replaced it', report[0].steps[0].actual, 's')
  // Amber for a sound that drifted, red only for one that is wrong or absent.
  check('a close miss is not green', report[0].verdict, 'ok')
  check('clean words are green', report[2].verdict, 'good')
  const dropped = byWord(words, alignPhones(flatten(words), normalizeRecognized('θɪk əbaʊt ðɪs')))
  check('a dropped sound is red', dropped[0].verdict, 'poor')

  // A word boundary must not let the phone splitter glue two vowels together.
  check('no digraph spans the gap', flatten(targetWords('sofa is', dict)).includes('aɪ'), false)
})

group('a dominant substitution earns practice words', () => {
  check('an even split is no habit', dominant([['s', 2], ['f', 2]]), null)
  check('a clear favourite is', dominant([['s', 4], ['f', 1]])[0], 's')

  const pairs = findDrills(drills, 'θ', 's', 4)
  check('every suggestion contains the sound', pairs.every((d) => d.ipa.includes('θ')), true)
  check('minimal pairs are found', pairs.filter((d) => d.contrast).length > 0, true)
  check('and the partner has the substitute', pairs[0].contrast.ipa.includes('s'), true)

  // With no confusion to contrast against, plain examples still come back.
  check('plain examples when nothing to contrast', findDrills(drills, 'ʃ', undefined, 3).length, 3)
})

group('a word can be cut back out of the take', () => {
  // Two words, timed: the first runs 0.0-0.5s, the second 0.5-1.0s.
  const heard = [
    { phone: 'h', start: 0.0, end: 0.12 },
    { phone: 'æ', start: 0.12, end: 0.30 },
    { phone: 't', start: 0.30, end: 0.50 },
    { phone: 'd', start: 0.50, end: 0.62 },
    { phone: 'ɔ', start: 0.62, end: 0.80 },
    { phone: 'ɡ', start: 0.80, end: 1.00 },
  ]
  const words = targetWords('hat dog', dict)
  const report = byWord(words, alignPhones(flatten(words), heard))

  check('two words', report.length, 2)
  check('the first spans its own sounds', `${report[0].span.start}-${report[0].span.end}`, '0-0.5')
  check('and the second only its own', `${report[1].span.start}-${report[1].span.end}`, '0.5-1')

  // Output with no timings must not pretend to have them.
  const untimed = byWord(words, alignPhones(flatten(words), normalizeRecognized('hæt dɔɡ')))
  check('untimed output offers no span', untimed[0].span, null)

  // A word nothing was produced for cannot be played either.
  const dropped = byWord(words, alignPhones(flatten(words), heard.slice(3)))
  check('a word with no sounds has no span', dropped[0].span, null)
})

group('saying the same line again tracks progress', () => {
  const go = (target, overall, at) => ({ target, aligned: [], score: { overall }, at })
  const attempts = [
    go('Think about this.', 54, 1),
    go('Something else entirely', 90, 2),
    go('think about this', 71, 3),
    go('THINK ABOUT THIS!', 68, 4),
  ]

  const line = lineProgress(attempts, 'Think about this.')
  check('counts every go at the line', line.tries, 3)
  check('regardless of case or punctuation', lineProgress(attempts, 'think, about this').tries, 3)
  check('keeps the best', line.best, 71)
  check('and the first', line.first, 54)
  check('and the most recent, not the best', line.latest, 68)
  check('other lines are not counted', lineProgress(attempts, 'Something else entirely').tries, 1)
  check('an unattempted line has no progress', lineProgress(attempts, 'never said'), null)
  check('nor does an empty one', lineProgress(attempts, '   '), null)
})

group('a second go is measured against the first', () => {
  const words = targetWords('think about this', dict)
  const want = flatten(words)
  const go = (said) => alignPhones(want, normalizeRecognized(said))

  // First go: TH became s. Second: TH is right, but the final s is dropped.
  const first = go('sɪŋk əbaʊt ðɪs')
  const second = go('θɪŋk əbaʊt ðɪ')

  const moved = comparePhones(second, first)
  check('the fixed sound reads better', moved.get(0), 'better')
  check('an untouched sound reads level', moved.get(1), 'same')
  check('the dropped sound reads worse', moved.get(want.length - 1), 'worse')

  const deltas = compareWords(byWord(words, second), byWord(words, first))
  check('the mended word gained', deltas[0] > 0, true)
  check('the broken word lost', deltas[2] < 0, true)
  check('the untouched word is level', deltas[1], 0)

  // Nothing to compare against is not the same as no change.
  const other = compareWords(byWord(words, second), byWord(targetWords('think about that', dict), first))
  check('a differing word compares to nothing', other[2], null)
  check('while the words that do match still compare', other[0] !== null, true)
})

group('every curated phrase says what it claims to', () => {
  const bank = indexPhrases(dict, PHRASE_BANK)

  // A phrase whose words the dictionary cannot transcribe is not a drill.
  const untranscribed = bank.filter((p) => p.words < p.text.split(/\s+/).length)
  check('every word transcribes', untranscribed.map((p) => p.text).join(' | '), '')

  // The curated `focus` is a claim; the dictionary is the arbiter of it.
  const lying = bank.filter((p) =>
    p.focus.some((f) => !p.counts.has(f)) || (p.pair ?? []).some((f) => !p.counts.has(f)),
  )
  check('every phrase carries the sounds it advertises', lying.map((p) => p.text).join(' | '), '')

  // Short enough to say in one breath, long enough to be a phrase.
  check('none is a single word', bank.every((p) => p.words >= 3), true)
  check('none is a paragraph', bank.every((p) => p.words <= 9), true)

  // /ɾ/ and /ʔ/ are never expected, because the dictionary is canonical.
  const drillable = Object.keys(PHONES).filter((p) => p !== 'ɾ' && p !== 'ʔ')
  const uncovered = drillable.filter((p) => bank.filter((one) => one.focus.includes(p)).length < 2)
  check('every drillable sound has lines of its own', uncovered.join(' '), '')
  check('the flap is never expected', expectedPhones(lookupWord('water', dict, cache).ipa).includes('ɾ'), false)
})

group('a drill covers the sounds it was asked for', () => {
  const bank = indexPhrases(dict, PHRASE_BANK)
  const wanted = ['ɑ', 'u', 'ɔ', 'ə']
  const set = buildDrill(bank, wanted)

  check('nothing asked for is left out', set.missing.length, 0)
  check('and every sound is actually in a line', wanted.every((phone) =>
    set.steps.some((step) => step.covers.some((hit) => hit.phone === phone))), true)

  // Twice over, so a sound is not proved by one easy context.
  const contexts = (phone) => set.steps.filter((s) => s.covers.some((h) => h.phone === phone)).length
  check('each sound gets more than one context', wanted.every((p) => contexts(p) >= 2), true)

  // The commonest sound in English needs a line written *for* it, not the
  // leftovers of somebody else's — this is what plain set cover gets wrong.
  const deliberate = (phone) =>
    set.steps.some((s) => s.phrase.focus.includes(phone) && s.covers.some((h) => h.phone === phone))
  check('and one line written for it', wanted.every(deliberate), true)

  check('the drill stays short', set.steps.length <= 8, true)
  check('no line is repeated', new Set(set.steps.map((s) => s.phrase.text)).size, set.steps.length)

  // Every sound in the inventory can be drilled on its own.
  const thin = Object.keys(PHONES)
    .filter((p) => p !== 'ɾ' && p !== 'ʔ')
    .filter((p) => buildDrill(bank, [p], 4).steps.length < 2)
  check('any single sound builds a drill', thin.join(' '), '')

  // Asking for something that cannot be practised says so rather than pretending.
  check('an undrillable sound is reported', buildDrill(bank, ['ʔ']).missing.join(''), 'ʔ')
})

group('a known confusion picks the phrase that exposes it', () => {
  const bank = indexPhrases(dict, PHRASE_BANK)

  // /ɑ/ heard as /ʌ/: the best line holds both, so the difference is audible.
  const both = phrasesFor(bank, 'ɑ', 'ʌ', 1)[0]
  check('the top line contrasts the two', !!both.pair, true)
  check('it has the sound aimed at', both.counts.has('ɑ'), true)
  check('and the one replacing it', both.counts.has('ʌ'), true)

  // With no confusion named, a line written for the sound still comes first.
  const plain = phrasesFor(bank, 'θ', undefined, 1)[0]
  check('a plain request gets a focused line', plain.focus.includes('θ'), true)
  check('every suggestion contains the sound', phrasesFor(bank, 'ʒ', undefined, 3).every((p) => p.counts.has('ʒ')), true)
})

group('a drill is scored on the sounds it was built for', () => {
  const timed = (text) => normalizeRecognized(text).map((p, i) => ({ ...p, start: i / 10, end: (i + 1) / 10 }))
  const words = targetWords('think about this', dict)
  const want = flatten(words)
  const aligned = alignPhones(want, timed('sɪŋk əbaʊt ðɪs'))

  const [th] = focusScore(aligned, ['θ'])
  check('the drilled sound is counted', th.seen, 1)
  check('and marked wrong when it is', th.right, 0)

  const clean = alignPhones(want, timed('θɪŋk əbaʊt ðɪs'))
  check('a clean take scores full', focusScore(clean, ['θ'])[0].right, 1)

  // Sounds the line never contained are not reported as perfect.
  check('an absent sound is not listed', focusScore(clean, ['ʒ']).length, 0)
  check('several are counted at once', focusScore(clean, ['ɪ', 'ð']).length, 2)
})

group('the vowel chart covers the inventory it plots', () => {
  const charted = [...VOWELS, ...DIPHTHONGS]

  // Everything on the chart is a sound the app actually uses.
  const strangers = charted.filter((v) => !PHONES[v.phone])
  check('no invented symbols', strangers.map((v) => v.phone).join(' '), '')

  // And every vowel the app uses is on the chart. /ɚ/ is the exception: it is
  // /ɝ/ unstressed, the same mouth in the same place, so it shares the dot.
  const missing = Object.entries(PHONES)
    .filter(([phone, info]) => info.kind !== 'consonant' && phone !== 'ɚ')
    .filter(([phone]) => !charted.some((v) => v.phone === phone))
  check('every vowel is plotted', missing.map(([p]) => p).join(' '), '')

  const offChart = charted.filter(
    (v) => v.backness < 0 || v.backness > 1 || v.height < 0 || v.height > 1,
  )
  check('every dot lands inside the chart', offChart.map((v) => v.phone).join(' '), '')

  // Two dots on top of each other is two vowels the reader cannot click apart.
  // Measured after projection, since the front edge leans and the spacing with it.
  const crowded = []
  for (const set of [VOWELS, DIPHTHONGS]) {
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) {
        const a = place(set[i].backness, set[i].height)
        const b = place(set[j].backness, set[j].height)
        if (Math.hypot(a.x - b.x, a.y - b.y) < 24) crowded.push(`${set[i].phone}/${set[j].phone}`)
      }
    }
  }
  check('no two vowels sit on top of each other', crowded.join(' '), '')

  // A label is written to one side; the far side has to be inside the drawing.
  const spill = charted.filter((v) => {
    const at = place(v.backness, v.height)
    const left = v.labelSide ? v.labelSide === 'left' : v.backness < 0.5
    const edge = left ? at.x - 13 - v.phone.length * 10 : at.x + 13 + v.phone.length * 10
    return edge < 0 || edge > CHART.pad.left + CHART.width + CHART.pad.right
  })
  check('no symbol is written off the edge', spill.map((v) => v.phone).join(' '), '')

  // The keyword is what gets spoken when a dot is clicked, so it had better
  // contain the sound it is demonstrating.
  const wrong = charted.filter((v) => {
    const pron = lookupWord(v.keyword, dict, cache)
    return !pron || !expectedPhones(pron.ipa).includes(v.phone)
  })
  check('every keyword contains its own vowel', wrong.map((v) => v.keyword).join(' '), '')
})

group('spellings are credited to the right letters', () => {
  const charted = [...VOWELS, ...DIPHTHONGS]

  // Every pattern offered must actually turn up in common words.
  const barren = charted.flatMap((v) =>
    v.spellings
      .filter((pattern) => examplesFor(v.phone, pattern, dict, common, 1).length === 0)
      .map((pattern) => `${v.phone}:${pattern}`),
  )
  check('every spelling has examples', barren.join(' '), '')

  // And every example must really contain the sound.
  const lying = charted.flatMap((v) =>
    spellingGuide(v.phone, v.spellings, dict, common, 4).flatMap((s) =>
      s.examples.filter((w) => !expectedPhones(dict.get(w)[0]).includes(v.phone)),
    ),
  )
  check('every example contains the sound', lying.join(' '), '')

  // The letters have to be the ones doing the work. *People* has an /i/ and an
  // `e`, but the `e` that makes the sound is the one inside `eo`.
  const bareE = examplesFor('i', 'e', dict, common, 30)
  check('a bare e is not credited for people', bareE.includes('people'), false)
  check('nor for eagle', bareE.includes('eagle'), false)
  check('but be, we and he are', ['be', 'we', 'he'].every((w) => bareE.includes(w)), true)

  // A silent final e writes no vowel of its own, or every split digraph breaks.
  check('a split digraph resolves', examplesFor('eɪ', 'a_e', dict, common, 8).includes('make'), true)

  // Consonantal y and w must not invent a vowel that is not written.
  check('y is a vowel inside a word', examplesFor('ɪ', 'y', dict, common, 4).includes('system'), true)
  check('and w is never one', examplesFor('oʊ', 'ow', dict, common, 8).includes('windows'), true)

  // Two of the same pattern and there is no saying which one is meant.
  check('an ambiguous word is skipped', examplesFor('u', 'oo', dict, ['voodoo'], 4).length, 0)
  check('while one occurrence is fine', examplesFor('u', 'oo', dict, ['food'], 4).join(''), 'food')
})

group('scorers are kept apart', () => {
  const made = (at, scorer, rev) => ({ target: 'think', aligned: [], score: {}, at, scorer, rev })
  const current = (at) => made(at, 'gop', SCORER_REVISION)
  const legacy = { target: 'think', aligned: [], score: {}, at: 9 }

  // Anything saved before the scoring service existed carries no tag, and
  // reading that as the browser is what keeps old history interpretable.
  check('an untagged attempt is the browser', scorerOf(legacy), 'browser')
  check('a tagged one is taken at its word', scorerOf(made(1, 'gop')), 'gop')

  check('one attempt cannot be mixed', mixedScorers([current(1)]), false)
  check('nor can a consistent run', mixedScorers([current(1), current(2)]), false)
  check('old and new together are', mixedScorers([made(1, 'browser'), current(2)]), true)
  check('and an untagged one counts as old', mixedScorers([legacy, current(2)]), true)

  check('a current attempt is current', isCurrent(current(1)), true)
  check('a browser one never is', isCurrent(made(1, 'browser')), false)
  // The revision is what makes a future recalibration re-measure the history
  // by itself: bump it and everything below falls out of date here.
  check('nor is one from an older revision', isCurrent(made(1, 'gop', SCORER_REVISION - 1)), false)
  check('nor one scored before revisions existed', isCurrent(made(1, 'gop')), false)

  check('the one-time refresh includes unmarked current recordings', pendingRescore([current(1), made(2, 'browser'), legacy]), 3)
  check('a fully migrated history has none', pendingRescore([current(1), current(2)].map(a => ({ ...a, assessment: { version: 1, at: 10, source: 'history-rescore' } }))), 0)
  check('a stale revision brings them back', pendingRescore([made(1, 'gop', SCORER_REVISION - 1)]), 1)
})

group('a take survives the trip to the scoring service', async () => {
  // encodeWav writes the header the backend parses. A wrong format tag or
  // block align reads there as "Format not recognised" — a failure that would
  // otherwise surface only at the moment someone pressed record.
  const samples = new Float32Array(1600)
  for (let i = 0; i < samples.length; i++) samples[i] = Math.sin((2 * Math.PI * 220 * i) / 16000)

  const bytes = new Uint8Array(await encodeWav(samples).arrayBuffer())
  const view = new DataView(bytes.buffer)
  const text = (at, n) => String.fromCharCode(...bytes.slice(at, at + n))

  check('it is a RIFF/WAVE file', text(0, 4) + text(8, 4), 'RIFFWAVE')
  check('the fmt chunk is where it says', text(12, 4), 'fmt ')
  check('declared as IEEE float', view.getUint16(20, true), 3)
  check('mono', view.getUint16(22, true), 1)
  check('at 16 kHz', view.getUint32(24, true), 16000)
  check('4 bytes per frame', view.getUint16(32, true), 4)
  check('32 bits per sample', view.getUint16(34, true), 32)
  check('the data chunk sizes the samples', view.getUint32(40, true), samples.length * 4)
  check('and the file is header plus data', bytes.length, 44 + samples.length * 4)
  check('with the samples intact', new Float32Array(bytes.buffer, 44)[7], samples[7])
})

group('phrase library is large and randomized across sessions', () => {
  const bank = indexPhrases(dict, PHRASE_BANK)
  check('library has a large bank of phrases', bank.length >= 200, true)

  const normalizedLine = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const allContentLines = [...PHRASE_BANK.map((phrase) => phrase.text), ...DAILY_TRAINING_SENTENCES, ...DAILY_TRANSFER_SENTENCES]
  check('content lines are unique', new Set(allContentLines.map(normalizedLine)).size, allContentLines.length)

  const drillable = Object.keys(PHONES).filter((p) => p !== 'ɾ' && p !== 'ʔ')
  const undercovered = drillable.filter((p) => bank.filter((one) => one.focus.includes(p)).length < 5)
  check('every drillable sound has at least 5 lines of its own', undercovered.join(' '), '')

  // Multiple randomized drill generations yield varied phrases across sessions
  const sets = new Set()
  for (let i = 0; i < 10; i++) {
    const drill = buildDrill(bank, ['θ', 's', 'i'], 6, { randomize: true })
    sets.add(drill.steps.map((s) => s.phrase.text).join('|'))
  }
  check('randomized drill generation produces different sessions', sets.size > 1, true)
})

group('trouble words bank tracks struggles, persistence and targeted drills', () => {
  const bankPhrases = indexPhrases(dict, PHRASE_BANK)

  // Take with a struggling word: "think" pronounced as "sink"
  const words = targetWords('I think this is good', dict)
  const heard = normalizeRecognized('aɪ sɪŋk ðɪs ɪz ɡʊd').map((p, i) => ({ ...p, start: i / 10, end: (i + 1) / 10 }))
  const report = byWord(words, alignPhones(flatten(words), heard))

  const thinkWord = report.find((w) => w.text.toLowerCase() === 'think')
  check('faulty word is flagged as a struggle', isStruggleReport(thinkWord), true)

  // Record into struggle bank
  let bank = recordWordReports([], report, 1000)
  check('word is stored in bank', bank.some((w) => w.word === 'think'), true)
  const storedThink = bank.find((w) => w.word === 'think')
  check('initial struggle count is 1', storedThink.struggleCount, 1)
  check('weak phone /θ/ recorded', storedThink.weakPhones.some((p) => p.phone === 'θ'), true)
  check('initial status is not struggling a lot', isStrugglingLot(storedThink), false)

  // Second struggle with "think"
  bank = recordWordReports(bank, report, 2000)
  const twiceStruggled = bank.find((w) => w.word === 'think')
  check('struggle count incremented', twiceStruggled.struggleCount, 2)
  check('now qualifies as struggling a lot', isStrugglingLot(twiceStruggled), true)

  // Manual word addition, pin and remove
  const withManual = addManualWord(bank, 'squirrel', dict)
  check('manual word added', withManual.some((w) => w.word === 'squirrel'), true)
  check('manual word is pinned', withManual.find((w) => w.word === 'squirrel').pinned, true)

  const unpinned = togglePinnedWord(withManual, 'squirrel')
  check('word unpinned', unpinned.find((w) => w.word === 'squirrel').pinned, false)

  const withoutWord = removeStruggledWord(unpinned, 'squirrel')
  check('word removed', withoutWord.some((w) => w.word === 'squirrel'), false)

  // Generate targeted drill around the struggled word
  const wordDrill = buildDrillForWord(twiceStruggled, bankPhrases, dict, { randomize: true })
  check('drill for word has steps', wordDrill.steps.length >= 3, true)
  check('first step keeps the word in context', wordDrill.steps[0].phrase.text.includes('think'), true)
  check('first step is not an isolated word', wordDrill.steps[0].phrase.text.trim() !== 'think', true)
  check('drills the weak phone /θ/', wordDrill.steps.some((s) => s.covers.some((c) => c.phone === 'θ')), true)

  // Multi-word drill
  const multiDrill = buildDrillForStruggledWords([twiceStruggled], bankPhrases, dict, { randomize: true })
  check('multi-word drill has steps', multiDrill.steps.length >= 3, true)
})

group('daily deck schedules retention rather than a finite course', () => {
  const base = Date.parse('2026-09-15T09:00:00')
  let state = { cards: [], reviews: [], sessions: [] }
  state = syncCandidates(state, [{
    id: cardIdForSound('Î¸', 's'),
    kind: 'sound',
    label: '/Î¸/ â†’ /s/',
    focusPhones: ['Î¸'],
    confusion: 's',
  }], base)
  check('a new card is immediately due', buildDailyQueue(state.cards, 8, base).length, 1)

  const started = startDailySession(state, 8, base)
  check('daily session contains the new card', started.session.queue[0], 'sound:Î¸:s')
  state = started.state

  const first = recordDailyReview(state, {
    cardId: 'sound:Î¸:s', sessionId: started.session.id, prompt: 'Think clearly.',
    rating: 'good', reviewedAt: base, focusScore: 100, overallScore: 92,
  })
  state = first.state
  check('good moves a card into review', state.cards[0].state, 'review')
  check('good schedules a future review', state.cards[0].dueAt > base, true)
  check('review is recorded separately from attempts', state.reviews.length, 1)

  const secondAt = state.cards[0].dueAt + 1
  const nextSession = startDailySession(state, 8, secondAt)
  state = nextSession.state
  const second = recordDailyReview(state, {
    cardId: 'sound:Î¸:s', sessionId: nextSession.session.id, prompt: 'Three things.',
    rating: 'again', repeatNow: true, reviewedAt: secondAt, focusScore: 20, overallScore: 61,
  })
  state = second.state
  check('again returns a learned card to relearning', state.cards[0].state, 'relearning')
  check('again shortens the next interval', state.cards[0].dueAt < secondAt + 2 * 24 * 60 * 60 * 1000, true)
  check('an explicit repeat keeps the card next', state.sessions.find((s) => s.id === nextSession.session.id).queue[1], 'sound:Î¸:s')
  check('daily summary counts the first rating', summaryForDay(state, localDateKey(base)).reviews, 1)
  check('daily summary counts the later rating', summaryForDay(state, localDateKey(secondAt)).reviews, 1)
})

group('daily practice applies the same individual-sound threshold', () => {
  const step = (value) => ({ expected: 'θ', actual: 'θ', verdict: 'correct', distance: 0,
    expectedIndex: 0, start: 0, end: 0.1, score: value })
  const score = (overall) => ({ overall, correct: 1, close: 0, wrong: 0, missing: 0, extra: 0 })
  check('79 asks for review even with a high average', automaticDailyOutcome(['θ'], [step(79)], score(99), []).retry, true)
  for (const value of [80, 95, 100]) {
    const outcome = automaticDailyOutcome(['θ'], [step(value)], score(value), [])
    check(`${value} meets the threshold`, outcome.retry, false)
    check(`${value} is a good practice take, not a mastery claim`, outcome.rating, 'good')
  }
  check('a custom threshold is honored', automaticDailyOutcome(['θ'], [step(79)], score(79), [], 75).retry, false)
  check('a missing score is unassessed', automaticDailyOutcome(['θ'], [step(100)], null, []).assessed, false)
  check('an unavailable target is unassessed', automaticDailyOutcome(['s'], [step(100)], score(100), []).assessed, false)
  check('missing timing is not a pronunciation failure', automaticDailyOutcome(['θ'], [{ ...step(20), end: null }], score(20), []).assessed, false)
})

group('Daily varies contexts and voices without leaking transfer sentences', () => {
  const base = Date.parse('2026-09-15T09:00:00')
  const voices = [{ uri: 'one', name: 'One', lang: 'en-US' }, { uri: 'two', name: 'Two', lang: 'en-US' }, { uri: 'three', name: 'Three', lang: 'en-GB' }]
  check('automatic voices match the American dictionary', referenceVoicePool(voices).map((v) => v.uri).join(','), 'one,two')
  check('other English accents can be enabled', referenceVoicePool(voices, { excluded: [], accent: 'all' }).length, 3)
  check('zero voices never invents a reference', referenceVoicePool([]).length, 0)
  const preferred = { uri: 'brian', name: 'Microsoft Brian Online (Natural)', lang: 'en-US', local: false }
  check('Brian wins over installed voices', defaultVoice([...voices, preferred]).uri, 'brian')
  check('Daily prefers natural voices over robotic alternatives', referenceVoicePool([...voices, preferred]).map((v) => v.uri).join(','), 'brian')
  const andrew = { ...preferred, uri: 'andrew', name: 'Andrew (Natural · free online)', source: 'edge' }
  check('Daily automatically includes other natural speakers', referenceVoicePool([...voices, preferred, andrew]).length, 2)
  for (const contrast of LISTENING_CONTRASTS) {
    const [a, b] = contrast.words.map((word) => expectedPhones(dict.get(word)?.[0] ?? ''))
    check(`checked contrast ${contrast.words.join('/')} differs by one phone`, a.length === b.length && a.filter((phone, i) => phone !== b[i]).length === 1, true)
    for (const frame of contrast.frames) for (const word of contrast.words) {
      const sentence = frame.replace('{word}', word)
      check(`connected listening context: ${sentence}`, isPracticeContext(sentence, dict, word), true)
    }
  }
  for (const text of [...DAILY_TRAINING_SENTENCES, ...DAILY_TRANSFER_SENTENCES]) {
    check(`known words: ${text}`, analyze(text, dict).stats.unknown, 0)
    check(`no word-in-a-slot templates: ${text}`, isWordCarrier(text), false)
  }
  const uncovered = []
  for (const phone of Object.keys(PHONES).filter((phone) => !['ɾ', 'ʔ'].includes(phone))) {
    let state = syncCandidates({ cards: [], reviews: [], sessions: [] }, [
      { id: phone, kind: 'sound', label: phone, focusPhones: [phone] },
    ], base)
    const started = startDailySession(state, 2, base)
    const routine = planDailyRoutine(started.state, started.session, dict, voices, [], () => 0.37)
    const spoken = routine.steps.filter((step) => step.kind !== 'listening')
    if (spoken.filter((step) => step.kind === 'production').length < 2 || !spoken.some((step) => step.kind === 'transfer')) uncovered.push(phone)
    check(`all spoken contexts include ${phone}`, spoken.every((step) => sentenceFitsCard(step.prompt, state.cards[0], dict)), true)
    check(`two distinct rehearsal sentences for ${phone}`, new Set(spoken.filter((step) => step.kind === 'production').map((step) => step.prompt)).size, 2)
    const transfer = routine.steps.find((step) => step.kind === 'transfer')
    check(`unfamiliar text is held out for ${phone}`, !routine.steps.filter((step) => step !== transfer).some((step) => (step.options ?? [step.prompt]).includes(transfer?.prompt)), true)
  }
  check('each expected sound has training and transfer coverage', uncovered.join(' '), '')
  let state = syncCandidates({ cards: [], reviews: [], sessions: [] }, [
    { id: 'word:think', kind: 'word', label: 'think', word: 'think', focusPhones: ['θ'], confusion: 's' },
  ], base)
  const started = startDailySession(state, 2, base)
  const routine = planDailyRoutine(started.state, started.session, dict, voices.slice(0, 2), [], () => 0.1)
  check('word targets cannot be credited by unrelated sentences', routine.steps.filter((step) => step.kind !== 'listening').every((step) => /\bthink\b/i.test(step.prompt)), true)
  check('known confusion receives its matching contrast', contrastsForCard(state.cards[0], dict)[0].pair.includes('s'), true)
  const listening = routine.steps.filter((step) => step.kind === 'listening')
  check('listening changes reference voice', listening[0].voiceURI !== listening[1].voiceURI, true)
  check('both answer positions are used', new Set(listening.map((step) => step.answer)).size, 2)
  const transfer = routine.steps.find((step) => step.kind === 'transfer')
  const revised = planDailyRoutine(started.state, started.session, dict, voices, [transfer.prompt], () => 0.1)
  check('Studio attempts exclude seen text from transfer', revised.steps.find((step) => step.kind === 'transfer').prompt !== transfer.prompt, true)
  const atTransfer = { ...routine, cursor: routine.steps.indexOf(transfer) }
  state = exposeRoutineStep(updateRoutine(started.state, started.session.id, atTransfer), started.session.id, base)
  const textOnScreen = state.sessions[0].routine.steps[atTransfer.cursor].prompt
  const resumed = exposeRoutineStep(state, started.session.id, base + 100)
  check('resuming a displayed transfer does not mark it familiar to itself', resumed.sessions[0].routine.steps[atTransfer.cursor].fresh, true)
  check('displayed transfer survives a new plan as used', planDailyRoutine(state, started.session, dict, voices, [], () => 0.1).steps.find((step) => step.kind === 'transfer').prompt !== textOnScreen, true)
  const storage = new Map()
  const priorStorage = globalThis.localStorage
  globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) }
  saveDailyState(state)
  const restored = loadDailyState()
  check('session plan and exposure survive reload', JSON.stringify(restored.sessions), JSON.stringify(state.sessions))
  globalThis.localStorage = priorStorage
})

group('voice rotation respects exclusions, current choices and immutable history', () => {
  const brian = { uri: 'brian-online', name: 'Brian Multilingual (Natural · free online)', lang: 'en-US', source: 'edge' }
  const duplicate = { ...brian, uri: 'brian-browser', name: 'Microsoft Brian Online (Natural) - English (United States)', source: 'browser' }
  const emma = { ...brian, uri: 'emma', name: 'Emma (Natural · free online)' }
  const andrew = { ...brian, uri: 'andrew', name: 'Andrew (Natural · free online)' }
  const robotic = { ...brian, uri: 'david', name: 'Microsoft David Desktop', source: 'browser' }
  const voices = [duplicate, brian, emma, andrew, robotic]
  let preferences = { accent: 'en-US', excluded: [] }
  check('duplicate online/browser speaker has a shared identity', voiceKey(brian), voiceKey(duplicate))
  check('duplicates do not inflate speaker variation', uniqueEnglishVoices(voices).length, 4)
  preferences = excludeVoice(preferences, brian)
  check('exclusion covers the browser duplicate too', isExcluded(duplicate, preferences), true)
  check('excluded Brian cannot return through a default fallback', referenceVoicePool(voices, preferences).some((voice) => voiceKey(voice) === voiceKey(brian)), false)
  const storage = new Map()
  const oldStorage = globalThis.localStorage
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  saveVoicePreferences(preferences)
  check('exclusions and accent survive reload', JSON.stringify(loadVoicePreferences()), JSON.stringify(preferences))
  storage.set(VOICE_PREFERENCES_KEY, '{broken')
  check('corrupted preferences recover safely', loadVoicePreferences().excluded.length, 0)
  globalThis.localStorage = oldStorage

  const event = { id: 'e1', stepId: 'past', voiceURI: brian.uri, status: 'answered', first: true, correct: true }
  const routine = { version: 1, cursor: 1, events: [event], notices: [], steps: [
    { id: 'past', voiceURI: brian.uri, prompt: 'Past sentence.' },
    { id: 'now', voiceURI: brian.uri, referenceHeard: true, prompt: 'Current sentence.' },
    { id: 'later', voiceURI: brian.uri, prompt: 'Next sentence.' },
    { id: 'last', voiceURI: brian.uri, prompt: 'Final sentence.' },
  ] }
  const pool = referenceVoicePool(voices, preferences)
  const revised = refreshRoutineVoices(routine, pool, () => .3)
  check('exclusion preserves recorded voice provenance', JSON.stringify(revised.events), JSON.stringify(routine.events))
  check('completed step is untouched', revised.steps[0], routine.steps[0])
  check('pending steps use only allowed speakers', revised.steps.slice(1).every((step) => pool.some((voice) => voice.uri === step.voiceURI)), true)
  check('new voice requires another complete listen', revised.steps[1].referenceHeard, false)
  check('rotation repair leaves prompts and step IDs alone', revised.steps.map((step) => `${step.id}:${step.prompt}`).join('|'), routine.steps.map((step) => `${step.id}:${step.prompt}`).join('|'))
  check('adjacent pending cards change speaker', revised.steps.slice(2).every((step, index) => step.voiceURI !== revised.steps[index + 1].voiceURI), true)
  check('reload cannot reroll repaired voices', refreshRoutineVoices(revised, pool), revised)
  const explicit = changeRoutineVoice({ ...revised, cursor: 2 }, revised.steps[1].voiceURI)
  check('another voice is not undone by automatic rotation', refreshRoutineVoices(explicit, pool).steps[2].voiceURI, revised.steps[1].voiceURI)
  preferences = excludeVoice(excludeVoice(preferences, emma), andrew)
  check('excluding every natural voice does not activate robotic fallbacks', referenceVoicePool(voices, preferences).length, 0)
  check('empty pool never resurrects a blocked voice', refreshRoutineVoices(revised, []).steps[1].voiceURI, undefined)
  check('one remaining voice is reusable', refreshRoutineVoices(revised, [emma]).steps.slice(1).every((step) => step.voiceURI === emma.uri), true)

  const base = Date.parse('2026-09-15T09:00:00')
  const state = syncCandidates({ cards: [], reviews: [], sessions: [] }, [
    { id: 'theta', kind: 'sound', label: 'theta', focusPhones: ['θ'] },
    { id: 'ship', kind: 'sound', label: 'ship', focusPhones: ['ʃ'] },
  ], base)
  const started = startDailySession(state, 2, base)
  const plan = planDailyRoutine(started.state, started.session, dict, [brian, emma, andrew], [], () => .3)
  check('voices rotate in final on-screen order, not target-building order', plan.steps.slice(1).every((step, index) => step.voiceURI !== plan.steps[index].voiceURI), true)
  check('use the whole pool before repeating a speaker', new Set(plan.steps.slice(0, 3).map((step) => step.voiceURI)).size, 3)
})

group('word practice uses real contexts and migrates only pending carrier exercises', () => {
  const base = Date.parse('2026-09-15T09:00:00')
  const word = 'astronomer'
  const source = 'The astronomer watched the comet above the valley.'
  const focusPhones = expectedPhones(dict.get(word)[0]).slice(0, 2)
  const entry = { word, display: word, ipa: dict.get(word)[0], weakPhones: focusPhones.map((phone) => ({ phone, count: 1 })) }
  check('uncovered word never gets a fabricated drill', buildDrillForWord(entry, [], dict).steps.length, 0)
  check('a supplied sentence can become a word drill', buildDrillForWord({ ...entry, contexts: [source] }, [], dict).steps[0].phrase.text, source)
  check('a single word is not a sentence', contextsForWord(word, dict, [word]).length, 0)
  check('old unquoted carrier is rejected', isPracticeContext(`Please say ${word} once again.`, dict, word), false)
  check('old quoted carrier is rejected', isPracticeContext(`The storyteller used "${word}" while describing the journey.`, dict, word), false)
  const reportWords = targetWords(source, dict)
  const reports = byWord(reportWords, flatten(reportWords).map((expected, i) => ({ expected, expectedIndex: i,
    actual: expected, verdict: 'wrong', score: 20, distance: 0, start: i / 10, end: (i + 1) / 10 })))
  const saved = recordWordReports([], reports, base, source).find((item) => item.word === word)
  check('trouble bank retains the original sentence', saved.contexts[0], source)

  let state = syncCandidates({ cards: [], reviews: [], sessions: [] }, [{ id: word, kind: 'word', word, label: word, focusPhones }], base)
  const start = startDailySession(state, 2, base)
  const noContext = planDailyRoutine(start.state, start.session, dict, [])
  check('Daily does not pretend to practise an uncovered word', noContext.steps.some((step) => step.kind === 'production'), false)
  check('Daily explains missing contexts', noContext.notices.some((text) => text.includes('no meaningful practice sentences')), true)
  const withContext = planDailyRoutine(start.state, start.session, dict, [], [source])
  check('Daily reuses the actual source sentence', withContext.steps.find((step) => step.kind === 'production').prompt, source)
  check('source sentences cannot masquerade as unfamiliar tests', withContext.steps.some((step) => step.kind === 'transfer' && step.prompt === source), false)

  state = syncCandidates({ cards: [], reviews: [], sessions: [] }, [{ id: 'think', kind: 'word', word: 'think', label: 'think', focusPhones: ['θ'] }], base)
  const started = startDailySession(state, 2, base)
  const legacy = { version: 1, cursor: 1, notices: [], steps: [
    { id: 'past', cardId: 'think', kind: 'production', prompt: 'The scholar explained why "think" appeared in the ancient text.' },
    { id: 'pending', cardId: 'think', kind: 'production', prompt: 'She repeated "think" before continuing the story.', referenceHeard: true, exposedAt: base },
    { id: 'held-out', cardId: 'think', kind: 'transfer', prompt: 'A traveler remembered hearing "think" during the announcement.', fresh: true },
  ], events: [{ id: 'saved-score', stepId: 'past', cardId: 'think', kind: 'production', status: 'scored', prompt: 'The scholar explained why "think" appeared in the ancient text.', first: true, overallScore: 83, at: base }] }
  state = updateRoutine(started.state, started.session.id, legacy)
  const refreshed = refreshLegacyContexts(state, state.sessions[0], dict, [])
  check('recorded history remains byte-for-byte intact', JSON.stringify(refreshed.events), JSON.stringify(legacy.events))
  check('completed prompts remain as recorded', refreshed.steps[0].prompt, legacy.steps[0].prompt)
  check('pending prompts now have meaningful contexts', refreshed.steps.slice(1).every((step) => isPracticeContext(step.prompt, dict, 'think')), true)
  check('replacements must be listened to again', !!refreshed.steps[1].referenceHeard, false)
  check('migration cannot load stale scoring against a new prompt', refreshed.steps[1].id !== legacy.steps[1].id, true)
  state = updateRoutine(state, started.session.id, refreshed)
  check('natural plans never reroll on reload', refreshLegacyContexts(state, state.sessions[0], dict, []), undefined)
})

group('Daily corrections and blacklists survive old sources, saved sessions and reloads', () => {
  const base = Date.parse('2026-09-15T09:00:00')
  const original = 'The astronomer watch the comet above the valley.'
  const corrected = 'The astronomer watched the comet above the valley.'
  const revised = 'The astronomer watched a comet above the valley.'
  let preferences = changeDailySentence([], original, { text: corrected })
  preferences = changeDailySentence(preferences, corrected, { text: revised })
  check('oldest source receives latest correction', resolveDailySentence(original, preferences), revised)
  check('intermediate attempts receive latest correction', resolveDailySentence(corrected, preferences), revised)
  check('paragraphs split before applying corrections and deduplication', dailySentences([`${original} ${corrected}`, revised], preferences).join('|'), revised)
  preferences = changeDailySentence(preferences, original, { blocked: true })
  for (const text of [original, corrected, revised.toUpperCase().replace('.', '!!!')]) {
    check('blacklist covers every spelling and punctuation variant', resolveDailySentence(text, preferences), null)
  }
  preferences = changeDailySentence(preferences, original, { blocked: false })
  check('restoring an old spelling preserves the latest correction', resolveDailySentence(original, preferences), revised)
  let state = syncCandidates({ cards: [], reviews: [], sessions: [], sentencePreferences: preferences }, [{
    id: 'astronomer', kind: 'word', label: 'astronomer', word: 'astronomer', focusPhones: expectedPhones(dict.get('astronomer')[0]).slice(0, 2),
  }], base)
  const start = startDailySession(state, 2, base)
  const plan = planDailyRoutine(start.state, start.session, dict, [], [original, corrected], () => .3)
  check('new production uses only the correction', plan.steps.filter((step) => step.kind === 'production').every((step) => step.prompt === revised), true)
  check('saved correction remains available after old attempts are pruned', planDailyRoutine(start.state, start.session, dict, []).steps.some((step) => step.prompt === revised), true)

  const oldStep = { id: 'now', cardId: 'astronomer', kind: 'transfer', prompt: original, referenceHeard: true, fresh: true, exposedAt: base }
  const event = { id: 'recorded', stepId: 'now', cardId: 'astronomer', kind: 'transfer', prompt: original, status: 'scored', first: true, fresh: true, overallScore: 90, rating: 'good', at: base }
  state = updateRoutine(start.state, start.session.id, { version: 1, steps: [{ ...oldStep, id: 'past' }, oldStep, { ...oldStep, id: 'later' }], cursor: 1, events: [event], notices: [] })
  state = refreshRoutineSentences(state, dict, base + 1)
  check('completed sentence is not rewritten', state.sessions[0].routine.steps[0].prompt, original)
  check('current and queued sentences are corrected', state.sessions[0].routine.steps.slice(1).every((step) => step.prompt === revised), true)
  check('correction invalidates old scoring and heard reference', state.sessions[0].routine.steps[1].id !== oldStep.id && !state.sessions[0].routine.steps[1].referenceHeard, true)
  check('edited transfer becomes rehearsal', state.sessions[0].routine.steps[1].kind, 'production')
  check('recorded result retains its original text and score', JSON.stringify(state.sessions[0].routine.events), JSON.stringify([event]))
  check('reconciliation cannot reroll corrected sessions', refreshRoutineSentences(state, dict), state)
  state = { ...state, sentencePreferences: changeDailySentence(state.sentencePreferences, corrected, { blocked: true }) }
  state = refreshRoutineSentences(state, dict, base + 2)
  check('all pending occurrences are removed together', state.sessions[0].routine.steps.length, 1)
  check('removing the last pending sentence closes the saved session', !!state.sessions[0].endedAt, true)
  check('blacklisting preserves earned review scheduling', state.reviews.length, 1)
  check('blacklisting does not create a failure or skip result', state.sessions[0].routine.events.length, 1)
  const next = startDailySession(state, 2, state.cards[0].dueAt + 86400000)
  const nextPlan = planDailyRoutine(next.state, next.session, dict, [], [original, corrected, revised])
  check('old attempts, prompt history and recall cannot resurrect a blacklist', nextPlan.steps.every((step) => ![original, corrected, revised].includes(step.prompt)), true)

  const storage = new Map()
  const priorStorage = globalThis.localStorage
  try {
    globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
    saveDailyState(state)
    const restored = loadDailyState()
    check('corrections, aliases and blacklist survive reload', isDeepStrictEqual(restored.sentencePreferences, state.sentencePreferences), true)
    check('reload still excludes the original typo', resolveDailySentence(original, restored.sentencePreferences), null)
    storage.set('phonetics-lab:daily', JSON.stringify({ cards: [], reviews: [], sessions: [], sentencePreferences: [null, { text: 3 }, { text: 'bad', originals: null }] }))
    check('malformed sentence preferences are ignored safely', loadDailyState().sentencePreferences.length, 0)
    storage.set('phonetics-lab:daily', JSON.stringify({ cards: [], reviews: [], sessions: [] }))
    check('legacy state loads without sentence preferences', loadDailyState().sentencePreferences.length, 0)
  } finally { globalThis.localStorage = priorStorage }

  const sounds = syncCandidates({ cards: [], reviews: [], sessions: [] }, [{ id: 'theta', kind: 'sound', label: 'theta', focusPhones: ['θ'] }], base)
  const soundStart = startDailySession(sounds, 2, base)
  const soundPlan = planDailyRoutine(soundStart.state, soundStart.session, dict, [], [], () => .3)
  const listening = soundPlan.steps.find((step) => step.kind === 'listening')
  const distractor = listening.options[1 - listening.answer]
  let blocked = { ...soundStart.state, sentencePreferences: changeDailySentence([], distractor, { blocked: true }) }
  blocked = updateRoutine(blocked, soundStart.session.id, soundPlan)
  blocked = refreshRoutineSentences(blocked, dict, base)
  check('blacklisting a distractor removes the entire listening trial', !blocked.sessions[0].routine.steps.some((step) => step.options?.includes(distractor)), true)
  const replanned = planDailyRoutine(blocked, soundStart.session, dict, [], [], () => .3)
  check('blacklisted listening options never return in a new plan', !replanned.steps.some((step) => (step.options ?? [step.prompt]).some((text) => sentenceKey(text) === sentenceKey(distractor))), true)
  const listeningEdits = listening.options.reduce((prefs, text) => changeDailySentence(prefs, text, { text: text.replace(/[.!?]$/, ' today.') }), [])
  const edited = refreshRoutineSentences(updateRoutine({ ...soundStart.state, sentencePreferences: listeningEdits }, soundStart.session.id, soundPlan), dict, base)
  const trial = edited.sessions[0].routine.steps.find((step) => step.id === `${listening.id}:edited`)
  check('editing both listening options preserves the answer position', trial?.prompt, trial?.options[trial?.answer])
  check('edited listening requires a new complete reference', trial?.referenceHeard, false)
  const allBlocked = soundPlan.steps.reduce((prefs, step) => (step.options ?? [step.prompt]).reduce((current, text) => changeDailySentence(current, text, { blocked: true }), prefs), [])
  const alternate = planDailyRoutine({ ...soundStart.state, sentencePreferences: allBlocked }, soundStart.session, dict, [], [], () => .3)
  check('authored production, listening and transfer all honor exclusions', alternate.steps.every((step) => (step.options ?? [step.prompt]).every((text) => resolveDailySentence(text, allBlocked) !== null)), true)
})

group('Daily preserves first responses and schedules only independent evidence', () => {
  const base = Date.parse('2026-09-15T09:00:00')
  let state = syncCandidates({ cards: [], reviews: [], sessions: [] }, [{ id: 'target', kind: 'sound', label: 'θ', focusPhones: ['θ'], confusion: 's' }], base)
  const start = startDailySession(state, 2, base)
  const id = start.session.id
  state = updateRoutine(start.state, id, planDailyRoutine(start.state, start.session, dict, [{ uri: 'one', lang: 'en-US' }], [], () => 0.2))
  let routine = state.sessions[0].routine
  const firstStep = routine.steps[0]
  const unheard = recordRoutineEvent(state, id, { stepId: firstStep.id, status: 'answered', choice: firstStep.answer, at: base })
  check('cannot answer unheard audio', unheard.sessions[0].routine.events.length, 0)
  state = markReferenceHeard(state, id, 'one')
  state = recordRoutineEvent(state, id, { stepId: firstStep.id, status: 'answered', choice: 1 - firstStep.answer, at: base + 1 })
  state = recordRoutineEvent(state, id, { stepId: firstStep.id, status: 'answered', choice: firstStep.answer, at: base + 2 })
  check('answer cannot be replaced after feedback', state.sessions[0].routine.events.length, 1)
  check('incorrect first answer stays incorrect', state.sessions[0].routine.events[0].correct, false)
  state = advanceRoutine(state, id, base + 3)
  state = advanceRoutine(state, id, base + 4)
  check('skipped listening does not count as wrong', routineSummary(state.sessions).listening.count, 1)
  for (let i = 0; i < 2; i++) {
    routine = state.sessions[0].routine
    const step = routine.steps[routine.cursor]
    state = recordRoutineEvent(state, id, { stepId: step.id, status: 'scored', overallScore: 98, rating: 'easy', attemptAt: base + 10 + i, at: base + 10 + i })
    state = advanceRoutine(state, id, base + 12 + i)
  }
  routine = state.sessions[0].routine
  const step = routine.steps[routine.cursor]
  state = exposeRoutineStep(state, id, base + 15)
  const input = { stepId: step.id, status: 'scored', overallScore: 71, rating: 'again', attemptAt: base + 20, at: base + 20 }
  state = recordRoutineEvent(state, id, input)
  state = recordRoutineEvent(state, id, input)
  check('duplicate scoring callback is idempotent', state.sessions[0].routine.events.filter((event) => event.stepId === step.id).length, 1)
  state = markReferenceHeard(state, id, 'one')
  state = recordRoutineEvent(state, id, { ...input, overallScore: 100, rating: 'easy', attemptAt: base + 30, at: base + 30 })
  check('extra takes do not change transfer scores', routineSummary(state.sessions).transfer.average, 71)
  check('repetitions are recorded separately', routineSummary(state.sessions).repetitions, 1)
  check('weak transfer controls an otherwise high rehearsal score', routineCardRating(state.sessions[0].routine.events), 'again')
  state = advanceRoutine(state, id, base + 40)
  check('one target receives one schedule update', state.reviews.length, 1)
  check('finishing ends the session', !!state.sessions[0].endedAt, true)
  check('repeat calls cannot schedule it twice', advanceRoutine(state, id, base + 50).reviews.length, 1)
  const later = startDailySession(state, 2, state.cards[0].dueAt + 24 * 60 * 60 * 1000)
  const laterPlan = planDailyRoutine(later.state, later.session, dict, [], [], () => 0.2)
  check('later review begins with delayed recall', laterPlan.steps[0].kind, 'recall')
  check('a successful listening answer cannot manufacture speech progress', routineCardRating([{ kind: 'listening', first: true, status: 'answered', correct: true }]), null)
  check('rehearsal alone keeps a conservative interval', routineCardRating([{ kind: 'production', first: true, status: 'scored', rating: 'easy' }]), 'hard')
  const mixed = routineSummary([{ routine: { events: [
    { kind: 'production', first: true, status: 'scored', overallScore: 50, scorer: 'gop', revision: 1 },
    { kind: 'production', first: true, status: 'scored', overallScore: 100, scorer: 'browser' },
  ] } }])
  check('different scorers are not averaged together', mixed.production.average, null)
  let limited = syncCandidates({ cards: [], reviews: [], sessions: [] }, ['θ', 's', 'i', 'ɪ'].map((phone) => ({
    id: phone, kind: 'sound', label: phone, focusPhones: [phone],
  })), base)
  const intake = startDailySession(limited, 4, base)
  check('only two new targets enter the first session', intake.session.queue.length, 2)
  limited = intake.state
  for (const cardId of intake.session.queue) limited = recordDailyReview(limited, {
    cardId, sessionId: intake.session.id, prompt: 'We think the ship is ready.', rating: 'good', reviewedAt: base + 100,
  }).state
  check('another session cannot introduce two more targets today', startDailySession(limited, 4, base + 200).session, null)
})

await group('online reference cancellation and errors never count as heard audio', async () => {
  const originalFetch = globalThis.fetch
  const OriginalAudio = globalThis.Audio
  const pending = []
  const played = []
  let ended = 0
  let errors = 0
  globalThis.fetch = () => new Promise((resolve) => pending.push(resolve))
  globalThis.Audio = class {
    constructor(url) { this.url = url; played.push(this) }
    play() { return Promise.resolve() }
    pause() {}
  }
  const finishFetch = () => pending.shift()({ ok: true, blob: async () => new Blob(['audio'], { type: 'audio/mpeg' }) })
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const options = { voiceURI: 'edge:en-US-BrianMultilingualNeural', onEnd: () => ended++, onError: () => errors++ }
  try {
    synthesise('The traveler crossed the old bridge.', options)
    stopSpeech()
    finishFetch()
    await settle()
    check('a cancelled late response never starts audio', played.length, 0)
    check('cancellation cannot unlock a listening answer', ended, 0)
    check('deliberate cancellation is not a playback error', errors, 0)
    synthesise('The sailor opened the garden gate.', options)
    finishFetch()
    await settle()
    check('downloading audio does not mean it was heard', ended, 0)
    played[0].onerror()
    check('an audio decoding error is reported', errors, 1)
    check('an audio decoding error is not successful playback', ended, 0)
    synthesise('The river flowed beyond the village.', options)
    finishFetch()
    await settle()
    played[1].onended()
    played[1].onended()
    check('completed playback unlocks exactly once', ended, 1)
  } finally {
    stopSpeech()
    globalThis.fetch = originalFetch
    globalThis.Audio = OriginalAudio
  }
})

group('pronunciation stats tracks profile, articulatory diagnostics and evolution over time', () => {
  const baseTime = Date.parse('2026-09-20T10:00:00')
  const laterTime = Date.parse('2026-09-21T10:00:00')

  // Early attempt with /θ/ substituted with /s/
  const attempt1 = {
    target: 'think clearly',
    at: baseTime,
    durationMs: 3200,
    score: { overall: 60, correct: 4, close: 1, wrong: 2, missing: 0, extra: 0 },
    aligned: [
      { expected: 'θ', actual: 's', verdict: 'wrong', distance: 0.3, expectedIndex: 0, start: 0, end: 0.1 },
      { expected: 'ɪ', actual: 'ɪ', verdict: 'correct', distance: 0, expectedIndex: 1, start: 0.1, end: 0.2 },
      { expected: 'ŋ', actual: 'ŋ', verdict: 'correct', distance: 0, expectedIndex: 2, start: 0.2, end: 0.3 },
      { expected: 'k', actual: 'k', verdict: 'correct', distance: 0, expectedIndex: 3, start: 0.3, end: 0.4 },
    ],
  }

  // Second take: /θ/ pronounced correctly!
  const attempt2 = {
    target: 'think clearly',
    at: laterTime,
    durationMs: 3000,
    score: { overall: 95, correct: 7, close: 0, wrong: 0, missing: 0, extra: 0 },
    aligned: [
      { expected: 'θ', actual: 'θ', verdict: 'correct', distance: 0, expectedIndex: 0, start: 0, end: 0.1 },
      { expected: 'ɪ', actual: 'ɪ', verdict: 'correct', distance: 0, expectedIndex: 1, start: 0.1, end: 0.2 },
      { expected: 'ŋ', actual: 'ŋ', verdict: 'correct', distance: 0, expectedIndex: 2, start: 0.2, end: 0.3 },
      { expected: 'k', actual: 'k', verdict: 'correct', distance: 0, expectedIndex: 3, start: 0.3, end: 0.4 },
    ],
  }

  const wordReports = byWord(targetWords('think clearly', dict), attempt1.aligned)
  const struggles = recordWordReports([], wordReports, baseTime, 'think clearly')
  check('struggle bank captures firstSeen and history', struggles[0]?.history?.length, 1)

  const emptyDaily = { cards: [], reviews: [], sessions: [] }
  const stats = analyzeStats([attempt1, attempt2], struggles, emptyDaily, 'all', laterTime)

  check('total attempts recorded', stats.kpis.totalAttempts, 2)
  check('average score calculated', stats.kpis.avgScore, 78)
  check('total speaking duration captured', stats.kpis.totalAudioDurationMs, 6200)
  check('streak computed', stats.kpis.currentStreakDays, 2)

  // Problem phonemes identification
  const thetaStat = stats.problemPhones.find((p) => p.phone === 'θ')
  check('theta is tracked in problem sounds', Boolean(thetaStat), true)
  check('theta confusion records s', thetaStat?.confusions[0]?.phone, 's')
  check('theta trend shows improvement', thetaStat?.trend, 'improving')

  // Articulatory categories
  check('manner breakdown includes fricatives', stats.articulatoryProfile.manners.some((m) => m.id === 'fricative'), true)
  check('place breakdown includes dental', stats.articulatoryProfile.places.some((p) => p.id === 'dental'), true)

  // Word evolution
  const thinkWord = stats.troubleWords.find((w) => w.word === 'think')
  check('trouble word has firstScore recorded', thinkWord?.firstScore, 82)

  // Timeline points
  check('timeline points count matches attempts', stats.timelinePoints.length, 2)
  check('timeline rolling average computed', stats.timelinePoints[1]?.rollingAvg, 78)

  // JSON export
  const exported = exportStatsReport(stats)
  check('export produces valid JSON string', exported.includes('"kpis"') && exported.includes('"problemPhonemes"'), true)
})

group('priority lists track conversational trouble words, common English usage and regressions', () => {
  const t0 = Date.parse('2026-09-18T10:00:00')
  const t1 = Date.parse('2026-09-19T10:00:00')
  const t2 = Date.parse('2026-09-20T10:00:00')
  const t3 = Date.parse('2026-09-21T10:00:00')

  // Early takes where /ɹ/ in "really" was pronounced correctly
  const take1 = {
    target: 'really good',
    at: t0,
    durationMs: 2500,
    mode: 'free',
    score: { overall: 95, correct: 8, close: 0, wrong: 0, missing: 0, extra: 0 },
    aligned: [
      { expected: 'ɹ', actual: 'ɹ', verdict: 'correct', distance: 0, expectedIndex: 0, start: 0, end: 0.1 },
      { expected: 'ɪ', actual: 'ɪ', verdict: 'correct', distance: 0, expectedIndex: 1, start: 0.1, end: 0.2 },
      { expected: 'l', actual: 'l', verdict: 'correct', distance: 0, expectedIndex: 2, start: 0.2, end: 0.3 },
      { expected: 'i', actual: 'i', verdict: 'correct', distance: 0, expectedIndex: 3, start: 0.3, end: 0.4 },
      { expected: 'ɡ', actual: 'ɡ', verdict: 'correct', distance: 0, expectedIndex: 4, start: 0.4, end: 0.5 },
      { expected: 'ʊ', actual: 'ʊ', verdict: 'correct', distance: 0, expectedIndex: 5, start: 0.5, end: 0.6 },
      { expected: 'd', actual: 'd', verdict: 'correct', distance: 0, expectedIndex: 6, start: 0.6, end: 0.7 },
    ],
  }

  // Later spontaneous take 2: "really" used again in free speech, but /ɹ/ was substituted with /w/ (wrong)
  const take2 = {
    target: 'really nice',
    at: t1,
    durationMs: 2800,
    mode: 'free',
    score: { overall: 55, correct: 5, close: 0, wrong: 2, missing: 0, extra: 0 },
    aligned: [
      { expected: 'ɹ', actual: 'w', verdict: 'wrong', distance: 0.4, expectedIndex: 0, start: 0, end: 0.1 },
      { expected: 'ɪ', actual: 'ɪ', verdict: 'correct', distance: 0, expectedIndex: 1, start: 0.1, end: 0.2 },
      { expected: 'l', actual: 'l', verdict: 'correct', distance: 0, expectedIndex: 2, start: 0.2, end: 0.3 },
      { expected: 'i', actual: 'i', verdict: 'correct', distance: 0, expectedIndex: 3, start: 0.3, end: 0.4 },
      { expected: 'n', actual: 'n', verdict: 'correct', distance: 0, expectedIndex: 4, start: 0.4, end: 0.5 },
      { expected: 'aɪ', actual: 'aɪ', verdict: 'correct', distance: 0, expectedIndex: 5, start: 0.5, end: 0.6 },
      { expected: 's', actual: 's', verdict: 'correct', distance: 0, expectedIndex: 6, start: 0.6, end: 0.7 },
    ],
  }

  // Later spontaneous take 3: "really" used yet again in free speech with error on /ɹ/
  const take3 = {
    target: 'really hard',
    at: t2,
    durationMs: 3100,
    mode: 'free',
    score: { overall: 50, correct: 4, close: 0, wrong: 3, missing: 0, extra: 0 },
    aligned: [
      { expected: 'ɹ', actual: 'w', verdict: 'wrong', distance: 0.4, expectedIndex: 0, start: 0, end: 0.1 },
      { expected: 'ɪ', actual: 'ɪ', verdict: 'correct', distance: 0, expectedIndex: 1, start: 0.1, end: 0.2 },
      { expected: 'l', actual: 'l', verdict: 'correct', distance: 0, expectedIndex: 2, start: 0.2, end: 0.3 },
      { expected: 'i', actual: 'i', verdict: 'correct', distance: 0, expectedIndex: 3, start: 0.3, end: 0.4 },
      { expected: 'h', actual: 'h', verdict: 'correct', distance: 0, expectedIndex: 4, start: 0.4, end: 0.5 },
      { expected: 'ɑ', actual: 'ɑ', verdict: 'correct', distance: 0, expectedIndex: 5, start: 0.5, end: 0.6 },
      { expected: 'ɹ', actual: 'w', verdict: 'wrong', distance: 0.4, expectedIndex: 6, start: 0.6, end: 0.7 },
      { expected: 'd', actual: 'd', verdict: 'correct', distance: 0, expectedIndex: 7, start: 0.7, end: 0.8 },
    ],
  }

  const reports = [
    ...byWord(targetWords('really good', dict), take1.aligned),
    ...byWord(targetWords('really nice', dict), take2.aligned),
    ...byWord(targetWords('really hard', dict), take3.aligned),
  ]
  let struggles = []
  struggles = recordWordReports(struggles, reports.slice(0, 2), t0, 'really good')
  struggles = recordWordReports(struggles, reports.slice(2, 4), t1, 'really nice')
  struggles = recordWordReports(struggles, reports.slice(4, 7), t2, 'really hard')

  const emptyDaily = { cards: [], reviews: [], sessions: [] }
  const stats = analyzeStats([take1, take2, take3], struggles, emptyDaily, 'all', t3, common, dict)

  // 1. Free speech priorities check
  const topFreePriority = stats.freeSpeechPriorities[0]
  check('free speech priority identifies really as #1 conversational trouble word', topFreePriority?.word, 'really')
  check('free speech count captures 3 takes', topFreePriority?.freeSpeechCount, 3)
  check('free speech error count captured', topFreePriority?.freeSpeechFailures, 2)
  check('free speech captures spoken sentence context', (topFreePriority?.recentSentences?.length ?? 0) > 0, true)
  check('free speech word is marked as regressing', topFreePriority?.isRegressing, true)

  // 2. Regressing phonemes check (/ɹ/ dropped from 100% early to 0% late)
  const rStat = stats.regressingPhones.find((p) => p.phone === 'ɹ')
  check('regressing sound detected for rhotic', Boolean(rStat), true)
  check('regressing sound specifies drop points', (rStat?.dropPoints ?? 0) >= 10, true)
  check('regressing sound notes dominant substitution w', rStat?.dominantConfusion, 'w')
  check('regressing sound includes articulatory advice', Boolean(rStat?.coachingAdvice), true)

  // 3. Regressing trouble words check
  const reallyRegressing = stats.regressingWords.find((w) => w.word === 'really')
  check('regressing words identifies really with score drop', Boolean(reallyRegressing), true)
  check('regressing word records drop points', (reallyRegressing?.dropPoints ?? 0) >= 10, true)

  // 4. Common American English priority list check
  check('common English priority list is populated', stats.commonEnglishPriorities.length > 0, true)
  const topCommon = stats.commonEnglishPriorities[0]
  check('top common word has priorityRank assigned', topCommon?.priorityRank, 1)
  check('top common word has American English frequency rank', (topCommon?.englishRank ?? 0) > 0, true)
  // Unpracticed high-frequency words containing weak sound /ɹ/
  const unpracticedR = stats.commonEnglishPriorities.find((w) => w.isUnpracticedWithWeakSounds && w.weakPhones.includes('ɹ'))
  check('suggests unpracticed high-frequency American words containing weak sound', Boolean(unpracticedR), true)

  // 5. JSON export includes the priority lists and regressions
  const jsonReport = exportStatsReport(stats)
  const parsed = JSON.parse(jsonReport)
  check('exported JSON includes freeSpeechPriorities', (parsed.freeSpeechPriorities?.length ?? 0) > 0, true)
  check('exported JSON includes commonEnglishPriorities', (parsed.commonEnglishPriorities?.length ?? 0) > 0, true)
  check('exported JSON includes regressingPhonemes', (parsed.regressingPhonemes?.length ?? 0) > 0, true)
  check('exported JSON includes regressingWords', (parsed.regressingWords?.length ?? 0) > 0, true)
})

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
