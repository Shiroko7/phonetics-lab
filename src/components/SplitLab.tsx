import { useState } from 'react'
import type { Dictionary } from '../lib/dict.ts'
import type { DisplayOptions } from '../lib/display.ts'
import type { Voice } from '../lib/speech.ts'
import type { AnalyzedToken, Stats } from '../lib/analyze.ts'
import type { Annotation } from './Reading.tsx'
import type { PracticeState } from '../lib/usePracticeState.ts'
import { ActiveDrillBanner } from './shared/ActiveDrillBanner.tsx'
import { AudioTransport } from './shared/AudioTransport.tsx'
import { WordDiagnostics } from './shared/WordDiagnostics.tsx'
import { TroubleBankPanel } from './shared/TroubleBankPanel.tsx'
import { DrillsPanel } from './shared/DrillsPanel.tsx'
import { HistoryPanel } from './shared/HistoryPanel.tsx'
import { PhoneticLookup } from './shared/PhoneticLookup.tsx'
import { SettingsDrawer } from './shared/SettingsDrawer.tsx'
import { Vowels } from './Vowels.tsx'
import { formatIPA } from '../lib/display.ts'

interface Props {
  view: 'practice' | 'lookup' | 'vowels'
  setView: (v: 'practice' | 'lookup' | 'vowels') => void
  practice: PracticeState
  // Lookup props
  text: string
  setText: (t: string) => void
  tokens: AnalyzedToken[]
  stats: Stats
  annotation: Annotation
  setAnnotation: (a: Annotation) => void
  readingAloud: boolean
  toggleReadAloud: () => void
  // Speech & settings
  display: DisplayOptions
  setDisplay: (d: DisplayOptions) => void
  preferRecording: boolean
  setPreferRecording: (p: boolean) => void
  rate: number
  setRate: (r: number) => void
  voices: Voice[]
  voiceURI: string
  onVoice: (v: string) => void
  onPreviewVoice: () => void
  onSay: (word: string) => void
  onPractisePhone: (phone: string) => void
  dict: Dictionary
}

type RightDeckTab = 'diagnostics' | 'trouble' | 'drills' | 'history'

