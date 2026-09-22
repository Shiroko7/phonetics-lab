/**
 * Trouble Words Bank: tracking words the user struggles with across practice,
 * saving them for reference, and building targeted drills around them.
 *
 * When a user repeatedly mispronounces a word — whether dropping a consonant,
 * confusing a vowel, or scoring poorly — this module records the word, its
 * failure history, and the specific phonemes that failed. The user can review
 * these words in their trouble bank, listen to correct models, and generate
 * custom drill sets targeting those exact words and sounds.
 */

import { expectedPhones } from './align.ts'
import type { Dictionary } from './dict.ts'
import { buildDrill, phrasesFor, type DrillPhrase, type DrillSet, type DrillStep } from './phrasebank.ts'
import { byWord, flatten, targetWords, type WordReport } from './report.ts'
import type { Attempt } from './practice.ts'
import { PHONES } from './phones.ts'
import { DEFAULT_PRACTICE_THRESHOLD, soundPracticeStatus, wordPracticeStatus } from './practicePolicy.ts'
import { contextsForWord, contextSentences, isPracticeContext } from './context.ts'

export interface WeakPhoneStat {
  phone: string
  count: number
}

export interface StruggleHistoryEntry {
  at: number
  score: number
  verdict: 'good' | 'ok' | 'poor'
  said?: string
}

export interface StruggledWord {
  /** Normalized lowercase word key, e.g. "schedule", "thought", "squirrel" */
  word: string
  /** Word casing for display, e.g. "Schedule" */
  display: string
  /** Canonical IPA transcription */
  ipa: string
  /** How many times the user struggled with this word across attempts */
  struggleCount: number
  /** Total number of attempts that included this word */
  totalAttempts: number
  /** Lowest score recorded for this word (0-100) */
  lowestScore: number
  /** Most recent score recorded for this word (0-100) */
  lastScore: number
  /** Best score recorded for this word (0-100) */
  bestScore: number
  /** Timestamp of the most recent attempt */
  lastSeen: number
  /** Timestamp when the word was first attempted / struggled with */
  firstSeen?: number
  /** Chronological history of attempts on this word */
  history?: StruggleHistoryEntry[]
  /** Phonemes that failed in this word, ordered by frequency of failure */
  weakPhones: WeakPhoneStat[]
  /** What the user was heard saying instead (recent examples) */
  recentSaid: string[]
  /** True if the user manually added or pinned this word to their bank */
  pinned?: boolean
  /** Real sentences in which this word was practised, newest first. */
  contexts?: string[]
}

export const STRUGGLES_KEY = 'phonetics-lab:struggles'
const MAX_STRUGGLED_WORDS = 100

/** Clean a token down to plain lowercase alphanumeric and apostrophes. */
export function normalizeWord(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9']/g, '').trim()
}

/** Whether a word attempt is considered a struggle. */
export function isStruggleReport(word: WordReport, threshold = DEFAULT_PRACTICE_THRESHOLD): boolean {
  return wordPracticeStatus(word, threshold) === 'review'
}

/** Whether a stored word qualifies as "struggles a lot" / needs urgent focus. */
export function isStrugglingLot(entry: StruggledWord): boolean {
  if (entry.pinned) return true
  if (entry.struggleCount >= 2) return true
  return entry.totalAttempts >= 2 && entry.struggleCount / entry.totalAttempts >= 0.5
}

/** Load the trouble words bank from local storage. */
export function loadStruggles(): StruggledWord[] {
  try {
    const raw = localStorage.getItem(STRUGGLES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StruggledWord[]) : []
  } catch {
    return []
  }
}

/** Persist the trouble words bank to local storage. */
export function saveStruggles(words: StruggledWord[]): void {
  try {
    localStorage.setItem(STRUGGLES_KEY, JSON.stringify(words.slice(0, MAX_STRUGGLED_WORDS)))
  } catch {
    // Storage failure must not break practice
  }
}

