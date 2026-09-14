/**
 * Choosing what to say next.
 *
 * The weak-sound report names the problem; a drill is the answer to it. Single
 * words are the obvious answer and the wrong one — a sound said on its own is a
 * sound with time to prepare, and it comes out better than it ever does in
 * running speech. So the drills here are short phrases, and the job of this
 * module is to pick the right ones.
 *
 * Two questions get asked of the bank:
 *
 *   - one sound: "what should I say to work on /ɔ/, which I keep turning into
 *     /ʌ/?" — answered by `phrasesFor`, which prefers a line built around
 *     exactly that confusion.
 *   - several at once: "here are my four worst sounds, build me a session" —
 *     answered by `buildDrill`, a greedy cover that looks for the fewest lines
 *     giving every sound a couple of different contexts.
 *
 * What a phrase actually contains is measured here against the dictionary
 * rather than trusted from the data file, so a curated `focus` can never drift
 * away from the phrase it describes.
 */

import { PHRASE_BANK, type CuratedPhrase } from '../data/phrases.ts'
import type { Dictionary } from './dict.ts'
import { flatten, targetWords } from './report.ts'

/** A curated phrase with its sounds counted. */
export interface DrillPhrase extends CuratedPhrase {
  /** Phone -> how many times the phrase contains it. */
  counts: Map<string, number>
  /** Expected phones in total. A short line is a quicker repetition. */
  length: number
  /** Words the dictionary could transcribe. */
  words: number
}

/** Measure the bank against a dictionary. */
export function indexPhrases(dict: Dictionary, bank: CuratedPhrase[] = PHRASE_BANK): DrillPhrase[] {
  return bank.map((phrase) => {
    const words = targetWords(phrase.text, dict)
    const phones = flatten(words)
    const counts = new Map<string, number>()
    for (const phone of phones) counts.set(phone, (counts.get(phone) ?? 0) + 1)
    return { ...phrase, counts, length: phones.length, words: words.length }
  })
}

const indexes = new WeakMap<Dictionary, DrillPhrase[]>()

/** Indexed once per dictionary — a hundred-odd lookups, so not worth repeating. */
export function phraseIndex(dict: Dictionary): DrillPhrase[] {
  let index = indexes.get(dict)
  if (!index) {
    index = indexPhrases(dict)
    indexes.set(dict, index)
  }
  return index
}

/** Whether a phrase was written to set these two sounds against each other. */
function contrasts(phrase: DrillPhrase, a: string, b: string): boolean {
  return !!phrase.pair && phrase.pair.includes(a) && phrase.pair.includes(b)
}

/**
 * Lines worth saying to work on one sound, best first.
 *
 * When the substitution is known, a phrase holding both sounds at once comes
 * top: hearing *cop* and *cup* in one breath is what makes the difference
 * audible, in a way that four /ɑ/ words in a row never is.
 */
