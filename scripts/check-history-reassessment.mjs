/** Original synthetic fixtures. No browser profile, real recordings or network access. */
import assert from 'node:assert/strict'
import { scoreAlignment } from '../src/lib/align.ts'
import { targetWords, flatten } from '../src/lib/report.ts'
import { ASSESSMENT_VERSION, isRefreshed, analysisAttempts, backupAttempts, HISTORY_BACKUP_KEY, loadAttempts, saveAttempts } from '../src/lib/practice.ts'
import { preserveAssessment, mergeAssessment } from '../src/lib/assessmentHistory.ts'
import { pending, rescoreAll } from '../src/lib/rescore.ts'
import { reviewHistory } from '../src/lib/practiceReviewHistory.ts'
import { emptyPracticePreferences } from '../src/lib/practicePolicy.ts'
import { dailyCandidates, reassessDaily, currentDailyView } from '../src/lib/dailyReassessment.ts'
import { syncCandidates, buildDailyQueue } from '../src/lib/daily.ts'
import { routineSummary } from '../src/lib/dailyRoutine.ts'
import { analyzeStats } from '../src/lib/analytics.ts'

const dict = new Map([['cat', ['kæt']], ['cap', ['kæp']]])
const preferences = emptyPracticePreferences()
const make = (at, value = 60, extra = {}) => {
  const aligned = flatten(targetWords('cat', dict)).map((phone, i) => ({ expected: phone, actual: phone, expectedIndex: i,
    score: value, verdict: 'correct', distance: 1 - value / 100, start: i / 10, end: (i + 1) / 10 }))
  return { at, target: 'cat', scorer: 'gop', rev: 2, aligned, score: scoreAlignment(aligned), ...extra }
}
const update = (before, value = 95) => preserveAssessment(before, { ...before, ...make(before.at, value), target: before.target, practiceSession: before.practiceSession,
  practiceFirst: before.practiceFirst }, 'history-rescore', 999)
const a = make(1), b = make(2)
const revised = update(a)
assert.equal(pending([a, b]), 2, 'same acoustic revision is still included in the requested one-time refresh')
assert(isRefreshed(revised))
assert.equal(pending([revised]), 0)
assert.equal(pending([{ ...revised, rev: 1 }]), 1)
assert.equal(revised.originalAssessment.score.overall, 60)
assert.equal(update(revised, 90).originalAssessment.score.overall, 60, 'subsequent refreshes preserve the earliest original')
assert.equal(revised.practiceFirst, undefined, 'rescoring cannot manufacture first-take metadata')
assert.equal(revised.at, a.at)
assert.equal(revised.assessment.version, ASSESSMENT_VERSION)

const newRecording = make(3)
assert.deepEqual(mergeAssessment([a, b, newRecording], a, revised).map(x => x.at), [1, 2, 3])
assert.equal(mergeAssessment([a, b, newRecording], a, revised)[0].score.overall, 95)
const edited = { ...a, target: 'cap' }, deleted = [b]
assert.equal(mergeAssessment([edited], a, revised)[0], edited)
assert.equal(mergeAssessment(deleted, a, revised), deleted, 'deleted recordings are not resurrected')
const duplicated = [a, { ...a }]
assert.equal(mergeAssessment(duplicated, a, revised), duplicated, 'ambiguous identities are not overwritten')
assert.throws(() => mergeAssessment([a], a, { ...revised, at: 100 }), /identity/)

let live = [a, b], release
const waiting = new Promise(resolve => { release = resolve })
const operation = rescoreAll(live, dict, undefined, { force: true,
  scoreAttempt: async before => { await waiting; return update(before) },
  onUpdate: (before, after) => { const next = mergeAssessment(live, before, after); const applied = next !== live; live = next; return applied },
})
live = [edited, b, newRecording]
release()
const run = await operation
assert.equal(run.rescored, 1)
assert.equal(run.skipped.length, 1)
assert.deepEqual(live.map(x => x.at), [1, 2, 3])
assert.equal(live[0].target, 'cap')
assert.equal(live[1].score.overall, 95)
assert.equal(live[2], newRecording)

