import {
  DAILY_TRAINING_SENTENCES, DAILY_TRANSFER_SENTENCES, LISTENING_CONTRASTS,
  TRANSFER_ACTIONS, TRANSFER_SUBJECTS,
} from '../data/dailyContent.ts'
import { expectedPhones } from './align.ts'
import { contextSentences, isPracticeContext, isWordCarrier } from './context.ts'
import { localDateKey, scheduleDailyCard, type CurrentDailyAssessment, type DailyCard, type DailySession, type DailyState, type ReviewRating } from './daily.ts'
import type { Dictionary } from './dict.ts'
import { flatten, targetWords } from './report.ts'
import type { Voice } from './speech.ts'
import { allowedDailyVoices, type VoicePreferences } from './voicePreferences.ts'
import { dailySentences, resolveDailySentence, sentenceKey as key } from './dailySentences.ts'
import type { ReviewChoice } from './practicePolicy.ts'

export type RoutineKind = 'listening' | 'production' | 'transfer' | 'recall'
export interface DailyPreferences {
  /** Legacy whitelist, retained for storage compatibility; the shared exclusion pool supersedes it. */
  voiceURIs: string[]
  goal: number
}
export interface RoutineStep {
  id: string
  cardId: string
  kind: RoutineKind
  prompt: string
  voiceURI?: string
  voicePicked?: boolean
  options?: [string, string]
  answer?: number
  pair?: [string, string]
  fresh?: boolean
  exposedAt?: number
  referenceHeard?: boolean
}
export interface RoutineEvent {
  id: string
  stepId: string
  cardId: string
  kind: RoutineKind
  prompt: string
  at: number
  status: 'scored' | 'answered' | 'skipped'
  /** Only the first response to this step counts in progress and scheduling. */
  first: boolean
  correct?: boolean
  choice?: number
  rating?: ReviewRating
  overallScore?: number
  focusScore?: number
  attemptAt?: number
  scorer?: string
  revision?: number
  assessed?: boolean
  practiceThreshold?: number
  practicePolicyRevision?: number
  voiceURI?: string
  referenceHeard?: boolean
  fresh?: boolean
  /** Derived view only; original event fields above remain immutable. */
  currentAssessment?: CurrentDailyAssessment
}
export interface DailyRoutine {
  version: 1
  voiceRotation?: 1
  steps: RoutineStep[]
  cursor: number
  events: RoutineEvent[]
  notices: string[]
  /** Scheduling choices are separate from immutable first-take scores and ratings. */
  practiceReviews?: Record<string, ReviewChoice[]>
  practiceReviewResolved?: Record<string, boolean>
}

