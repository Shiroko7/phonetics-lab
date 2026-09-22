/**
 * Compares what the speaker actually said against what the word should sound
 * like, phone by phone.
 *
 * The recogniser emits espeak-flavoured IPA covering every language it was
 * trained on, so its output is first folded into the General American inventory
 * the rest of the app uses. The two sequences are then aligned with
 * Needleman-Wunsch, scored by articulatory distance rather than exact match, so
 * a near miss reads as a near miss instead of a flat error.
 */

import { FEATURES, phoneDistance } from './phonefeatures.ts'
import { splitPhones } from './phonology.ts'

/** Phones the comparison knows how to score; anything else is discarded. */
const KNOWN: ReadonlySet<string> = new Set(Object.keys(FEATURES))

/** Diacritics and suprasegmentals the comparison ignores. */
const STRIP = /[ˈˌːˑ̃ʰʲ̞̩̯̰̥̈͡\.\s]/g

/** espeak symbols folded onto their nearest General American equivalent. */
const FOLD: Record<string, string> = {
  // Vowel qualities espeak distinguishes but GenAm does not.
  'ɐ': 'ʌ', 'ɜ': 'ɝ', 'ɘ': 'ə', 'ɵ': 'ə', 'ᵻ': 'ɪ', 'ɨ': 'ɪ', 'ʉ': 'u',
  'e': 'ɛ', 'o': 'oʊ', 'ɒ': 'ɑ', 'a': 'æ', 'ɶ': 'æ', 'ɤ': 'ʌ', 'ø': 'ɛ', 'œ': 'ɛ',
  'y': 'i', 'ʏ': 'ɪ', 'ɪ̈': 'ɪ',
  // Rhotics: every trill or approximant variant is English /ɹ/.
  'r': 'ɹ', 'ʁ': 'ɹ', 'ʀ': 'ɹ', 'ɻ': 'ɹ', 'ɽ': 'ɹ', 'ʋ': 'ɹ',
  // Consonant variants.
  'ɫ': 'l', 'ɬ': 'l', 'ɭ': 'l', 'ʎ': 'l',
  'g': 'ɡ', 'ɢ': 'ɡ', 'x': 'k', 'χ': 'k', 'q': 'k', 'ɣ': 'ɡ',
  'ɸ': 'f', 'β': 'v', 'ʈ': 't', 'ɖ': 'd', 'ɳ': 'n', 'ɲ': 'n', 'ɴ': 'ŋ',
  'ç': 'ʃ', 'ʝ': 'ʒ', 'ʂ': 'ʃ', 'ʐ': 'ʒ', 'ɕ': 'ʃ', 'ʑ': 'ʒ',
  'ts': 's', 'dz': 'z', 'ɦ': 'h', 'ʕ': 'h', 'ħ': 'h',
}

/** Adjacent pairs the recogniser emits separately that are one English phone. */
const MERGE: Record<string, string> = {
  'ɛɪ': 'eɪ', 'eɪ': 'eɪ', 'æɪ': 'aɪ', 'aɪ': 'aɪ', 'ɑɪ': 'aɪ',
  'ɔɪ': 'ɔɪ', 'oɪ': 'ɔɪ',
  'oʊʊ': 'oʊ', 'oʊ': 'oʊ', 'əʊ': 'oʊ',
  'æʊ': 'aʊ', 'aʊ': 'aʊ', 'ɑʊ': 'aʊ',
  'tʃ': 'tʃ', 'dʒ': 'dʒ',
  'ɝɹ': 'ɝ', 'əɹ': 'ɚ', 'ʌɹ': 'ɝ',
}

/**
 * Fold recogniser output into the app's phone inventory: strip diacritics, map
 * foreign qualities onto English ones, then glue separated diphthongs together.
 */
export function normalizeRecognized(input: string | Heard[]): Heard[] {
  // A bare string is output with no timings behind it — the regression suite,
  // and anywhere else only the sounds matter.
  const units: Heard[] =
    typeof input === 'string'
      ? splitPhones(input.replace(STRIP, '')).map((phone) => ({ phone, start: 0, end: 0 }))
      : input.flatMap((unit) =>
          splitPhones(unit.phone.replace(STRIP, '')).map((phone) => ({ ...unit, phone })),
        )

  const folded: Heard[] = []
  for (const unit of units) {
    const mapped = FOLD[unit.phone] ?? unit.phone
    if (!mapped) continue
    // A fold may itself produce a digraph (o -> oʊ); both halves share the span.
    for (const piece of splitPhones(mapped)) folded.push({ ...unit, phone: piece })
  }

  const merged: Heard[] = []
  for (let i = 0; i < folded.length; i++) {
    const next = folded[i + 1]
    const pair = next ? folded[i].phone + next.phone : ''
    if (next && MERGE[pair]) {
      merged.push({ phone: MERGE[pair], start: folded[i].start, end: next.end })
      i++
    } else {
      merged.push(folded[i])
    }
  }

  // Anything still outside the inventory is dropped rather than scored as an error.
  return merged.filter((unit) => KNOWN.has(unit.phone))
}

/** Expected phones for a target, with stress and syllable marks removed. */
export function expectedPhones(ipa: string): string[] {
  return splitPhones(ipa.replace(STRIP, '')).filter((p) => KNOWN.has(p))
}

export type Verdict = 'correct' | 'close' | 'wrong' | 'missing' | 'extra'

