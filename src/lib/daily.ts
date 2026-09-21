/**
 * Persistent spaced-practice state.
 *
 * Attempts are the detailed recordings produced by Practice Studio. Daily
 * cards are the durable learning objects that decide what should come back,
 * and reviews are the small, append-only events that let us measure retention
 * without depending on the (deliberately shorter) attempt history.
 */

import type { DailyRoutine, DailyPreferences } from './dailyRoutine.ts'
import { normalizeSentencePreferences, type SentencePreference } from './dailySentences.ts'

export type CardKind = 'sound' | 'word'
export type CardState = 'new' | 'learning' | 'review' | 'relearning' | 'suspended'
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy'

export interface DailyCard {
  id: string
  kind: CardKind
  label: string
  word?: string
  focusPhones: string[]
  confusion?: string
  createdAt: number
  dueAt: number
  intervalDays: number
  ease: number
  repetitions: number
  lapses: number
  state: CardState
  totalReviews: number
  successfulReviews: number
  lastReviewedAt?: number
  lastPrompt?: string
  /** Recent contexts used for this card, so future reviews can vary the line. */
  promptHistory?: string[]
  lastRating?: ReviewRating
  lastScore?: number
}

export interface ReviewEvent {
  id: string
  cardId: string
  sessionId: string
  reviewedAt: number
  prompt: string
  rating: ReviewRating
  attemptAt?: number
  focusScore?: number
  overallScore?: number
  intervalBeforeDays: number
  intervalAfterDays: number
  dueAt: number
}

export interface DailySession {
  id: string
  dateKey: string
  startedAt: number
  endedAt?: number
  goal: number
  queue: string[]
  index: number
  reviewIds: string[]
  routine?: DailyRoutine
}

export interface DailyState {
  cards: DailyCard[]
  reviews: ReviewEvent[]
  sessions: DailySession[]
  preferences?: DailyPreferences
  sentencePreferences?: SentencePreference[]
}

export interface CardCandidate {
  id: string
  kind: CardKind
  label: string
  word?: string
  focusPhones: string[]
  confusion?: string
}

export interface DailyDaySummary {
  dateKey: string
  reviews: number
  successful: number
  again: number
  hard: number
  good: number
  easy: number
  minutes: number
  sessions: number
}

const STORAGE_KEY = 'phonetics-lab:daily'
const FORMAT_VERSION = 1
const DEFAULT_EASE = 2.3
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

const EMPTY_STATE: DailyState = { cards: [], reviews: [], sessions: [] }

function validRating(value: unknown): value is ReviewRating {
  return value === 'again' || value === 'hard' || value === 'good' || value === 'easy'
}

function validCard(value: unknown): value is DailyCard {
  if (!value || typeof value !== 'object') return false
  const card = value as Partial<DailyCard>
  return typeof card.id === 'string'
    && (card.kind === 'sound' || card.kind === 'word')
    && typeof card.label === 'string'
    && Array.isArray(card.focusPhones)
    && typeof card.createdAt === 'number'
    && typeof card.dueAt === 'number'
}

