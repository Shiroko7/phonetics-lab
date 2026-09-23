import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze } from './lib/analyze.ts'
import { loadDictionary, type Dictionary } from './lib/dict.ts'
import { DEFAULT_DISPLAY, type DisplayOptions } from './lib/display.ts'
import {
  onVoicesReady,
  pronounce,
  stop,
  synthesise,
  warmUp,
  defaultVoice,
  isBrianVoice,
  type Voice,
} from './lib/speech.ts'
import type { Annotation } from './components/Reading.tsx'
import { HISTORY_BACKUP_KEY, HISTORY_KEY, loadAttempts, saveAttempts, type Attempt } from './lib/practice.ts'
import { clearClips, deleteClip } from './lib/clips.ts'
import { mergeAssessment, preserveAssessment } from './lib/assessmentHistory.ts'
import { usePracticeState } from './lib/usePracticeState.ts'
import { SplitLab } from './components/SplitLab.tsx'
import { useVoicePreferences } from './lib/useVoicePreferences.ts'
import { isExcluded, loadVoicePreferences } from './lib/voicePreferences.ts'

const VOICE_KEY = 'phonetics-lab:voice'
// Apply the new default once; later explicit choices still persist normally.
const VOICE_POLICY_KEY = 'phonetics-lab:voice-policy'
const VOICE_POLICY = 'brian-default-v1'

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
    // optional persistence
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

  // Default view is Practice (Speaking Studio)
  const [view, setView] = useState<'practice' | 'daily' | 'lookup' | 'vowels' | 'stats'>('practice')

  const [drillSound, setDrillSound] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts())
  const attemptsRef = useRef(attempts)
  const persistedHistoryRef = useRef<string | null | undefined>(undefined)
  if (persistedHistoryRef.current === undefined) persistedHistoryRef.current = readStored(HISTORY_KEY)
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceURI, setVoiceURI] = useState('')
  const [readingAloud, setReadingAloud] = useState(false)
  const [voicePreferences] = useVoicePreferences()
  const voiceAllowed = voices.some((voice) => voice.uri === voiceURI && !isExcluded(voice, voicePreferences))

  useEffect(() => {
    loadDictionary(({ loaded, total }) => setProgress(total ? loaded / total : 0))
      .then(setDict)
      .catch((err: Error) => setError(err.message))
  }, [])

  useEffect(() => {
    return onVoicesReady((available) => {
      setVoices(available)
      setVoiceURI(() => {
        const preferences = loadVoicePreferences()
        const allowed = available.filter((voice) => !isExcluded(voice, preferences))
        const saved = readStored(VOICE_POLICY_KEY) === VOICE_POLICY ? readStored(VOICE_KEY) : null
        if (saved && allowed.some((v) => v.uri === saved)) return saved
        const preferred = defaultVoice(allowed)
        if (preferred && isBrianVoice(preferred) && !saved) {
          writeStored(VOICE_KEY, preferred.uri)
          writeStored(VOICE_POLICY_KEY, VOICE_POLICY)
        }
        return preferred?.uri ?? ''
      })
    })
  }, [])

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
    writeStored(VOICE_POLICY_KEY, VOICE_POLICY)
  }, [])

  useEffect(() => {
    const selected = voices.find((voice) => voice.uri === voiceURI)
    if ((selected && isExcluded(selected, voicePreferences)) || (!voiceURI && voices.length)) {
      chooseVoice(defaultVoice(voices.filter((voice) => !isExcluded(voice, voicePreferences)))?.uri ?? '')
    }
  }, [voicePreferences, voices, voiceURI, chooseVoice])

  const analysis = useMemo(() => (dict ? analyze(text, dict) : null), [text, dict])

  const say = useCallback(
    (word: string) => {
      if (voiceAllowed) pronounce(word, { preferRecording, rate, voiceURI })
    },
    [preferRecording, rate, voiceURI, voiceAllowed],
  )

  const previewVoice = useCallback(() => {
    if (voiceAllowed) synthesise('The quick brown fox jumps over the lazy dog.', { rate, voiceURI })
  }, [rate, voiceURI, voiceAllowed])

  const toggleReadAloud = useCallback(() => {
    if (readingAloud) {
      stop()
      setReadingAloud(false)
      return
    }
    if (!voiceAllowed) return
    setReadingAloud(true)
    synthesise(text, { rate, voiceURI, onEnd: () => setReadingAloud(false) })
  }, [readingAloud, text, rate, voiceURI, voiceAllowed])

  const persistAttempts = useCallback((next: Attempt[]) => {
    if (localStorage.getItem(HISTORY_KEY) !== persistedHistoryRef.current) {
      throw new Error('History changed in another tab. Reload this page before continuing; the newer saved history was not overwritten.')
    }
    if (!saveAttempts(next)) throw new Error('Browser storage is full or blocked. The previous saved history was kept; export a backup before freeing space.')
    persistedHistoryRef.current = localStorage.getItem(HISTORY_KEY)
    attemptsRef.current = next
    setAttempts(next)
  }, [])

  const recordAttempt = useCallback((attempt: Attempt, replaceAt?: number) => {
    const previous = attemptsRef.current
    if (replaceAt !== undefined) {
      const original = previous.find(a => a.at === attempt.at)
      if (!original) throw new Error('This recording was deleted while analysis was running; it was not restored.')
      persistAttempts(previous.map(a => a.at === attempt.at ? preserveAssessment(original, attempt, 'text-edit') : a))
    } else persistAttempts([...previous, attempt])
  }, [persistAttempts])

  const updateAssessment = useCallback((before: Attempt, updated: Attempt): boolean => {
    const current = attemptsRef.current
    const next = mergeAssessment(current, before, updated)
    if (next === current) return false
    persistAttempts(next)
    return true
  }, [persistAttempts])

  const deleteAttempt = useCallback((index: number) => {
    const previous = attemptsRef.current, removed = previous[index]
    if (!removed) return
    try {
      persistAttempts(previous.filter((_, i) => i !== index))
      void deleteClip(removed.at)
    } catch (err) { setError((err as Error).message) }
  }, [persistAttempts])

  const clearHistory = useCallback(() => {
    try { persistAttempts([]); localStorage.removeItem(HISTORY_BACKUP_KEY); void clearClips() }
    catch (err) { setError((err as Error).message) }
  }, [persistAttempts])

  // Practice controller hook
  const practice = usePracticeState({
    text,
    dict,
    display,
    attempts,
    drill: drillSound,
    onDrillStarted: () => setDrillSound(null),
    onAttempt: recordAttempt,
    onAssessment: updateAssessment,
    onClearHistory: clearHistory,
    onDeleteAttempt: deleteAttempt,
    onSpeak: (phrase, onEnd, onError) => {
      if (!voiceAllowed) { onError?.('No allowed voice is available. Restore a speaker in voice settings.'); return }
      synthesise(phrase, { rate, voiceURI, onEnd, onError })
    },
  })

  return (
    <div className="app">
      {error && (
        <div className="panel error" style={{ margin: '20px auto', maxWidth: 800 }}>
          {error}
        </div>
      )}

      {!dict && !error && (
        <div className="loading" style={{ margin: '60px auto' }}>
          <span>Loading pronunciation dictionary…</span>
          <span className="bar">
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        </div>
      )}

      {dict && analysis && (
        <SplitLab
          view={view}
          setView={setView}
          practice={practice}
          text={text}
          setText={setText}
          tokens={analysis.tokens}
          stats={analysis.stats}
          annotation={annotation}
          setAnnotation={setAnnotation}
          readingAloud={readingAloud}
          toggleReadAloud={toggleReadAloud}
          display={display}
          setDisplay={setDisplay}
          preferRecording={preferRecording}
          setPreferRecording={setPreferRecording}
          rate={rate}
          setRate={setRate}
          voices={voices}
          voiceURI={voiceURI}
          onVoice={chooseVoice}
          onPreviewVoice={previewVoice}
          onSay={say}
          onPractisePhone={(phone) => {
            setDrillSound(phone)
            setView('practice')
          }}
          dict={dict}
        />
      )}
    </div>
  )
}
