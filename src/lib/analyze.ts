/** Turns a passage into per-token pronunciations plus a summary of coverage. */

import { lookupWord, type Pronunciation } from './lookup.ts'
import type { Dictionary } from './dict.ts'
import { tokenize, type Token } from './tokenize.ts'
import { syllableCount } from './phonology.ts'
import { formatIPA, type DisplayOptions } from './display.ts'

export interface AnalyzedToken extends Token {
  pron: Pronunciation | null
}

export interface Stats {
  words: number
  unique: number
  syllables: number
  dictionary: number
  derived: number
  guessed: number
  unknown: number
}

export interface Analysis {
  tokens: AnalyzedToken[]
  stats: Stats
}

export function analyze(text: string, dict: Dictionary): Analysis {
  const cache = new Map<string, Pronunciation | null>()
  const seen = new Set<string>()
  const stats: Stats = {
    words: 0,
    unique: 0,
    syllables: 0,
    dictionary: 0,
    derived: 0,
    guessed: 0,
    unknown: 0,
  }

  const tokens: AnalyzedToken[] = tokenize(text).map((token) => {
    if (!token.isWord) return { ...token, pron: null }

    const pron = lookupWord(token.text, dict, cache)
    stats.words += 1
    seen.add(token.text.toLowerCase())

    if (!pron) {
      stats.unknown += 1
    } else {
      stats.syllables += syllableCount(pron.ipa)
      if (pron.source === 'guessed') stats.guessed += 1
      else if (pron.source === 'dictionary') stats.dictionary += 1
      else stats.derived += 1
    }

    return { ...token, pron }
  })

  stats.unique = seen.size
  return { tokens, stats }
}

/** The whole passage rewritten in IPA, keeping the original punctuation. */
export function toIPAText(tokens: AnalyzedToken[], display: DisplayOptions): string {
  return tokens
    .map((token) => {
      if (!token.isWord) return token.text
      return token.pron ? formatIPA(token.pron.ipa, display) : token.text
    })
    .join('')
}