export function phrasesFor(
  index: DrillPhrase[],
  phone: string,
  insteadOf?: string,
  limit = 3,
  options?: { randomize?: boolean },
): DrillPhrase[] {
  return index
    .filter((phrase) => phrase.counts.has(phone))
    .map((phrase) => {
      let rank = 0
      if (insteadOf && contrasts(phrase, phone, insteadOf)) rank += 20
      if (phrase.focus.includes(phone)) rank += 10
      // A contrast written for some other pair carries this sound incidentally.
      else if (phrase.pair) rank -= 2
      rank += Math.min(phrase.counts.get(phone) ?? 0, 4)
      // Between two equally apt lines, the shorter one is the better drill.
      rank -= phrase.length / 40
      if (options?.randomize) {
        rank += (Math.random() - 0.5) * 1.5
      }
      return { phrase, rank }
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map((scored) => scored.phrase)
}

/** One line of a session, and which of the requested sounds it exercises. */
export interface DrillStep {
  phrase: DrillPhrase
  covers: { phone: string; count: number }[]
}

export interface DrillSet {
  steps: DrillStep[]
  /** Sounds asked for that the bank has nothing for. */
  missing: string[]
}

/**
 * How many separate lines each requested sound should turn up in. One context
 * proves nothing: a sound can survive *good book* and still collapse in *could
 * put*, and a drill that only ever asks for the easy one teaches the easy one.
 */
const CONTEXTS = 2

/** What a line written for the sound is worth over one that merely contains it. */
const DELIBERATE = 6

export interface BuildDrillOptions {
  /** If true, picks randomly among top contenders for fresh drill variety on each session. */
  randomize?: boolean
}

/**
 * Build a session covering every sound asked for.
 *
 * Greedy set cover, with one rule the plain algorithm gets wrong. Some sounds —
 * /ə/ above all — turn up everywhere, so a cover built on presence alone marks
 * them done from the leftovers of other people's lines and never gives them one
 * of their own. A schwa problem is not addressed by a phrase about dogs that
 * happens to contain three of them. So every requested sound is owed a line
 * *written* for it as well as its two contexts.
 *
 * The first phrase chosen is the one doing the most work, which is also the
 * right one to open with.
 */
export function buildDrill(
  index: DrillPhrase[],
  wanted: string[],
  limit = 8,
  options?: BuildDrillOptions,
): DrillSet {
  const targets = [...new Set(wanted)]

  // Contexts still owed, and whether a line written for the sound is still owed.
  const owed = new Map(targets.map((phone) => [phone, CONTEXTS]))
  const owedFocus = new Map(targets.map((phone) => [phone, 1]))
  const outstanding = () =>
    [...owed.values()].some((n) => n > 0) || [...owedFocus.values()].some((n) => n > 0)

  const steps: DrillStep[] = []
  const used = new Set<string>()

  while (steps.length < limit && outstanding()) {
    const candidates: { phrase: DrillPhrase; gain: number }[] = []
    let maxGain = 0

    for (const phrase of index) {
      if (used.has(phrase.text)) continue
      let gain = 0
      for (const phone of targets) {
        const count = phrase.counts.get(phone)
        if (!count) continue
        // Three of a sound in one line is plenty; more is not three times better.
        const worth = Math.min(count, 3)
        const written = phrase.focus.includes(phone)
        if (written && (owedFocus.get(phone) ?? 0) > 0) gain += DELIBERATE + worth
        else if ((owed.get(phone) ?? 0) > 0) gain += written ? worth * 3 : worth
      }
      if (gain <= 0) continue
      // Prefer the shorter line when two do the same work.
      gain -= phrase.length / 100
      if (gain > maxGain) maxGain = gain
      candidates.push({ phrase, gain })
    }

    if (candidates.length === 0 || maxGain <= 0) break

    let best: DrillPhrase | null = null
    if (options?.randomize) {
      const threshold = Math.max(0.5, maxGain - 0.75)
      const pool = candidates.filter((c) => c.gain >= threshold)
      best = pool[Math.floor(Math.random() * pool.length)].phrase
    } else {
      best = candidates.reduce((top, c) => (c.gain > top.gain ? c : top)).phrase
    }

    used.add(best.text)
    const covers = coverage(best, targets)
    steps.push({ phrase: best, covers })
    for (const { phone } of covers) {
      owed.set(phone, (owed.get(phone) ?? 0) - 1)
      if (best.focus.includes(phone)) owedFocus.set(phone, (owedFocus.get(phone) ?? 0) - 1)
    }
  }

  // Whatever the session never reached — because the bank has nothing for it,
  // or because the line limit ran out first.
  const covered = new Set(steps.flatMap((step) => step.covers.map((hit) => hit.phone)))
  return { steps, missing: targets.filter((phone) => !covered.has(phone)) }
}

/** Which of the wanted sounds a phrase carries, most frequent first. */
function coverage(phrase: DrillPhrase, wanted: string[]): { phone: string; count: number }[] {
  return wanted
    .map((phone) => ({ phone, count: phrase.counts.get(phone) ?? 0 }))
    .filter((hit) => hit.count > 0)
    .sort((a, b) => b.count - a.count)
}