let forced = 0
await rescoreAll([revised], dict, undefined, { force: true, scoreAttempt: async before => { forced++; return update(before) } })
assert.equal(forced, 1, 'Recalculate all really reruns already-current recordings')
const skipped = await rescoreAll([a], dict, undefined, { scoreAttempt: async () => { throw new Error('missing audio') } })
assert.equal(skipped.attempts[0], a)
assert.equal(skipped.skipped[0].reason, 'missing audio')
assert.equal(pending(skipped.attempts), 1, 'failures are not stamped current')
const noAudio = await rescoreAll([a], dict)
assert.match(noAudio.skipped[0].reason, /recording is no longer stored/, 'actual rescore path refuses unavailable IndexedDB audio without a network call')
let processed = 0
await assert.rejects(rescoreAll([a, b], dict, undefined, { scoreAttempt: async before => { processed++; return update(before) },
  onUpdate: () => { throw new Error('storage full') },
}), /storage full/)
assert.equal(processed, 1, 'persistence failure stops the run')
const controller = new AbortController()
let commits = 0
await rescoreAll([a, b], dict, undefined, { signal: controller.signal, scoreAttempt: async before => { controller.abort(); return update(before) },
  onUpdate: () => { commits++; return true },
})
assert.equal(commits, 0, 'an unmounted/cancelled refresh cannot commit its in-flight result')

// Storage is a local, in-memory fake, never the user's browser storage.
const memory = new Map(), key = 'phonetics-lab:attempts'
let quota = false
globalThis.localStorage = {
  getItem: name => memory.get(name) ?? null,
  setItem: (name, value) => { if (quota) throw new Error('QuotaExceeded'); memory.set(name, value) },
  removeItem: name => memory.delete(name),
}
assert(saveAttempts([a, b]))
backupAttempts()
const originalBytes = memory.get(HISTORY_BACKUP_KEY)
assert(saveAttempts([revised, b]))
backupAttempts()
assert.equal(memory.get(HISTORY_BACKUP_KEY), originalBytes, 'backup is never overwritten')
const persisted = memory.get(key)
quota = true
assert.equal(saveAttempts([newRecording]), false)
assert.equal(memory.get(key), persisted, 'failed save leaves original storage intact')
quota = false
assert(saveAttempts(Array.from({ length: 501 }, (_, i) => make(i))))
assert.equal(loadAttempts().length, 501, 'recalculation never silently discards the oldest recording')
assert(saveAttempts([{ ...revised, score: { ...revised.score, overall: 91 } }]))
assert.equal(loadAttempts()[0].score.overall, 91, 'loading a current assessment preserves the service headline')
memory.delete(HISTORY_BACKUP_KEY); quota = true
assert.throws(backupAttempts, /QuotaExceeded/)
delete globalThis.localStorage

const legacy = update(a, 60)
const review = reviewHistory([legacy], dict, preferences)
assert.equal(review.legacyExcluded, 1)
assert.equal(review.weak.length, 0)
assert.equal(review.bank[0].struggleCount, 0)
assert.equal(review.bank[0].legacyAttempts, 1)
assert.equal(dailyCandidates(review)[0].word, 'cat', 'legacy evidence can seed practice, without pretending to be a first take')
const olderScale = make(5, 10, { scorer: 'browser', rev: 1 })
assert.deepEqual(analysisAttempts([revised, olderScale]), [revised])
const profiles = analyzeStats([revised, olderScale], [], { cards: [], reviews: [], sessions: [] }, 'all', 1000, undefined, dict)
assert.equal(profiles.kpis.avgScore, 95)
assert.equal(profiles.kpis.totalAttempts, 1)
assert.equal(profiles.kpis.allTimeAttempts, 2)