function normalizeState(value: unknown): DailyState {
  if (!value || typeof value !== 'object') return { ...EMPTY_STATE }
  const raw = value as Partial<DailyState> & { version?: number }
  const cards = Array.isArray(raw.cards) ? raw.cards.filter(validCard).map((card) => ({
    ...card,
    focusPhones: card.focusPhones.filter((phone): phone is string => typeof phone === 'string'),
    ease: typeof card.ease === 'number' ? card.ease : DEFAULT_EASE,
    intervalDays: typeof card.intervalDays === 'number' ? card.intervalDays : 0,
    repetitions: typeof card.repetitions === 'number' ? card.repetitions : 0,
    lapses: typeof card.lapses === 'number' ? card.lapses : 0,
    state: card.state ?? 'new',
    totalReviews: typeof card.totalReviews === 'number' ? card.totalReviews : 0,
    successfulReviews: typeof card.successfulReviews === 'number' ? card.successfulReviews : 0,
    promptHistory: Array.isArray(card.promptHistory)
      ? card.promptHistory.filter((prompt): prompt is string => typeof prompt === 'string').slice(-8)
      : (card.lastPrompt ? [card.lastPrompt] : []),
  })) : []
  const reviews = Array.isArray(raw.reviews) ? raw.reviews.filter((review): review is ReviewEvent => {
    if (!review || typeof review !== 'object') return false
    const item = review as Partial<ReviewEvent>
    return typeof item.id === 'string'
      && typeof item.cardId === 'string'
      && typeof item.sessionId === 'string'
      && typeof item.reviewedAt === 'number'
      && typeof item.prompt === 'string'
      && validRating(item.rating)
  }) : []
  const sessions = Array.isArray(raw.sessions) ? raw.sessions.filter((session): session is DailySession => {
    if (!session || typeof session !== 'object') return false
    const item = session as Partial<DailySession>
    return typeof item.id === 'string'
      && typeof item.dateKey === 'string'
      && typeof item.startedAt === 'number'
      && typeof item.goal === 'number'
      && Array.isArray(item.queue)
      && typeof item.index === 'number'
      && Array.isArray(item.reviewIds)
  }) : []
  const preferences = raw.preferences && typeof raw.preferences === 'object' ? {
    voiceURIs: Array.isArray(raw.preferences.voiceURIs)
      ? raw.preferences.voiceURIs.filter((uri): uri is string => typeof uri === 'string') : [],
    goal: [2, 4, 6].includes(raw.preferences.goal) ? raw.preferences.goal : 4,
  } : undefined
  return { cards, reviews, sessions, preferences, sentencePreferences: normalizeSentencePreferences(raw.sentencePreferences) }
}

export function loadDailyState(): DailyState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...EMPTY_STATE }
    const parsed = JSON.parse(raw) as unknown
    return normalizeState(parsed)
  } catch {
    return { ...EMPTY_STATE }
  }
}

export function saveDailyState(state: DailyState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: FORMAT_VERSION, ...state }))
  } catch {
    // Daily history is best-effort and must never prevent recording speech.
  }
}

export function clearDailyState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Optional storage removal
  }
}