/** Clear the trouble words bank from local storage. */
export function clearStruggles(): void {
  try {
    localStorage.removeItem(STRUGGLES_KEY)
  } catch {
    // Storage failure must not break practice
  }
}

/**
 * Record a take's word-by-word reports into the struggle bank.
 *
 * Words struggled with have their struggle count and weak phones updated.
 * Words said cleanly update their attempt count and last score, showing progress.
 */
export function recordWordReports(
  bank: StruggledWord[],
  reports: WordReport[],
  at: number,
  sourceText?: string,
): StruggledWord[] {
  const map = new Map<string, StruggledWord>(bank.map((entry) => [entry.word, { ...entry }]))

  for (const report of reports) {
    const key = normalizeWord(report.text)
    // Skip words with no pronounceable letters or single characters like punctuation
    if (!key || (key.length <= 1 && key !== 'a' && key !== 'i')) continue

    const struggled = isStruggleReport(report)
    let entry = map.get(key)

    if (!entry) {
      if (!struggled) continue // Only track words when they first encounter difficulty
      const wrongSteps = report.steps.filter((s) => soundPracticeStatus(s) === 'review')
      const phoneCounts = new Map<string, number>()
      for (const s of wrongSteps) {
        if (s.expected) phoneCounts.set(s.expected, (phoneCounts.get(s.expected) ?? 0) + 1)
      }
      entry = {
        word: key,
        display: report.text.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''),
        ipa: report.ipa,
        struggleCount: 1,
        totalAttempts: 1,
        lowestScore: report.score,
        lastScore: report.score,
        bestScore: report.score,
        lastSeen: at,
        firstSeen: at,
        history: [{ at, score: report.score, verdict: report.verdict, said: report.said }],
        weakPhones: [...phoneCounts.entries()]
          .map(([phone, count]) => ({ phone, count }))
          .sort((a, b) => b.count - a.count),
        recentSaid: report.said ? [report.said] : [],
      }
      map.set(key, entry)
    } else {
      entry.totalAttempts++
      entry.lastSeen = at
      entry.firstSeen = entry.firstSeen ?? at
      entry.lastScore = report.score
      entry.lowestScore = Math.min(entry.lowestScore, report.score)
      entry.bestScore = Math.max(entry.bestScore, report.score)
      entry.history = [
        ...(entry.history ?? []),
        { at, score: report.score, verdict: report.verdict, said: report.said },
      ].slice(-50)

      if (struggled) {
        entry.struggleCount++
        const phoneCounts = new Map<string, number>(entry.weakPhones.map((p) => [p.phone, p.count]))
        for (const s of report.steps) {
          if (s.expected && soundPracticeStatus(s) === 'review') {
            phoneCounts.set(s.expected, (phoneCounts.get(s.expected) ?? 0) + 1)
          }
        }
        entry.weakPhones = [...phoneCounts.entries()]
          .map(([phone, count]) => ({ phone, count }))
          .sort((a, b) => b.count - a.count)
        if (report.said && !entry.recentSaid.includes(report.said)) {
          entry.recentSaid = [report.said, ...entry.recentSaid].slice(0, 3)
        }
      }
    }
    if (sourceText) {
      const contexts = contextSentences([sourceText]).filter((text) => {
        const tokens = text.split(/\s+/).map(normalizeWord)
        return tokens.length >= 5 && tokens.includes(key)
      })
      entry.contexts = [...new Set([...contexts, ...(entry.contexts ?? [])])].slice(0, 8)
    }
  }

  return [...map.values()].sort(sortStruggles)
}

/** Sort struggle bank: pinned first, then by struggle count descending, then recent. */
export function sortStruggles(a: StruggledWord, b: StruggledWord): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (b.struggleCount !== a.struggleCount) return b.struggleCount - a.struggleCount
  return b.lastSeen - a.lastSeen
}

