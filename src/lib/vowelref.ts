/**
 * Example words for a vowel, grouped by how the vowel is spelled.
 *
 * The hard part of an English vowel is not making it — it is knowing when a
 * piece of writing is asking for it. /u/ is *oo*, *u*, *ew*, *ue*, *ou*, *ui*
 * and a bare *o*; the reader needs to see that, with real words under each.
 *
 * The words are not curated. They come from the frequency list, so they are
 * words the reader will actually meet, and each is confirmed against the
 * dictionary to contain the sound it is offered for.
 *
 * Crediting the right *letters* is the part that needs care, and presence is
 * not enough to establish it. *People* contains /i/ and contains an `e`, but
 * the `e` that spells the /i/ is the one in `eo` — offering *people* as an
 * example of a bare `e` teaches something false. So a word is only used when
 * its vowel spellings and its vowel sounds line up one for one, and the run of
 * letters the pattern matched is the one that answers for the sound.
 */

import { expectedPhones } from './align.ts'
import type { Dictionary } from './dict.ts'
import { PHONES } from './phones.ts'

/** One way of writing a sound, and words that write it that way. */
export interface Spelling {
  /** The letters, `_` standing for any one letter: `a_e` is the *a…e* of *make*. */
  pattern: string
  /** Commonest first. */
  examples: string[]
}

/** Longer than this and the word is no longer a clear illustration of anything. */
const LONGEST = 9

/**
 * A pattern, anchored so it cannot be half of a longer vowel spelling —
 * otherwise the `ea` of *eagle* answers for a bare `e`.
 *
 * `w` closes a run on the right but never opens one: *ow* and *aw* are vowel
 * spellings, while the `w` of *twin* is a consonant standing in front of one.
 */
function matcher(pattern: string): RegExp {
  return new RegExp(`(?<![aeiouy])${pattern.replace(/_/g, '[a-z]')}(?![aeiouyw])`, 'g')
}

/**
 * Where each written vowel is: maximal runs of vowel letters.
 *
 * A run opens on `a e i o u`, and on `y` anywhere but the first letter — which
 * is the difference between the vowel of *system* and the consonant of *yes*.
 * `w` never opens one, so the `w` of *windows* does not invent a vowel that is
 * not there.
 */
function vowelRuns(word: string): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = []
  for (let i = 0; i < word.length; i++) {
    if (!'aeiou'.includes(word[i]) && !(word[i] === 'y' && i > 0)) continue
    let end = i + 1
    while (end < word.length && 'aeiouyw'.includes(word[end])) end++
    runs.push({ start: i, end })
    i = end - 1
  }
  // A final silent `e` writes no vowel of its own — it is the tail of a split
  // digraph, or nothing at all. Counting it would put every *make* and *these*
  // one run ahead of its sounds.
  const last = runs[runs.length - 1]
  if (runs.length > 1 && last.end === word.length && last.end - last.start === 1 && word[last.start] === 'e') {
    runs.pop()
  }
  return runs
}

/** The vowels of a transcription, in order. */
function vowelPhones(ipa: string): string[] {
  return expectedPhones(ipa).filter((phone) => PHONES[phone] && PHONES[phone].kind !== 'consonant')
}

/**
 * Words where `pattern` spells `phone`, commonest first.
 *
 * `words` is expected in frequency order; that order is the ranking.
 */
export function examplesFor(
  phone: string,
  pattern: string,
  dict: Dictionary,
  words: string[],
  limit = 6,
): string[] {
  const regex = matcher(pattern)
  const found: string[] = []

  for (const word of words) {
    if (word.length > LONGEST) continue

    regex.lastIndex = 0
    const at = regex.exec(word)
    // Twice over and there is no telling which one is being pointed at.
    if (!at || regex.exec(word)) continue

    const ipa = dict.get(word)?.[0]
    if (!ipa) continue

    // Only where the writing and the sounds line up can a run be held
    // responsible for a particular vowel.
    const runs = vowelRuns(word)
    const vowels = vowelPhones(ipa)
    if (runs.length !== vowels.length) continue

    const index = runs.findIndex((run) => at.index >= run.start && at.index < run.end)
    if (index === -1 || vowels[index] !== phone) continue

    found.push(word)
    if (found.length >= limit) break
  }

  return found
}

/** The whole guide for one vowel: every spelling that earned examples. */
export function spellingGuide(
  phone: string,
  patterns: string[],
  dict: Dictionary,
  words: string[],
  limit = 6,
): Spelling[] {
  return patterns
    .map((pattern) => ({ pattern, examples: examplesFor(phone, pattern, dict, words, limit) }))
    .filter((spelling) => spelling.examples.length > 0)
}
