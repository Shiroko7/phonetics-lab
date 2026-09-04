/**
 * The lookup cascade: dictionary first, then regular morphology, then spelling
 * rules. Every result records how it was reached so the UI can be honest about
 * which transcriptions are curated data and which are inference.
 */

import type { Dictionary } from './dict.ts'
import { attachS, derive } from './morphology.ts'
import { guess } from './g2p.ts'
import { numberToWords } from './numbers.ts'
import { americanVariants } from './spelling.ts'

export type Source = 'dictionary' | 'derived' | 'spelled' | 'guessed'

export interface Pronunciation {
  /** The word as looked up (lowercased, punctuation trimmed). */
  word: string
  /** Preferred transcription, canonical: no flapping, no vowel merger. */
  ipa: string
  /** Alternates from the dictionary, preferred one first. */
  variants: string[]
  source: Source
  /** How a derived or spelled form was reached, for the tooltip. */
  note?: string
}

/** Letter names, for initialisms that are read out one letter at a time. */
const LETTERS: Record<string, string> = {
  a: 'eɪ', b: 'bi', c: 'si', d: 'di', e: 'i', f: 'ɛf', g: 'dʒi', h: 'eɪtʃ',
  i: 'aɪ', j: 'dʒeɪ', k: 'keɪ', l: 'ɛl', m: 'ɛm', n: 'ɛn', o: 'oʊ', p: 'pi',
  q: 'kju', r: 'ɑɹ', s: 'ɛs', t: 'ti', u: 'ju', v: 'vi', w: 'ˈdʌ.bəl.ju',
  x: 'ɛks', y: 'waɪ', z: 'zi',
}

/** Strip anything that is not part of the word itself. */
export function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/^[^a-z0-9']+/, '')
    .replace(/[^a-z0-9']+$/, '')
}

function joinParts(parts: Pronunciation[]): string {
  return parts.map((p) => p.ipa).join(' ')
}

/**
 * Resolve one word. `cache` memoises across the whole document, which matters
 * because natural text repeats its vocabulary heavily.
 */
export function lookupWord(
  raw: string,
  dict: Dictionary,
  cache: Map<string, Pronunciation | null> = new Map(),
): Pronunciation | null {
  const word = normalize(raw)
  if (!word) return null

  const hit = cache.get(word)
  if (hit !== undefined) return hit

  const result = resolve(word, raw, dict, cache)
  cache.set(word, result)
  return result
}

function resolve(
  word: string,
  raw: string,
  dict: Dictionary,
  cache: Map<string, Pronunciation | null>,
): Pronunciation | null {
  const lookup = (w: string) => dict.get(w)

  // 1. Straight dictionary hit.
  const direct = dict.get(word)
  if (direct) {
    return { word, ipa: direct[0], variants: direct, source: 'dictionary' }
  }

  // 2. Numerals, read as words.
  const asNumber = numberToWords(word)
  if (asNumber) {
    const parts = asNumber
      .map((w) => lookupWord(w, dict, cache))
      .filter((p): p is Pronunciation => p !== null)
    if (parts.length) {
      return {
        word,
        ipa: joinParts(parts),
        variants: [],
        source: 'derived',
        note: asNumber.join(' '),
      }
    }
  }

  // 3. Initialisms: read WHO and API letter by letter, but only when the source
  //    text actually capitalised them and no real word matches.
  const isInitialism = /^[A-Z]{2,6}$/.test(raw.replace(/[^A-Za-z]/g, ''))
  if (isInitialism && !dict.has(word)) {
    const spelled = [...word].map((c) => LETTERS[c]).filter(Boolean)
    if (spelled.length === word.length) {
      return {
        word,
        ipa: spelled.join('.'),
        variants: [],
        source: 'spelled',
        note: 'read as letters',
      }
    }
  }

  // 4. Possessives: resolve the base word by any means, then attach -s. Doing it
  //    this way means "Kubernetes's" works even though the base is only guessable.
  const possessive = /^(.+?)'s$|^(.+?s)'$/.exec(word)
  if (possessive) {
    const base = possessive[1] ?? possessive[2]
    const bare = word.replace(/'/g, '')

    // Some possessives are listed outright, and CMUdict spells them without the
    // apostrophe ("cat's" is stored as "cats").
    const listed = dict.get(word) ?? dict.get(bare)
    if (listed) return { word, ipa: listed[0], variants: listed, source: 'dictionary' }

    const stem = lookupWord(base, dict, cache)
    if (stem) {
      // A plural possessive ("dogs'") already ends in the -s it needs.
      const ipa = possessive[2] ? stem.ipa : attachS(stem.ipa)
      return {
        word,
        ipa,
        variants: [],
        source: stem.source === 'guessed' ? 'guessed' : 'derived',
        note: `${base} + possessive`,
      }
    }
  }

  // 5. British spellings, checked against the American dictionary.
  for (const variant of americanVariants(word)) {
    const listed = dict.get(variant)
    if (listed) {
      return { word, ipa: listed[0], variants: listed, source: 'dictionary', note: `US: ${variant}` }
    }
    const derivedVariant = derive(variant, lookup)
    if (derivedVariant) {
      return {
        word,
        ipa: derivedVariant.ipa,
        variants: [],
        source: 'derived',
        note: `US: ${variant} (${derivedVariant.via})`,
      }
    }
  }

  // 6. Hyphenated compounds: transcribe each half on its own.
  if (word.includes('-')) {
    const pieces = word.split('-').filter(Boolean)
    if (pieces.length > 1) {
      const parts = pieces
        .map((p) => lookupWord(p, dict, cache))
        .filter((p): p is Pronunciation => p !== null)
      if (parts.length === pieces.length) {
        return {
          word,
          ipa: joinParts(parts),
          variants: [],
          source: parts.every((p) => p.source === 'dictionary') ? 'dictionary' : 'derived',
          note: pieces.join(' + '),
        }
      }
    }
  }

  // 7. Regular inflection or affixation built on a known stem.
  const derived = derive(word, lookup)
  if (derived) {
    return { word, ipa: derived.ipa, variants: [], source: 'derived', note: derived.via }
  }

  // 8. Spelling rules, explicitly flagged as a guess.
  const guessed = guess(word)
  if (guessed) {
    return { word, ipa: guessed, variants: [], source: 'guessed', note: 'from spelling' }
  }

  return null
}
