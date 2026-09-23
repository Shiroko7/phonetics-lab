/** Project current recording analyses into Daily without rewriting original events or review dates. */
import type { Dictionary } from './dict.ts'
import { isRefreshed, sameLine, type Attempt } from './practice.ts'
import { byWord, dominant, targetWords } from './report.ts'
import { automaticDailyOutcome } from './dailyDecision.ts'
import { decisionsFor, soundScore, wordPracticeStatus, type PracticePreferences } from './practicePolicy.ts'
import { cardIdForSound, cardIdForWord, type CardCandidate, type CurrentDailyAssessment, type DailyState } from './daily.ts'
import { routineCardRating } from './dailyRoutine.ts'
import type { reviewHistory } from './practiceReviewHistory.ts'

type Review = ReturnType<typeof reviewHistory>
export function dailyCandidates(review: Review): CardCandidate[] {
  return [
    ...review.weak.slice(0, 4).map(stat => {
      const confusion = dominant(stat.confusions)?.[0]
      return { id: cardIdForSound(stat.phone, confusion), kind: 'sound' as const, label: `/${stat.phone}/`, focusPhones: [stat.phone], confusion }
    }),
    ...review.bank.filter(w => w.pinned || w.struggleCount >= 2 || (w.legacyAttempts ?? 0) > 0).slice(0, 8).map(w => ({
      id: cardIdForWord(w.word), kind: 'word' as const, label: w.display, word: w.display, focusPhones: w.weakPhones.map(p => p.phone),
    })),
  ]
}

export function reassessDaily(state: DailyState, attempts: Attempt[], dict: Dictionary, preferences: PracticePreferences, review: Review): DailyState {
  if (!attempts.some(isRefreshed)) return state
  const byAt = new Map(attempts.map(a => [a.at, a]))
  const duplicate = new Set(attempts.filter((a, i) => attempts.findIndex(b => b.at === a.at) !== i).map(a => a.at))
  const assess = (at: number | undefined, prompt: string, cardId: string): CurrentDailyAssessment | undefined => {
    const attempt = at === undefined || duplicate.has(at) ? undefined : byAt.get(at)
    if (!attempt || !isRefreshed(attempt) || !sameLine(attempt.target, prompt)) return undefined
    const reports = byWord(targetWords(attempt.target, dict), attempt.aligned)
    const focus = state.cards.find(c => c.id === cardId)?.focusPhones ?? []
    const values = reports.filter(w => wordPracticeStatus(w, preferences.threshold) !== 'unscored').flatMap(w => w.steps)
      .filter(s => s.expected && (!focus.length || focus.includes(s.expected))).map(soundScore).filter((n): n is number => n !== null)
    const outcome = automaticDailyOutcome(focus, attempt.aligned, attempt.score, reports, preferences.threshold, decisionsFor(attempt, reports, preferences))
    return { overallScore: attempt.score.overall, focusScore: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : undefined,
      rating: outcome.rating, assessed: outcome.assessed === true, scorer: attempt.scorer!, revision: attempt.rev!,
      updatedAt: attempt.assessment!.at, practiceThreshold: preferences.threshold }
  }
  const sessions = state.sessions.map(session => !session.routine ? session : { ...session, routine: { ...session.routine,
    events: session.routine.events.map(event => event.status !== 'scored' ? event : {
      ...event, currentAssessment: assess(event.attemptAt, event.prompt, event.cardId),
    }),
  } })
  const reviews = state.reviews.map(event => {
    let currentAssessment = assess(event.attemptAt, event.prompt, event.cardId)
    const routine = sessions.find(s => s.id === event.sessionId)?.routine
    if (currentAssessment && routine) {
      const events = routine.events.filter(e => e.cardId === event.cardId)
      const speech = events.filter(e => e.first && e.status === 'scored')
      // Don't call a mixed old/current set of first takes a recalculated review.
      if (speech.some(e => !e.currentAssessment)) currentAssessment = undefined
      else {
        const rating = routineCardRating(events.map(e => e.currentAssessment ? { ...e, ...e.currentAssessment } : e))
        currentAssessment = { ...currentAssessment, rating: rating ?? 'hard', assessed: rating !== null && currentAssessment.assessed }
      }
    }
    return { ...event, currentAssessment }
  })
  const words = new Map(review.bank.map(w => [w.word, w]))
  const flags = new Set(review.bank.flatMap(w => w.weakPhones.map(p => p.phone)))
  const cards = state.cards.map(card => {
    const word = card.word?.toLowerCase().replace(/[^a-z0-9']/g, '')
    if (word && words.get(word)?.pinned) return { ...card, analysisInactive: false }
    const known = card.kind === 'word' ? !!word && review.observedWords.includes(word)
      : card.focusPhones.length > 0 && card.focusPhones.every(p => review.observedPhones.includes(p))
    const relevant = card.kind === 'word' ? !!word && words.has(word) : card.focusPhones.some(p => flags.has(p))
    if (!known) return card
    return { ...card, analysisInactive: !relevant }
  })
  const next = { ...state, cards, sessions, reviews }
  return JSON.stringify(next) === JSON.stringify(state) ? state : next
}

/** Read-only display/analytics projection. Never persist this over the source events. */
export function currentDailyView(state: DailyState): DailyState {
  return { ...state,
    sessions: state.sessions.map(s => !s.routine ? s : { ...s, routine: { ...s.routine,
      events: s.routine.events.map(e => e.currentAssessment ? { ...e, ...e.currentAssessment } : e),
    } }),
    reviews: state.reviews.map(r => r.currentAssessment ? { ...r, ...r.currentAssessment } : r),
  }
}
