/**
 * Comprehensive Analytics & Progress Engine.
 *
 * Gathers, correlates, and tracks pronunciation metrics over time:
 * - Phoneme-by-phoneme diagnostics and articulatory failure modes
 * - Consonant manner, place, and voicing profiling
 * - Vowel quality diagnostics (tense/lax, vowel height, rhotics)
 * - Systematic substitutions (confusion matrix) and articulatory explanations
 * - Chronological evolution: score progression, moving averages, and before/after comparisons
 * - Word trouble bank progression (first attempt vs lowest vs latest)
 * - Session tracking, practice time, daily consistency and retention
 */

import { analysisAttempts, type Attempt } from './practice.ts'
import { FEATURES, describeSubstitution, type Manner, type Place, type Features } from './phonefeatures.ts'
import { PHONES } from './phones.ts'
import type { StruggledWord, StruggleHistoryEntry } from './struggles.ts'
import { localDateKey, type DailyState } from './daily.ts'
import type { Dictionary } from './dict.ts'
import { expectedPhones } from './align.ts'

export type TimeRange = 'all' | '90d' | '30d' | '14d' | '7d' | 'today'

export interface TimeRangeOption {
  key: TimeRange
  label: string
  days: number
}

export const TIME_RANGES: TimeRangeOption[] = [
  { key: 'all', label: 'All Time', days: Infinity },
  { key: '90d', label: '90 Days', days: 90 },
  { key: '30d', label: '30 Days', days: 30 },
  { key: '14d', label: '14 Days', days: 14 },
  { key: '7d', label: '7 Days', days: 7 },
  { key: 'today', label: 'Today', days: 1 },
]

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function isWithinRange(timestamp: number, range: TimeRange, now = Date.now()): boolean {
  if (range === 'all') return true
  if (range === 'today') {
    return localDateKey(timestamp) === localDateKey(now)
  }
  const days = range === '90d' ? 90 : range === '30d' ? 30 : range === '14d' ? 14 : 7
  return timestamp >= now - days * MS_PER_DAY
}

export interface ScoreDistribution {
  good: number
  ok: number
  poor: number
  goodPct: number
  okPct: number
  poorPct: number
}

export interface OverallKPIs {
  totalAttempts: number
  allTimeAttempts: number
  totalAudioDurationMs: number
  avgScore: number
  medianScore: number
  bestScore: number
  lowestScore: number
  scoreDelta: number
  scoreDeltaDirection: 'up' | 'down' | 'flat'
  distribution: ScoreDistribution
  activeDaysCount: number
  currentStreakDays: number
  uniqueWordsCount: number
  phonemesPracticedCount: number
  phonemesMasteredCount: number
  persistentProblemsCount: number
  troubleWordsCount: number
  dailyReviewsCount: number
  dailySuccessRate: number
}

export type TrendDirection = 'improving' | 'steady' | 'regressing' | 'new'

export interface PhoneConfusion {
  phone: string
  count: number
  percentage: number
  explanation: string
}

export interface ProblemPhoneStat {
  phone: string
  name: string
  example: string
  kind: 'consonant' | 'vowel' | 'diphthong' | 'r-coloured'
  seen: number
  correct: number
  close: number
  wrong: number
  missing: number
  accuracyRate: number // 0 - 100
  errorRate: number // 0 - 100
  impactScore: number
  dominantSubstitution?: string
  confusions: PhoneConfusion[]
  articulatoryNotes: string[]
  trend: TrendDirection
  trendDelta: number // percentage points change in accuracy from early to late
  timeline: { dateKey: string; accuracy: number; count: number }[]
}

export interface ArticulatoryCategoryStat {
  id: string
  label: string
  seen: number
  correct: number
  accuracyRate: number
  errorRate: number
  problemSounds: string[]
}

export interface ArticulatoryProfile {
  vowels: {
    seen: number
    correct: number
    accuracyRate: number
    errorRate: number
  }
  consonants: {
    seen: number
    correct: number
    accuracyRate: number
    errorRate: number
  }
  manners: ArticulatoryCategoryStat[]
  places: ArticulatoryCategoryStat[]
  voicing: {
    voiced: { seen: number; correct: number; accuracyRate: number }
    voiceless: { seen: number; correct: number; accuracyRate: number }
    devoicingErrors: number // voiced replaced by voiceless
    voicingErrors: number // voiceless replaced by voiced
  }
  vowelQualities: {
    tense: { seen: number; accuracyRate: number }
    lax: { seen: number; accuracyRate: number }
    high: { seen: number; accuracyRate: number }
    mid: { seen: number; accuracyRate: number }
    low: { seen: number; accuracyRate: number }
    rhotics: { seen: number; accuracyRate: number }
    diphthongs: { seen: number; accuracyRate: number }
  }
}

export interface WordTroubleStat {
  word: string
  display: string
  ipa: string
  struggleCount: number
  totalAttempts: number
  firstScore: number
  bestScore: number
  lastScore: number
  lowestScore: number
  scoreDelta: number
  status: 'mastered' | 'improving' | 'stuck' | 'regressing'
  weakPhones: { phone: string; count: number }[]
  recentSaid: string[]
  firstSeen: number
  lastSeen: number
  history: StruggleHistoryEntry[]
  contexts?: string[]
}

export interface AttemptTimelinePoint {
  index: number
  at: number
  dateKey: string
  formattedDate: string
  formattedTime: string
  target: string
  score: number
  rollingAvg: number
  durationMs: number
  scorer?: string
  wrongSounds: string[]
  missingSounds: string[]
}

export interface DaySummaryStat {
  dateKey: string
  dateLabel: string
  timestamp: number
  takesCount: number
  avgScore: number
  bestScore: number
  totalDurationMs: number
  goodCount: number
  okCount: number
  poorCount: number
  dailyReviewsCount: number
  dailySuccessCount: number
}

export interface FreeSpeechPriorityWord {
  word: string
  display: string
  ipa: string
  freeSpeechCount: number
  freeSpeechFailures: number
  freeSpeechErrorRate: number
  overallCount: number
  overallErrorRate: number
  firstScore: number
  bestScore: number
  lastScore: number
  lowestScore: number
  scoreDelta: number
  isRegressing: boolean
  weakPhones: { phone: string; count: number }[]
  recentSentences: string[]
  priorityScore: number
  priorityRank: number
}

