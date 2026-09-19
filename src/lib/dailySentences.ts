import { contextSentences } from './context.ts'

export interface SentencePreference {
  /** Remember every spelling so old attempts cannot bring a typo back. */
  originals: string[]
  text: string
  blocked: boolean
}

export const sentenceKey = (text: string) => text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9']+/g, ' ').trim()

export function normalizeSentencePreferences(value: unknown): SentencePreference[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry.text !== 'string' || !sentenceKey(entry.text) || !Array.isArray(entry.originals)) return []
    return [{ text: entry.text, blocked: entry.blocked === true,
      originals: [...new Set<string>([...entry.originals.filter((text: unknown): text is string => typeof text === 'string'), entry.text])] }]
  })
}

function matches(entry: SentencePreference, text: string): boolean {
  const key = sentenceKey(text)
  return sentenceKey(entry.text) === key || entry.originals.some((original) => sentenceKey(original) === key)
}

export function resolveDailySentence(text: string, preferences: SentencePreference[] = []): string | null {
  const entry = preferences.find((item) => matches(item, text))
  return entry?.blocked ? null : entry?.text ?? text
}

export function dailySentences(texts: string[], preferences: SentencePreference[] = []): string[] {
  const resolved = contextSentences(texts).flatMap((text) => resolveDailySentence(text, preferences) ?? [])
  return [...new Map(resolved.map((text) => [sentenceKey(text), text])).values()]
}

export function changeDailySentence(
  preferences: SentencePreference[] = [], original: string, change: { text?: string; blocked?: boolean },
): SentencePreference[] {
  const existing = preferences.find((entry) => matches(entry, original))
  const text = (change.text ?? existing?.text ?? original).trim().replace(/\s+/g, ' ')
  // Merge aliases when a correction matches another sentence already in the bank.
  const related = preferences.filter((entry) => matches(entry, original) || matches(entry, text))
  const entry: SentencePreference = {
    originals: [...new Set([original, text, ...related.flatMap((item) => [item.text, ...item.originals])])],
    text,
    blocked: change.blocked ?? related.some((item) => item.blocked),
  }
  return [...preferences.filter((item) => !related.includes(item)), entry]
}