/**
 * Scan attempt history to seed or synchronize the struggle bank.
 */
export function syncStrugglesFromAttempts(
  currentBank: StruggledWord[],
  attempts: Attempt[],
  dict: Dictionary,
): StruggledWord[] {
  let bank = [...currentBank]
  // Process attempts in chronological order
  const sorted = [...attempts].sort((a, b) => a.at - b.at)
  for (const attempt of sorted) {
    const words = targetWords(attempt.target, dict)
    if (words.length === 0 || attempt.aligned.length === 0) continue
    const report = byWord(words, attempt.aligned)
    bank = recordWordReports(bank, report, attempt.at, attempt.target)
  }
  return bank
}

/** Manually add a word to the trouble words bank. */
export function addManualWord(
  bank: StruggledWord[],
  rawWord: string,
  dict: Dictionary,
): StruggledWord[] | null {
  const key = normalizeWord(rawWord)
  if (!key) return null
  const ipa = dict.get(key)?.[0]
  if (!ipa) return null

  const existing = bank.find((e) => e.word === key)
  if (existing) {
    return bank.map((e) => (e.word === key ? { ...e, pinned: true } : e))
  }

  const phones = expectedPhones(ipa)
  const newEntry: StruggledWord = {
    word: key,
    display: rawWord.trim(),
    ipa,
    struggleCount: 1,
    totalAttempts: 0,
    lowestScore: 0,
    lastScore: 0,
    bestScore: 0,
    lastSeen: Date.now(),
    firstSeen: Date.now(),
    history: [],
    weakPhones: phones.slice(0, 2).map((p) => ({ phone: p, count: 1 })),
    recentSaid: [],
    pinned: true,
  }
  const next = [newEntry, ...bank].sort(sortStruggles)
  saveStruggles(next)
  return next
}

/** Remove a word from the trouble bank. */
export function removeStruggledWord(bank: StruggledWord[], wordKey: string): StruggledWord[] {
  const next = bank.filter((e) => e.word !== wordKey)
  saveStruggles(next)
  return next
}

/** Toggle pinned state of a word. */
export function togglePinnedWord(bank: StruggledWord[], wordKey: string): StruggledWord[] {
  const next = bank.map((e) => (e.word === wordKey ? { ...e, pinned: !e.pinned } : e)).sort(sortStruggles)
  saveStruggles(next)
  return next
}

/** Index the sounds in a supplied practice sentence. */
export function makePhrase(text: string, focus: string[], dict: Dictionary): DrillPhrase | null {
  const words = targetWords(text, dict)
  const phones = flatten(words)
  if (phones.length === 0) return null
  const counts = new Map<string, number>()
  for (const p of phones) counts.set(p, (counts.get(p) ?? 0) + 1)
  return {
    text,
    focus,
    counts,
    length: phones.length,
    words: words.length,
  }
}

/**
 * Generate a complete, targeted practice drill around a specific trouble word.
 *
 * A complete drill session consists only of contextual speech:
 * 1. An authored or previously practised sentence containing the word
 * 2. Additional phrases from the library that drill the word's weakest phonemes
 */