export interface CommonEnglishPriorityWord {
  word: string
  display: string
  ipa: string
  englishRank: number
  userAttempts: number
  userStruggles: number
  accuracyRate: number
  lastScore?: number
  weakPhones: string[]
  isUnpracticedWithWeakSounds: boolean
  priorityScore: number
  priorityRank: number
}

export interface RegressingPhoneStat {
  phone: string
  name: string
  example: string
  earlyAccuracy: number
  recentAccuracy: number
  dropPoints: number
  dominantConfusion?: string
  totalTested: number
  coachingAdvice: string
}

export interface RegressingWordStat {
  word: string
  display: string
  ipa: string
  bestScore: number
  lastScore: number
  dropPoints: number
  weakPhones: string[]
  lastSeen: number
  contexts?: string[]
}

export interface FullAnalyticsSummary {
  range: TimeRange
  kpis: OverallKPIs
  problemPhones: ProblemPhoneStat[]
  articulatoryProfile: ArticulatoryProfile
  troubleWords: WordTroubleStat[]
  freeSpeechPriorities: FreeSpeechPriorityWord[]
  commonEnglishPriorities: CommonEnglishPriorityWord[]
  regressingPhones: RegressingPhoneStat[]
  regressingWords: RegressingWordStat[]
  timelinePoints: AttemptTimelinePoint[]
  daySummaries: DaySummaryStat[]
  topImprovers: { phone: string; change: number; oldAccuracy: number; newAccuracy: number }[]
  topRegressions: { phone: string; change: number; oldAccuracy: number; newAccuracy: number }[]
}

/** Standard GA inventory size ~ 42 phones */
export const TOTAL_GA_PHONES = Object.keys(PHONES).length

/** Format millisecond duration into human-readable minutes and seconds */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
}

/** Format timestamp to date string (e.g. "Sep 21, 2026") */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format timestamp to short date string (e.g. "Sep 21") */
export function formatShortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

/** Format timestamp to time string (e.g. "11:05 AM") */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Compute consecutive practice streak ending today or yesterday */
export function computeStreak(activeDates: Set<string>, now = Date.now()): number {
  if (activeDates.size === 0) return 0
  const todayKey = localDateKey(now)
  const yesterdayKey = localDateKey(now - MS_PER_DAY)

  let currentKey = activeDates.has(todayKey) ? todayKey : activeDates.has(yesterdayKey) ? yesterdayKey : null
  if (!currentKey) return 0

  let streak = 0
  let checkDate = new Date(currentKey === todayKey ? now : now - MS_PER_DAY)

  while (true) {
    const key = localDateKey(checkDate.getTime())
    if (activeDates.has(key)) {
      streak++
      checkDate.setDate(checkDate.getDate() - 1)
    } else {
      break
    }
  }
  return streak
}

/** Helper to categorize consonant manner */
const MANNER_LABELS: Record<Manner, string> = {
  fricative: 'Fricatives (/θ, ð, s, z, ʃ, ʒ, f, v, h/)',
  stop: 'Stops (/p, b, t, d, k, ɡ/)',
  affricate: 'Affricates (/tʃ, dʒ/)',
  approximant: 'Approximants (/ɹ, w, j/)',
  lateral: 'Lateral Approximant (/l/)',
  nasal: 'Nasals (/m, n, ŋ/)',
  tap: 'Flap / Tap (/ɾ/)',
}

/** Helper to categorize consonant place */
const PLACE_LABELS: Record<Place, string> = {
  dental: 'Dental (/θ, ð/)',
  alveolar: 'Alveolar (/t, d, s, z, n, l, ɾ/)',
  postalveolar: 'Postalveolar (/ʃ, ʒ, tʃ, dʒ, ɹ/)',
  velar: 'Velar (/k, ɡ, ŋ, w/)',
  labiodental: 'Labiodental (/f, v/)',
  bilabial: 'Bilabial (/p, b, m/)',
  glottal: 'Glottal (/h, ʔ/)',
  palatal: 'Palatal (/j/)',
}

/**
 * Main analytics entry point: analyzes attempts, daily state, and struggles.
 */
