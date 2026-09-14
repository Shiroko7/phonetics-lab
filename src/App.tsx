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
  type Voice,
} from './lib/speech.ts'
import type { Annotation } from './components/Reading.tsx'
import { loadAttempts, saveAttempts, type Attempt } from './lib/practice.ts'
import { clearClips, deleteClip } from './lib/clips.ts'
import { usePracticeState } from './lib/usePracticeState.ts'
import { SplitLab } from './components/SplitLab.tsx'

const VOICE_KEY = 'phonetics-lab:voice'

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
  const [view, setView] = useState<'practice' | 'lookup' | 'vowels'>('practice')

  const [drillSound, setDrillSound] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>(() => loadAttempts())
  const [voices, setVoices] = useState<Voice[]>([])
  const [voiceURI, setVoiceURI] = useState('')
  const [readingAloud, setReadingAloud] = useState(false)

  useEffect(() => {
    loadDictionary(({ loaded, total }) => setProgress(total ? loaded / total : 0))
      .then(setDict)
      .catch((err: Error) => setError(err.message))
  }, [])

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

  const say = useCallback(
    (word: string) => {
      pronounce(word, { preferRecording, rate, voiceURI })
    },
    [preferRecording, rate, voiceURI],
  )

  const previewVoice = useCallback(() => {
    synthesise('The quick brown fox jumps over the lazy dog.', { rate, voiceURI })
  }, [rate, voiceURI])

  const toggleReadAloud = useCallback(() => {
    if (readingAloud) {
      stop()
      setReadingAloud(false)
      return
    }
    setReadingAloud(true)
    synthesise(text, { rate, voiceURI, onEnd: () => setReadingAloud(false) })
  }, [readingAloud, text, rate, voiceURI])

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
    onSpeak: (phrase, onEnd) => synthesise(phrase, { rate, voiceURI, onEnd }),
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
