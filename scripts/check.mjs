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
import { lookupWord } from '../src/lib/lookup.ts'
import { applyFlapping, respell, transcribe } from '../src/lib/phonology.ts'
import { tokenize } from '../src/lib/tokenize.ts'
import { alignPhones, expectedPhones, normalizeRecognized, scoreAlignment } from '../src/lib/align.ts'
import { phoneDistance } from '../src/lib/phonefeatures.ts'
import {
  byWord, comparePhones, compareWords, dominant, flatten, focusScore, targetWords,
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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const dict = new Map()
const raw = await readFile(join(ROOT, 'public', 'dict', 'cmudict-ipa.txt'), 'utf8')
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
  const words = targetWords('think about this', dict)
  const want = flatten(words)
  const aligned = alignPhones(want, normalizeRecognized('sɪŋk əbaʊt ðɪs'))

  const [th] = focusScore(aligned, ['θ'])
  check('the drilled sound is counted', th.seen, 1)
  check('and marked wrong when it is', th.right, 0)

  const clean = alignPhones(want, normalizeRecognized('θɪŋk əbaʊt ðɪs'))
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

  check('everything not current is pending', pendingRescore([current(1), made(2, 'browser'), legacy]), 2)
  check('a fully migrated history has none', pendingRescore([current(1), current(2)]), 0)
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

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