export function analyzeStats(
  allAttempts: Attempt[],
  struggles: StruggledWord[],
  dailyState: DailyState,
  range: TimeRange = 'all',
  now = Date.now(),
  commonWords?: string[],
  dict?: Dictionary | null,
): FullAnalyticsSummary {
  // Sort attempts chronologically
  const chronologicalAttempts = analysisAttempts(allAttempts).sort((a, b) => a.at - b.at)

  // Filter attempts in selected range
  const filteredAttempts = chronologicalAttempts.filter((a) => isWithinRange(a.at, range, now))

  // 1. Overall KPIs
  const totalAttempts = filteredAttempts.length
  const allTimeAttempts = allAttempts.length

  const scores = filteredAttempts.map((a) => a.score.overall)
  const avgScore = scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0

  const sortedScores = [...scores].sort((a, b) => a - b)
  const medianScore = sortedScores.length
    ? sortedScores[Math.floor(sortedScores.length / 2)]
    : 0
  const bestScore = sortedScores.length ? sortedScores[sortedScores.length - 1] : 0
  const lowestScore = sortedScores.length ? sortedScores[0] : 0

  // Distribution
  let goodCount = 0
  let okCount = 0
  let poorCount = 0
  for (const s of scores) {
    if (s >= 85) goodCount++
    else if (s >= 65) okCount++
    else poorCount++
  }
  const distribution: ScoreDistribution = {
    good: goodCount,
    ok: okCount,
    poor: poorCount,
    goodPct: totalAttempts ? Math.round((goodCount / totalAttempts) * 100) : 0,
    okPct: totalAttempts ? Math.round((okCount / totalAttempts) * 100) : 0,
    poorPct: totalAttempts ? Math.round((poorCount / totalAttempts) * 100) : 0,
  }

  // Duration in ms: sum attempt durationMs (default 3500ms if absent) + daily session minutes
  const attemptDurationMs = filteredAttempts.reduce(
    (sum, a) => sum + (typeof a.durationMs === 'number' && a.durationMs > 0 ? a.durationMs : 3500),
    0,
  )
  const filteredDailySessions = dailyState.sessions.filter((s) => isWithinRange(s.startedAt, range, now))
  const dailyDurationMs = filteredDailySessions.reduce((sum, s) => {
    const end = s.endedAt ?? s.startedAt
    return sum + Math.max(0, end - s.startedAt)
  }, 0)
  const totalAudioDurationMs = attemptDurationMs + dailyDurationMs

  // Active days & streak
  const allActiveDates = new Set<string>()
  for (const a of allAttempts) allActiveDates.add(localDateKey(a.at))
  for (const r of dailyState.reviews) allActiveDates.add(localDateKey(r.reviewedAt))
  for (const s of dailyState.sessions) allActiveDates.add(s.dateKey)

  const rangeActiveDates = new Set<string>()
  for (const a of filteredAttempts) rangeActiveDates.add(localDateKey(a.at))
  for (const s of filteredDailySessions) rangeActiveDates.add(s.dateKey)

  const currentStreakDays = computeStreak(allActiveDates, now)

  // Unique words practiced
  const uniqueWords = new Set<string>()
  for (const a of filteredAttempts) {
    const tokens = a.target.toLowerCase().match(/[a-z0-9']+/g) ?? []
    for (const tok of tokens) if (tok.length > 1 || tok === 'a' || tok === 'i') uniqueWords.add(tok)
  }

  // Delta calculation (trend)
  let scoreDelta = 0
  let scoreDeltaDirection: 'up' | 'down' | 'flat' = 'flat'
  if (range === 'all') {
    if (scores.length >= 4) {
      const half = Math.floor(scores.length / 2)
      const firstAvg = scores.slice(0, half).reduce((s, n) => s + n, 0) / half
      const secondAvg = scores.slice(half).reduce((s, n) => s + n, 0) / (scores.length - half)
      scoreDelta = Math.round(secondAvg - firstAvg)
    }
  } else {
    // Compare selected range vs the equal preceding window
    const days = range === '90d' ? 90 : range === '30d' ? 30 : range === '14d' ? 14 : range === '7d' ? 7 : 1
    const windowMs = days * MS_PER_DAY
    const priorAttempts = chronologicalAttempts.filter(
      (a) => a.at >= now - 2 * windowMs && a.at < now - windowMs,
    )
    if (priorAttempts.length > 0 && scores.length > 0) {
      const priorAvg = priorAttempts.reduce((s, a) => s + a.score.overall, 0) / priorAttempts.length
      scoreDelta = Math.round(avgScore - priorAvg)
    }
  }
  scoreDeltaDirection = scoreDelta > 0 ? 'up' : scoreDelta < 0 ? 'down' : 'flat'

  // Daily reviews stats in range
  const filteredReviews = dailyState.reviews.filter((r) => isWithinRange(r.reviewedAt, range, now))
  const dailyReviewsCount = filteredReviews.length
  const dailySuccessfulCount = filteredReviews.filter((r) => r.rating !== 'again' && r.currentAssessment?.assessed !== false).length
  const dailySuccessRate = dailyReviewsCount ? Math.round((dailySuccessfulCount / dailyReviewsCount) * 100) : 0

  // 2. Phoneme Occurrences & Evolution Over Time
  interface PhoneAccumulator {
    phone: string
    seen: number
    correct: number
    close: number
    wrong: number
    missing: number
    confusions: Map<string, number>
    // Chronological points to measure before/after trend
    history: { at: number; correct: boolean; close: boolean; wrong: boolean; actual: string | null }[]
    dates: Map<string, { total: number; correct: number }>
  }

  const phoneMap = new Map<string, PhoneAccumulator>()
  const getAcc = (phone: string): PhoneAccumulator => {
    let acc = phoneMap.get(phone)
    if (!acc) {
      acc = {
        phone,
        seen: 0,
        correct: 0,
        close: 0,
        wrong: 0,
        missing: 0,
        confusions: new Map(),
        history: [],
        dates: new Map(),
      }
      phoneMap.set(phone, acc)
    }
    return acc
  }

  for (const attempt of filteredAttempts) {
    const dKey = localDateKey(attempt.at)
    for (const step of attempt.aligned) {
      if (!step.expected) continue
      const acc = getAcc(step.expected)
      acc.seen++
      const isCorrect = step.verdict === 'correct'
      const isClose = step.verdict === 'close'
      const isWrong = step.verdict === 'wrong'
      const isMissing = step.verdict === 'missing'

      if (isCorrect) acc.correct++
      else if (isClose) acc.close++
      else if (isMissing) acc.missing++
      else if (isWrong) {
        acc.wrong++
        if (step.actual) {
          acc.confusions.set(step.actual, (acc.confusions.get(step.actual) ?? 0) + 1)
        }
      }

      acc.history.push({
        at: attempt.at,
        correct: isCorrect,
        close: isClose,
        wrong: isWrong,
        actual: step.actual,
      })

      const dateStat = acc.dates.get(dKey) ?? { total: 0, correct: 0 }
      dateStat.total++
      if (isCorrect) dateStat.correct += 1
      else if (isClose) dateStat.correct += 0.5
      acc.dates.set(dKey, dateStat)
    }
  }

  // Transform phone accumulators into ProblemPhoneStat[]
  const problemPhones: ProblemPhoneStat[] = []
  const topImprovers: { phone: string; change: number; oldAccuracy: number; newAccuracy: number }[] = []
  const topRegressions: { phone: string; change: number; oldAccuracy: number; newAccuracy: number }[] = []

  let phonemesMasteredCount = 0

  for (const acc of phoneMap.values()) {
    const info = PHONES[acc.phone]
    const features = FEATURES[acc.phone]
    const misses = acc.wrong + acc.missing + acc.close * 0.4
    const accuracyRate = acc.seen ? Math.round(((acc.correct + acc.close * 0.5) / acc.seen) * 100) : 0
    const errorRate = acc.seen ? Math.round((misses / acc.seen) * 100) : 0
    const impactScore = Math.round((errorRate / 100) * Math.log2(acc.seen + 1) * 100) / 100

    if (accuracyRate >= 85 && acc.seen >= 3) {
      phonemesMasteredCount++
    }

    // Sort confusions
    const confusionsList: PhoneConfusion[] = [...acc.confusions.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([subPhone, count]) => {
        const pct = acc.wrong ? Math.round((count / acc.wrong) * 100) : 0
        const explanation = describeSubstitution(acc.phone, subPhone)
        return {
          phone: subPhone,
          count,
          percentage: pct,
          explanation: explanation ? `${explanation}` : '',
        }
      })

    // Articulatory notes
    const articulatoryNotes: string[] = []
    if (confusionsList.length > 0) {
      for (const conf of confusionsList.slice(0, 2)) {
        if (conf.explanation) {
          articulatoryNotes.push(`Said /${conf.phone}/ instead (${conf.percentage}% of substitutions): ${conf.explanation}`)
        }
      }
    }
    if (acc.missing > 0 && acc.seen > 0 && (acc.missing / acc.seen) >= 0.2) {
      const dropPct = Math.round((acc.missing / acc.seen) * 100)
      articulatoryNotes.push(`Dropped / omitted in ${dropPct}% of occurrences`)
    }

    // Trend calculation: compare first half of occurrences vs second half
    let trend: TrendDirection = 'steady'
    let trendDelta = 0
    if (acc.history.length >= 2) {
      const mid = Math.floor(acc.history.length / 2)
      const early = acc.history.slice(0, mid)
      const late = acc.history.slice(mid)

      const earlyScore = early.reduce((s, h) => s + (h.correct ? 1 : h.close ? 0.5 : 0), 0) / early.length
      const lateScore = late.reduce((s, h) => s + (h.correct ? 1 : h.close ? 0.5 : 0), 0) / late.length
      trendDelta = Math.round((lateScore - earlyScore) * 100)

      if (trendDelta >= 10) trend = 'improving'
      else if (trendDelta <= -10) trend = 'regressing'
      else trend = 'steady'

      const oldAcc = Math.round(earlyScore * 100)
      const newAcc = Math.round(lateScore * 100)
      if (trendDelta >= 15) {
        topImprovers.push({ phone: acc.phone, change: trendDelta, oldAccuracy: oldAcc, newAccuracy: newAcc })
      } else if (trendDelta <= -15) {
        topRegressions.push({ phone: acc.phone, change: trendDelta, oldAccuracy: oldAcc, newAccuracy: newAcc })
      }
    } else {
      trend = 'new'
    }

    // Timeline points by date
    const timeline = [...acc.dates.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dateKey, stat]) => ({
        dateKey,
        accuracy: Math.round((stat.correct / stat.total) * 100),
        count: stat.total,
      }))

    problemPhones.push({
      phone: acc.phone,
      name: info?.name ?? (features?.type === 'vowel' ? 'vowel' : 'consonant'),
      example: info?.example ?? '',
      kind: info?.kind ?? (features?.type === 'vowel' ? 'vowel' : 'consonant'),
      seen: acc.seen,
      correct: acc.correct,
      close: acc.close,
      wrong: acc.wrong,
      missing: acc.missing,
      accuracyRate,
      errorRate,
      impactScore,
      dominantSubstitution: confusionsList[0]?.phone,
      confusions: confusionsList,
      articulatoryNotes,
      trend,
      trendDelta,
      timeline,
    })
  }

  // Sort problem phones by impact score descending (worst/most frequent issues first)
  problemPhones.sort((a, b) => b.impactScore - a.impactScore)

  topImprovers.sort((a, b) => b.change - a.change)
  topRegressions.sort((a, b) => a.change - b.change)

  const persistentProblemsCount = problemPhones.filter(
    (p) => p.errorRate >= 25 && p.seen >= 3,
  ).length

  // 3. Articulatory Profile
  let vowelsSeen = 0
  let vowelsCorrect = 0
  let consonantsSeen = 0
  let consonantsCorrect = 0

  // Manners accumulator
  const mannerMap = new Map<Manner, { seen: number; correct: number; problemPhones: Set<string> }>()
  for (const m of ['fricative', 'stop', 'affricate', 'approximant', 'lateral', 'nasal', 'tap'] as Manner[]) {
    mannerMap.set(m, { seen: 0, correct: 0, problemPhones: new Set() })
  }

  // Places accumulator
  const placeMap = new Map<Place, { seen: number; correct: number; problemPhones: Set<string> }>()
  for (const p of ['dental', 'alveolar', 'postalveolar', 'velar', 'labiodental', 'bilabial', 'glottal', 'palatal'] as Place[]) {
    placeMap.set(p, { seen: 0, correct: 0, problemPhones: new Set() })
  }

  // Voicing accumulator
  let voicedSeen = 0
  let voicedCorrect = 0
  let voicelessSeen = 0
  let voicelessCorrect = 0
  let devoicingErrors = 0
  let voicingErrors = 0

  // Vowel qualities accumulator
  const vowelQual = {
    tenseSeen: 0, tenseCorrect: 0,
    laxSeen: 0, laxCorrect: 0,
    highSeen: 0, highCorrect: 0,
    midSeen: 0, midCorrect: 0,
    lowSeen: 0, lowCorrect: 0,
    rhoticSeen: 0, rhoticCorrect: 0,
    diphthongSeen: 0, diphthongCorrect: 0,
  }

  for (const p of problemPhones) {
    const feat: Features | undefined = FEATURES[p.phone]
    if (!feat) continue

    const right = p.correct + p.close * 0.5

    if (feat.type === 'vowel') {
      vowelsSeen += p.seen
      vowelsCorrect += right

      if (feat.tense) {
        vowelQual.tenseSeen += p.seen
        vowelQual.tenseCorrect += right
      } else {
        vowelQual.laxSeen += p.seen
        vowelQual.laxCorrect += right
      }

      if (feat.height <= 1.5) {
        vowelQual.highSeen += p.seen
        vowelQual.highCorrect += right
      } else if (feat.height >= 3.5) {
        vowelQual.lowSeen += p.seen
        vowelQual.lowCorrect += right
      } else {
        vowelQual.midSeen += p.seen
        vowelQual.midCorrect += right
      }

      if (feat.rhotic || p.phone === 'ɝ' || p.phone === 'ɚ') {
        vowelQual.rhoticSeen += p.seen
        vowelQual.rhoticCorrect += right
      }

      if (feat.offglide || p.kind === 'diphthong') {
        vowelQual.diphthongSeen += p.seen
        vowelQual.diphthongCorrect += right
      }
    } else {
      consonantsSeen += p.seen
      consonantsCorrect += right

      // Manner
      const mStat = mannerMap.get(feat.manner)
      if (mStat) {
        mStat.seen += p.seen
        mStat.correct += right
        if (p.errorRate >= 25 && p.seen >= 2) mStat.problemPhones.add(p.phone)
      }

      // Place
      const plStat = placeMap.get(feat.place)
      if (plStat) {
        plStat.seen += p.seen
        plStat.correct += right
        if (p.errorRate >= 25 && p.seen >= 2) plStat.problemPhones.add(p.phone)
      }

      // Voicing
      if (feat.voiced) {
        voicedSeen += p.seen
        voicedCorrect += right
        for (const c of p.confusions) {
          const subFeat = FEATURES[c.phone]
          if (subFeat && subFeat.type === 'consonant' && !subFeat.voiced) {
            devoicingErrors += c.count
          }
        }
      } else {
        voicelessSeen += p.seen
        voicelessCorrect += right
        for (const c of p.confusions) {
          const subFeat = FEATURES[c.phone]
          if (subFeat && subFeat.type === 'consonant' && subFeat.voiced) {
            voicingErrors += c.count
          }
        }
      }
    }
  }

  const manners: ArticulatoryCategoryStat[] = [...mannerMap.entries()]
    .map(([manner, stat]) => {
      const accuracyRate = stat.seen ? Math.round((stat.correct / stat.seen) * 100) : 100
      return {
        id: manner,
        label: MANNER_LABELS[manner] ?? manner,
        seen: stat.seen,
        correct: Math.round(stat.correct),
        accuracyRate,
        errorRate: 100 - accuracyRate,
        problemSounds: [...stat.problemPhones],
      }
    })
    .filter((m) => m.seen > 0)
    .sort((a, b) => b.errorRate - a.errorRate)

  const places: ArticulatoryCategoryStat[] = [...placeMap.entries()]
    .map(([place, stat]) => {
      const accuracyRate = stat.seen ? Math.round((stat.correct / stat.seen) * 100) : 100
      return {
        id: place,
        label: PLACE_LABELS[place] ?? place,
        seen: stat.seen,
        correct: Math.round(stat.correct),
        accuracyRate,
        errorRate: 100 - accuracyRate,
        problemSounds: [...stat.problemPhones],
      }
    })
    .filter((p) => p.seen > 0)
    .sort((a, b) => b.errorRate - a.errorRate)

  const articulatoryProfile: ArticulatoryProfile = {
    vowels: {
      seen: vowelsSeen,
      correct: Math.round(vowelsCorrect),
      accuracyRate: vowelsSeen ? Math.round((vowelsCorrect / vowelsSeen) * 100) : 0,
      errorRate: vowelsSeen ? Math.round(((vowelsSeen - vowelsCorrect) / vowelsSeen) * 100) : 0,
    },
    consonants: {
      seen: consonantsSeen,
      correct: Math.round(consonantsCorrect),
      accuracyRate: consonantsSeen ? Math.round((consonantsCorrect / consonantsSeen) * 100) : 0,
      errorRate: consonantsSeen ? Math.round(((consonantsSeen - consonantsCorrect) / consonantsSeen) * 100) : 0,
    },
    manners,
    places,
    voicing: {
      voiced: {
        seen: voicedSeen,
        correct: Math.round(voicedCorrect),
        accuracyRate: voicedSeen ? Math.round((voicedCorrect / voicedSeen) * 100) : 0,
      },
      voiceless: {
        seen: voicelessSeen,
        correct: Math.round(voicelessCorrect),
        accuracyRate: voicelessSeen ? Math.round((voicelessCorrect / voicelessSeen) * 100) : 0,
      },
      devoicingErrors,
      voicingErrors,
    },
    vowelQualities: {
      tense: {
        seen: vowelQual.tenseSeen,
        accuracyRate: vowelQual.tenseSeen ? Math.round((vowelQual.tenseCorrect / vowelQual.tenseSeen) * 100) : 0,
      },
      lax: {
        seen: vowelQual.laxSeen,
        accuracyRate: vowelQual.laxSeen ? Math.round((vowelQual.laxCorrect / vowelQual.laxSeen) * 100) : 0,
      },
      high: {
        seen: vowelQual.highSeen,
        accuracyRate: vowelQual.highSeen ? Math.round((vowelQual.highCorrect / vowelQual.highSeen) * 100) : 0,
      },
      mid: {
        seen: vowelQual.midSeen,
        accuracyRate: vowelQual.midSeen ? Math.round((vowelQual.midCorrect / vowelQual.midSeen) * 100) : 0,
      },
      low: {
        seen: vowelQual.lowSeen,
        accuracyRate: vowelQual.lowSeen ? Math.round((vowelQual.lowCorrect / vowelQual.lowSeen) * 100) : 0,
      },
      rhotics: {
        seen: vowelQual.rhoticSeen,
        accuracyRate: vowelQual.rhoticSeen ? Math.round((vowelQual.rhoticCorrect / vowelQual.rhoticSeen) * 100) : 0,
      },
      diphthongs: {
        seen: vowelQual.diphthongSeen,
        accuracyRate: vowelQual.diphthongSeen ? Math.round((vowelQual.diphthongCorrect / vowelQual.diphthongSeen) * 100) : 0,
      },
    },
  }

  // 4. Trouble Words Bank Evolution
  const troubleWords: WordTroubleStat[] = struggles
    .filter((w) => isWithinRange(w.lastSeen, range, now))
    .map((w) => {
      const history = w.history ?? []
      const firstScore = history.length > 0 ? history[0].score : (w.lowestScore || w.lastScore)
      const scoreDelta = w.lastScore - firstScore

      let status: 'mastered' | 'improving' | 'stuck' | 'regressing' = 'stuck'
      if (w.lastScore >= 85 && w.totalAttempts >= 2) {
        status = 'mastered'
      } else if (scoreDelta >= 10) {
        status = 'improving'
      } else if (scoreDelta <= -10) {
        status = 'regressing'
      } else {
        status = 'stuck'
      }

      return {
        word: w.word,
        display: w.display,
        ipa: w.ipa,
        struggleCount: w.struggleCount,
        totalAttempts: w.totalAttempts,
        firstScore,
        bestScore: w.bestScore,
        lastScore: w.lastScore,
        lowestScore: w.lowestScore,
        scoreDelta,
        status,
        weakPhones: w.weakPhones,
        recentSaid: w.recentSaid,
        firstSeen: w.firstSeen ?? w.lastSeen,
        lastSeen: w.lastSeen,
        history,
        contexts: w.contexts,
      }
    })
    .sort((a, b) => {
      // Prioritize un-mastered words with high struggle count
      if (a.status === 'mastered' && b.status !== 'mastered') return 1
      if (b.status === 'mastered' && a.status !== 'mastered') return -1
      return b.struggleCount - a.struggleCount || b.lastSeen - a.lastSeen
    })

  // 4b. Word take usage tracking (specifically tracking free speech vs scripted usage)
  interface WordTakeMetrics {
    word: string
    display: string
    freeCount: number
    freeErrors: number
    overallCount: number
    overallErrors: number
    sentences: Set<string>
    scores: number[]
    lastSeen: number
  }
  const wordMetricsMap = new Map<string, WordTakeMetrics>()
  const hasAnyFreeTakes = filteredAttempts.some((a) => a.mode === 'free')

  for (const attempt of filteredAttempts) {
    const isFree = attempt.mode === 'free'
    const hasAttemptError = attempt.score.overall < 85
    const tokens = attempt.target.match(/[a-zA-Z0-9']+/g) ?? []

    for (const rawToken of tokens) {
      const key = rawToken.toLowerCase().replace(/[^a-z0-9']/g, '')
      if (!key || (key.length <= 1 && key !== 'a' && key !== 'i')) continue

      let item = wordMetricsMap.get(key)
      if (!item) {
        item = {
          word: key,
          display: rawToken,
          freeCount: 0,
          freeErrors: 0,
          overallCount: 0,
          overallErrors: 0,
          sentences: new Set(),
          scores: [],
          lastSeen: attempt.at,
        }
        wordMetricsMap.set(key, item)
      }

      item.overallCount++
      item.scores.push(attempt.score.overall)
      item.lastSeen = attempt.at
      if (hasAttemptError) item.overallErrors++
      if (isFree) {
        item.freeCount++
        if (hasAttemptError) item.freeErrors++
      }
      if (attempt.target.length > 5) item.sentences.add(attempt.target)
    }
  }

  // Free Speech Priority List: words the user says a lot in free speech and gets wrong
  const freeSpeechPriorities: FreeSpeechPriorityWord[] = []
  for (const [key, metrics] of wordMetricsMap.entries()) {
    const troubleEntry = troubleWords.find((w) => w.word === key)
    const struggleEntry = struggles.find((s) => s.word === key)

    const freeCount = hasAnyFreeTakes ? metrics.freeCount : metrics.overallCount
    const freeFailures = hasAnyFreeTakes ? metrics.freeErrors : metrics.overallErrors

    // Only include words that had struggles or failed takes
    if (freeCount === 0) continue
    const isStruggled = freeFailures > 0 || Boolean(troubleEntry) || Boolean(struggleEntry)
    if (!isStruggled) continue

    const freeErrorRate = Math.round((freeFailures / freeCount) * 100)
    const overallErrorRate = metrics.overallCount
      ? Math.round((metrics.overallErrors / metrics.overallCount) * 100)
      : freeErrorRate

    const firstScore = metrics.scores.length > 0 ? metrics.scores[0] : (troubleEntry?.firstScore ?? (100 - freeErrorRate))
    const bestScore = Math.max(troubleEntry?.bestScore ?? 0, ...(metrics.scores.length > 0 ? metrics.scores : [firstScore]))
    const lastScore = metrics.scores.length > 0 ? metrics.scores[metrics.scores.length - 1] : (troubleEntry?.lastScore ?? (100 - freeErrorRate))
    const lowestScore = Math.min(troubleEntry?.lowestScore ?? 100, ...(metrics.scores.length > 0 ? metrics.scores : [firstScore]))
    const scoreDelta = lastScore - firstScore
    const isRegressing = scoreDelta <= -10 || (bestScore >= 80 && lastScore <= 70)

    const weakPhones = troubleEntry?.weakPhones ?? []
    const ipa = struggleEntry?.ipa ?? troubleEntry?.ipa ?? (dict?.get(key)?.[0] ?? '')

    // Priority Score formula: high frequency in free speech + errors + regressing
    const priorityScore = (freeCount * 12) + (freeFailures * 22) + Math.round(freeErrorRate * 0.4) + (isRegressing ? 35 : 0)

    freeSpeechPriorities.push({
      word: key,
      display: metrics.display,
      ipa,
      freeSpeechCount: metrics.freeCount,
      freeSpeechFailures: metrics.freeErrors,
      freeSpeechErrorRate: freeErrorRate,
      overallCount: metrics.overallCount,
      overallErrorRate,
      firstScore,
      bestScore,
      lastScore,
      lowestScore,
      scoreDelta,
      isRegressing,
      weakPhones,
      recentSentences: [...metrics.sentences].slice(0, 3),
      priorityScore,
      priorityRank: 0,
    })
  }

  freeSpeechPriorities.sort((a, b) => b.priorityScore - a.priorityScore)
  freeSpeechPriorities.forEach((item, idx) => {
    item.priorityRank = idx + 1
  })

  // 4c. American English Frequency Priority List
  const commonRankMap = new Map<string, number>()
  if (commonWords) {
    commonWords.forEach((word, index) => {
      commonRankMap.set(word.toLowerCase().replace(/[^a-z0-9']/g, ''), index + 1)
    })
  }

  const commonEnglishPriorities: CommonEnglishPriorityWord[] = []
  const addedCommonWords = new Set<string>()

  // 1. Common words the user has attempted and struggled with
  for (const tw of troubleWords) {
    const rank = commonRankMap.get(tw.word)
    if (!rank) continue
    addedCommonWords.add(tw.word)

    const rankWeight = 1 / Math.log2(rank + 1.5)
    const priorityScore = Math.round(rankWeight * 100 * (tw.struggleCount * 8 + (100 - tw.lastScore)))

    commonEnglishPriorities.push({
      word: tw.word,
      display: tw.display,
      ipa: tw.ipa,
      englishRank: rank,
      userAttempts: tw.totalAttempts,
      userStruggles: tw.struggleCount,
      accuracyRate: tw.lastScore,
      lastScore: tw.lastScore,
      weakPhones: tw.weakPhones.map((p) => p.phone),
      isUnpracticedWithWeakSounds: false,
      priorityScore,
      priorityRank: 0,
    })
  }

  // Also check user attempted words from wordMetricsMap that are common words
  for (const [key, metrics] of wordMetricsMap.entries()) {
    if (addedCommonWords.has(key)) continue
    const rank = commonRankMap.get(key)
    if (!rank) continue
    if (metrics.overallErrors === 0) continue

    addedCommonWords.add(key)
    const ipa = dict?.get(key)?.[0] ?? ''
    const rankWeight = 1 / Math.log2(rank + 1.5)
    const priorityScore = Math.round(rankWeight * 100 * (metrics.overallErrors * 8 + 30))

    commonEnglishPriorities.push({
      word: key,
      display: metrics.display,
      ipa,
      englishRank: rank,
      userAttempts: metrics.overallCount,
      userStruggles: metrics.overallErrors,
      accuracyRate: Math.round(((metrics.overallCount - metrics.overallErrors) / metrics.overallCount) * 100),
      lastScore: undefined,
      weakPhones: [],
      isUnpracticedWithWeakSounds: false,
      priorityScore,
      priorityRank: 0,
    })
  }

  // 2. High-frequency American English words NOT yet attempted that contain the user's top problem phonemes
  if (commonWords && commonWords.length > 0) {
    const topWeakPhones = problemPhones.filter((p) => p.errorRate >= 25).slice(0, 6).map((p) => p.phone)
    if (topWeakPhones.length > 0) {
      const topCommon = commonWords.slice(0, 300)
      for (let i = 0; i < topCommon.length; i++) {
        const rawWord = topCommon[i].toLowerCase().replace(/[^a-z0-9']/g, '')
        if (!rawWord || addedCommonWords.has(rawWord) || rawWord.length <= 1) continue

        const ipa = dict?.get(rawWord)?.[0]
        if (!ipa) continue

        const phones = expectedPhones(ipa)
        const matchingWeak = phones.filter((p) => topWeakPhones.includes(p))
        if (matchingWeak.length > 0) {
          addedCommonWords.add(rawWord)
          const rank = i + 1
          const rankWeight = 1 / Math.log2(rank + 1.5)
          const priorityScore = Math.round(rankWeight * 160 + matchingWeak.length * 20)

          commonEnglishPriorities.push({
            word: rawWord,
            display: rawWord,
            ipa,
            englishRank: rank,
            userAttempts: 0,
            userStruggles: 0,
            accuracyRate: 0,
            lastScore: undefined,
            weakPhones: [...new Set(matchingWeak)],
            isUnpracticedWithWeakSounds: true,
            priorityScore,
            priorityRank: 0,
          })
        }
        if (commonEnglishPriorities.length >= 40) break
      }
    }
  }

  commonEnglishPriorities.sort((a, b) => b.priorityScore - a.priorityScore)
  commonEnglishPriorities.forEach((item, idx) => {
    item.priorityRank = idx + 1
  })

  // 4d. Regressing elements (things that have gotten worse over time)
  const regressingPhones: RegressingPhoneStat[] = problemPhones
    .filter((p) => p.trend === 'regressing' || p.trendDelta <= -10)
    .map((p) => {
      const dropPoints = Math.abs(p.trendDelta)
      const earlyAccuracy = Math.min(100, p.accuracyRate + dropPoints)
      const advice = p.articulatoryNotes[0]
        ? `Coaching note: ${p.articulatoryNotes[0]}`
        : `Watch out for substituting /${p.dominantSubstitution ?? ''}/ back into your speech.`

      return {
        phone: p.phone,
        name: p.name,
        example: p.example,
        earlyAccuracy,
        recentAccuracy: p.accuracyRate,
        dropPoints,
        dominantConfusion: p.dominantSubstitution,
        totalTested: p.seen,
        coachingAdvice: advice,
      }
    })
    .sort((a, b) => b.dropPoints - a.dropPoints)

  const regressingWordsMap = new Map<string, RegressingWordStat>()

  for (const w of troubleWords) {
    if (w.status === 'regressing' || w.scoreDelta <= -10 || (w.bestScore >= 80 && w.lastScore <= 70)) {
      regressingWordsMap.set(w.word, {
        word: w.word,
        display: w.display,
        ipa: w.ipa,
        bestScore: w.bestScore,
        lastScore: w.lastScore,
        dropPoints: Math.max(10, w.bestScore - w.lastScore),
        weakPhones: w.weakPhones.map((p) => p.phone),
        lastSeen: w.lastSeen,
        contexts: w.contexts,
      })
    }
  }

  // Also include words from wordMetricsMap that regressed across takes
  for (const [key, metrics] of wordMetricsMap.entries()) {
    if (regressingWordsMap.has(key) || metrics.scores.length < 2) continue
    const firstScore = metrics.scores[0]
    const lastScore = metrics.scores[metrics.scores.length - 1]
    const bestScore = Math.max(...metrics.scores)
    const scoreDelta = lastScore - firstScore

    if (scoreDelta <= -10 || (bestScore >= 80 && lastScore <= 70)) {
      const troubleEntry = troubleWords.find((w) => w.word === key)
      const ipa = troubleEntry?.ipa ?? (dict?.get(key)?.[0] ?? '')
      const weakPhones = troubleEntry?.weakPhones.map((p) => p.phone) ?? []

      regressingWordsMap.set(key, {
        word: key,
        display: metrics.display,
        ipa,
        bestScore,
        lastScore,
        dropPoints: Math.max(10, bestScore - lastScore),
        weakPhones,
        lastSeen: metrics.lastSeen,
        contexts: [...metrics.sentences],
      })
    }
  }

  const regressingWords: RegressingWordStat[] = [...regressingWordsMap.values()].sort((a, b) => b.dropPoints - a.dropPoints)

  // 5. Timeline Points & Rolling Averages
  const timelinePoints: AttemptTimelinePoint[] = []
  const ROLLING_WINDOW = 5

  for (let i = 0; i < filteredAttempts.length; i++) {
    const a = filteredAttempts[i]
    const windowSlice = filteredAttempts.slice(Math.max(0, i - ROLLING_WINDOW + 1), i + 1)
    const rollingAvg = Math.round(
      windowSlice.reduce((sum, item) => sum + item.score.overall, 0) / windowSlice.length,
    )

    const wrongSounds: string[] = []
    const missingSounds: string[] = []
    for (const step of a.aligned) {
      if (step.expected && step.verdict === 'wrong') wrongSounds.push(step.expected)
      if (step.expected && step.verdict === 'missing') missingSounds.push(step.expected)
    }

    timelinePoints.push({
      index: i,
      at: a.at,
      dateKey: localDateKey(a.at),
      formattedDate: formatDate(a.at),
      formattedTime: formatTime(a.at),
      target: a.target,
      score: a.score.overall,
      rollingAvg,
      durationMs: a.durationMs ?? 3500,
      scorer: a.scorer,
      wrongSounds: [...new Set(wrongSounds)],
      missingSounds: [...new Set(missingSounds)],
    })
  }

  // 6. Day Summaries (Calendar & Activity Aggregations)
  const dayMap = new Map<string, DaySummaryStat>()

  for (const point of timelinePoints) {
    let day = dayMap.get(point.dateKey)
    if (!day) {
      day = {
        dateKey: point.dateKey,
        dateLabel: formatShortDate(point.at),
        timestamp: point.at,
        takesCount: 0,
        avgScore: 0,
        bestScore: 0,
        totalDurationMs: 0,
        goodCount: 0,
        okCount: 0,
        poorCount: 0,
        dailyReviewsCount: 0,
        dailySuccessCount: 0,
      }
      dayMap.set(point.dateKey, day)
    }
    day.takesCount++
    day.totalDurationMs += point.durationMs
    day.bestScore = Math.max(day.bestScore, point.score)
    if (point.score >= 85) day.goodCount++
    else if (point.score >= 65) day.okCount++
    else day.poorCount++
  }

  // Merge daily review events into day summaries
  for (const r of filteredReviews) {
    const dKey = localDateKey(r.reviewedAt)
    let day = dayMap.get(dKey)
    if (!day) {
      day = {
        dateKey: dKey,
        dateLabel: formatShortDate(r.reviewedAt),
        timestamp: r.reviewedAt,
        takesCount: 0,
        avgScore: 0,
        bestScore: 0,
        totalDurationMs: 0,
        goodCount: 0,
        okCount: 0,
        poorCount: 0,
        dailyReviewsCount: 0,
        dailySuccessCount: 0,
      }
      dayMap.set(dKey, day)
    }
    day.dailyReviewsCount++
    if (r.rating !== 'again' && r.currentAssessment?.assessed !== false) day.dailySuccessCount++
  }

  // Compute average score for each day
  for (const day of dayMap.values()) {
    const dayPoints = timelinePoints.filter((p) => p.dateKey === day.dateKey)
    if (dayPoints.length > 0) {
      day.avgScore = Math.round(
        dayPoints.reduce((sum, p) => sum + p.score, 0) / dayPoints.length,
      )
    }
  }

  const daySummaries = [...dayMap.values()].sort((a, b) => a.timestamp - b.timestamp)

  const kpis: OverallKPIs = {
    totalAttempts,
    allTimeAttempts,
    totalAudioDurationMs,
    avgScore,
    medianScore,
    bestScore,
    lowestScore,
    scoreDelta,
    scoreDeltaDirection,
    distribution,
    activeDaysCount: rangeActiveDates.size,
    currentStreakDays,
    uniqueWordsCount: uniqueWords.size,
    phonemesPracticedCount: phoneMap.size,
    phonemesMasteredCount,
    persistentProblemsCount,
    troubleWordsCount: troubleWords.length,
    dailyReviewsCount,
    dailySuccessRate,
  }

  return {
    range,
    kpis,
    problemPhones,
    articulatoryProfile,
    troubleWords,
    freeSpeechPriorities,
    commonEnglishPriorities,
    regressingPhones,
    regressingWords,
    timelinePoints,
    daySummaries,
    topImprovers,
    topRegressions,
  }
}

/** Generate a structured export payload of all statistics */
export function exportStatsReport(summary: FullAnalyticsSummary): string {
  const payload = {
    exportedAt: new Date().toISOString(),
    filterRange: summary.range,
    kpis: summary.kpis,
    problemPhonemes: summary.problemPhones.map((p) => ({
      phone: p.phone,
      name: p.name,
      seen: p.seen,
      accuracyRate: p.accuracyRate,
      errorRate: p.errorRate,
      dominantSubstitution: p.dominantSubstitution,
      trend: p.trend,
      trendDelta: p.trendDelta,
      confusions: p.confusions,
    })),
    freeSpeechPriorities: summary.freeSpeechPriorities,
    commonEnglishPriorities: summary.commonEnglishPriorities,
    regressingPhonemes: summary.regressingPhones,
    regressingWords: summary.regressingWords,
    articulatoryBreakdown: summary.articulatoryProfile,
    troubledWords: summary.troubleWords.map((w) => ({
      word: w.word,
      ipa: w.ipa,
      struggleCount: w.struggleCount,
      totalAttempts: w.totalAttempts,
      firstScore: w.firstScore,
      bestScore: w.bestScore,
      lastScore: w.lastScore,
      status: w.status,
      weakPhones: w.weakPhones,
    })),
    timeline: summary.timelinePoints.map((p) => ({
      date: p.formattedDate,
      time: p.formattedTime,
      target: p.target,
      score: p.score,
      durationMs: p.durationMs,
      wrongSounds: p.wrongSounds,
      missingSounds: p.missingSounds,
    })),
  }
  return JSON.stringify(payload, null, 2)
}
