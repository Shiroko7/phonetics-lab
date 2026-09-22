/** Authored synthetic fixtures; no claims about human performance. */
import assert from 'node:assert/strict'
import { scoreAlignment } from '../src/lib/align.ts'
import { byWord, targetWords, flatten } from '../src/lib/report.ts'
import { emptyPracticePreferences, soundScore, soundPracticeStatus, wordPracticeStatus, wordReviewKey, decisionsFor, normalizeThreshold } from '../src/lib/practicePolicy.ts'
import { reviewHistory, isFirstPracticeTake } from '../src/lib/practiceReviewHistory.ts'
import { automaticDailyOutcome } from '../src/lib/dailyDecision.ts'
import { routineCardRating, recordRoutineReviewChoices, routineSummary, advanceRoutine } from '../src/lib/dailyRoutine.ts'
import { syncCandidates, startDailySession } from '../src/lib/daily.ts'

const dict = new Map([['cat', ['kæt']], ['cap', ['kæp']]])
const step = (score = 100, index = 0, expected = 'k') => ({ expected, actual: expected, expectedIndex: index,
  score, verdict: 'correct', distance: 0, start: index / 10, end: (index + 1) / 10 })
const attempt = (at, target = 'cat', session = 's1', first = true, scores = [79, 100, 100]) => {
  const aligned = flatten(targetWords(target, dict)).map((p, i) => step(scores[i % scores.length], i, p))
  return { at, target, aligned, score: scoreAlignment(aligned), scorer: 'gop', rev: 2, practiceSession: session, practiceFirst: first }
}
const prefs = emptyPracticePreferences()
assert.equal(prefs.threshold, 80)
assert.equal(soundScore(step(100)), 100, '100 is not capped')
assert.equal(soundScore(step(73)), 73, 'correct verdict never inflates a numerical score')
assert.equal(soundPracticeStatus(step(80)), 'met')
assert.equal(soundPracticeStatus(step(79)), 'review')
assert.equal(soundPracticeStatus(step(79), 75), 'met')
for (const invalid of [{ end: 0 }, { start: null }, { score: NaN }, { score: 101 }, { verdict: 'missing' }, { expectedIndex: null }]) {
  assert.equal(soundPracticeStatus({ ...step(), ...invalid }), 'unscored')
}
assert.equal(normalizeThreshold(NaN), 80)
assert.equal(normalizeThreshold(200), 100)
const a = attempt(1), reports = byWord(targetWords(a.target, dict), a.aligned)
assert(a.score.overall > 80)
assert.equal(wordPracticeStatus(reports[0]), 'review', 'a high average must not hide a low phone')
assert.equal(wordPracticeStatus({ ...reports[0], timing: 'ambiguous' }), 'unscored')
assert.equal(wordPracticeStatus({ ...reports[0], timing: 'unavailable' }), 'unscored')
const original = JSON.stringify(a)
const key = wordReviewKey(a, reports[0], 0)
const accepted = { ...prefs, decisions: { [key]: 'accepted' } }
assert.deepEqual(decisionsFor(a, reports, accepted), ['accepted'])
assert.equal(wordReviewKey({ ...a, rev: 3 }, reports[0], 0) === key, false)
assert.equal(wordReviewKey({ ...a, target: 'cap' }, reports[0], 0) === key, false)
assert.equal(wordReviewKey(a, [{ ...reports[0], steps: [step(78)] }][0], 0) === key, false)
assert.equal(reviewHistory([a], dict, accepted).sounds.length, 0)
assert.equal(reviewHistory([a], dict, accepted).bank.length, 0)
assert.equal(reviewHistory([a], dict, { ...accepted, decisions: { [key]: 'bad-cut' } }).bank.length, 0)
assert.equal(reviewHistory([a], dict, { ...accepted, decisions: { [key]: 'later' } }).bank.length, 1)
assert.equal(JSON.stringify(a), original, 'review never rewrites evidence')
assert.equal(reviewHistory([a], dict, prefs).bank.length, 1, 'undo restores review')
assert.equal(reviewHistory([a], dict, { ...prefs, threshold: 75 }).bank.length, 0)
const repeated = reviewHistory([attempt(1, 'cat cat')], dict, prefs)
assert.equal(repeated.sounds.find(p => p.phone === 'k').seen, 1)
assert.equal(repeated.bank[0].totalAttempts, 1, 'repeated words count once per first take')
assert.equal(repeated.bank[0].struggleCount, 1)
const history = [a, attempt(2, 'cat', 's1', false), attempt(3, 'cat', 's2'), attempt(4, 'cap', 's2')]
const reviewed = reviewHistory(history, dict, prefs)
assert.equal(reviewed.retriesExcluded, 1)
assert.equal(reviewed.sounds.find(p => p.phone === 'k').seen, 3)
assert.equal(reviewed.sounds.find(p => p.phone === 'k').recurring, true)
assert.equal(reviewHistory([a, { ...attempt(2), practiceSession: undefined, practiceFirst: undefined }], dict, prefs).legacyExcluded, 1)
assert.equal(reviewHistory([a, { ...attempt(2), rev: 3 }], dict, prefs).sounds[0].seen, 1, 'scorer revisions stay separate')
assert.equal(reviewHistory([a, attempt(2, 'cat', 's1', false, [100])], dict, prefs).bank.length, 0, 'a resolved retry clears the queue without inflating first-take counts')
assert.equal(reviewHistory([a], dict, { ...prefs, dismissedBefore: { cat: 1 } }).bank.length, 0)
assert.equal(reviewHistory([a, attempt(2)], dict, { ...prefs, dismissedBefore: { cat: 1 } }).bank.length, 1)
assert.equal(isFirstPracticeTake([a], 's1', ' cat '), false)
assert.equal(isFirstPracticeTake([a], 's2', 'cat'), true)

