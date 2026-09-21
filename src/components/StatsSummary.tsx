import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  analyzeStats,
  exportStatsReport,
  formatDuration,
  TIME_RANGES,
  type ProblemPhoneStat,
  type TimeRange,
  type WordTroubleStat,
} from '../lib/analytics.ts'
import { PHONES } from '../lib/phones.ts'
import type { PracticeState } from '../lib/usePracticeState.ts'
import { band } from '../lib/usePracticeState.ts'
import type { Dictionary } from '../lib/dict.ts'
import { loadDailyState } from '../lib/daily.ts'
import { getClip } from '../lib/clips.ts'
import { loadCommonWords } from '../lib/drills.ts'

interface Props {
  practice: PracticeState
  dict: Dictionary
  onPractisePhone: (phone: string) => void
  onNavigateToPractice: () => void
}

type StatsTab = 'trends' | 'priorities' | 'regressions' | 'phonemes' | 'articulatory' | 'words' | 'timeline'
type PriorityFilter = 'all' | 'freeSpeech' | 'commonEnglish'

export function StatsSummary({
  practice,
  dict,
  onPractisePhone,
  onNavigateToPractice,
}: Props) {
  const [range, setRange] = useState<TimeRange>('all')
  const [activeTab, setActiveTab] = useState<StatsTab>('trends')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null)
  const [phoneFilter, setPhoneFilter] = useState<'all' | 'consonants' | 'vowels' | 'trouble'>('trouble')
  const [wordFilter, setWordFilter] = useState<'all' | 'struggles' | 'improving' | 'mastered'>('all')
  const [playingClipAt, setPlayingClipAt] = useState<number | null>(null)
  const [commonWords, setCommonWords] = useState<string[] | undefined>(undefined)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null)

  const { attempts, struggles, clips, reopen, practiseWord, setLine } = practice
  const dailyState = useMemo(() => loadDailyState(), [])

  useEffect(() => {
    let mounted = true
    loadCommonWords()
      .then((words) => {
        if (mounted) setCommonWords(words)
      })
      .catch((err) => {
        console.warn('Could not load common words list for stats:', err)
      })
    return () => {
      mounted = false
    }
  }, [])

  // Comprehensive analytics computation
  const stats = useMemo(() => {
    return analyzeStats(attempts, struggles, dailyState, range, undefined, commonWords, dict)
  }, [attempts, struggles, dailyState, range, commonWords, dict])

  // Helper to load and practise any priority word or phrase in studio
  const handlePracticeWord = useCallback(
    (wordStr: string, sentence?: string) => {
      const struggleEntry = struggles.find((e) => e.word.toLowerCase() === wordStr.toLowerCase())
      if (struggleEntry) {
        practiseWord(struggleEntry)
      } else if (sentence) {
        setLine(sentence)
      } else {
        setLine(wordStr)
      }
      onNavigateToPractice()
    },
    [struggles, practiseWord, setLine, onNavigateToPractice],
  )

  // Select initial problem phone if available
  useEffect(() => {
    if (!selectedPhone && stats.problemPhones.length > 0) {
      setSelectedPhone(stats.problemPhones[0].phone)
    }
  }, [selectedPhone, stats.problemPhones])

  // Handle playing historical audio clip
  const togglePlayClip = useCallback(async (at: number) => {
    if (playingClipAt === at) {
      audioPlayerRef.current?.pause()
      setPlayingClipAt(null)
      return
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause()
      audioPlayerRef.current = null
    }

    const clip = await getClip(at)
    if (!clip) return

    const url = URL.createObjectURL(clip.blob)
    const audio = new Audio(url)
    audioPlayerRef.current = audio
    setPlayingClipAt(at)

    audio.onended = () => {
      setPlayingClipAt(null)
      URL.revokeObjectURL(url)
      audioPlayerRef.current = null
    }
    audio.onerror = () => {
      setPlayingClipAt(null)
      audioPlayerRef.current = null
    }
    void audio.play()
  }, [playingClipAt])

  useEffect(() => {
    return () => {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause()
        audioPlayerRef.current = null
      }
    }
  }, [])

  // Download JSON stats report
  const handleExportJSON = () => {
    const jsonString = exportStatsReport(stats)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `phonetics-lab-stats-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Filtered problem phones
  const visiblePhones = useMemo(() => {
    return stats.problemPhones.filter((p) => {
      if (phoneFilter === 'consonants') return p.kind === 'consonant'
      if (phoneFilter === 'vowels') return p.kind !== 'consonant'
      if (phoneFilter === 'trouble') return p.errorRate >= 20 || p.impactScore >= 0.2
      return true
    })
  }, [stats.problemPhones, phoneFilter])

  // Selected phone object
  const activePhoneStat: ProblemPhoneStat | undefined = useMemo(() => {
    return (
      stats.problemPhones.find((p) => p.phone === selectedPhone) ??
      stats.problemPhones[0]
    )
  }, [stats.problemPhones, selectedPhone])

  // Filtered trouble words
  const visibleWords: WordTroubleStat[] = useMemo(() => {
    return stats.troubleWords.filter((w) => {
      if (wordFilter === 'struggles') return w.status === 'stuck' || w.status === 'regressing'
      if (wordFilter === 'improving') return w.status === 'improving'
      if (wordFilter === 'mastered') return w.status === 'mastered'
      return true
    })
  }, [stats.troubleWords, wordFilter])

  // Empty state if no attempts exist yet
  if (attempts.length === 0) {
    return (
      <div className="stats-container">
        <div className="stats-empty-hero">
          <div className="empty-hero-badge">📊</div>
          <h2>Your Pronunciation Profile Will Appear Here</h2>
          <p>
            Every recording you make in the Practice Studio and every sentence reviewed in Daily Practice is analyzed phone-by-phone with millisecond timestamps.
          </p>
          <div className="empty-hero-features">
            <div className="feature-item">
              <span className="feat-icon">🎯</span>
              <div>
                <strong>Articulatory Diagnostics</strong>
                <span>Identifies your systematic phone confusions (e.g. /θ/ → /s/, /ɹ/ → /w/).</span>
              </div>
            </div>
            <div className="feature-item">
              <span className="feat-icon">📈</span>
              <div>
                <strong>Evolution Over Time</strong>
                <span>Tracks your pronunciation score trajectories, rolling averages, and mastery streaks.</span>
              </div>
            </div>
            <div className="feature-item">
              <span className="feat-icon">🎙️</span>
              <div>
                <strong>Timestamped Recording Log</strong>
                <span>Replay historical recordings, compare takes, and measure your accent progress.</span>
              </div>
            </div>
          </div>
          <button className="primary large-btn" onClick={onNavigateToPractice}>
            Start Recording in Practice Studio
          </button>
        </div>
      </div>
    )
  }

  const { kpis } = stats

  return (
    <div className="stats-container">
      {/* HEADER BAR & CONTROLS */}
      <header className="stats-header">
        <div className="stats-header-titles">
          <div className="stats-title-row">
            <h2>Pronunciation Profile &amp; Stats</h2>
            <span className="stats-attempt-pill">
              {kpis.totalAttempts} take{kpis.totalAttempts === 1 ? '' : 's'} analyzed
            </span>
          </div>
          <p className="stats-subtitle">
            Phoneme-by-phoneme articulatory analysis, systematic substitutions, and progress over time.
          </p>
        </div>

        <div className="stats-header-actions">
          {/* Time range selector */}
          <div className="time-range-segmented">
            {TIME_RANGES.map((t) => (
              <button
                key={t.key}
                className={`time-range-btn ${range === t.key ? 'active' : ''}`}
                onClick={() => setRange(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="stats-export-buttons">
            <button
              className="ghost-btn"
              onClick={handleExportJSON}
              title="Download your pronunciation metrics and history as JSON"
            >
              📥 Export Data
            </button>
            <button
              className="ghost-btn danger-text-btn"
              onClick={() => setShowResetConfirm(true)}
              title="Delete history and start over"
            >
              🗑️ Start Over
            </button>
          </div>
        </div>
      </header>

      {/* TOP KPI CARDS */}
      <section className="stats-kpi-grid">
        {/* KPI 1: Overall Average Score */}
        <div className="kpi-card accent-card">
          <div className="kpi-card-header">
            <span className="kpi-label">Average Accuracy</span>
            <span className={`kpi-score-badge ${band(kpis.avgScore)}`}>
              {band(kpis.avgScore).toUpperCase()}
            </span>
          </div>
          <div className="kpi-number-row">
            <span className="kpi-big-number">{kpis.avgScore}</span>
            <span className="kpi-unit">/100</span>
            {kpis.scoreDelta !== 0 && (
              <span className={`kpi-trend-pill ${kpis.scoreDeltaDirection}`}>
                {kpis.scoreDelta > 0 ? `+${kpis.scoreDelta}` : kpis.scoreDelta} pts
              </span>
            )}
          </div>
          {/* Distribution bar */}
          <div className="kpi-mini-bar" title={`Good: ${kpis.distribution.goodPct}%, OK: ${kpis.distribution.okPct}%, Poor: ${kpis.distribution.poorPct}%`}>
            <div className="bar-seg good-seg" style={{ width: `${kpis.distribution.goodPct}%` }} />
            <div className="bar-seg ok-seg" style={{ width: `${kpis.distribution.okPct}%` }} />
            <div className="bar-seg poor-seg" style={{ width: `${kpis.distribution.poorPct}%` }} />
          </div>
          <div className="kpi-subtext">
            <span>{kpis.distribution.good} good ({kpis.distribution.goodPct}%)</span>
            <span>Median: {kpis.medianScore}</span>
          </div>
        </div>

        {/* KPI 2: Speech Volume & Time */}
        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-label">Recorded Speech</span>
            <span className="kpi-icon">🎙️</span>
          </div>
          <div className="kpi-number-row">
            <span className="kpi-big-number">{formatDuration(kpis.totalAudioDurationMs)}</span>
          </div>
          <div className="kpi-meta-list">
            <div className="kpi-meta-row">
              <span>Practice takes:</span>
              <strong>{kpis.totalAttempts}</strong>
            </div>
            <div className="kpi-meta-row">
              <span>Active days:</span>
              <strong>{kpis.activeDaysCount} {kpis.currentStreakDays > 1 ? `(${kpis.currentStreakDays}d streak 🔥)` : ''}</strong>
            </div>
          </div>
        </div>

        {/* KPI 3: Problem Phonemes */}
        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-label">Problem Phonemes</span>
            <span className="kpi-icon">⚠️</span>
          </div>
          <div className="kpi-number-row">
            <span className="kpi-big-number">{kpis.persistentProblemsCount}</span>
            <span className="kpi-unit">sounds</span>
          </div>
          <div className="kpi-meta-list">
            {stats.problemPhones.length > 0 ? (
              <div className="kpi-problem-chips">
                {stats.problemPhones.slice(0, 4).map((p) => (
                  <button
                    key={p.phone}
                    className="problem-mini-tag"
                    onClick={() => {
                      setSelectedPhone(p.phone)
                      setActiveTab('phonemes')
                    }}
                    title={`Click to inspect /${p.phone}/: ${p.errorRate}% error rate`}
                  >
                    /{p.phone}/ {p.errorRate}%
                  </button>
                ))}
              </div>
            ) : (
              <span className="kpi-clean-msg">No persistent phoneme errors detected!</span>
            )}
          </div>
        </div>

        {/* KPI 4: GA Inventory Mastery */}
        <div className="kpi-card">
          <div className="kpi-card-header">
            <span className="kpi-label">Inventory Mastery</span>
            <span className="kpi-icon">🗺️</span>
          </div>
          <div className="kpi-number-row">
            <span className="kpi-big-number">{kpis.phonemesMasteredCount}</span>
            <span className="kpi-unit">/ {kpis.phonemesPracticedCount} sounds</span>
          </div>
          <div className="kpi-subtext">
            <span>{kpis.uniqueWordsCount} unique words spoken</span>
            <span>{kpis.troubleWordsCount} trouble words</span>
          </div>
        </div>
      </section>

      {/* MAIN VIEW TABS */}
      <nav className="stats-tab-navigation">
        <button
          className={`stats-tab-nav-btn ${activeTab === 'trends' ? 'active' : ''}`}
          onClick={() => setActiveTab('trends')}
        >
          📈 Evolution &amp; Trends
        </button>
        <button
          className={`stats-tab-nav-btn ${activeTab === 'priorities' ? 'active' : ''}`}
          onClick={() => setActiveTab('priorities')}
        >
          🎯 Priority Lists ({stats.freeSpeechPriorities.length + stats.commonEnglishPriorities.length})
        </button>
        <button
          className={`stats-tab-nav-btn ${activeTab === 'regressions' ? 'active' : ''}`}
          onClick={() => setActiveTab('regressions')}
        >
          ⚠️ Getting Worse ({stats.regressingPhones.length + stats.regressingWords.length})
        </button>
        <button
          className={`stats-tab-nav-btn ${activeTab === 'phonemes' ? 'active' : ''}`}
          onClick={() => setActiveTab('phonemes')}
        >
          🔤 Problem Phonemes ({stats.problemPhones.length})
        </button>
        <button
          className={`stats-tab-nav-btn ${activeTab === 'articulatory' ? 'active' : ''}`}
          onClick={() => setActiveTab('articulatory')}
        >
          🔬 Articulatory Diagnostics
        </button>
        <button
          className={`stats-tab-nav-btn ${activeTab === 'words' ? 'active' : ''}`}
          onClick={() => setActiveTab('words')}
        >
          📖 Trouble Words ({stats.troubleWords.length})
        </button>
        <button
          className={`stats-tab-nav-btn ${activeTab === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveTab('timeline')}
        >
          🕒 Recording Log ({stats.timelinePoints.length})
        </button>
      </nav>

      {/* TAB CONTENT 1: TRENDS & EVOLUTION */}
      {activeTab === 'trends' && (
        <section className="stats-section-deck">
          {/* Chronological Score Progression Graph */}
          <div className="stats-panel-card">
            <div className="panel-card-header">
              <div>
                <h3>Pronunciation Score Progression Over Time</h3>
                <p className="panel-desc">
                  Every recording take plotted chronologically with moving average curve and the 85-point mastery threshold.
                </p>
              </div>
            </div>

            {stats.timelinePoints.length > 0 ? (
              <div className="trend-chart-container">
                <ScoreProgressionChart points={stats.timelinePoints} />
              </div>
            ) : (
              <div className="panel-empty-notice">Not enough takes in this time window to draw trend curve.</div>
            )}
          </div>

          {/* Breakthroughs vs Needs Attention */}
          <div className="trends-duo-grid">
            <div className="stats-panel-card">
              <div className="panel-card-header">
                <h3>🚀 Pronunciation Breakthroughs</h3>
                <p className="panel-desc">Sounds that have improved significantly across your takes.</p>
              </div>
              <div className="breakthrough-list">
                {stats.topImprovers.length > 0 ? (
                  stats.topImprovers.map((item) => (
                    <div key={item.phone} className="breakthrough-row">
                      <div className="bt-phone-chip">/{item.phone}/</div>
                      <div className="bt-info">
                        <div className="bt-title">
                          Accuracy: {item.oldAccuracy}% → <strong>{item.newAccuracy}%</strong>
                        </div>
                        <span className="bt-example">{PHONES[item.phone]?.name}</span>
                      </div>
                      <div className="bt-gain-pill">+{item.change}%</div>
                    </div>
                  ))
                ) : (
                  <div className="empty-subpanel-state">
                    Keep practicing! Sounds that improve by 15%+ will be celebrated here.
                  </div>
                )}
              </div>
              <div className="card-bottom-link-row">
                <button
                  className="ghost-btn tiny full-width-link"
                  onClick={() => setActiveTab('priorities')}
                >
                  View High-Priority Practice Lists ({stats.freeSpeechPriorities.length + stats.commonEnglishPriorities.length}) →
                </button>
              </div>
            </div>

            <div className="stats-panel-card">
              <div className="panel-card-header">
                <h3>⚠️ Needs Targeted Attention</h3>
                <p className="panel-desc">Sounds that remain stubbornly difficult or have regressed.</p>
              </div>
              <div className="breakthrough-list">
                {stats.problemPhones
                  .filter((p) => p.trend === 'regressing' || (p.errorRate >= 40 && p.seen >= 3))
                  .slice(0, 4)
                  .map((p) => (
                    <div key={p.phone} className="breakthrough-row regression">
                      <div className="bt-phone-chip warn">/{p.phone}/</div>
                      <div className="bt-info">
                        <div className="bt-title">
                          Error rate: <strong>{p.errorRate}%</strong> ({p.seen} attempts)
                        </div>
                        <span className="bt-example">
                          {p.dominantSubstitution ? `Common substitution: /${p.dominantSubstitution}/` : PHONES[p.phone]?.name}
                        </span>
                      </div>
                      <button
                        className="ghost-btn tiny"
                        onClick={() => onPractisePhone(p.phone)}
                        title={`Start drill for /${p.phone}/`}
                      >
                        Drill
                      </button>
                    </div>
                  ))}
                {stats.problemPhones.filter((p) => p.trend === 'regressing' || (p.errorRate >= 40 && p.seen >= 3)).length === 0 && (
                  <div className="empty-subpanel-state">No critical regressing sounds detected!</div>
                )}
              </div>
              <div className="card-bottom-link-row">
                <button
                  className="ghost-btn tiny full-width-link"
                  onClick={() => setActiveTab('regressions')}
                >
                  Inspect Detected Regressions ({stats.regressingPhones.length + stats.regressingWords.length}) →
                </button>
              </div>
            </div>
          </div>

          {/* Daily Activity & Consistency Heatmap/Bar chart */}
          <div className="stats-panel-card">
            <div className="panel-card-header">
              <h3>Daily Practice Intensity &amp; Accuracy</h3>
              <p className="panel-desc">Takes recorded and average performance day-by-day.</p>
            </div>
            <div className="daily-rhythm-grid">
              {stats.daySummaries.map((day) => (
                <div key={day.dateKey} className="day-rhythm-cell">
                  <div className="rhythm-date-tag">{day.dateLabel}</div>
                  <div className={`rhythm-score-pill ${band(day.avgScore)}`}>
                    {day.avgScore > 0 ? day.avgScore : '—'}
                  </div>
                  <div className="rhythm-takes-count">
                    {day.takesCount} take{day.takesCount === 1 ? '' : 's'}
                  </div>
                  <div className="rhythm-time">
                    {day.totalDurationMs > 0 ? formatDuration(day.totalDurationMs) : ''}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TAB CONTENT 2: DUAL PRIORITY LISTS */}
      {activeTab === 'priorities' && (
        <section className="stats-section-deck">
          {/* Priority Hero Explainer */}
          <div className="priority-hero-banner">
            <div className="priority-hero-titles">
              <h3>🎯 Target Action Priority Lists</h3>
              <p className="panel-desc">
                Two essential, complementary priority lists: words you personally say frequently in spontaneous / free speech where mistakes occur, and the highest-frequency American English words that target your weak phonetic sounds.
              </p>
            </div>
            <div className="priority-filter-toggles">
              <button
                className={`priority-filter-btn ${priorityFilter === 'all' ? 'active' : ''}`}
                onClick={() => setPriorityFilter('all')}
              >
                All Priority Targets ({stats.freeSpeechPriorities.length + stats.commonEnglishPriorities.length})
              </button>
              <button
                className={`priority-filter-btn ${priorityFilter === 'freeSpeech' ? 'active' : ''}`}
                onClick={() => setPriorityFilter('freeSpeech')}
              >
                🗣️ Free-Speech Trouble ({stats.freeSpeechPriorities.length})
              </button>
              <button
                className={`priority-filter-btn ${priorityFilter === 'commonEnglish' ? 'active' : ''}`}
                onClick={() => setPriorityFilter('commonEnglish')}
              >
                🇺🇸 Common American English ({stats.commonEnglishPriorities.length})
              </button>
            </div>
          </div>

          {/* LIST 1: CONVERSATIONAL FREE SPEECH TROUBLE WORDS */}
          {(priorityFilter === 'all' || priorityFilter === 'freeSpeech') && (
            <div className="stats-panel-card">
              <div className="panel-card-header">
                <div>
                  <h3>🗣️ Spontaneous &amp; Free-Speech Priority Words</h3>
                  <p className="panel-desc">
                    Words you naturally say repeatedly during spontaneous takes where pronunciation errors were detected. Correcting these yields the fastest real-world fluency and accent improvement in daily conversation.
                  </p>
                </div>
                <span className="priority-count-badge">
                  {stats.freeSpeechPriorities.length} conversational word{stats.freeSpeechPriorities.length === 1 ? '' : 's'}
                </span>
              </div>

              {stats.freeSpeechPriorities.length > 0 ? (
                <div className="priority-card-grid">
                  {stats.freeSpeechPriorities.slice(0, 30).map((item) => (
                    <div key={item.word} className={`priority-item-card ${item.isRegressing ? 'is-regressing' : ''}`}>
                      <div className="pic-header">
                        <div className="pic-rank-badge free-speech">
                          #{item.priorityRank} Conversational Priority
                        </div>
                        {item.isRegressing && (
                          <span className="pic-alert-badge" title="Accuracy dropped over time">
                            ⚠️ Getting Worse
                          </span>
                        )}
                      </div>

                      <div className="pic-body">
                        <div className="pic-word-row">
                          <span className="pic-word-name">{item.display}</span>
                          {item.ipa && <span className="pic-ipa">/{item.ipa}/</span>}
                        </div>

                        <div className="pic-stats-grid">
                          <div className="pic-stat-box">
                            <span className="ps-num">{item.freeSpeechCount}×</span>
                            <span className="ps-lbl">Spoken in free speech</span>
                          </div>
                          <div className="pic-stat-box">
                            <span className="ps-num warn">{item.freeSpeechFailures} ({item.freeSpeechErrorRate}%)</span>
                            <span className="ps-lbl">Errors in free speech</span>
                          </div>
                          <div className="pic-stat-box">
                            <span className="ps-num">
                              {item.firstScore} → <strong>{item.lastScore}</strong>
                            </span>
                            <span className="ps-lbl">
                              Trajectory {item.scoreDelta !== 0 && (
                                <span className={`delta-tag ${item.scoreDelta > 0 ? 'up' : 'down'}`}>
                                  {item.scoreDelta > 0 ? `+${item.scoreDelta}` : item.scoreDelta}
                                </span>
                              )}
                            </span>
                          </div>
                        </div>

                        {item.weakPhones.length > 0 && (
                          <div className="pic-weak-row">
                            <span className="pic-weak-lbl">Struggled sounds:</span>
                            <div className="pic-weak-chips">
                              {item.weakPhones.map((p) => (
                                <button
                                  key={p.phone}
                                  className="weak-phone-chip clickable"
                                  onClick={() => onPractisePhone(p.phone)}
                                  title={`Drill /${p.phone}/ sound in Drill Studio`}
                                >
                                  /{p.phone}/
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {item.recentSentences.length > 0 && (
                          <div className="pic-context-box">
                            <span className="pic-context-label">Heard in your speech:</span>
                            <span className="pic-context-quote">“{item.recentSentences[0]}”</span>
                          </div>
                        )}
                      </div>

                      <div className="pic-footer">
                        <button
                          className="primary tiny pic-action-btn"
                          onClick={() => handlePracticeWord(item.word, item.recentSentences[0])}
                          title={`Practise "${item.display}" in Practice Studio`}
                        >
                          Practise in Studio ↗
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panel-empty-notice">
                  No free-speech trouble words recorded yet. As you record spontaneous speech in the Practice Studio, words you use repeatedly and get wrong will appear here automatically.
                </div>
              )}
            </div>
          )}

          {/* LIST 2: MOST COMMON WORDS IN AMERICAN ENGLISH */}
          {(priorityFilter === 'all' || priorityFilter === 'commonEnglish') && (
            <div className="stats-panel-card">
              <div className="panel-card-header">
                <div>
                  <h3>🇺🇸 Most Common Words in American English</h3>
                  <p className="panel-desc">
                    The highest-frequency General American vocabulary where you have struggled or that contain your weak sounds. Perfecting these guarantees that the words native listeners hear most often from you sound authentic and effortless.
                  </p>
                </div>
                <span className="priority-count-badge">
                  {stats.commonEnglishPriorities.length} frequent word{stats.commonEnglishPriorities.length === 1 ? '' : 's'}
                </span>
              </div>

              {stats.commonEnglishPriorities.length > 0 ? (
                <div className="priority-card-grid">
                  {stats.commonEnglishPriorities.slice(0, 30).map((item) => (
                    <div
                      key={item.word}
                      className={`priority-item-card common-en ${item.isUnpracticedWithWeakSounds ? 'unpracticed' : ''}`}
                    >
                      <div className="pic-header">
                        <div className="pic-rank-badge common-en">
                          #{item.priorityRank} General American Priority
                        </div>
                        <span className="pic-freq-badge">
                          #{item.englishRank} in American English
                        </span>
                      </div>

                      <div className="pic-body">
                        <div className="pic-word-row">
                          <span className="pic-word-name">{item.display}</span>
                          {item.ipa && <span className="pic-ipa">/{item.ipa}/</span>}
                        </div>

                        {item.isUnpracticedWithWeakSounds ? (
                          <div className="pic-unpracticed-box">
                            <span className="unpracticed-pill">High-Frequency Accent Opportunity</span>
                            <p className="unpracticed-text">
                              Contains your difficult sound{item.weakPhones.length === 1 ? '' : 's'}:{' '}
                              <strong>{item.weakPhones.map((p) => `/${p}/`).join(' ')}</strong>. Practicing this common word prevents accent transfer in everyday conversations.
                            </p>
                          </div>
                        ) : (
                          <div className="pic-stats-grid">
                            <div className="pic-stat-box">
                              <span className="ps-num">{item.userAttempts}×</span>
                              <span className="ps-lbl">Recorded takes</span>
                            </div>
                            <div className="pic-stat-box">
                              <span className="ps-num warn">{item.userStruggles}</span>
                              <span className="ps-lbl">Struggles</span>
                            </div>
                            <div className="pic-stat-box">
                              <span className={`ps-num ${band(item.accuracyRate)}`}>
                                {item.accuracyRate}/100
                              </span>
                              <span className="ps-lbl">Latest accuracy</span>
                            </div>
                          </div>
                        )}

                        {item.weakPhones.length > 0 && (
                          <div className="pic-weak-row">
                            <span className="pic-weak-lbl">Target sounds:</span>
                            <div className="pic-weak-chips">
                              {item.weakPhones.map((phone) => (
                                <button
                                  key={phone}
                                  className="weak-phone-chip clickable"
                                  onClick={() => onPractisePhone(phone)}
                                  title={`Drill /${phone}/ sound in Drill Studio`}
                                >
                                  /{phone}/
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="pic-footer">
                        <button
                          className="primary tiny pic-action-btn"
                          onClick={() => handlePracticeWord(item.word)}
                          title={`Practise "${item.display}" in Practice Studio`}
                        >
                          Practise in Studio ↗
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panel-empty-notice">
                  No common American English priority words detected yet. Complete a few takes to identify foundational sound priorities.
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB CONTENT 3: REGRESSIONS ("THINGS GETTING WORSE") */}
      {activeTab === 'regressions' && (
        <section className="stats-section-deck">
          <div className="regressions-hero-banner">
            <div className="regressions-hero-titles">
              <h3>⚠️ Pronunciation Regressions ("Things Getting Worse")</h3>
              <p className="panel-desc">
                Pronunciation progress is rarely a straight line. Often, concentrating on a new sound causes previously mastered sounds or words to temporarily slip back. Catching and refreshing these regressions early cements long-term accent retention.
              </p>
            </div>
          </div>

          {/* DUO GRID: REGRESSING PHONEMES vs REGRESSING WORDS */}
          <div className="regressions-grid">
            {/* 1. Regressing Phonemes */}
            <div className="stats-panel-card">
              <div className="panel-card-header">
                <div>
                  <h3>🔤 Phonemes With Declining Accuracy</h3>
                  <p className="panel-desc">
                    Sounds whose accuracy in recent takes is 10+ points lower than earlier recordings.
                  </p>
                </div>
                <span className="regress-count-badge">
                  {stats.regressingPhones.length} sound{stats.regressingPhones.length === 1 ? '' : 's'}
                </span>
              </div>

              {stats.regressingPhones.length > 0 ? (
                <div className="regress-card-list">
                  {stats.regressingPhones.map((p) => (
                    <div key={p.phone} className="regress-card">
                      <div className="rc-header">
                        <div className="rc-phone-block">
                          <span className="rc-phone-chip">/{p.phone}/</span>
                          <div className="rc-phone-names">
                            <strong>{p.name}</strong>
                            <span className="rc-example">e.g. "{p.example}"</span>
                          </div>
                        </div>
                        <span className="rc-drop-pill">
                          -{p.dropPoints} pts drop
                        </span>
                      </div>

                      <div className="rc-progress-bar-block">
                        <div className="rc-bar-labels">
                          <span>Early: {p.earlyAccuracy}%</span>
                          <span>Recent: <strong>{p.recentAccuracy}%</strong></span>
                        </div>
                        <div className="rc-bar-track">
                          <div className="rc-bar-early" style={{ width: `${p.earlyAccuracy}%` }} />
                          <div className="rc-bar-recent" style={{ width: `${p.recentAccuracy}%` }} />
                        </div>
                      </div>

                      {p.dominantConfusion && (
                        <div className="rc-slip-note">
                          <span className="rc-slip-icon">↩️</span>
                          <span>
                            Slipping back to <strong>/{p.dominantConfusion}/</strong> instead of /{p.phone}/
                          </span>
                        </div>
                      )}

                      {p.coachingAdvice && (
                        <div className="rc-advice-box">
                          <strong>Articulatory Tip:</strong> {p.coachingAdvice}
                        </div>
                      )}

                      <div className="rc-footer">
                        <span className="rc-tested-count">{p.totalTested} occurrences tested</span>
                        <button
                          className="primary tiny"
                          onClick={() => onPractisePhone(p.phone)}
                          title={`Start drill for /${p.phone}/`}
                        >
                          Drill /{p.phone}/ Now ↗
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="regress-clean-state">
                  <span className="rc-clean-icon">🌟</span>
                  <h4>No Phoneme Regressions Detected!</h4>
                  <p>All your practiced phonemes are holding steady or improving over time.</p>
                </div>
              )}
            </div>

            {/* 2. Regressing Trouble Words */}
            <div className="stats-panel-card">
              <div className="panel-card-header">
                <div>
                  <h3>📖 Trouble Words With Declining Scores</h3>
                  <p className="panel-desc">
                    Words where your recent take scored significantly lower than your personal best.
                  </p>
                </div>
                <span className="regress-count-badge">
                  {stats.regressingWords.length} word{stats.regressingWords.length === 1 ? '' : 's'}
                </span>
              </div>

              {stats.regressingWords.length > 0 ? (
                <div className="regress-card-list">
                  {stats.regressingWords.map((w) => (
                    <div key={w.word} className="regress-card">
                      <div className="rc-header">
                        <div className="rc-word-block">
                          <span className="rc-word-name">{w.display}</span>
                          {w.ipa && <span className="rc-word-ipa">/{w.ipa}/</span>}
                        </div>
                        <span className="rc-drop-pill">
                          -{w.dropPoints} pts drop
                        </span>
                      </div>

                      <div className="rc-score-duo">
                        <div className="rc-score-item">
                          <span className="rc-score-lbl">Best Score</span>
                          <span className={`rc-score-val ${band(w.bestScore)}`}>{w.bestScore}</span>
                        </div>
                        <span className="rc-score-arrow">➔</span>
                        <div className="rc-score-item">
                          <span className="rc-score-lbl">Latest Score</span>
                          <span className={`rc-score-val ${band(w.lastScore)}`}>{w.lastScore}</span>
                        </div>
                      </div>

                      {w.weakPhones.length > 0 && (
                        <div className="rc-weak-chips-row">
                          <span className="rc-weak-lbl">Sound issues:</span>
                          {w.weakPhones.map((p) => (
                            <button
                              key={p}
                              className="weak-phone-chip clickable"
                              onClick={() => onPractisePhone(p)}
                              title={`Drill /${p}/ in Drill Studio`}
                            >
                              /{p}/
                            </button>
                          ))}
                        </div>
                      )}

                      {w.contexts && w.contexts.length > 0 && (
                        <div className="rc-context-box">
                          <span className="rc-context-quote">“{w.contexts[0]}”</span>
                        </div>
                      )}

                      <div className="rc-footer">
                        <span className="rc-tested-count">Last practiced {new Date(w.lastSeen).toLocaleDateString()}</span>
                        <button
                          className="primary tiny"
                          onClick={() => handlePracticeWord(w.word, w.contexts?.[0])}
                          title={`Practise "${w.display}" in Practice Studio`}
                        >
                          Practise Word ↗
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="regress-clean-state">
                  <span className="rc-clean-icon">🌟</span>
                  <h4>No Word Regressions Detected!</h4>
                  <p>None of your previously learned words have slipped significantly below their peak scores.</p>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB CONTENT 2: PROBLEM PHONEMES */}
      {activeTab === 'phonemes' && (
        <section className="phonemes-explorer-layout">
          {/* LEFT: SOUNDS LIST */}
          <div className="sounds-sidebar-panel">
            <div className="sounds-filter-bar">
              <button
                className={`filter-chip ${phoneFilter === 'trouble' ? 'active' : ''}`}
                onClick={() => setPhoneFilter('trouble')}
              >
                Trouble Only
              </button>
              <button
                className={`filter-chip ${phoneFilter === 'all' ? 'active' : ''}`}
                onClick={() => setPhoneFilter('all')}
              >
                All Sounds ({stats.problemPhones.length})
              </button>
              <button
                className={`filter-chip ${phoneFilter === 'consonants' ? 'active' : ''}`}
                onClick={() => setPhoneFilter('consonants')}
              >
                Consonants
              </button>
              <button
                className={`filter-chip ${phoneFilter === 'vowels' ? 'active' : ''}`}
                onClick={() => setPhoneFilter('vowels')}
              >
                Vowels
              </button>
            </div>

            <div className="sounds-scroll-list">
              {visiblePhones.map((p) => {
                const isSelected = selectedPhone === p.phone
                return (
                  <button
                    key={p.phone}
                    className={`sound-list-row ${isSelected ? 'selected' : ''}`}
                    onClick={() => setSelectedPhone(p.phone)}
                  >
                    <div className="row-phone-col">
                      <span className="sound-ipa">/{p.phone}/</span>
                      <span className="sound-type-tag">{p.kind}</span>
                    </div>

                    <div className="row-metric-col">
                      <div className="row-error-line">
                        <span className="error-pct-label">{p.errorRate}% error</span>
                        <span className={`trend-badge ${p.trend}`}>
                          {p.trend === 'improving' ? '↗ improving' : p.trend === 'regressing' ? '↘ regressing' : '→ steady'}
                        </span>
                      </div>
                      <div className="mini-error-bar">
                        <div className="error-fill" style={{ width: `${p.errorRate}%` }} />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* RIGHT: SOUND DEEP-DIVE INSPECTOR */}
          <div className="sound-detail-panel">
            {activePhoneStat ? (
              <div className="sound-inspector-wrap">
                <div className="inspector-hero-row">
                  <div className="hero-sound-badge">
                    <span className="big-ipa">/{activePhoneStat.phone}/</span>
                    <span className="sound-kind-pill">{activePhoneStat.kind}</span>
                  </div>

                  <div className="hero-sound-info">
                    <h3>{activePhoneStat.name}</h3>
                    <p className="hero-example">
                      Keyword: <strong>"{activePhoneStat.example}"</strong> · Tested <strong>{activePhoneStat.seen}</strong> times
                    </p>
                  </div>

                  <div className="hero-actions">
                    <button
                      className="primary start-drill-btn"
                      onClick={() => onPractisePhone(activePhoneStat.phone)}
                    >
                      ⚡ Practice /{activePhoneStat.phone}/ in Studio
                    </button>
                  </div>
                </div>

                {/* Accuracy & Breakdown Meter */}
                <div className="inspector-accuracy-card">
                  <div className="acc-card-header">
                    <h4>Pronunciation Accuracy Breakdown</h4>
                    <span className="acc-rate-num">{activePhoneStat.accuracyRate}% Accurate</span>
                  </div>

                  <div className="stacked-verdict-bar">
                    <div
                      className="verdict-bar-slice correct"
                      style={{ width: `${(activePhoneStat.correct / activePhoneStat.seen) * 100}%` }}
                      title={`Correct: ${activePhoneStat.correct}`}
                    />
                    <div
                      className="verdict-bar-slice close"
                      style={{ width: `${(activePhoneStat.close / activePhoneStat.seen) * 100}%` }}
                      title={`Close: ${activePhoneStat.close}`}
                    />
                    <div
                      className="verdict-bar-slice wrong"
                      style={{ width: `${(activePhoneStat.wrong / activePhoneStat.seen) * 100}%` }}
                      title={`Wrong substitutions: ${activePhoneStat.wrong}`}
                    />
                    <div
                      className="verdict-bar-slice missing"
                      style={{ width: `${(activePhoneStat.missing / activePhoneStat.seen) * 100}%` }}
                      title={`Dropped / missing: ${activePhoneStat.missing}`}
                    />
                  </div>

                  <div className="verdict-legend-row">
                    <span className="legend-item"><i className="dot correct" /> {activePhoneStat.correct} correct</span>
                    <span className="legend-item"><i className="dot close" /> {activePhoneStat.close} near miss</span>
                    <span className="legend-item"><i className="dot wrong" /> {activePhoneStat.wrong} substituted</span>
                    <span className="legend-item"><i className="dot missing" /> {activePhoneStat.missing} dropped</span>
                  </div>
                </div>

                {/* Confusion Matrix & Substitutions */}
                <div className="inspector-confusions-card">
                  <h4>What was heard instead (Systematic Substitutions)</h4>
                  {activePhoneStat.confusions.length > 0 ? (
                    <div className="confusions-table">
                      {activePhoneStat.confusions.map((c) => (
                        <div key={c.phone} className="confusion-row">
                          <div className="sub-phone-box">
                            <span className="sub-arrow">→</span>
                            <span className="sub-ipa">/{c.phone}/</span>
                            <span className="sub-count">{c.count} time{c.count === 1 ? '' : 's'} ({c.percentage}%)</span>
                          </div>
                          <div className="sub-explanation">
                            {c.explanation || 'Different phonetic articulation'}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="clean-sub-msg">
                      No systematic substitutions recorded for this sound.
                    </div>
                  )}
                </div>

                {/* Articulatory Diagnostic Advice */}
                {activePhoneStat.articulatoryNotes.length > 0 && (
                  <div className="inspector-notes-card">
                    <h4>Articulatory Coaching Notes</h4>
                    <ul className="coaching-notes-list">
                      {activePhoneStat.articulatoryNotes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Historical Accuracy Timeline for this Phone */}
                {activePhoneStat.timeline.length > 1 && (
                  <div className="inspector-history-card">
                    <h4>Accuracy Evolution Across Sessions</h4>
                    <div className="phone-timeline-points">
                      {activePhoneStat.timeline.map((tp) => (
                        <div key={tp.dateKey} className="pt-point">
                          <span className="pt-date">{tp.dateKey}</span>
                          <span className={`pt-score-pill ${band(tp.accuracy)}`}>{tp.accuracy}%</span>
                          <span className="pt-count">{tp.count} takes</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="inspector-empty">Select a sound on the left to view detailed diagnostics.</div>
            )}
          </div>
        </section>
      )}

      {/* TAB CONTENT 3: ARTICULATORY DIAGNOSTICS */}
      {activeTab === 'articulatory' && (
        <section className="articulatory-section-deck">
          {/* Top Row: Vowels vs Consonants */}
          <div className="articulatory-duo-row">
            <div className="stats-panel-card">
              <div className="panel-card-header">
                <h3>Vowels Profile</h3>
                <span className={`acc-pill ${band(stats.articulatoryProfile.vowels.accuracyRate)}`}>
                  {stats.articulatoryProfile.vowels.accuracyRate}% Accuracy
                </span>
              </div>
              <p className="panel-desc">Tested {stats.articulatoryProfile.vowels.seen} vowel instances.</p>
              <div className="bar-track">
                <div
                  className="bar-fill good-bg"
                  style={{ width: `${stats.articulatoryProfile.vowels.accuracyRate}%` }}
                />
              </div>

              {/* Vowel Qualities Breakdown */}
              <div className="vowel-qualities-grid">
                <div className="qual-card">
                  <span className="qual-title">Tense Vowels</span>
                  <span className="qual-num">{stats.articulatoryProfile.vowelQualities.tense.accuracyRate}%</span>
                  <span className="qual-sub">/i, eɪ, u, oʊ, ɑ/</span>
                </div>
                <div className="qual-card">
                  <span className="qual-title">Lax Vowels</span>
                  <span className="qual-num">{stats.articulatoryProfile.vowelQualities.lax.accuracyRate}%</span>
                  <span className="qual-sub">/ɪ, ɛ, æ, ʊ, ʌ, ə/</span>
                </div>
                <div className="qual-card">
                  <span className="qual-title">R-Coloured</span>
                  <span className="qual-num">{stats.articulatoryProfile.vowelQualities.rhotics.accuracyRate}%</span>
                  <span className="qual-sub">/ɝ, ɚ/</span>
                </div>
                <div className="qual-card">
                  <span className="qual-title">Diphthongs</span>
                  <span className="qual-num">{stats.articulatoryProfile.vowelQualities.diphthongs.accuracyRate}%</span>
                  <span className="qual-sub">/aɪ, aʊ, ɔɪ/</span>
                </div>
              </div>
            </div>

            <div className="stats-panel-card">
              <div className="panel-card-header">
                <h3>Consonants Profile</h3>
                <span className={`acc-pill ${band(stats.articulatoryProfile.consonants.accuracyRate)}`}>
                  {stats.articulatoryProfile.consonants.accuracyRate}% Accuracy
                </span>
              </div>
              <p className="panel-desc">Tested {stats.articulatoryProfile.consonants.seen} consonant instances.</p>
              <div className="bar-track">
                <div
                  className="bar-fill good-bg"
                  style={{ width: `${stats.articulatoryProfile.consonants.accuracyRate}%` }}
                />
              </div>

              {/* Voicing Diagnostics */}
              <div className="voicing-card">
                <h4>Voicing Control</h4>
                <div className="voicing-duo">
                  <div className="voicing-box">
                    <span className="v-label">Voiced Consonants</span>
                    <span className="v-val">{stats.articulatoryProfile.voicing.voiced.accuracyRate}%</span>
                    <span className="v-sub">/b, d, ɡ, v, ð, z, ʒ, dʒ/</span>
                  </div>
                  <div className="voicing-box">
                    <span className="v-label">Voiceless Consonants</span>
                    <span className="v-val">{stats.articulatoryProfile.voicing.voiceless.accuracyRate}%</span>
                    <span className="v-sub">/p, t, k, f, θ, s, ʃ, tʃ, h/</span>
                  </div>
                </div>
                {stats.articulatoryProfile.voicing.devoicingErrors > 0 && (
                  <div className="devoicing-alert">
                    ⚠️ Devoicing detected: voiced sounds turned voiceless in {stats.articulatoryProfile.voicing.devoicingErrors} instances.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Consonant Manner Breakdown */}
          <div className="stats-panel-card">
            <div className="panel-card-header">
              <h3>Consonant Breakdown by Manner of Articulation</h3>
              <p className="panel-desc">
                Identifies whether your errors stem from fricatives, affricates, stops, or approximant liquids.
              </p>
            </div>
            <div className="category-bars-list">
              {stats.articulatoryProfile.manners.map((m) => (
                <div key={m.id} className="category-bar-row">
                  <div className="cat-header-row">
                    <span className="cat-name">{m.label}</span>
                    <span className="cat-acc">{m.accuracyRate}% accuracy</span>
                  </div>
                  <div className="bar-track">
                    <div
                      className={`bar-fill ${m.errorRate > 30 ? 'warn-bg' : 'good-bg'}`}
                      style={{ width: `${m.accuracyRate}%` }}
                    />
                  </div>
                  {m.problemSounds.length > 0 && (
                    <div className="cat-trouble-chips">
                      <span className="trouble-label">Trouble sounds:</span>
                      {m.problemSounds.map((phone) => (
                        <button
                          key={phone}
                          className="trouble-chip-btn"
                          onClick={() => {
                            setSelectedPhone(phone)
                            setActiveTab('phonemes')
                          }}
                        >
                          /{phone}/
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Consonant Place Breakdown */}
          <div className="stats-panel-card">
            <div className="panel-card-header">
              <h3>Consonant Breakdown by Place of Articulation</h3>
              <p className="panel-desc">
                Where the constriction happens inside the vocal tract (e.g. dental tongue-between-teeth vs alveolar).
              </p>
            </div>
            <div className="category-bars-list">
              {stats.articulatoryProfile.places.map((pl) => (
                <div key={pl.id} className="category-bar-row">
                  <div className="cat-header-row">
                    <span className="cat-name">{pl.label}</span>
                    <span className="cat-acc">{pl.accuracyRate}% accuracy</span>
                  </div>
                  <div className="bar-track">
                    <div
                      className={`bar-fill ${pl.errorRate > 30 ? 'warn-bg' : 'good-bg'}`}
                      style={{ width: `${pl.accuracyRate}%` }}
                    />
                  </div>
                  {pl.problemSounds.length > 0 && (
                    <div className="cat-trouble-chips">
                      <span className="trouble-label">Trouble sounds:</span>
                      {pl.problemSounds.map((phone) => (
                        <button
                          key={phone}
                          className="trouble-chip-btn"
                          onClick={() => {
                            setSelectedPhone(phone)
                            setActiveTab('phonemes')
                          }}
                        >
                          /{phone}/
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* TAB CONTENT 4: TROUBLE WORDS EVOLUTION */}
      {activeTab === 'words' && (
        <section className="stats-panel-card">
          <div className="panel-card-header words-header-flex">
            <div>
              <h3>Trouble Words Bank &amp; Evolution</h3>
              <p className="panel-desc">
                Tracks words that caused difficulty, their score changes from first take to latest, and their weak phonemes.
              </p>
            </div>

            <div className="words-filter-chips">
              <button
                className={`filter-chip ${wordFilter === 'all' ? 'active' : ''}`}
                onClick={() => setWordFilter('all')}
              >
                All ({stats.troubleWords.length})
              </button>
              <button
                className={`filter-chip ${wordFilter === 'struggles' ? 'active' : ''}`}
                onClick={() => setWordFilter('struggles')}
              >
                Struggles
              </button>
              <button
                className={`filter-chip ${wordFilter === 'improving' ? 'active' : ''}`}
                onClick={() => setWordFilter('improving')}
              >
                Improving
              </button>
              <button
                className={`filter-chip ${wordFilter === 'mastered' ? 'active' : ''}`}
                onClick={() => setWordFilter('mastered')}
              >
                Mastered
              </button>
            </div>
          </div>

          {visibleWords.length > 0 ? (
            <div className="words-table-container">
              <table className="words-progress-table">
                <thead>
                  <tr>
                    <th>Word</th>
                    <th>IPA</th>
                    <th>First Score</th>
                    <th>Score Progression</th>
                    <th>Latest Score</th>
                    <th>Weak Sounds</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleWords.map((word) => (
                    <tr key={word.word}>
                      <td className="word-name-cell">
                        <strong>{word.display}</strong>
                        <span className="word-attempts-sub">
                          {word.totalAttempts} attempt{word.totalAttempts === 1 ? '' : 's'}
                        </span>
                      </td>
                      <td className="word-ipa-cell">/{word.ipa}/</td>
                      <td className="word-score-cell">
                        <span className={`take-score-pill ${band(word.firstScore)}`}>
                          {word.firstScore}
                        </span>
                      </td>
                      <td className="word-progression-cell">
                        <div className="progression-flex">
                          <span>{word.firstScore}</span>
                          <span className="arrow-prog">→</span>
                          <strong>{word.lastScore}</strong>
                          {word.scoreDelta !== 0 && (
                            <span className={`delta-tag ${word.scoreDelta > 0 ? 'up' : 'down'}`}>
                              {word.scoreDelta > 0 ? `+${word.scoreDelta}` : word.scoreDelta}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="word-score-cell">
                        <span className={`take-score-pill ${band(word.lastScore)}`}>
                          {word.lastScore}
                        </span>
                      </td>
                      <td className="word-sounds-cell">
                        {word.weakPhones.map((p) => (
                          <span key={p.phone} className="weak-phone-chip">
                            /{p.phone}/
                          </span>
                        ))}
                      </td>
                      <td className="word-status-cell">
                        <span className={`status-badge ${word.status}`}>
                          {word.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="word-action-cell">
                        <button
                          className="ghost-btn tiny"
                          onClick={() => {
                            const entry = struggles.find((e) => e.word === word.word)
                            if (entry) {
                              practiseWord(entry)
                              onNavigateToPractice()
                            }
                          }}
                          title={`Practise "${word.display}" in Practice Studio`}
                        >
                          Practise
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="panel-empty-notice">No trouble words matching this filter.</div>
          )}
        </section>
      )}

      {/* TAB CONTENT 5: CHRONOLOGICAL RECORDING TIMELINE LOG */}
      {activeTab === 'timeline' && (
        <section className="stats-panel-card">
          <div className="panel-card-header">
            <h3>Timestamped Recording History</h3>
            <p className="panel-desc">
              Every take recorded with its date, exact time, overall score, audio playback, and detected phonetic issues.
            </p>
          </div>

          <div className="timeline-log-list">
            {[...stats.timelinePoints].reverse().map((point) => {
              const hasClip = clips.has(point.at)
              const isPlaying = playingClipAt === point.at

              return (
                <div key={`${point.at}-${point.index}`} className="timeline-log-row">
                  <div className="log-stamp-col">
                    <span className="log-date">{point.formattedDate}</span>
                    <span className="log-time">{point.formattedTime}</span>
                    {point.scorer && <span className="log-scorer-tag">{point.scorer.toUpperCase()}</span>}
                  </div>

                  <div className="log-score-col">
                    <span className={`take-score-pill ${band(point.score)}`}>
                      {point.score}
                    </span>
                  </div>

                  <div className="log-content-col">
                    <div className="log-target-text">"{point.target}"</div>
                    {(point.wrongSounds.length > 0 || point.missingSounds.length > 0) && (
                      <div className="log-issues-row">
                        {point.wrongSounds.map((s) => (
                          <span key={s} className="log-error-pill wrong" title={`Wrong sound: /${s}/`}>
                            /{s}/ wrong
                          </span>
                        ))}
                        {point.missingSounds.map((s) => (
                          <span key={s} className="log-error-pill missing" title={`Dropped sound: /${s}/`}>
                            /{s}/ dropped
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="log-controls-col">
                    {hasClip && (
                      <button
                        className={`clip-play-btn ${isPlaying ? 'playing' : ''}`}
                        onClick={() => void togglePlayClip(point.at)}
                        title={isPlaying ? 'Pause audio take' : 'Play audio take'}
                      >
                        {isPlaying ? '⏸ Pause' : '▶ Play'}
                      </button>
                    )}
                    <button
                      className="ghost-btn tiny"
                      onClick={() => {
                        void reopen(point.index)
                        onNavigateToPractice()
                      }}
                      title="Load this take into Practice Studio"
                    >
                      Studio ↗
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* RESET CONFIRMATION MODAL */}
      {showResetConfirm && (
        <div className="stats-modal-backdrop" onClick={() => setShowResetConfirm(false)}>
          <div className="stats-reset-modal" onClick={(e) => e.stopPropagation()}>
            <div className="stats-reset-modal-header">
              <span className="reset-modal-icon">⚠️</span>
              <div>
                <h3>Delete History &amp; Start Over</h3>
                <p className="reset-modal-subtitle">
                  Choose how much data you want to clear. This action is permanent.
                </p>
              </div>
            </div>

            <div className="stats-reset-cards">
              <div className="reset-card">
                <div className="reset-card-info">
                  <strong>Clear Practice Takes Only</strong>
                  <p>
                    Deletes all {attempts.length} recorded take{attempts.length === 1 ? '' : 's'}, audio clips, and stats timeline. Keeps your Trouble Words Bank and Daily Practice streak.
                  </p>
                </div>
                <button
                  className="ghost-btn danger-text-btn"
                  onClick={() => {
                    practice.resetAllData(false)
                    setShowResetConfirm(false)
                  }}
                >
                  Clear Takes ({attempts.length})
                </button>
              </div>

              <div className="reset-card danger-card">
                <div className="reset-card-info">
                  <strong>Complete Factory Reset (Start Over Fresh)</strong>
                  <p>
                    Wipes everything: all {attempts.length} recorded takes, all saved audio, trouble words bank ({struggles.length} words), and daily practice history. Returns app to a brand new state.
                  </p>
                </div>
                <button
                  className="primary danger-btn"
                  onClick={() => {
                    practice.resetAllData(true)
                    setShowResetConfirm(false)
                  }}
                >
                  Wipe Everything &amp; Start Over
                </button>
              </div>
            </div>

            <div className="stats-reset-modal-footer">
              <button className="ghost-btn" onClick={() => setShowResetConfirm(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Responsive SVG chart for chronological score progression.
 */
function ScoreProgressionChart({ points }: { points: { at: number; score: number; rollingAvg: number; target: string; formattedDate: string }[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  if (points.length === 0) return null

  const width = 800
  const height = 240
  const padding = { top: 20, right: 30, bottom: 40, left: 40 }

  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const minScore = 0
  const maxScore = 100

  const getX = (i: number) => {
    if (points.length === 1) return padding.left + chartW / 2
    return padding.left + (i / (points.length - 1)) * chartW
  }

  const getY = (score: number) => {
    return padding.top + chartH - ((score - minScore) / (maxScore - minScore)) * chartH
  }

  // Generate path for rolling average curve
  const rollingPath = points.length > 1
    ? points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(p.rollingAvg)}`).join(' ')
    : ''

  const hoveredPoint = hoveredIndex !== null ? points[hoveredIndex] : null

  return (
    <div className="svg-chart-wrapper">
      <svg viewBox={`0 0 ${width} ${height}`} className="score-progression-svg" preserveAspectRatio="none">
        {/* Grid lines */}
        {[85, 65, 50].map((yVal) => (
          <g key={yVal} className="grid-group">
            <line
              x1={padding.left}
              y1={getY(yVal)}
              x2={padding.left + chartW}
              y2={getY(yVal)}
              stroke="var(--line)"
              strokeDasharray={yVal === 85 ? '4 4' : '2 2'}
              strokeWidth={yVal === 85 ? 1.5 : 1}
            />
            <text
              x={padding.left - 8}
              y={getY(yVal) + 4}
              textAnchor="end"
              className="axis-label"
              fontSize="10"
              fill="var(--ink-faint)"
            >
              {yVal}
            </text>
          </g>
        ))}

        {/* 85 Mastery threshold label */}
        <text
          x={padding.left + chartW - 5}
          y={getY(85) - 6}
          textAnchor="end"
          fontSize="10"
          fill="var(--good)"
          fontWeight="600"
        >
          Mastery Target (85)
        </text>

        {/* Rolling Average Curve */}
        {rollingPath && (
          <path
            d={rollingPath}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Attempt Points */}
        {points.map((p, i) => {
          const cx = getX(i)
          const cy = getY(p.score)
          const isHovered = hoveredIndex === i

          return (
            <circle
              key={p.at}
              cx={cx}
              cy={cy}
              r={isHovered ? 7 : 4}
              fill={p.score >= 85 ? 'var(--good)' : p.score >= 65 ? 'var(--ok)' : 'var(--poor)'}
              stroke="var(--bg-panel)"
              strokeWidth={isHovered ? 2 : 1}
              className="chart-data-dot"
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          )
        })}
      </svg>

      {/* Interactive Tooltip */}
      {hoveredPoint && (
        <div className="chart-tooltip-bubble">
          <div className="tooltip-header">
            <span className="tooltip-date">{hoveredPoint.formattedDate}</span>
            <span className={`tooltip-score ${band(hoveredPoint.score)}`}>
              {hoveredPoint.score} pts
            </span>
          </div>
          <div className="tooltip-phrase">"{hoveredPoint.target}"</div>
          <div className="tooltip-avg">5-take rolling average: {hoveredPoint.rollingAvg}</div>
        </div>
      )}
    </div>
  )
}