export function buildDrillForWord(
  entry: StruggledWord,
  bankPhrases: DrillPhrase[],
  dict: Dictionary,
  options?: { randomize?: boolean; contexts?: string[] },
): DrillSet {
  const steps: DrillStep[] = []
  const usedTexts = new Set<string>()

  const contexts = contextsForWord(entry.word, dict, [...(entry.contexts ?? []), ...(options?.contexts ?? [])])
  const candidates = contexts.length ? contexts : bankPhrases.map((phrase) => phrase.text)
    .filter((text) => isPracticeContext(text, dict, entry.word))
  const chosen = candidates[options?.randomize ? Math.floor(Math.random() * candidates.length) : 0]
  const curatedMatch = chosen ? makePhrase(chosen, entry.weakPhones.map((phone) => phone.phone), dict) : null
  // Missing context is a coverage gap, not a reason to manufacture a carrier.
  if (!curatedMatch) return { steps: [], missing: entry.weakPhones.map((phone) => phone.phone) }

  if (curatedMatch) {
    usedTexts.add(curatedMatch.text)
    const covers = entry.weakPhones
      .map((p) => ({ phone: p.phone, count: curatedMatch.counts.get(p.phone) ?? 0 }))
      .filter((c) => c.count > 0)
    steps.push({
      phrase: curatedMatch,
      covers: covers.length > 0 ? covers : [{ phone: entry.weakPhones[0]?.phone ?? 'θ', count: 1 }],
    })
  }

  // Step 3: Difficult sounds reinforcement: pick drill phrases for the weak sounds
  const targetSounds = entry.weakPhones.length > 0
    ? entry.weakPhones.map((p) => p.phone)
    : expectedPhones(entry.ipa).filter((p) => p in PHONES && p !== 'ɾ' && p !== 'ʔ').slice(0, 2)

  for (const sound of targetSounds) {
    if (steps.length >= 6) break
    const matches = phrasesFor(bankPhrases.filter((phrase) => isPracticeContext(phrase.text, dict)), sound, undefined, 2, options)
    for (const phrase of matches) {
      if (usedTexts.has(phrase.text)) continue
      usedTexts.add(phrase.text)
      steps.push({
        phrase,
        covers: [{ phone: sound, count: phrase.counts.get(sound) ?? 1 }],
      })
      if (steps.length >= 6) break
    }
  }

  return { steps, missing: [] }
}

/**
 * Generate a practice drill session spanning multiple trouble words.
 */
export function buildDrillForStruggledWords(
  entries: StruggledWord[],
  bankPhrases: DrillPhrase[],
  dict: Dictionary,
  options?: { randomize?: boolean; contexts?: string[] },
): DrillSet {
  if (entries.length === 0) return { steps: [], missing: [] }
  if (entries.length === 1) return buildDrillForWord(entries[0], bankPhrases, dict, options)

  const steps: DrillStep[] = []
  const usedTexts = new Set<string>()

  // Word steps for up to 3 trouble words
  const selectedWords = options?.randomize
    ? [...entries].sort(() => Math.random() - 0.5).slice(0, 3)
    : entries.slice(0, 3)

  for (const word of selectedWords) {
    const phrase = buildDrillForWord(word, bankPhrases, dict, options).steps[0]?.phrase
    if (phrase && !usedTexts.has(phrase.text)) {
      usedTexts.add(phrase.text)
      const covers = word.weakPhones
        .map((p) => ({ phone: p.phone, count: phrase.counts.get(p.phone) ?? 0 }))
        .filter((c) => c.count > 0)
      steps.push({
        phrase,
        covers: covers.length > 0 ? covers : [{ phone: word.weakPhones[0]?.phone ?? 'θ', count: 1 }],
      })
    }
  }

  if (!steps.length) return { steps: [], missing: [...new Set(selectedWords.flatMap((word) => word.weakPhones.map((phone) => phone.phone)))] }

  // Complement with curated drills targeting the union of weak sounds
  const allWeak = [...new Set(selectedWords.flatMap((w) => w.weakPhones.map((p) => p.phone)))]
  const drillableWeak = allWeak.filter((p) => p in PHONES && p !== 'ɾ' && p !== 'ʔ')
  if (drillableWeak.length > 0) {
    const soundDrill = buildDrill(bankPhrases.filter((phrase) => isPracticeContext(phrase.text, dict)), drillableWeak, 5, options)
    for (const step of soundDrill.steps) {
      if (!usedTexts.has(step.phrase.text) && steps.length < 8) {
        usedTexts.add(step.phrase.text)
        steps.push(step)
      }
    }
  }

  return { steps, missing: [] }
}
