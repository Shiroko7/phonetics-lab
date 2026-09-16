import type { AlignedPhone, Score } from './align.ts'
import type { WordReport } from './report.ts'
import type { ReviewRating } from './daily.ts'

/**
 * Daily practice is a retention system, not a perfection test. The numbers
 * below are deliberately broad because alignment is an estimate and speech
 * naturally varies with rhythm, reduction, dialect and recording conditions.
 */
export const DAILY_RETRY_SCORE = 78
export const DAILY_POOR_WORD_SCORE = 70
export const DAILY_PASS_SCORE = 90

export interface DailyOutcome {
  rating: ReviewRating
  retry: boolean
  reason: string
}

/**
 * Decide whether a card needs another immediate attempt.
 *
 * A line score of 90 or more is enough to move on. Individual mismatches
 * still get highlighted and keep the next interval conservative. Below
 * that goal, a gross target error, a substantially poor word, or a low
 * whole-line score suggests another pass; close phones remain acceptable.
 */
export function automaticDailyOutcome(
  focusPhones: string[],
  aligned: AlignedPhone[] | null,
  score: Score | null,
  report: WordReport[],
): DailyOutcome {
  if (!aligned?.length || !score || !Number.isFinite(score.overall)) {
    return { rating: 'again', retry: true, reason: 'The take could not be scored reliably.' }
  }

  const relevant = aligned.filter((step) => step.expected && focusPhones.includes(step.expected))
  if (!relevant.length) {
    return { rating: 'again', retry: true, reason: 'The target sound was not available for comparison.' }
  }
  const grossTargetError = relevant.some(
    (step) => step.verdict === 'wrong' || step.verdict === 'missing',
  )
  const closeTarget = relevant.some((step) => step.verdict === 'close')
  const poorWord = report.some((word) => word.score < DAILY_POOR_WORD_SCORE)
  const lowLineScore = score.overall < DAILY_RETRY_SCORE
  const meetsGoal = score.overall >= DAILY_PASS_SCORE

  if (!meetsGoal && (grossTargetError || poorWord || lowLineScore)) {
    return {
      rating: 'again',
      retry: true,
      reason: grossTargetError
        ? 'The scorer detected a possible substitution or omission in the target.'
        : poorWord
          ? 'One or more words have a substantial mismatch.'
          : 'The line score suggests another attempt may help.',
    }
  }

  if (grossTargetError || poorWord || closeTarget || !meetsGoal) {
    return {
      rating: 'hard',
      retry: false,
      reason: meetsGoal
        ? `The line meets the ${DAILY_PASS_SCORE}/100 goal. Highlighted sounds will stay in review.`
        : 'The line was usable, so it stays in rotation with a short interval.',
    }
  }
  if (score.overall >= 95) {
    return { rating: 'easy', retry: false, reason: 'The target held cleanly in this context.' }
  }
  return { rating: 'good', retry: false, reason: `The line meets the ${DAILY_PASS_SCORE}/100 goal. The independent checks will guide the next review.` }
}