export function SplitLab({
  view,
  setView,
  practice,
  text,
  setText,
  tokens,
  stats,
  annotation,
  setAnnotation,
  readingAloud,
  toggleReadAloud,
  display,
  setDisplay,
  preferRecording,
  setPreferRecording,
  rate,
  setRate,
  voices,
  voiceURI,
  onVoice,
  onPreviewVoice,
  onSay,
  onPractisePhone,
  dict,
}: Props) {
  const [rightDeckTab, setRightDeckTab] = useState<RightDeckTab>('diagnostics')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const {
    mode,
    setMode,
    target,
    editTarget,
    sentences,
    expectedIPA,
    silence,
    setAligned,
    setHeard,
    setPlayback,
    setEditing,
    setTarget,
    struggles,
    weak,
    attempts,
    score,
    setLine,
  } = practice

  return (
    <div className="split-root">
      {/* COMPACT TOP NAVIGATION BAR */}
      <header className="split-topbar">
        <div className="split-brand">
          <span className="split-brand-icon">⚡</span>
          <div className="split-brand-info">
            <span className="split-brand-name">Phonetics Lab</span>
            <span className="split-brand-tagline">General American IPA</span>
          </div>
        </div>

        <nav className="split-nav-tabs">
          <button
            className={`split-tab-btn ${view === 'practice' ? 'active' : ''}`}
            onClick={() => setView('practice')}
          >
            Practice Studio
          </button>
          <button
            className={`split-tab-btn ${view === 'lookup' ? 'active' : ''}`}
            onClick={() => setView('lookup')}
          >
            Phonetic Lookup
          </button>
          <button
            className={`split-tab-btn ${view === 'vowels' ? 'active' : ''}`}
            onClick={() => setView('vowels')}
          >
            Vowel Chart
          </button>
        </nav>

        <div className="split-topbar-right">
          {dict && (
            <span className="dict-badge" title="CMU Pronouncing Dictionary loaded">
              {dict.size.toLocaleString()} words
            </span>
          )}
          <button
            className="split-settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="Open Audio & Speech Settings"
          >
            ⚙️ Settings
          </button>
        </div>
      </header>

      {/* DUAL DECK WORKSPACE */}
      <main className="split-stage-container">
        {view === 'practice' && (
          <div className="split-decks-grid">
            {/* LEFT DECK: INPUT, PROMPT & AUDIO CAPTURE */}
            <section className="deck-column left-deck">
              <div className="deck-header">
                <div className="deck-title">
                  <span className="deck-num">1</span>
                  <h3>Target &amp; Recording</h3>
                </div>

                <div className="mode-segmented-pill">
                  <button
                    className={`segmented-btn ${mode === 'scripted' ? 'active' : ''}`}
                    onClick={() => {
                      setMode('scripted')
                      setAligned(null)
                      setHeard([])
                    }}
                  >
                    Scripted
                  </button>
                  <button
                    className={`segmented-btn ${mode === 'free' ? 'active' : ''}`}
                    onClick={() => {
                      setMode('free')
                      setAligned(null)
                      setHeard([])
                      setTarget('')
                    }}
                  >
                    Free Speech
                  </button>
                </div>
              </div>

              <div className="deck-body">
                <ActiveDrillBanner practice={practice} compact />

                {/* Sentence switcher pills */}
                {mode === 'scripted' && sentences.length > 1 && (
                  <div className="split-sentence-bar">
                    <span className="bar-label">Phrases:</span>
                    <div className="sentence-scroll-row">
                      {sentences.map((s, i) => (
                        <button
                          key={i}
                          className={`sentence-mini-chip ${s === target ? 'active' : ''}`}
                          onClick={() => {
                            silence()
                            setTarget(s)
                            setAligned(null)
                            setHeard([])
                            setPlayback(null)
                            setEditing(null)
                          }}
                          title={s}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Prompt textarea & Expected IPA */}
                <div className="split-target-box">
                  <textarea
                    className="split-target-textarea"
                    value={target}
                    onChange={(e) => editTarget(e.target.value)}
                    placeholder={
                      mode === 'free'
                        ? 'Press record and speak. Detected words appear here...'
                        : 'Type or choose words to practise...'
                    }
                    rows={3}
                  />
                  {expectedIPA && (
                    <div className="split-target-ipa">
                      <span className="ipa-label">TARGET IPA</span>
                      <span className="ipa-text">/{formatIPA(expectedIPA, display)}/</span>
                    </div>
                  )}
                </div>

                {/* Audio Recording & Reference Transport */}
                <div className="split-transport-wrap">
                  <AudioTransport practice={practice} size="normal" />
                </div>

                {/* Quick launch trouble chips */}
                {struggles.length > 0 && (
                  <div className="split-quick-trouble-tray">
                    <span className="tray-label">Quick load trouble word:</span>
                    <div className="trouble-chips-wrap">
                      {struggles.slice(0, 8).map((entry) => (
                        <button
                          key={entry.word}
                          className="trouble-quick-chip"
                          onClick={() => setLine(entry.display)}
                          title={`Load "${entry.display}" into practice`}
                        >
                          {entry.display}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* RIGHT DECK: ACOUSTIC DIAGNOSTICS & COMPARISON */}
            <section className="deck-column right-deck">
              <div className="deck-header">
                <div className="deck-title">
                  <span className="deck-num">2</span>
                  <h3>Diagnostics &amp; Analysis</h3>
                </div>

                <div className="right-deck-tabs">
                  <button
                    className={`deck-tab ${rightDeckTab === 'diagnostics' ? 'active' : ''}`}
                    onClick={() => setRightDeckTab('diagnostics')}
                  >
                    Analysis {score && `(${score.overall})`}
                  </button>
                  <button
                    className={`deck-tab ${rightDeckTab === 'trouble' ? 'active' : ''}`}
                    onClick={() => setRightDeckTab('trouble')}
                  >
                    Trouble ({struggles.length})
                  </button>
                  <button
                    className={`deck-tab ${rightDeckTab === 'drills' ? 'active' : ''}`}
                    onClick={() => setRightDeckTab('drills')}
                  >
                    Drills {weak.length > 0 && `(${weak.length})`}
                  </button>
                  <button
                    className={`deck-tab ${rightDeckTab === 'history' ? 'active' : ''}`}
                    onClick={() => setRightDeckTab('history')}
                  >
                    History ({attempts.length})
                  </button>
                </div>
              </div>

              <div className="deck-body">
                {rightDeckTab === 'diagnostics' && (
                  <>
                    {score ? (
                      <WordDiagnostics practice={practice} />
                    ) : (
                      <div className="right-deck-idle-state">
                        <div className="idle-hero-icon">🎧</div>
                        <h4>Ready for audio</h4>
                        <p>
                          Record your take on the left deck. Instant phoneme-by-phoneme alignment and articulatory scoring will appear here.
                        </p>
                        {weak.length > 0 && (
                          <div className="idle-weak-preview">
                            <span className="preview-label">Your weak sounds:</span>
                            <div className="preview-chips">
                              {weak.map((w) => (
                                <span key={w.phone} className="preview-sound-tag">
                                  /{w.phone}/ ({Math.round(w.errorRate * 100)}% off)
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {rightDeckTab === 'trouble' && (
                  <TroubleBankPanel practice={practice} layout="compact" />
                )}

                {rightDeckTab === 'drills' && (
                  <DrillsPanel practice={practice} layout="compact" />
                )}

                {rightDeckTab === 'history' && (
                  <HistoryPanel practice={practice} layout="compact" />
                )}
              </div>
            </section>
          </div>
        )}

        {view === 'lookup' && (
          <div className="split-lookup-wrapper">
            <PhoneticLookup
              text={text}
              setText={setText}
              tokens={tokens}
              stats={stats}
              display={display}
              annotation={annotation}
              setAnnotation={setAnnotation}
              onSay={onSay}
              readingAloud={readingAloud}
              toggleReadAloud={toggleReadAloud}
              preferRecording={preferRecording}
              layout="split"
            />
          </div>
        )}

        {view === 'vowels' && (
          <div className="split-vowels-wrapper">
            <Vowels
              dict={dict}
              attempts={attempts}
              onPlay={onSay}
              onPractise={onPractisePhone}
            />
          </div>
        )}
      </main>

      {/* SETTINGS DRAWER */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        display={display}
        onDisplay={setDisplay}
        preferRecording={preferRecording}
        onPreferRecording={setPreferRecording}
        rate={rate}
        onRate={setRate}
        voices={voices}
        voiceURI={voiceURI}
        onVoice={onVoice}
        onPreviewVoice={onPreviewVoice}
      />
    </div>
  )
}