const base = syncCandidates({ cards: [], reviews: [], sessions: [] }, dailyCandidates(review), 0)
const event = { id: 'event', stepId: 'step', cardId: 'word:cat', kind: 'transfer', prompt: 'cat', at: 1,
  status: 'scored', first: true, fresh: true, referenceHeard: false, attemptAt: 1,
  overallScore: 25, focusScore: 25, rating: 'again', scorer: 'gop', revision: 1, assessed: true }
const listening = { id: 'listen', stepId: 'listening', cardId: 'word:cat', kind: 'listening', prompt: 'cat', at: 0,
  status: 'answered', first: true, correct: true, choice: 0 }
base.sessions = [{ id: 'session', dateKey: '1970-01-01', startedAt: 0, endedAt: 10, goal: 1, queue: ['word:cat'], index: 1, reviewIds: ['review'],
  routine: { version: 1, cursor: 1, steps: [], events: [listening, event], notices: [] } }]
base.reviews = [{ id: 'review', cardId: 'word:cat', sessionId: 'session', reviewedAt: 10, prompt: 'cat', rating: 'again',
  overallScore: 25, attemptAt: 1, intervalBeforeDays: 0, intervalAfterDays: 0, dueAt: 100 }]
const raw = JSON.stringify(base)
const goodReview = reviewHistory([revised], dict, preferences)
const reconciled = reassessDaily(base, [revised], dict, preferences, goodReview)
assert.equal(JSON.stringify(base), raw)
assert.equal(reconciled.sessions[0].routine.events[1].overallScore, 25)
assert.equal(reconciled.sessions[0].routine.events[1].currentAssessment.overallScore, 95)
assert.equal(reconciled.reviews[0].rating, 'again', 'original scheduling event is unchanged')
assert.equal(reconciled.reviews[0].currentAssessment.rating, 'good')
assert.equal(reconciled.reviews[0].dueAt, 100, 'historical review dates are not rewritten')
assert.equal(reconciled.cards[0].analysisInactive, true)
assert.deepEqual(buildDailyQueue(reconciled.cards, 4, 1000), [])
const display = currentDailyView(reconciled)
assert.equal(routineSummary(display.sessions).transfer.average, 95)
assert.equal(routineSummary(display.sessions).transfer.count, 1)
assert.equal(routineSummary(display.sessions).listening.correct, 1)
assert.equal(display.reviews[0].rating, 'good')
assert.equal(analyzeStats([revised], [], display, 'all', 1000, undefined, dict).kpis.dailySuccessRate, 100)
assert.equal(reassessDaily(reconciled, [revised], dict, preferences, goodReview), reconciled, 'idempotent derivation')
const badAgain = reassessDaily(reconciled, [legacy], dict, preferences, review)
assert.equal(badAgain.cards[0].analysisInactive, false)
assert.equal(currentDailyView(badAgain).sessions[0].routine.events[1].overallScore, 60)
const unavailable = reassessDaily(reconciled, [update(make(1, 95, { target: 'cap' }))], dict, preferences, goodReview)
assert.equal(unavailable.sessions[0].routine.events[1].currentAssessment, undefined, 'different transcript cannot rewrite an old Daily event')
assert.equal(currentDailyView(unavailable).sessions[0].routine.events[1].overallScore, 25)
const pin = { ...review.bank[0], pinned: true }
const pinned = reassessDaily(reconciled, [revised], dict, preferences, reviewHistory([revised], dict, preferences, [pin]))
assert.equal(pinned.cards[0].analysisInactive, false, 'manual pins remain eligible even when current scores meet the threshold')

const first = { ...legacy, practiceSession: 's1', practiceFirst: true }
const second = { ...update(b, 70), practiceSession: 's2', practiceFirst: true }
const word = reviewHistory([first, second], dict, preferences).bank[0]
assert.deepEqual(word.history.map(h => h.score), [60, 70])
assert.equal(word.lowestScore, 60)
assert.equal(word.bestScore, 70)
assert.equal(word.struggleCount, 2)
console.log('History reassessment passed: full refresh, original evidence, safe incremental merge, failures, persistence, legacy practice, Stats and Daily propagation.')
