/** Practice decisions, not an acoustic scorer or calibrated correctness probability. */
import { scoreAlignment, type AlignedPhone } from './align.ts'
import type { WordReport } from './report.ts'
import type { Attempt } from './practice.ts'

export const DEFAULT_PRACTICE_THRESHOLD = 80
export const PRACTICE_POLICY_REVISION = 1
export const PRACTICE_PREFERENCES_KEY = 'phonetics-lab:practice-policy-v1'
export type ReviewChoice = 'accepted' | 'later' | 'bad-cut'
export type PracticeStatus = 'met' | 'review' | 'unscored'
export interface PracticePreferences {
  threshold: number
  /** User choices only. Never labels, numerical score edits or training data. */
  decisions: Record<string, ReviewChoice>
  dismissedBefore: Record<string, number>
}
export const emptyPracticePreferences = (): PracticePreferences => ({ threshold: DEFAULT_PRACTICE_THRESHOLD, decisions: {}, dismissedBefore: {} })
export function normalizeThreshold(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : DEFAULT_PRACTICE_THRESHOLD
}
export function loadPracticePreferences(): PracticePreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(PRACTICE_PREFERENCES_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return emptyPracticePreferences()
    return { threshold: normalizeThreshold(raw.threshold),
      decisions: Object.fromEntries(Object.entries(raw.decisions ?? {}).filter(([, v]) => typeof v === 'string' && ['accepted', 'later', 'bad-cut'].includes(v))) as Record<string, ReviewChoice>,
      dismissedBefore: Object.fromEntries(Object.entries(raw.dismissedBefore ?? {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number> }
  } catch { return emptyPracticePreferences() }
}
export function savePracticePreferences(value: PracticePreferences): void {
  try { localStorage.setItem(PRACTICE_PREFERENCES_KEY, JSON.stringify(value)) } catch { /* Optional persistence. */ }
}
export function soundScore(step: AlignedPhone): number | null {
  if (!step.expected || step.expectedIndex === null || step.verdict === 'missing'
    || step.start === null || step.end === null || !Number.isFinite(step.start) || !Number.isFinite(step.end)
    || step.end <= step.start) return null
  if (step.score !== undefined) return Number.isFinite(step.score) && step.score >= 0 && step.score <= 100 ? step.score : null
  // Browser recognizer has a different scale, retained in history provenance.
  return scoreAlignment([step]).overall
}
export function soundPracticeStatus(step: AlignedPhone, threshold = DEFAULT_PRACTICE_THRESHOLD, unreliable = false): PracticeStatus {
  const score = unreliable ? null : soundScore(step)
  return score === null ? 'unscored' : score < normalizeThreshold(threshold) ? 'review' : 'met'
}
export function wordPracticeStatus(word: WordReport, threshold = DEFAULT_PRACTICE_THRESHOLD): PracticeStatus {
  if (word.timing === 'ambiguous' || word.timing === 'unavailable' || !word.steps.length) return 'unscored'
  const statuses = word.steps.filter((s) => s.expected).map((s) => soundPracticeStatus(s, threshold))
  if (!statuses.length || statuses.includes('unscored')) return 'unscored'
  return statuses.includes('review') ? 'review' : 'met'
}
export function practiceClass(status: PracticeStatus): string {
  return status === 'met' ? 'good' : status === 'review' ? 'poor' : 'uncertain'
}
/** Text correction or rescoring invalidates a dismissal; evidence remains immutable. */
export function wordReviewKey(attempt: Attempt, word: WordReport, index: number): string {
  return JSON.stringify([attempt.at, attempt.scorer ?? 'browser', attempt.rev ?? 0, attempt.target, index,
    word.steps.map((s) => [s.expectedIndex, s.expected, s.actual, s.score ?? null, s.distance, s.verdict, s.start, s.end])])
}
export function decisionsFor(attempt: Attempt | undefined, reports: WordReport[], preferences: PracticePreferences): (ReviewChoice | undefined)[] {
  return reports.map((word, i) => attempt ? preferences.decisions[wordReviewKey(attempt, word, i)] : undefined)
}