export interface AlignedPhone {
  expected: string | null
  actual: string | null
  verdict: Verdict
  /** 0 = identical, 1 = unrelated. Null for insertions and deletions. */
  distance: number | null
  /** The scorer's numerical result; never reconstruct it from a verdict. */
  score?: number
  /** Acoustic evidence, retained for diagnostics and future calibration. */
  posterior?: number
  gop?: number
  /** Index into the expected sequence, for mapping back onto words. */
  expectedIndex: number | null
  /**
   * Where the sound that was actually produced sits in the recording, in
   * seconds. Null for a sound that was never produced; zero-width when the
   * recogniser offered no timings.
   */
  start: number | null
  end: number | null
}

/** A phone the recogniser produced, and where in the take it happened. */
export interface Heard {
  phone: string
  /** Seconds from the start of the recording. */
  start: number
  end: number
}

export const GAP_PENALTY = 0.75
/** Below this, a substitution is a near miss worth coaching rather than a gross error. */
const CLOSE_BELOW = 0.25

/**
 * Pairs that do not change the word, so swapping them is not a mistake:
 * tapped t/d, reduced vowels, and the cot-caught merger most speakers have.
 *
 * Everything else counts as an error even when articulatorily adjacent —
 * /θ/ and /s/ are neighbours on the tongue but "think" and "sink" are
 * different words, and a learner needs to see that.
 */
const ALLOPHONES: [string, string][] = [
  ['t', 'ɾ'], ['d', 'ɾ'], ['t', 'ʔ'],
  ['ə', 'ʌ'], ['ɚ', 'ɝ'], ['ɑ', 'ɔ'],
]

const EQUIVALENT = new Set(ALLOPHONES.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]))

function effectiveDistance(
  expected: string,
  actual: string,
  index: number,
  allowedVariants?: Map<number, Set<string>>,
): number {
  if (expected === actual || EQUIVALENT.has(`${expected}|${actual}`)) return 0
  const variants = allowedVariants?.get(index)
  if (variants && variants.has(actual)) return 0
  return phoneDistance(expected, actual)
}

export function pronunciationDistance(expected: string, actual: string): number {
  return effectiveDistance(expected, actual, 0)
}

function verdictFor(
  expected: string,
  actual: string,
  distance: number,
  allowedVariants?: Set<string>,
): Verdict {
  if (expected === actual || EQUIVALENT.has(`${expected}|${actual}`)) return 'correct'
  if (allowedVariants && allowedVariants.has(actual)) return 'correct'
  return distance < CLOSE_BELOW ? 'close' : 'wrong'
}

/**
 * Needleman-Wunsch over phones, scored by articulatory similarity.
 * Substituting a similar sound costs little; a gap costs a fixed penalty.
 * Also accepts contextual connected-speech variants (e.g. weak forms of function words).
 */
export function alignPhones(
  expected: string[],
  actual: Heard[],
  allowedVariants?: Map<number, Set<string>>,
): AlignedPhone[] {
  const n = expected.length
  const m = actual.length

  // score[i][j] = best cost of aligning the first i expected with first j actual.
  const score: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = 1; i <= n; i++) score[i][0] = i * GAP_PENALTY
  for (let j = 1; j <= m; j++) score[0][j] = j * GAP_PENALTY

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      score[i][j] = Math.min(
        score[i - 1][j - 1] + effectiveDistance(expected[i - 1], actual[j - 1].phone, i - 1, allowedVariants),
        score[i - 1][j] + GAP_PENALTY,
        score[i][j - 1] + GAP_PENALTY,
      )
    }
  }

  const out: AlignedPhone[] = []
  let i = n
  let j = m
  while (i > 0 || j > 0) {
    const cost =
      i > 0 && j > 0
        ? effectiveDistance(expected[i - 1], actual[j - 1].phone, i - 1, allowedVariants)
        : Infinity
    const diagonal = i > 0 && j > 0 && score[i][j] === score[i - 1][j - 1] + cost
    if (diagonal) {
      const said = actual[j - 1]
      const distance = cost
      const variantsForSlot = allowedVariants?.get(i - 1)
      out.push({
        expected: expected[i - 1],
        actual: said.phone,
        distance,
        expectedIndex: i - 1,
        start: said.start,
        end: said.end,
        verdict: verdictFor(expected[i - 1], said.phone, distance, variantsForSlot),
      })
      i--
      j--
    } else if (i > 0 && score[i][j] === score[i - 1][j] + GAP_PENALTY) {
      out.push({
        expected: expected[i - 1], actual: null, distance: null,
        expectedIndex: i - 1, start: null, end: null, verdict: 'missing',
      })
      i--
    } else {
      out.push({
        expected: null, actual: actual[j - 1].phone, distance: null,
        expectedIndex: null, start: actual[j - 1].start, end: actual[j - 1].end,
        verdict: 'extra',
      })
      j--
    }
  }

  return out.reverse()
}

export interface Score {
  /** 0-100, weighted so outright errors hurt more than near misses. */
  overall: number
  correct: number
  close: number
  wrong: number
  missing: number
  extra: number
}

export function scoreAlignment(aligned: AlignedPhone[]): Score {
  const tally: Score = { overall: 0, correct: 0, close: 0, wrong: 0, missing: 0, extra: 0 }
  let earned = 0
  let possible = 0

  for (const step of aligned) {
    tally[step.verdict]++
    if (step.verdict === 'extra') {
      // Inserted sounds are penalised, but cannot make a target unreachable.
      possible += 0.5
      continue
    }
    possible += 1
    if (step.score !== undefined && Number.isFinite(step.score)) earned += Math.min(100, Math.max(0, step.score)) / 100
    else if (step.verdict === 'correct') earned += 1
    else if (step.verdict === 'close') earned += 0.5
    else if (step.verdict === 'wrong') earned += Math.max(0, 1 - (step.distance ?? 1)) * 0.4
  }

  tally.overall = possible === 0 ? 0 : Math.round((earned / possible) * 100)
  return tally
}
