/** Derive priorities without rewriting scores, recordings or the original trouble bank. */
import type { Dictionary } from './dict.ts'
import { byWord, targetWords } from './report.ts'
import { analysisAttempts, sameLine, type Attempt, type PhoneStat } from './practice.ts'
import { normalizeWord, type StruggledWord, type StruggleHistoryEntry } from './struggles.ts'
import { decisionsFor, soundPracticeStatus, wordPracticeStatus, type PracticePreferences } from './practicePolicy.ts'

export interface SoundPattern {
  phone: string; seen: number; flagged: number; words: string[]; contexts: number; sessions: number; recurring: boolean
}
export function reviewHistory(attempts: Attempt[], dict: Dictionary, preferences: PracticePreferences, manual: StruggledWord[] = []) {
  const ordered = [...attempts].sort((a, b) => a.at - b.at)
  const compatible = analysisAttempts(ordered)
  const latest = compatible.at(-1)
  const patterns = new Map<string, { seen: number; flagged: number; words: Set<string>; contexts: Set<string>; sessions: Set<string>; flaggedContexts: Set<string>; flaggedSessions: Set<string> }>()
  const latestWords = new Map<string, StruggledWord | null>()
  const wordCounts = new Map<string, { seen: number; flagged: number }>()
  const legacyCounts = new Map<string, number>()
  const histories = new Map<string, StruggleHistoryEntry[]>()
  const contexts = new Map<string, Set<string>>()
  const observedWords = new Set<string>(), observedPhones = new Set<string>()
  const firstTakes = new Set<string>()
  let legacyExcluded = 0, retriesExcluded = 0
  for (const attempt of compatible) {
    const reports = byWord(targetWords(attempt.target, dict), attempt.aligned)
    const choices = decisionsFor(attempt, reports, preferences)
    const firstKey = JSON.stringify([attempt.practiceSession, attempt.target.trim().toLowerCase().replace(/\s+/g, ' ')])
    const first = !!attempt.practiceSession && attempt.practiceFirst === true && !firstTakes.has(firstKey)
    const legacy = !attempt.practiceSession || attempt.practiceFirst === undefined
    if (first) firstTakes.add(firstKey)
    else if (!attempt.practiceSession || attempt.practiceFirst === undefined) legacyExcluded++
    else retriesExcluded++
    const takePhones = new Map<string, { flagged: boolean; words: Set<string> }>()
    const takeWords = new Map<string, boolean>()
    const takeEntries = new Map<string, StruggledWord | null>()
    const takeHistory = new Map<string, StruggleHistoryEntry>()
    reports.forEach((word, index) => {
      const key = normalizeWord(word.text), choice = choices[index]
      const status = wordPracticeStatus(word, preferences.threshold)
      observedWords.add(key)
      word.steps.forEach((step) => { if (step.expected) observedPhones.add(step.expected) })
      if (status !== 'unscored') {
        const old = takeHistory.get(key)
        if (!old || word.score < old.score) takeHistory.set(key, { at: attempt.at, score: word.score, verdict: word.verdict, said: word.said })
        const lines = contexts.get(key) ?? new Set<string>(); lines.add(attempt.target); contexts.set(key, lines)
      }
      const eligible = status !== 'unscored' && choice !== 'accepted' && choice !== 'bad-cut'
      if (first && eligible) {
        takeWords.set(key, (takeWords.get(key) ?? false) || status === 'review')
        for (const step of word.steps) {
          if (!step.expected || soundPracticeStatus(step, preferences.threshold) === 'unscored') continue
          const p = takePhones.get(step.expected) ?? { flagged: false, words: new Set<string>() }
          p.flagged ||= soundPracticeStatus(step, preferences.threshold) === 'review'
          p.words.add(key); takePhones.set(step.expected, p)
        }
      }
      const dismissed = Math.max(preferences.dismissedBefore[key] ?? -Infinity, preferences.dismissedBefore['*'] ?? -Infinity)
      if (!key || attempt.at <= dismissed) return
      if (!eligible || status !== 'review') { if (!takeEntries.has(key)) takeEntries.set(key, null); return }
      const weak = [...new Set(word.steps.filter((s) => soundPracticeStatus(s, preferences.threshold) === 'review').map((s) => s.expected!))]
      takeEntries.set(key, { word: key, display: word.text, ipa: word.ipa, struggleCount: 0,
        totalAttempts: 0, lowestScore: word.score, lastScore: word.score, bestScore: word.score,
        lastSeen: attempt.at, firstSeen: attempt.at, history: [{ at: attempt.at, score: word.score, verdict: word.verdict, said: word.said }],
        weakPhones: weak.map((phone) => ({ phone, count: 1 })), recentSaid: word.said ? [word.said] : [], contexts: [attempt.target] })
    })
    for (const [key, entry] of takeHistory) {
      histories.set(key, [...(histories.get(key) ?? []), entry])
      if (legacy) legacyCounts.set(key, (legacyCounts.get(key) ?? 0) + 1)
    }
    for (const [key, flagged] of takeWords) {
      const count = wordCounts.get(key) ?? { seen: 0, flagged: 0 }
      count.seen++; count.flagged += Number(flagged); wordCounts.set(key, count)
    }
    for (const [key, entry] of takeEntries) {
      const count = wordCounts.get(key) ?? { seen: 0, flagged: 0 }
      const history = histories.get(key) ?? []
      latestWords.set(key, entry ? { ...entry, struggleCount: count.flagged, totalAttempts: count.seen,
        legacyAttempts: legacyCounts.get(key) ?? 0, history, firstSeen: history[0]?.at ?? entry.firstSeen,
        lowestScore: Math.min(...history.map(h => h.score), entry.lastScore), bestScore: Math.max(...history.map(h => h.score), entry.lastScore),
        contexts: [...(contexts.get(key) ?? [])].reverse() } : null)
    }
    for (const [phone, take] of takePhones) {
      const p = patterns.get(phone) ?? { seen: 0, flagged: 0, words: new Set<string>(), contexts: new Set<string>(), sessions: new Set<string>(), flaggedContexts: new Set<string>(), flaggedSessions: new Set<string>() }
      p.seen++; p.flagged += Number(take.flagged)
      take.words.forEach((word) => p.words.add(word))
      p.contexts.add(attempt.target.trim().toLowerCase().replace(/\s+/g, ' ')); p.sessions.add(attempt.practiceSession!)
      if (take.flagged) { p.flaggedContexts.add(attempt.target.trim().toLowerCase().replace(/\s+/g, ' ')); p.flaggedSessions.add(attempt.practiceSession!) }
      patterns.set(phone, p)
    }
  }
  const sounds: SoundPattern[] = [...patterns].map(([phone, p]) => ({ phone, seen: p.seen, flagged: p.flagged,
    words: [...p.words], contexts: p.contexts.size, sessions: p.sessions.size,
    recurring: p.flagged >= 2 && (p.flaggedContexts.size >= 2 || p.flaggedSessions.size >= 2) }))
    .sort((a, b) => Number(b.recurring) - Number(a.recurring) || b.flagged / b.seen - a.flagged / a.seen || b.seen - a.seen)
  const bank = new Map([...latestWords].filter((entry): entry is [string, StruggledWord] => entry[1] !== null))
  for (const pin of manual.filter((w) => w.pinned)) bank.set(pin.word, { ...(bank.get(pin.word) ?? { ...pin,
    struggleCount: 0, totalAttempts: 0, history: [], lowestScore: 0, lastScore: 0, bestScore: 0 }), pinned: true })
  const weak: PhoneStat[] = sounds.filter((p) => p.recurring).map((p) => ({ phone: p.phone, seen: p.seen,
    correct: p.seen - p.flagged, close: 0, wrong: p.flagged, missing: 0, confusions: [], errorRate: p.flagged / p.seen }))
  return { sounds, weak, bank: [...bank.values()].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.lastSeen - a.lastSeen),
    observedWords: [...observedWords], observedPhones: [...observedPhones], compatibleAttempts: compatible.length,
    legacyExcluded, retriesExcluded, scale: latest ? `${latest.scorer ?? 'browser'} · revision ${latest.rev ?? 0}` : 'No recordings yet' }
}
export function isFirstPracticeTake(attempts: Attempt[], session: string, target: string): boolean {
  return !attempts.some((a) => a.practiceSession === session && sameLine(a.target, target))
}