/** Local calendar key; daily practice should not split around UTC midnight. */
export function localDateKey(at = Date.now()): string {
  const date = new Date(at)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function cardIdForSound(phone: string, confusion?: string): string {
  return `sound:${phone}:${confusion ?? '*'}`
}

export function cardIdForWord(word: string): string {
  return `word:${word.toLowerCase().replace(/[^a-z0-9']+/g, '')}`
}

function createCard(candidate: CardCandidate, now: number): DailyCard {
  return {
    ...candidate,
    focusPhones: [...new Set(candidate.focusPhones)],
    createdAt: now,
    dueAt: now,
    intervalDays: 0,
    ease: DEFAULT_EASE,
    repetitions: 0,
    lapses: 0,
    state: 'new',
    totalReviews: 0,
    successfulReviews: 0,
  }
}

/** Add new targets without resetting the schedule of cards already learned. */
export function syncCandidates(
  state: DailyState,
  candidates: CardCandidate[],
  now = Date.now(),
): DailyState {
  const next = { ...state, cards: state.cards.map((card) => ({ ...card, focusPhones: [...card.focusPhones] })) }
  const existing = new Set(next.cards.map((card) => card.id))
  for (const candidate of candidates) {
    if (existing.has(candidate.id) || candidate.focusPhones.length === 0) continue
    next.cards.push(createCard(candidate, now))
    existing.add(candidate.id)
  }
  return next
}

export function findOpenSession(state: DailyState, date = localDateKey()): DailySession | null {
  return [...state.sessions]
    .reverse()
    .find((session) => session.dateKey === date && !session.endedAt && session.index < session.queue.length) ?? null
}

function due(card: DailyCard, now: number): boolean {
  return card.state !== 'suspended' && card.dueAt <= now
}

/** Due cards first, with a small daily intake of new targets. */
export function buildDailyQueue(
  cards: DailyCard[],
  goal: number,
  now = Date.now(),
  newLimit = 2,
): string[] {
  const available = cards.filter((card) => due(card, now))
  const dueReviews = available
    .filter((card) => card.state !== 'new')
    .sort((a, b) => a.dueAt - b.dueAt || (a.lastReviewedAt ?? a.createdAt) - (b.lastReviewedAt ?? b.createdAt))
  const newCards = available
    .filter((card) => card.state === 'new')
    .sort((a, b) => a.createdAt - b.createdAt)
  return [
    ...dueReviews.slice(0, Math.max(0, goal - Math.min(newLimit, newCards.length))).map((card) => card.id),
    ...newCards.slice(0, newLimit).map((card) => card.id),
  ].slice(0, goal)
}

export function startDailySession(
  state: DailyState,
  goal: number,
  now = Date.now(),
): { state: DailyState; session: DailySession | null } {
  const existing = findOpenSession(state, localDateKey(now))
  if (existing) return { state, session: existing }
  const firstSeen = new Map<string, number>()
  const remember = (cardId: string, at: number) => firstSeen.set(cardId, Math.min(firstSeen.get(cardId) ?? Infinity, at))
  for (const review of state.reviews) remember(review.cardId, review.reviewedAt)
  for (const saved of state.sessions) {
    for (const step of saved.routine?.steps ?? []) if (step.exposedAt) remember(step.cardId, step.exposedAt)
  }
  const introducedToday = [...firstSeen.values()].filter((at) => localDateKey(at) === localDateKey(now)).length
  const queue = buildDailyQueue(state.cards, goal, now, Math.max(0, 2 - introducedToday))
  if (queue.length === 0) return { state, session: null }
  const session: DailySession = {
    id: `session:${now}:${Math.random().toString(36).slice(2, 8)}`,
    dateKey: localDateKey(now),
    startedAt: now,
    goal,
    queue,
    index: 0,
    reviewIds: [],
  }
  return { state: { ...state, sessions: [...state.sessions, session] }, session }
}

interface ScheduleResult {
  state: CardState
  intervalDays: number
  dueAt: number
  ease: number
  repetitions: number
  lapses: number
}

export function scheduleDailyCard(card: DailyCard, rating: ReviewRating, now: number): ScheduleResult {
  let ease = card.ease || DEFAULT_EASE
  let intervalDays = card.intervalDays
  let repetitions = card.repetitions
  let lapses = card.lapses

  if (rating === 'again') {
    return {
      state: card.repetitions === 0 ? 'learning' : 'relearning',
      intervalDays: Math.max(0, Math.round(intervalDays * 0.25 * 10) / 10),
      dueAt: now + 10 * MINUTE,
      ease: Math.max(1.3, ease - 0.2),
      repetitions,
      lapses: lapses + (card.repetitions > 0 ? 1 : 0),
    }
  }

  if (card.state === 'new' || card.state === 'learning' || card.state === 'relearning') {
    repetitions += 1
    if (rating === 'hard') intervalDays = Math.max(1, intervalDays || 1)
    else if (rating === 'good') intervalDays = intervalDays >= 1 ? Math.max(3, Math.round(intervalDays * 2)) : 3
    else intervalDays = intervalDays >= 1 ? Math.max(7, Math.round(intervalDays * 3)) : 7
  } else {
    if (rating === 'hard') {
      intervalDays = Math.max(1, Math.round(Math.max(1, intervalDays) * 1.2))
      ease = Math.max(1.3, ease - 0.15)
    } else if (rating === 'good') {
      intervalDays = Math.max(2, Math.round(Math.max(1, intervalDays) * ease))
    } else {
      intervalDays = Math.max(4, Math.round(Math.max(1, intervalDays) * (ease + 0.35)))
      ease = Math.min(3.0, ease + 0.05)
    }
    repetitions += 1
  }

  return {
    state: 'review',
    intervalDays,
    dueAt: now + intervalDays * DAY,
    ease,
    repetitions,
    lapses,
  }
}

export interface ReviewInput {
  cardId: string
  sessionId: string
  prompt: string
  rating: ReviewRating
  /** The learner may repeat the current card any number of times, or advance. */
  repeatNow?: boolean
  reviewedAt?: number
  attemptAt?: number
  focusScore?: number
  overallScore?: number
}

/** Apply a rating, append its review event, and advance the active session. */
export function recordDailyReview(
  state: DailyState,
  input: ReviewInput,
): { state: DailyState; review: ReviewEvent | null } {
  const now = input.reviewedAt ?? Date.now()
  const cardIndex = state.cards.findIndex((card) => card.id === input.cardId)
  const sessionIndex = state.sessions.findIndex((session) => session.id === input.sessionId)
  if (cardIndex < 0 || sessionIndex < 0) return { state, review: null }

  const card = state.cards[cardIndex]
  const session = state.sessions[sessionIndex]
  if (session.endedAt || session.queue[session.index] !== card.id) {
    return { state, review: null }
  }

  const result = scheduleDailyCard(card, input.rating, now)
  const review: ReviewEvent = {
    id: `review:${now}:${Math.random().toString(36).slice(2, 8)}`,
    cardId: card.id,
    sessionId: session.id,
    reviewedAt: now,
    prompt: input.prompt,
    rating: input.rating,
    attemptAt: input.attemptAt,
    focusScore: input.focusScore,
    overallScore: input.overallScore,
    intervalBeforeDays: card.intervalDays,
    intervalAfterDays: result.intervalDays,
    dueAt: result.dueAt,
  }

  const updatedCard: DailyCard = {
    ...card,
    ...result,
    totalReviews: card.totalReviews + 1,
    successfulReviews: card.successfulReviews + (input.rating === 'again' ? 0 : 1),
    lastReviewedAt: now,
    lastPrompt: input.prompt,
    promptHistory: [...(card.promptHistory ?? []), input.prompt].slice(-8),
    lastRating: input.rating,
    lastScore: input.focusScore ?? input.overallScore,
  }

  const nextSession: DailySession = {
    ...session,
    index: session.index + 1,
    reviewIds: [...session.reviewIds, review.id],
  }

  // A failed card can be retrieved again in this same session when the learner
  // asks for it. Each explicit repeat adds one more deliberate opportunity.
  if (input.rating === 'again' && input.repeatNow !== false && !nextSession.queue.slice(nextSession.index).includes(card.id)) {
    // The learner explicitly chose to repeat. There is no automatic retry
    // loop: each press creates one more deliberate retrieval opportunity.
    nextSession.queue = [
      ...nextSession.queue.slice(0, nextSession.index),
      card.id,
      ...nextSession.queue.slice(nextSession.index),
    ]
  }
  if (nextSession.index >= nextSession.queue.length) nextSession.endedAt = now

  const cards = state.cards.map((item, index) => (index === cardIndex ? updatedCard : item))
  const sessions = state.sessions.map((item, index) => (index === sessionIndex ? nextSession : item))
  return {
    state: { ...state, cards, sessions, reviews: [...state.reviews, review] },
    review,
  }
}

export function summaryForDay(state: DailyState, date: string): DailyDaySummary {
  const reviews = state.reviews.filter((review) => localDateKey(review.reviewedAt) === date)
  const sessions = state.sessions.filter((session) => session.dateKey === date)
  const successful = reviews.filter((review) => review.rating !== 'again').length
  const minutes = sessions.reduce((total, session) => {
    const sessionReviews = reviews.filter((review) => review.sessionId === session.id)
    const end = session.endedAt
      ?? (sessionReviews.length > 0 ? sessionReviews[sessionReviews.length - 1].reviewedAt : session.startedAt)
    return total + Math.max(0, end - session.startedAt) / MINUTE
  }, 0)
  return {
    dateKey: date,
    reviews: reviews.length,
    successful,
    again: reviews.filter((review) => review.rating === 'again').length,
    hard: reviews.filter((review) => review.rating === 'hard').length,
    good: reviews.filter((review) => review.rating === 'good').length,
    easy: reviews.filter((review) => review.rating === 'easy').length,
    minutes: Math.round(minutes * 10) / 10,
    sessions: sessions.length,
  }
}

export function recentDaySummaries(state: DailyState, count = 14, now = Date.now()): DailyDaySummary[] {
  const today = new Date(now)
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    return summaryForDay(state, localDateKey(date.getTime()))
  })
}

export function formatDue(card: DailyCard, now = Date.now()): string {
  if (card.dueAt <= now) return 'Due now'
  const hours = Math.max(1, Math.round((card.dueAt - now) / (60 * MINUTE)))
  if (hours < 24) return `Due in ${hours}h`
  const days = Math.max(1, Math.round(hours / 24))
  return `Due in ${days}d`
}