const sample = <T,>(items: T[], random: () => number): T | undefined => items[Math.min(items.length - 1, Math.floor(random() * items.length))]
const shuffle = <T,>(items: T[], random: () => number): T[] => {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function referenceVoicePool(voices: Voice[], preferences: VoicePreferences = { excluded: [], accent: 'en-US' }): Voice[] {
  return allowedDailyVoices(voices, preferences)
}

/** Keep sentences and evidence fixed while repairing the remaining voice rotation. */
export function refreshRoutineVoices(routine: DailyRoutine, voices: Voice[], random: () => number = Math.random): DailyRoutine {
  const pool = shuffle(voices, random)
  const available = new Set(pool.map((voice) => voice.uri))
  const counts = new Map<string, number>()
  let previous: string | undefined
  let changed = routine.voiceRotation !== 1
  const steps = routine.steps.map((step, index) => {
    if (index < routine.cursor) { previous = step.voiceURI; return step }
    const valid = !!step.voiceURI && available.has(step.voiceURI)
    const currentHeard = index === routine.cursor && (step.voicePicked || step.referenceHeard || routine.events.some((event) => event.stepId === step.id))
    let voiceURI = step.voiceURI
    if (!valid || !currentHeard && (!routine.voiceRotation || pool.length > 1 && voiceURI === previous)) {
      const alternatives = pool.filter((voice) => pool.length === 1 || voice.uri !== previous)
      voiceURI = [...alternatives].sort((a, b) => (counts.get(a.uri) ?? 0) - (counts.get(b.uri) ?? 0))[0]?.uri
    }
    previous = voiceURI
    if (voiceURI) counts.set(voiceURI, (counts.get(voiceURI) ?? 0) + 1)
    if (voiceURI === step.voiceURI) return step
    changed = true
    return { ...step, voiceURI, referenceHeard: false, voicePicked: false }
  })
  return changed ? { ...routine, voiceRotation: 1, steps } : routine
}

export function changeRoutineVoice(routine: DailyRoutine, voiceURI: string): DailyRoutine {
  return { ...routine, steps: routine.steps.map((step, index) => index === routine.cursor && step.voiceURI !== voiceURI
    ? { ...step, voiceURI, referenceHeard: false, voicePicked: true } : step) }
}

export function sentenceFitsCard(text: string, card: DailyCard, dict: Dictionary): boolean {
  if (!isPracticeContext(text, dict, card.kind === 'word' ? card.word : undefined)) return false
  const words = targetWords(text, dict)
  const phones = flatten(words)
  return card.focusPhones.some((phone) => phones.includes(phone))
}

export function contrastsForCard(card: DailyCard, dict: Dictionary) {
  return LISTENING_CONTRASTS.flatMap((contrast) => {
    const [a, b] = contrast.words.map((word) => expectedPhones(dict.get(word)?.[0] ?? ''))
    if (!a.length || a.length !== b.length) return []
    const changed = a.flatMap((phone, i) => phone !== b[i] ? [[phone, b[i]] as [string, string]] : [])
    if (changed.length !== 1 || !card.focusPhones.some((phone) => changed[0].includes(phone))) return []
    return [{ ...contrast, pair: changed[0], exact: !!card.confusion && changed[0].includes(card.confusion) }]
  }).sort((a, b) => Number(b.exact) - Number(a.exact))
}

/** An edited listening trial must still differ by its original sound contrast. */
export function validListeningOptions(options: [string, string], pair: [string, string] | undefined, dict: Dictionary): boolean {
  if (!pair || options.some((text) => !isPracticeContext(text, dict))) return false
  const [a, b] = options.map((text) => flatten(targetWords(text, dict)))
  if (a.length !== b.length) return false
  const changed = a.flatMap((phone, index) => phone === b[index] ? [] : [[phone, b[index]]])
  return changed.length === 1 && pair.every((phone) => changed[0].includes(phone))
}

export function exposedPrompts(state: DailyState, attemptTexts: string[] = []): Set<string> {
  return new Set([
    ...contextSentences(attemptTexts),
    ...state.reviews.map((review) => review.prompt),
    ...state.cards.flatMap((card) => [card.lastPrompt ?? '', ...(card.promptHistory ?? [])]),
    ...state.sessions.flatMap((session) => session.routine?.steps
      .filter((step) => step.exposedAt).flatMap((step) => step.options ?? [step.prompt]) ?? []),
    ...(state.sentencePreferences ?? []).flatMap((entry) => [entry.text, ...entry.originals]),
  ].filter(Boolean).map(key))
}

/** Freeze the randomized plan once; reloads and new scores cannot reroll it. */
export function planDailyRoutine(
  state: DailyState, session: DailySession, dict: Dictionary, voices: Voice[],
  attemptTexts: string[] = [], random: () => number = Math.random,
): DailyRoutine {
  const seen = exposedPrompts(state, attemptTexts)
  const reserved = new Set(seen)
  const recalls: RoutineStep[] = []
  const listening: RoutineStep[] = []
  const production: RoutineStep[][] = [[], []]
  const transfers: RoutineStep[] = []
  const notices: string[] = []
  const pool = shuffle(voices, random)
  const preferences = state.sentencePreferences
  let serial = 0
  const add = (card: DailyCard, kind: RoutineKind, prompt: string, extra: Partial<RoutineStep> = {}): RoutineStep => ({
    id: `${session.id}:step:${serial++}`, cardId: card.id, kind, prompt,
    ...extra,
  })
  for (const cardId of session.queue.slice(session.index)) {
    const card = state.cards.find((item) => item.id === cardId)
    if (!card) continue
    const recall = card.lastPrompt ? resolveDailySentence(card.lastPrompt, preferences) : null
    if (recall && sentenceFitsCard(recall, card, dict)
      && card.lastReviewedAt && localDateKey(card.lastReviewedAt) !== session.dateKey) {
      recalls.push(add(card, 'recall', recall))
      reserved.add(key(recall))
    }
    const contrasts = contrastsForCard(card, dict).flatMap((contrast) => {
      const frames = contrast.frames.flatMap((frame) => {
        const options = contrast.words.map((word) => resolveDailySentence(frame.replace('{word}', word), preferences))
        return options.every((text) => text !== null) && validListeningOptions(options as [string, string], contrast.pair, dict)
          ? [options as [string, string]] : []
      })
      return frames.length ? [{ ...contrast, frames }] : []
    })
    const exact = contrasts.filter((contrast) => contrast.exact)
    const candidates = exact.length ? exact : contrasts
    const shuffled = shuffle(candidates, random)
    const answerOrder = shuffle([0, 1], random)
    for (let i = 0; i < 2 && shuffled.length; i++) {
      const contrast = shuffled[i % shuffled.length]
      const frame = contrast.frames[i % contrast.frames.length]
      const options = shuffle(frame, random) as [string, string]
      const answer = answerOrder[i]
      const step = add(card, 'listening', options[answer], { options, answer, pair: contrast.pair })
      listening.push(step)
      options.forEach((text) => reserved.add(key(text)))
    }
    if (!shuffled.length) notices.push(`${card.label}: no checked listening contrast is available yet; speech practice is included.`)
    const training = dailySentences([
      ...DAILY_TRAINING_SENTENCES,
      ...(preferences ?? []).map((entry) => entry.text),
      ...attemptTexts,
      ...state.reviews.map((review) => review.prompt),
      ...(card.promptHistory ?? []),
    ], preferences).filter((text) => sentenceFitsCard(text, card, dict))
    const recent = new Set(dailySentences(card.promptHistory ?? [], preferences).map(key))
    const usedHere = new Set<string>()
    for (let i = 0; i < 2; i++) {
      const available = training.filter((text) => !usedHere.has(key(text)))
      const unused = available.filter((text) => !reserved.has(key(text)))
      const pool = unused.length ? unused : available.filter((text) => !recent.has(key(text)))
      const chosen = sample(pool.length ? pool : available, random)
      if (!chosen) continue
      production[i].push(add(card, 'production', chosen))
      reserved.add(key(chosen))
      recent.add(key(chosen))
      usedHere.add(key(chosen))
    }
    if (usedHere.size < 2) notices.push(`${card.label}: ${usedHere.size ? 'only one meaningful practice sentence is' : 'no meaningful practice sentences are'} available. Add a full sentence containing this target in Practice Studio to expand its contexts.`)
    const reserve = dailySentences([
      ...DAILY_TRANSFER_SENTENCES,
      ...TRANSFER_SUBJECTS.flatMap((subject) => TRANSFER_ACTIONS.map((action) => `${subject} ${action}.`)),
    ], preferences).filter((text) => !reserved.has(key(text)) && sentenceFitsCard(text, card, dict))
    // Prefer fully authored sentences before using grammatical combinations.
    const authored = reserve.filter((text) => DAILY_TRANSFER_SENTENCES.includes(text))
    const chosen = sample(authored.length ? authored : reserve, random)
    if (chosen) {
      transfers.push(add(card, 'transfer', chosen, { fresh: true }))
      reserved.add(key(chosen))
    } else notices.push(`${card.label}: the available unfamiliar sentences have been used. This session will not claim a new transfer result for this target.`)
  }
  // Assign after interleaving: adjacent cards on screen always change speaker
  // when at least two are allowed. Repeat only after cycling through the pool.
  const steps = [...recalls, ...listening, ...production.flat(), ...transfers]
    .map((step, index) => ({ ...step, voiceURI: pool.length ? pool[index % pool.length].uri : undefined }))
  return { version: 1, voiceRotation: 1, steps, cursor: 0, events: [], notices }
}

/** Replace only pending legacy carriers. Completed work and event IDs remain intact. */
export function refreshLegacyContexts(
  state: DailyState, session: DailySession, dict: Dictionary, voices: Voice[], sources: string[] = [],
): DailyRoutine | undefined {
  const routine = session.routine
  if (!routine) return planDailyRoutine(state, session, dict, voices, sources)
  const needsReplacement = (step: RoutineStep, index: number) => index >= routine.cursor
    && !routine.events.some((event) => event.stepId === step.id)
    && (step.options ?? [step.prompt]).some(isWordCarrier)
  if (!routine.steps.some(needsReplacement)) return undefined
  // In interleaved plans, session.index is a count, not a queue position.
  const queue = [...new Set(routine.steps.slice(routine.cursor).map((step) => step.cardId))]
  const planned = planDailyRoutine(state, { ...session, queue, index: 0 }, dict, voices, sources)
  const used = new Set(routine.steps.filter((step, index) => !needsReplacement(step, index))
    .flatMap((step) => step.options ?? [step.prompt]).map(key))
  const steps = routine.steps.flatMap((step, index) => {
    if (!needsReplacement(step, index)) return [step]
    const replacement = planned.steps.find((item) => item.cardId === step.cardId && item.kind === step.kind
      && !(item.options ?? [item.prompt]).some((text) => used.has(key(text))))
    if (!replacement) return []
    ;(replacement.options ?? [replacement.prompt]).forEach((text) => used.add(key(text)))
    return [{ ...replacement, id: `${step.id}:context-v2` }]
  })
  return { ...routine, steps, notices: [...new Set([...routine.notices, ...planned.notices,
    'Pending word-in-a-slot exercises were replaced with meaningful contexts. Your recorded history is unchanged.'])] }
}

export function updateRoutine(state: DailyState, sessionId: string, routine: DailyRoutine): DailyState {
  return { ...state, sessions: state.sessions.map((session) => session.id === sessionId ? { ...session, routine } : session) }
}

/** Apply changes to saved, unfinished sessions without rewriting recorded evidence. */
export function refreshRoutineSentences(state: DailyState, dict: Dictionary, now = Date.now()): DailyState {
  let changed = false
  const finished: { sessionId: string; cardId: string }[] = []
  const sessions = state.sessions.map((session) => {
    const routine = session.routine
    if (session.endedAt || !routine) return session
    let revised = false
    const steps = routine.steps.flatMap((step, index): RoutineStep[] => {
      if (index < routine.cursor) return [step]
      const texts = step.options ?? [step.prompt]
      const resolved = texts.map((text) => resolveDailySentence(text, state.sentencePreferences))
      if (resolved.every((text, i) => text === texts[i])) return [step]
      revised = true
      if (resolved.some((text) => text === null)) return []
      const options = step.options ? resolved as [string, string] : undefined
      const prompt = options ? options[step.answer ?? 0] : resolved[0]!
      const card = state.cards.find((item) => item.id === step.cardId)
      if (!card || (options ? !validListeningOptions(options, step.pair, dict) : !sentenceFitsCard(prompt, card, dict))) return []
      // Editing reveals the text; it is now rehearsal, not independent recall/transfer.
      return [{ ...step, id: `${step.id}:edited`, prompt, options,
        kind: step.kind === 'listening' ? 'listening' : 'production',
        exposedAt: undefined, referenceHeard: false, fresh: false }]
    })
    if (!revised) return session
    changed = true
    const pending = new Set(steps.slice(routine.cursor).map((step) => step.cardId))
    const removed = [...new Set(routine.steps.slice(routine.cursor).map((step) => step.cardId))]
      .filter((cardId) => !pending.has(cardId))
    removed.forEach((cardId) => finished.push({ sessionId: session.id, cardId }))
    const ended = routine.cursor >= steps.length
    return { ...session, routine: { ...routine, steps },
      index: ended ? session.queue.length : session.index + removed.length, endedAt: ended ? now : undefined }
  })
  return changed ? finished.reduce((next, item) => scheduleRoutineTarget(next, item.sessionId, item.cardId, now), { ...state, sessions }) : state
}

export function exposeRoutineStep(state: DailyState, sessionId: string, now = Date.now(), attemptTexts: string[] = []): DailyState {
  const routine = state.sessions.find((session) => session.id === sessionId)?.routine
  const step = routine?.steps[routine.cursor]
  if (!routine || !step || step.exposedAt) return state
  const alreadySeen = exposedPrompts(state, attemptTexts).has(key(step.prompt))
  return updateRoutine(state, sessionId, { ...routine, steps: routine.steps.map((item) => item.id === step.id
    ? { ...item, exposedAt: now, fresh: item.kind === 'transfer' ? !alreadySeen : item.fresh } : item) })
}

export function markReferenceHeard(state: DailyState, sessionId: string, voiceURI: string): DailyState {
  const routine = state.sessions.find((session) => session.id === sessionId)?.routine
  if (!routine) return state
  return updateRoutine(state, sessionId, { ...routine, steps: routine.steps.map((step, index) => index === routine.cursor
    ? { ...step, referenceHeard: true, voiceURI } : step) })
}

export function recordRoutineEvent(
  state: DailyState, sessionId: string,
  input: Omit<RoutineEvent, 'id' | 'cardId' | 'kind' | 'prompt' | 'first'>,
): DailyState {
  const session = state.sessions.find((item) => item.id === sessionId)
  const routine = session?.routine
  const step = routine?.steps[routine.cursor]
  if (!session || session.endedAt || !routine || !step || step.id !== input.stepId) return state
  if (input.status === 'answered' && (step.kind !== 'listening' || !step.referenceHeard
    || ![0, 1].includes(input.choice ?? -1))) return state
  if (input.status === 'scored' && (step.kind === 'listening' || !Number.isFinite(input.overallScore)
    || !input.rating)) return state
  if (input.attemptAt && routine.events.some((event) => event.attemptAt === input.attemptAt)) return state
  const previous = routine.events.filter((event) => event.stepId === step.id && event.status !== 'skipped')
  if (step.kind === 'listening' && previous.length) return state
  const event: RoutineEvent = {
    ...input, id: `${step.id}:event:${routine.events.length}`, cardId: step.cardId,
    kind: step.kind, prompt: step.prompt, first: previous.length === 0,
    voiceURI: input.voiceURI ?? step.voiceURI,
    referenceHeard: step.referenceHeard ?? false, fresh: step.fresh,
    correct: input.status === 'answered' ? input.choice === step.answer : undefined,
  }
  return updateRoutine(state, sessionId, { ...routine, events: [...routine.events, event] })
}

const ratings: ReviewRating[] = ['again', 'hard', 'good', 'easy']
export function recordRoutineReviewChoices(state: DailyState, sessionId: string, attemptAt: number, choices: (ReviewChoice | undefined)[], resolved = false): DailyState {
  const session = state.sessions.find((s) => s.id === sessionId)
  if (!session?.routine || session.endedAt || !session.routine.events.some((e) => e.attemptAt === attemptAt)) return state
  const decisions = choices.filter((c): c is ReviewChoice => !!c)
  const allResolved = decisions.length > 0 && resolved
  if (JSON.stringify(session.routine.practiceReviews?.[attemptAt] ?? []) === JSON.stringify(decisions)
    && !!session.routine.practiceReviewResolved?.[attemptAt] === allResolved) return state
  return updateRoutine(state, sessionId, { ...session.routine, practiceReviews: { ...session.routine.practiceReviews, [attemptAt]: decisions },
    practiceReviewResolved: { ...session.routine.practiceReviewResolved, [attemptAt]: allResolved } })
}
/** Listening can shorten an interval, but it can never prove speech production. */
export function routineCardRating(events: RoutineEvent[], choices: Record<string, ReviewChoice[]> = {}, resolved: Record<string, boolean> = {}): ReviewRating | null {
  const first = events.filter((event) => event.first && event.status !== 'skipped')
  const scored = first.filter((event) => event.status === 'scored' && event.rating && event.assessed !== false)
  if (!scored.length) return null
  const independent = scored.filter((event) => (event.kind === 'transfer' && event.fresh || event.kind === 'recall') && !event.referenceHeard)
  const evidence = independent.length ? independent : scored
  let rating = Math.min(...evidence.map((event) => ratings.indexOf(event.attemptAt && choices[event.attemptAt]?.length
    && resolved[event.attemptAt] ? 'hard' : event.rating!)))
  // Rehearsal without an independent check remains a conservative review.
  if (!independent.length || first.some((event) => event.kind === 'listening' && event.correct === false)) rating = Math.min(rating, 1)
  return ratings[Math.max(0, rating)]
}

/** Preserve earned scheduling evidence even if the remaining sentence is removed. */
function scheduleRoutineTarget(state: DailyState, sessionId: string, cardId: string, now: number): DailyState {
  const session = state.sessions.find((item) => item.id === sessionId)
  const card = state.cards.find((item) => item.id === cardId)
  if (!session?.routine || !card) return state
  const events = session.routine.events.filter((event) => event.cardId === card.id)
    .map(event => event.currentAssessment ? { ...event, ...event.currentAssessment } : event)
  const choices = Object.fromEntries(Object.entries(session.routine.practiceReviews ?? {})
    .filter(([at]) => !events.some(e => String(e.attemptAt) === at && e.currentAssessment)))
  const rating = routineCardRating(events, choices, session.routine.practiceReviewResolved)
  const alreadyReviewed = state.reviews.some((review) => review.cardId === card.id && localDateKey(review.reviewedAt) === localDateKey(now))
  if (!rating || alreadyReviewed) return state
  const scheduled = scheduleDailyCard(card, rating, now)
  const scored = events.filter((event) => event.first && event.status === 'scored')
  const manualReview = scored.some((event) => event.attemptAt && session.routine!.practiceReviews?.[event.attemptAt]?.length)
  const last = scored[scored.length - 1]
  const id = `${session.id}:review:${card.id}`
  return {
    ...state,
    cards: state.cards.map((item) => item.id === card.id ? {
      ...card, ...scheduled, totalReviews: card.totalReviews + 1,
      successfulReviews: card.successfulReviews + Number(rating !== 'again' && !manualReview),
      lastReviewedAt: now, lastPrompt: last.prompt, lastRating: rating,
      lastScore: last.focusScore ?? last.overallScore,
      promptHistory: [...(card.promptHistory ?? []), ...scored.map((event) => event.prompt)].slice(-8),
    } : item),
    reviews: [...state.reviews, {
      id, cardId: card.id, sessionId, reviewedAt: now, prompt: last.prompt, rating,
      focusScore: last.focusScore, overallScore: last.overallScore, attemptAt: last.attemptAt,
      intervalBeforeDays: card.intervalDays, intervalAfterDays: scheduled.intervalDays, dueAt: scheduled.dueAt,
    }],
    sessions: state.sessions.map((item) => item.id === sessionId ? { ...item, reviewIds: [...item.reviewIds, id] } : item),
  }
}

/** Advance freely, recording skips honestly. Schedule each target once per day. */
export function advanceRoutine(state: DailyState, sessionId: string, now = Date.now()): DailyState {
  const session = state.sessions.find((item) => item.id === sessionId)
  const routine = session?.routine
  const step = routine?.steps[routine.cursor]
  if (!session || session.endedAt || !routine || !step) return state
  let next = state
  if (!routine.events.some((event) => event.stepId === step.id)) {
    next = recordRoutineEvent(next, sessionId, { stepId: step.id, at: now, status: 'skipped' })
  }
  const current = next.sessions.find((item) => item.id === sessionId)!.routine!
  const cursor = current.cursor + 1
  next = updateRoutine(next, sessionId, { ...current, cursor })
  const targetFinished = !current.steps.slice(cursor).some((item) => item.cardId === step.cardId)
  if (targetFinished) {
    next = scheduleRoutineTarget(next, sessionId, step.cardId, now)
    next = { ...next, sessions: next.sessions.map((item) => item.id === sessionId ? { ...item, index: item.index + 1 } : item) }
  }
  if (cursor >= current.steps.length) next = { ...next, sessions: next.sessions.map((item) => item.id === sessionId
    ? { ...item, endedAt: now, index: item.queue.length } : item) }
  return next
}

export function routineSummary(sessions: DailySession[], date?: string) {
  const events = sessions.flatMap((session) => session.routine?.events ?? [])
    .filter((event) => !date || localDateKey(event.at) === date)
  const first = events.filter((event) => event.first && event.status !== 'skipped')
  const listening = first.filter((event) => event.kind === 'listening' && event.status === 'answered')
  const measure = (kind: RoutineKind) => {
    const results = first.filter((event) => event.kind === kind && event.status === 'scored' && event.assessed !== false
      && (kind !== 'transfer' || event.fresh) && (kind === 'production' || !event.referenceHeard))
    const scales = new Set(results.map((event) => `${event.scorer ?? 'browser'}:${event.revision ?? 0}`))
    return { count: results.length, mixed: scales.size > 1, average: results.length && scales.size === 1
      ? Math.round(results.reduce((sum, event) => sum + (event.overallScore ?? 0), 0) / results.length) : null }
  }
  return {
    listening: { count: listening.length, correct: listening.filter((event) => event.correct).length },
    production: measure('production'), transfer: measure('transfer'), recall: measure('recall'),
    repetitions: events.filter((event) => !event.first && event.status === 'scored').length,
    skipped: events.filter((event) => event.status === 'skipped').length,
    voices: new Set(events.filter((event) => event.referenceHeard && event.voiceURI).map((event) => event.voiceURI)).size,
  }
}
