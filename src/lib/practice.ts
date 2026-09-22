/**
 * Practice sessions: what was attempted, how it scored, and which sounds keep
 * going wrong across attempts.
 *
 * The legacy per-phone tally is descriptive model output, not human evidence.
 * practiceReviewHistory.ts derives current practice flags from first takes.
 * Even recurring flags may be systematic recognizer errors.
 */

import { scoreAlignment, type AlignedPhone, type Score } from './align.ts'
import { ANALYSIS_REVISION } from './backend.ts'

/**
 * Which scorer produced an attempt's numbers.
 *
 * The two are not on the same scale, so a score from one cannot honestly be
 * compared against a score from the other. Absent on anything saved before the
 * scoring service existed, which is why the field is optional and why
 * `scorerOf` reads a missing one as the browser.
 */
export type Scorer = 'browser' | 'gop'

/**
 * Bumped whenever the service starts producing different numbers for the same
 * audio — recalibrated GOP thresholds, a new acoustic model, a change to the
 * accepted variants. Attempts carry the revision they were scored under, so
 * raising this is the whole of what it takes to have the history re-measure
 * itself the next time the app opens with the service running.
 *
 * 1: forced alignment + GOP, hand-set thresholds.
 * 2: word-aware variant paths, numerical scores, acoustic validity checks.
 */
export const SCORER_REVISION = ANALYSIS_REVISION

export interface Attempt {
  /** The phrase that was practised. */
  target: string
  aligned: AlignedPhone[]
  score: Score
  at: number
  scorer?: Scorer
  /** `SCORER_REVISION` at the time this was scored. Absent on anything older. */
  rev?: number
  /** Duration of the recording in milliseconds if available. */
  durationMs?: number
  /** Recording mode: free speech vs scripted. */
  mode?: 'scripted' | 'free'
  /** Practice provenance, independent of the acoustic scoring revision. */
  practiceSession?: string
  practiceFirst?: boolean
}

export function scorerOf(attempt: Attempt): Scorer {
  return attempt.scorer ?? 'browser'
}

export function sameScoringScale(a: Attempt, b: Attempt): boolean {
  return scorerOf(a) === scorerOf(b) && (a.rev ?? 0) === (b.rev ?? 0)
}

/** Whether an attempt's numbers came from the scoring service as it stands now. */
export function isCurrent(attempt: Attempt): boolean {
  return scorerOf(attempt) === 'gop' && attempt.rev === SCORER_REVISION
}

/** True when a run of attempts mixes the two scales, so trends across them lie. */
export function mixedScorers(attempts: Attempt[]): boolean {
  if (attempts.length < 2) return false
  return attempts.some((attempt) => !sameScoringScale(attempt, attempts[0]))
}

export interface PhoneStat {
  phone: string
  seen: number
  correct: number
  close: number
  wrong: number
  missing: number
  /** What was said instead, counted, most frequent first. */
  confusions: [string, number][]
  /** 0-1, where 1 is always wrong. */
  errorRate: number
}

const HISTORY_KEY = 'phonetics-lab:attempts'
const MAX_ATTEMPTS = 500

export function loadAttempts(): Attempt[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return (parsed as Attempt[]).map((attempt) => {
      if (attempt.scorer !== 'gop' || !Array.isArray(attempt.aligned)) return attempt
      // v1 persisted the original numerical score indirectly as distance.
      // Restore it without inventing acoustic evidence or changing revision.
      const aligned = attempt.aligned.map((step) => step.score === undefined && step.distance !== null
        ? { ...step, score: Math.round(100 * (1 - step.distance)) } : step)
      return { ...attempt, aligned, score: scoreAlignment(aligned) }
    })
  } catch {
    return []
  }
}

export function saveAttempts(attempts: Attempt[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(attempts.slice(-MAX_ATTEMPTS)))
  } catch {
    // History is a convenience; a full or blocked store must not break practice.
  }
}

export function clearStoredAttempts(): void {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    // Optional storage removal
  }
}

/**
 * Roll attempts up per expected phone. Sounds attempted only once or twice are
 * still listed but rank low, so a single fluke does not dominate the report.
 */
export function aggregate(attempts: Attempt[]): PhoneStat[] {
  const stats = new Map<string, PhoneStat & { confusionMap: Map<string, number> }>()

  const bucket = (phone: string) => {
    let stat = stats.get(phone)
    if (!stat) {
      stat = {
        phone, seen: 0, correct: 0, close: 0, wrong: 0, missing: 0,
        confusions: [], errorRate: 0, confusionMap: new Map(),
      }
      stats.set(phone, stat)
    }
    return stat
  }

  for (const attempt of attempts) {
    for (const step of attempt.aligned) {
      if (!step.expected) continue
      const stat = bucket(step.expected)
      stat.seen++
      if (step.verdict === 'correct') stat.correct++
      else if (step.verdict === 'close') stat.close++
      else if (step.verdict === 'missing') stat.missing++
      else if (step.verdict === 'wrong') {
        stat.wrong++
        if (step.actual) stat.confusionMap.set(step.actual, (stat.confusionMap.get(step.actual) ?? 0) + 1)
      }
    }
  }

  return [...stats.values()]
    .map((stat) => {
      const misses = stat.wrong + stat.missing + stat.close * 0.4
      return {
        phone: stat.phone,
        seen: stat.seen,
        correct: stat.correct,
        close: stat.close,
        wrong: stat.wrong,
        missing: stat.missing,
        confusions: [...stat.confusionMap.entries()].sort((a, b) => b[1] - a[1]),
        errorRate: stat.seen === 0 ? 0 : misses / stat.seen,
      }
    })
    // Weight by evidence so a 1-of-1 miss does not outrank a 8-of-10 habit.
    .sort((a, b) => b.errorRate * Math.log2(b.seen + 1) - a.errorRate * Math.log2(a.seen + 1))
}

/**
 * How a single line has gone across every attempt at it.
 *
 * Practice is repetition — say it, see what was wrong, say it again — so the
 * useful question after an attempt is not "how did that go" but "is this better
 * than last time".
 */
export interface LineProgress {
  tries: number
  best: number
  first: number
  latest: number
}

/** The same line however it was capitalised, spaced or punctuated. */
function lineKey(target: string): string {
  return target.toLowerCase().replace(/[^a-z0-9']+/g, ' ').trim()
}

/** Whether two attempts were at the same line. */
export function sameLine(a: string, b: string): boolean {
  const key = lineKey(a)
  return key.length > 0 && key === lineKey(b)
}

export function lineProgress(attempts: Attempt[], target: string): LineProgress | null {
  const key = lineKey(target)
  if (!key) return null

  const scores = attempts
    .filter((attempt) => lineKey(attempt.target) === key)
    .map((attempt) => attempt.score.overall)
  if (scores.length === 0) return null

  return {
    tries: scores.length,
    best: Math.max(...scores),
    first: scores[0],
    latest: scores[scores.length - 1],
  }
}

/** Split a passage into practisable sentences. */
export function toSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])[\s ]+(?=[A-Z"'“])|\n+/)
    .map((s) => s.trim())
    .filter((s) => /[a-zA-Z]/.test(s))
}

/** A rolling average of the last few attempts, for the trend line. */
export function recentAverage(attempts: Attempt[], count = 5): number | null {
  const recent = attempts.slice(-count)
  if (recent.length === 0) return null
  return Math.round(recent.reduce((sum, a) => sum + a.score.overall, 0) / recent.length)
}
