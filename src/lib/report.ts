/**
 * Turns a phone alignment back into words.
 *
 * Word-aware alignment still returns canonical phone indices. Every aligned
 * step carries the index of the expected phone it belongs to, so results can
 * be grouped by word without inferring ownership from acoustic timestamps.
 */

import {
  expectedPhones, scoreAlignment,
  type AlignedPhone, type Verdict as PhoneVerdict,
} from './align.ts'
import { analyze } from './analyze.ts'
import type { Dictionary } from './dict.ts'

/** One word of the target, with the phones it is expected to be made of. */
export interface TargetWord {
  text: string
  ipa: string
  phones: string[]
  variants?: string[]
  connectedNote?: string
  spellingNote?: string
}

export type Verdict = 'good' | 'ok' | 'poor'

export interface WordReport {
  text: string
  ipa: string
  /** The aligned steps belonging to this word, in order. */
  steps: AlignedPhone[]
  /** The scorer's estimate of the sounds across those steps. */
  said: string
  /**
   * Where this word sits in the recording, in seconds — so the take can be cut
   * at the word and the speaker can hear their own version of it against the
   * model's. Null when nothing was produced for the word, or when the phones
   * carry no timings.
   */
  span: { start: number; end: number } | null
  /** Neighboring words are intentionally included only in this replay mode. */
  contextSpan?: { start: number; end: number } | null
  timing?: 'estimated' | 'ambiguous' | 'unavailable'
  score: number
  verdict: Verdict
  connectedNote?: string
  spellingNote?: string
}

/**
 * The target broken into words, each with its own phones.
 *
 * Splitting per word rather than splitting one joined string also avoids a
 * quiet bug: the phone splitter matches the longest symbol it can, so a word
 * ending in /a/ followed by one starting /ɪ/ would otherwise be read as a
 * single /aɪ/ spanning the gap between them.
 */
export function targetWords(phrase: string, dict: Dictionary): TargetWord[] {
  if (!phrase.trim()) return []
  return analyze(phrase, dict)
    .tokens.filter((token) => token.isWord && token.pron)
    .map((token) => ({
      text: token.text,
      ipa: token.pron!.ipa,
      phones: expectedPhones(token.pron!.ipa),
      variants: token.pron!.variants,
      connectedNote: token.pron!.connectedNote,
      spellingNote: token.pron!.spellingNote,
    }))
    .filter((word) => word.phones.length > 0)
}

/** Every expected phone, in order — what the alignment actually compares. */
export function flatten(words: TargetWord[]): string[] {
  return words.flatMap((word) => word.phones)
}

/**
 * Compatibility helper for callers with a flat target. Only a single changed
 * position can safely be represented this way. Full paths use alignWordVariants.
 */
export function extractVariantMap(words: TargetWord[]): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>()
  let phoneOffset = 0
  for (const word of words) {
    const alternatives = (word.variants ?? []).map(expectedPhones)
      .filter((phones) => phones.length === word.phones.length)
    const changed = new Set(alternatives.flatMap((phones) =>
      phones.flatMap((p, i) => p !== word.phones[i] ? [i] : [])))
    if (changed.size === 1) {
      const i = [...changed][0]
      map.set(phoneOffset + i, new Set(alternatives.map((phones) => phones[i])))
    }
    phoneOffset += word.phones.length
  }
  return map
}

/** Cut the alignment back into words and score each one. */
export function byWord(words: TargetWord[], aligned: AlignedPhone[]): WordReport[] {
  // expected phone index -> which word it came from.
  const owner: number[] = []
  words.forEach((word, index) => word.phones.forEach(() => owner.push(index)))

  const buckets: AlignedPhone[][] = words.map(() => [])
  let current = 0
  for (const step of aligned) {
    // An inserted sound has no expected index; it belongs to whichever word we
    // are in the middle of.
    if (step.expectedIndex !== null) current = owner[step.expectedIndex] ?? current
    buckets[current]?.push(step)
  }

  const spans = buckets.map((steps) => spanOf(steps.filter((step) => step.expectedIndex !== null)))
  const context = buckets.map(spanOf)
  return words.map((word, index) => {
    const steps = buckets[index]
    const score = steps.length === 0 ? 0 : scoreAlignment(steps).overall
    const span = spans[index]
    // A shared acoustic span cannot truthfully be offered as an isolated word.
    // Check every other word, including spans separated by an untimed word.
    const overlaps = !!span && spans.some((other, i) => i !== index && other && other.start < span.end && other.end > span.start)
    const neighbors = context.slice(Math.max(0, index - 1), index + 2).filter((s) => s !== null)
    return {
      text: word.text,
      ipa: word.ipa,
      steps,
      said: steps.map((step) => step.actual ?? '').filter(Boolean).join(' '),
      span: overlaps ? null : span,
      contextSpan: neighbors.length ? { start: Math.min(...neighbors.map((s) => s.start)), end: Math.max(...neighbors.map((s) => s.end)) } : null,
      timing: overlaps ? 'ambiguous' : span ? 'estimated' : 'unavailable',
      score,
      verdict: verdictFor(steps),
      connectedNote: word.connectedNote,
      spellingNote: word.spellingNote,
    }
  })
}

