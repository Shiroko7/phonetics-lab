import type { AlignedPhone, Score } from './align.ts'
import type { WordReport } from './report.ts'
import type { ReviewRating } from './daily.ts'
import { DEFAULT_PRACTICE_THRESHOLD, normalizeThreshold, soundPracticeStatus, wordPracticeStatus, type ReviewChoice } from './practicePolicy.ts'

/**
 * Daily practice is a retention system, not a perfection test. The numbers
 * below are deliberately broad because alignment is an estimate and speech
 * naturally varies with rhythm, reduction, dialect and recording conditions.
 */
export const DAILY_PASS_SCORE = DEFAULT_PRACTICE_THRESHOLD

export interface DailyOutcome {
  rating: ReviewRating
  retry: boolean
  reason: string
  assessed?: boolean
}

/**
 * Decide whether a card needs another immediate attempt.
 *
 * Apply the user's threshold to individual assessed sounds, not a line
 * average. Review choices change suggestions, never the original score.
 */
export function automaticDailyOutcome(
  focusPhones: string[],
  aligned: AlignedPhone[] | null,
  score: Score | null,
  report: WordReport[],
  threshold = DEFAULT_PRACTICE_THRESHOLD,
  choices: (ReviewChoice | undefined)[] = [],
): DailyOutcome {
  const cutoff = normalizeThreshold(threshold)
  if (!aligned?.length || !score || !Number.isFinite(score.overall)) {
    return { rating: 'hard', retry: true, assessed: false, reason: 'This take could not be assessed. Record again; no pronunciation error is inferred.' }
  }

  const relevant = aligned.filter((step) => step.expected && (!focusPhones.length || focusPhones.includes(step.expected)))
  if (!relevant.length) {
    return { rating: 'hard', retry: true, assessed: false, reason: 'No assessable target sound. Record again; this is not a pronunciation failure.' }
  }
  if (report.some((word, i) => !choices[i] && wordPracticeStatus(word, cutoff) === 'review')
    || !report.length && relevant.some((step) => soundPracticeStatus(step, cutoff) === 'review')) {
    return { rating: 'again', retry: true, assessed: true, reason: `A sound is below your ${cutoff}/100 practice threshold. Listen in context and consider another try.` }
  }
  if (report.some((word, i) => !choices[i] && wordPracticeStatus(word, cutoff) === 'unscored')
    || !report.length && relevant.some((step) => soundPracticeStatus(step, cutoff) === 'unscored')) {
    return { rating: 'hard', retry: true, assessed: false, reason: 'Some sound timing is unavailable or ambiguous. Listen in context or record again; it is not counted as a sound error.' }
  }
  if (report.some((_, i) => choices[i])) return { rating: 'hard', retry: false, assessed: false,
    reason: 'Your review choice allows you to continue. Original scores and first-take evidence are unchanged.' }
  return { rating: 'good', retry: false, assessed: true, reason: `Assessed sounds meet your ${cutoff}/100 practice threshold. You can continue; 100 is not required.` }
}