assert.equal(automaticDailyOutcome([], a.aligned, a.score, reports).retry, true)
for (const choice of ['accepted', 'later', 'bad-cut']) {
  const result = automaticDailyOutcome([], a.aligned, a.score, reports, 80, [choice])
  assert.equal(result.retry, false)
  assert.equal(result.assessed, false)
}
assert.equal(automaticDailyOutcome([], a.aligned, a.score, [...reports, { ...reports[0], timing: 'ambiguous' }], 80, ['accepted']).retry, true,
  'one review cannot hide another unassessed word')
assert.equal(automaticDailyOutcome([], a.aligned, a.score, [...reports, ...reports], 80, ['accepted']).retry, true)
const event = { id: 'e', stepId: 'p', cardId: 'c', kind: 'transfer', prompt: 'cat', first: true, fresh: true,
  status: 'scored', overallScore: 93, rating: 'again', assessed: true, attemptAt: 1, at: 1, scorer: 'gop', revision: 2 }
const state = { cards: [], reviews: [], sessions: [{ id: 's', routine: { events: [event] } }] }
const updated = recordRoutineReviewChoices(state, 's', 1, ['accepted'], true)
assert.equal(JSON.stringify(updated.sessions[0].routine.events), JSON.stringify(state.sessions[0].routine.events))
assert.equal(routineCardRating([event], updated.sessions[0].routine.practiceReviews, updated.sessions[0].routine.practiceReviewResolved), 'hard')
assert.equal(routineCardRating([event], updated.sessions[0].routine.practiceReviews), 'again', 'partially reviewed take cannot hide unresolved flags')
assert.equal(routineCardRating([event, { ...event, id: 'other', attemptAt: 2 }], updated.sessions[0].routine.practiceReviews,
  updated.sessions[0].routine.practiceReviewResolved), 'again', 'one reviewed take cannot hide another low first take')
assert.equal(routineCardRating([event], recordRoutineReviewChoices(updated, 's', 1, []).sessions[0].routine.practiceReviews), 'again')
assert.equal(routineCardRating([{ ...event, assessed: false }]), null)
assert.equal(routineSummary([{ routine: { events: [{ ...event, assessed: false }] } }]).transfer.count, 0)
const base = Date.now()
const started = startDailySession(syncCandidates({ cards: [], reviews: [], sessions: [] }, [{ id: 'c', kind: 'sound', label: 'k', focusPhones: ['k'] }], base), 1, base)
const scheduleState = { ...started.state, sessions: started.state.sessions.map(s => ({ ...s, routine: {
  version: 1, cursor: 0, notices: [], steps: [{ id: 'p', cardId: 'c', kind: 'transfer', prompt: 'cat' }],
  events: [event], practiceReviews: { 1: ['accepted'] }, practiceReviewResolved: { 1: true },
} })) }
const scheduled = advanceRoutine(scheduleState, started.session.id, base + 1)
assert.equal(scheduled.reviews.length, 1)
assert.equal(scheduled.cards[0].lastRating, 'hard')
assert.equal(scheduled.cards[0].successfulReviews, 0, 'manual acceptance never manufactures successful review evidence')
assert.equal(scheduled.sessions[0].routine.events[0].overallScore, 93)
console.log('Practice policy: score integrity, 80/100 sound flags, abstention, first-take recurrence, reviews and Daily scheduling passed.')
