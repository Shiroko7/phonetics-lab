import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { loadAttempts, saveAttempts, type Attempt } from './lib/practice.ts'
import { clearClips, deleteClip } from './lib/clips.ts'
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
  const [view, setView] = useState<'practice' | 'daily' | 'lookup' | 'vowels'>('practice')

  const [drillSound, setDrillSound] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts())
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

  // Practice controller hook
  const practice = usePracticeState({
    text,
    dict,
    display,
    attempts,
    drill: drillSound,
    onDrillStarted: () => setDrillSound(null),
    onAttempt: recordAttempt,
    onReplaceAttempts: replaceAttempts,
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
          {error} — run <code>npm run dict</code> to build the dictionary, then reload.
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
