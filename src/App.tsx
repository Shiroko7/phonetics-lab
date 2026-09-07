import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze, toIPAText } from './lib/analyze.ts'
import { loadDictionary, type Dictionary } from './lib/dict.ts'
import { DEFAULT_DISPLAY, type DisplayOptions } from './lib/display.ts'
import {
  onVoicesReady,
  prefetchRecording,
  pronounce,
  stop,
  supportsSpeech,
  synthesise,
  warmUp,
  type Voice,
} from './lib/speech.ts'
import { Reading, type Annotation } from './components/Reading.tsx'
import { WordCard } from './components/WordCard.tsx'
import { Controls, PhoneKey, StatsPanel } from './components/Sidebar.tsx'
import { Practice } from './components/Practice.tsx'
import { Vowels } from './components/Vowels.tsx'
import { loadAttempts, saveAttempts, type Attempt } from './lib/practice.ts'
import { clearClips, deleteClip } from './lib/clips.ts'

const SAMPLE = `The rough coughing ploughman thought it through: though a colonel's schedule \
is thorough, the squirrel's laughter echoed. Phonetics reveals that "read" and "read" are \
spelled alike yet sound apart — 1,250 words later, you have debuggable knowledge.`

/** How long the card survives after the pointer leaves, so it can be reached. */
const CARD_GRACE_MS = 140

const VOICE_KEY = 'phonetics-lab:voice'

