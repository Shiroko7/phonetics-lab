import { DAILY_TRAINING_SENTENCES, LISTENING_CONTRASTS } from '../data/dailyContent.ts'
import { analyze } from './analyze.ts'
import type { Dictionary } from './dict.ts'
import { targetWords } from './report.ts'

/** Recognize the old word-in-a-slot exercises, not a general grammar checker. */
export function isWordCarrier(text: string): boolean {
  return /["“][a-z][a-z'-]*["”]/i.test(text)
    || /^(?:please say (?:the word )?.+ once again|i heard the word .+ clearly|try to pronounce .+ with care|the word .+ is common in speech)[.!]?$/i.test(text.trim())
}

export function contextSentences(texts: string[]): string[] {
  return [...new Set(texts.flatMap((text) => text.split(/(?<=[.!?])\s+|[\r\n]+/)).map((text) => text.trim()).filter(Boolean))]
}

export function isPracticeContext(text: string, dict: Dictionary, word?: string): boolean {
  if (isWordCarrier(text) || analyze(text, dict).stats.unknown) return false
  const words = targetWords(text, dict)
  return words.length >= 5 && words.every((item) => item.phones.length > 0)
    && (!word || words.some((item) => item.text.toLowerCase().replace(/[^a-z0-9']/g, '') === word.toLowerCase()))
}

/** Full authored or user-supplied sentences only; never interpolate an arbitrary word. */
export function contextsForWord(word: string, dict: Dictionary, sources: string[] = []): string[] {
  return contextSentences([...sources, ...DAILY_TRAINING_SENTENCES,
    ...LISTENING_CONTRASTS.flatMap((contrast) => contrast.frames.flatMap((frame) => contrast.words.map((word) => frame.replace('{word}', word)))),
  ])
    .filter((text) => isPracticeContext(text, dict, word))
}