/** The stretch of recording a word's sounds occupy, if they are timed at all. */
function spanOf(steps: AlignedPhone[]): { start: number; end: number } | null {
  let start = Infinity
  let end = -Infinity
  for (const step of steps) {
    if (step.start === null || step.end === null || !Number.isFinite(step.start) || !Number.isFinite(step.end) || step.end <= step.start) continue
    if (step.start < start) start = step.start
    if (step.end > end) end = step.end
  }
  // A zero-width span means untimed output, not a word said instantaneously.
  return end > start ? { start, end } : null
}

/** Whether a sound or a word went better or worse than it did last time. */
export type Change = 'better' | 'worse' | 'same'

/** How good a verdict is, so two of them can be compared. */
const RANK: Record<PhoneVerdict, number> = {
  correct: 4,
  close: 3,
  wrong: 2,
  missing: 1,
  // An insertion belongs to no expected sound, so it is never ranked.
  extra: 0,
}

/**
 * What changed, sound by sound, against an earlier go at the same line.
 *
 * Keyed by the index of the *expected* phone, which is the one thing two goes
 * at the same words are guaranteed to share. The sounds produced differ, and so
 * does the alignment, but the third sound of the line is the third sound of the
 * line in both — matching on anything else would compare a sound against its
 * neighbour and report improvement where none happened.
 */
export function comparePhones(now: AlignedPhone[], before: AlignedPhone[]): Map<number, Change> {
  const was = new Map<number, number>()
  for (const step of before) {
    if (step.expectedIndex !== null) was.set(step.expectedIndex, RANK[step.verdict])
  }

  const changes = new Map<number, Change>()
  for (const step of now) {
    if (step.expectedIndex === null) continue
    const previous = was.get(step.expectedIndex)
    if (previous === undefined) continue
    const rank = RANK[step.verdict]
    changes.set(step.expectedIndex, rank > previous ? 'better' : rank < previous ? 'worse' : 'same')
  }
  return changes
}

/** The same word however it was capitalised or punctuated. */
function sameWord(a: string, b: string): boolean {
  const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9']/g, '')
  return bare(a) === bare(b)
}

/**
 * Score change per word against an earlier go, positive for better. Null where
 * the two attempts do not line up — a word edited in or out leaves its
 * neighbours with nothing honest to compare against.
 */
export function compareWords(now: WordReport[], before: WordReport[]): (number | null)[] {
  return now.map((word, i) => {
    const earlier = before[i]
    return earlier && sameWord(earlier.text, word.text) ? word.score - earlier.score : null
  })
}

/** Word colour follows the worst phone verdict, not an average numerical score. */
export function verdictFor(steps: AlignedPhone[]): Verdict {
  if (steps.some((s) => s.verdict === 'wrong' || s.verdict === 'missing')) return 'poor'
  if (steps.some((s) => s.verdict === 'close' || s.verdict === 'extra')) return 'ok'
  return 'good'
}

/** How one sound a drill was chosen for actually went, in this one take. */
export interface FocusReport {
  phone: string
  /** Times the sound was expected in the line. */
  seen: number
  /** Times it landed. */
  right: number
  /** Times it drifted but stayed recognisable. */
  close: number
}

/**
 * Score just the sounds a drill was built around.
 *
 * A drill line is not really being marked out of a hundred — the other sounds
 * in it are only there to carry the one that matters. "/ɔ/ 3 of 4" is the
 * answer to what was asked; the overall score is context.
 */
export function focusScore(aligned: AlignedPhone[], phones: string[]): FocusReport[] {
  return phones
    .map((phone) => {
      const steps = aligned.filter((step) => step.expected === phone)
      return {
        phone,
        seen: steps.length,
        right: steps.filter((step) => step.verdict === 'correct').length,
        close: steps.filter((step) => step.verdict === 'close').length,
      }
    })
    .filter((report) => report.seen > 0)
}

/**
 * The substitution a phone keeps attracting, if there is a dominant one.
 * "Sometimes /s/, sometimes /f/" is not a habit worth naming; four times out of
 * five is.
 */
export function dominant(confusions: [string, number][]): [string, number] | null {
  if (confusions.length === 0) return null
  const total = confusions.reduce((sum, [, count]) => sum + count, 0)
  const [phone, count] = confusions[0]
  return count / total > 0.5 ? [phone, count] : null
}