/** localStorage is unavailable in private windows and when site data is blocked. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A remembered voice is a convenience, not a requirement.
  }
}

export default function App() {
  const [text, setText] = useState('')
  const [dict, setDict] = useState<Dictionary | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [display, setDisplay] = useState<DisplayOptions>(DEFAULT_DISPLAY)
  const [annotation, setAnnotation] = useState<Annotation>('none')
  const [preferRecording, setPreferRecording] = useState(false)
  const [rate, setRate] = useState(1)
  const [view, setView] = useState<'read' | 'practice' | 'vowels'>('read')
  /** A sound sent over from the vowel chart, for Practise to open a drill on. */
  const [drillSound, setDrillSound] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts())
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceURI, setVoiceURI] = useState('')

  const [hover, setHover] = useState<{ index: number; rect: DOMRect } | null>(null)
  const [speaking, setSpeaking] = useState<string | null>(null)
  const [readingAloud, setReadingAloud] = useState(false)
  const [copied, setCopied] = useState(false)

  const hideTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    loadDictionary(({ loaded, total }) => setProgress(total ? loaded / total : 0))
      .then(setDict)
      .catch((err: Error) => setError(err.message))
  }, [])

  // Voices arrive asynchronously in Chromium browsers, so the list is filled in
  // from an event rather than read once. A previous choice is restored if the
  // same voice is still installed.
  useEffect(() => {
    return onVoicesReady((available) => {
      setVoices(available)
      setVoiceURI((current) => {
        if (current && available.some((v) => v.uri === current)) return current
        const saved = readStored(VOICE_KEY)
        if (saved && available.some((v) => v.uri === saved)) return saved
        return available[0]?.uri ?? ''
      })
    })
  }, [])

  // Prime the speech engine on the first interaction so the first word the
  // reader clicks does not pay for engine (or cloud connection) start-up.
  useEffect(() => {
    const prime = () => warmUp()
    window.addEventListener('pointerdown', prime, { once: true })
    window.addEventListener('keydown', prime, { once: true })
    return () => {
      window.removeEventListener('pointerdown', prime)
      window.removeEventListener('keydown', prime)
    }
  }, [])

  const chooseVoice = useCallback((uri: string) => {
    setVoiceURI(uri)
    writeStored(VOICE_KEY, uri)
  }, [])

  const analysis = useMemo(() => (dict ? analyze(text, dict) : null), [text, dict])

  // Read by the hover handler, which should not be rebuilt on every keystroke.
  const analysisRef = useRef(analysis)
  analysisRef.current = analysis

  // Synchronous: speech starts on the click itself, with no network in between.
  const say = useCallback(
    (word: string) => {
      setSpeaking(word)
      pronounce(word, { preferRecording, rate, voiceURI })
      window.setTimeout(() => setSpeaking((w) => (w === word ? null : w)), 700)
    },
    [preferRecording, rate, voiceURI],
  )

  const previewVoice = useCallback(() => {
    synthesise('The quick brown fox jumps over the lazy dog.', { rate, voiceURI })
  }, [rate, voiceURI])

  const handleHover = useCallback(
    (index: number | null, rect: DOMRect | null) => {
      window.clearTimeout(hideTimer.current)
      if (index === null || !rect) {
        hideTimer.current = window.setTimeout(() => setHover(null), CARD_GRACE_MS)
        return
      }
      setHover({ index, rect })
      // Start fetching a recording while the card is open, so that by the time
      // the word is actually clicked the audio is already in hand.
      if (preferRecording) {
        const word = analysisRef.current?.tokens[index]?.pron?.word
        if (word) prefetchRecording(word)
      }
    },
    [preferRecording],
  )

  const keepCard = useCallback(() => window.clearTimeout(hideTimer.current), [])
  const releaseCard = useCallback(() => {
    hideTimer.current = window.setTimeout(() => setHover(null), CARD_GRACE_MS)
  }, [])

  const handleSelect = useCallback(
    (index: number) => {
      const pron = analysis?.tokens[index]?.pron
      if (pron) void say(pron.word)
    },
    [analysis, say],
  )

  const toggleReadAloud = useCallback(() => {
    if (readingAloud) {
      stop()
      setReadingAloud(false)
      return
    }
    setReadingAloud(true)
    synthesise(text, { rate, voiceURI, onEnd: () => setReadingAloud(false) })
  }, [readingAloud, text, rate, voiceURI])

  // `replaceAt` covers correcting a transcript: it is the same recording
  // re-scored against better words, not a separate attempt. It names an index
  // rather than meaning "the last one", because the attempt being corrected may
  // be an older one the user has gone back to.
  const recordAttempt = useCallback((attempt: Attempt, replaceAt?: number) => {
    setAttempts((previous) => {
      const next =
        replaceAt !== undefined && replaceAt >= 0 && replaceAt < previous.length
          ? previous.map((existing, i) => (i === replaceAt ? attempt : existing))
          : [...previous, attempt]
      saveAttempts(next)
      return next
    })
  }, [])

  // Re-scoring the history rewrites many attempts at once, so it replaces the
  // whole list rather than going through `recordAttempt` per entry — sixteen
  // separate writes would each save the array again and race each other.
  const replaceAttempts = useCallback((next: Attempt[]) => {
    setAttempts(next)
    saveAttempts(next)
  }, [])

  const deleteAttempt = useCallback((index: number) => {
    setAttempts((previous) => {
      const removed = previous[index]
      if (!removed) return previous
      const next = previous.filter((_, i) => i !== index)
      saveAttempts(next)
      void deleteClip(removed.at)
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setAttempts([])
    saveAttempts([])
    void clearClips()
  }, [])

  const copyIPA = async () => {
    if (!analysis) return
    await navigator.clipboard.writeText(toIPAText(analysis.tokens, display))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const hovered = hover !== null ? analysis?.tokens[hover.index]?.pron ?? null : null

  return (
    <div className="app">
      <header className="masthead">
        <h1>Phonetics Lab</h1>
        <span className="tagline">General American IPA · hover any word</span>
        <span className="spacer" />
        {dict && (
          <div className="view-switch" role="group" aria-label="View">
            <button className={view === 'read' ? 'on' : ''} onClick={() => setView('read')}>
              Read
            </button>
            <button className={view === 'practice' ? 'on' : ''} onClick={() => setView('practice')}>
              Practise
            </button>
            <button className={view === 'vowels' ? 'on' : ''} onClick={() => setView('vowels')}>
              Vowels
            </button>
          </div>
        )}
        {dict && <span className="tagline">{dict.size.toLocaleString()} words offline</span>}
      </header>

      {error && (
        <div className="panel error" style={{ marginTop: 20 }}>
          {error} — run <code>npm run dict</code> to build the dictionary, then reload.
        </div>
      )}

      {!dict && !error && (
        <div className="loading">
          <span>Loading pronunciation dictionary…</span>
          <span className="bar">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        </div>
      )}

      {dict && analysis && (
        <div className="columns">
          {view === 'practice' ? (
            <Practice
              text={text}
              dict={dict}
              display={display}
              attempts={attempts}
              drill={drillSound}
              onDrillStarted={() => setDrillSound(null)}
              onAttempt={recordAttempt}
              onReplaceAttempts={replaceAttempts}
              onClearHistory={clearHistory}
              onDeleteAttempt={deleteAttempt}
              onSpeak={(phrase, onEnd) => synthesise(phrase, { rate, voiceURI, onEnd })}
            />
          ) : view === 'vowels' ? (
            <Vowels
              dict={dict}
              attempts={attempts}
              onPlay={say}
              onPractise={(phone) => {
                setDrillSound(phone)
                setView('practice')
              }}
            />
          ) : (
          <div className="main-column">
            <div className="panel composer">
              <h3 className="panel-title">Your text</h3>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste any English text here…"
                spellCheck={false}
              />
              <div className="composer-actions">
                <button onClick={() => setText(SAMPLE)}>Try a sample</button>
                <button className="ghost" onClick={() => setText('')} disabled={!text}>
                  Clear
                </button>
                <span className="spacer" style={{ flex: 1 }} />
                <button onClick={copyIPA} disabled={!analysis.stats.words}>
                  {copied ? 'Copied' : 'Copy as IPA'}
                </button>
                <button onClick={toggleReadAloud} disabled={!text || !supportsSpeech()}>
                  {readingAloud ? 'Stop' : 'Read aloud'}
                </button>
              </div>
            </div>

            <Reading
              tokens={analysis.tokens}
              display={display}
              annotation={annotation}
              activeIndex={hover?.index ?? null}
              speaking={speaking}
              onHover={handleHover}
              onSelect={handleSelect}
            />
          </div>
          )}

          <aside className="sidebar">
            <StatsPanel stats={analysis.stats} />
            <Controls
              display={display}
              onDisplay={setDisplay}
              annotation={annotation}
              onAnnotation={setAnnotation}
              preferRecording={preferRecording}
              onPreferRecording={setPreferRecording}
              rate={rate}
              onRate={setRate}
              voices={voices}
              voiceURI={voiceURI}
              onVoice={chooseVoice}
              onPreviewVoice={previewVoice}
            />
            <PhoneKey onPlay={say} />
          </aside>
        </div>
      )}

      {hovered && hover && (
        <WordCard
          pron={hovered}
          anchor={hover.rect}
          display={display}
          onPlay={say}
          onEnter={keepCard}
          onLeave={releaseCard}
        />
      )}
    </div>
  )
}
