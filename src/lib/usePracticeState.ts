import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Dictionary } from './dict.ts'
import type { DisplayOptions } from './display.ts'
import {
  alignPhones, normalizeRecognized, scoreAlignment,
  type AlignedPhone, type Heard,
} from './align.ts'
import { describeSubstitution } from './phonefeatures.ts'
import {
  buildInfo, demote, loadRecognizer, loadTranscriber, prewarm, type LoadState,
} from './asr.ts'
import { decodeToMono16k, Recorder } from './recorder.ts'
import {
  analyze as analyzeRemote, probe as probeBackend, transcribe as transcribeRemote,
  type BackendInfo,
} from './backend.ts'
import { getClip, listClips, putClip, pruneClips } from './clips.ts'
import { stop as stopSpeaking } from './speech.ts'
import {
  aggregate, lineProgress, recentAverage, sameLine, SCORER_REVISION,
  toSentences,
  type Attempt,
} from './practice.ts'
import { pending as pendingRescore, rescoreAll } from './rescore.ts'
import {
  byWord, comparePhones, compareWords, extractVariantMap, flatten, focusScore, targetWords,
  type Change, type WordReport,
} from './report.ts'
import { drillIndex, type Drill, type DrillIndex } from './drills.ts'
import {
  buildDrill, phraseIndex, type DrillPhrase, type DrillSet,
} from './phrasebank.ts'
import { PHONES } from './phones.ts'
import { contextsForWord } from './context.ts'
import {
  loadStruggles, saveStruggles, recordWordReports, removeStruggledWord,
  togglePinnedWord, addManualWord, syncStrugglesFromAttempts, isStrugglingLot,
  buildDrillForWord, buildDrillForStruggledWords, type StruggledWord,
} from './struggles.ts'

export interface PracticeProps {
  text: string
  dict: Dictionary | null
  display: DisplayOptions
  attempts: Attempt[]
  drill?: string | null
  onDrillStarted?: () => void
  onAttempt: (attempt: Attempt, replaceAt?: number) => void
  onReplaceAttempts: (attempts: Attempt[]) => void
  onClearHistory: () => void
  onDeleteAttempt: (index: number) => void
  onSpeak: (text: string, onEnd?: () => void, onError?: (message: string) => void) => void
}

export type Mode = 'scripted' | 'free'
export type Phase = 'idle' | 'recording' | 'analysing' | 'done'
export type Track = 'target' | 'mine'

export const DRILLABLE = Object.entries(PHONES).filter(([phone]) => phone !== 'ɾ' && phone !== 'ʔ')

const LEAD_IN = 0.08
const TRAIL_OUT = 0.08
const MIN_SLICE = 0.18

export interface Playback {
  url: string
  durationMs: number
  blob: Blob
}

export function usePracticeState({
  text, dict, display, attempts, drill, onDrillStarted,
  onAttempt, onReplaceAttempts, onClearHistory, onDeleteAttempt, onSpeak,
}: PracticeProps) {
  const [mode, setMode] = useState<Mode>('scripted')
  const [target, setTarget] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [load, setLoad] = useState<LoadState>({ stage: 'idle', progress: 0 })
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [aligned, setAligned] = useState<AlignedPhone[] | null>(null)
  const [heard, setHeard] = useState<Heard[]>([])
  const [corrected, setCorrected] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<Track | null>(null)
  const [played, setPlayed] = useState(0)
  const [opened, setOpened] = useState(0)
  const [drills, setDrills] = useState<DrillIndex | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [clips, setClips] = useState<Set<number>>(() => new Set())
  const [against, setAgainst] = useState<'previous' | 'best'>('previous')
  const [session, setSession] = useState<DrillSet | null>(null)
  const [sessionSource, setSessionSource] = useState<
    | { type: 'sounds'; sounds: string[] }
    | { type: 'word'; word: StruggledWord }
    | { type: 'trouble' }
    | null
  >(null)
  const [stepAt, setStepAt] = useState(0)
  const [struggles, setStruggles] = useState<StruggledWord[]>(() => loadStruggles())
  const [troubleFilter, setTroubleFilter] = useState<'all' | 'struggles' | 'pinned'>('all')
  const [troubleSearch, setTroubleSearch] = useState('')
  const [newWordInput, setNewWordInput] = useState('')
  const [newWordError, setNewWordError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[] | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const [backend, setBackend] = useState<BackendInfo | null>(null)
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null)

  const recorder = useRef(new Recorder())
  const drillPanel = useRef<HTMLDivElement | null>(null)
  const levelTimer = useRef<number | undefined>(undefined)
  const player = useRef<HTMLAudioElement | null>(null)
  const context = useRef<AudioContext | null>(null)
  const decoded = useRef<AudioBuffer | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)

  const sentences = toSentences(text)

  useEffect(() => {
    if (mode === 'scripted' && !target && sentences.length) setTarget(sentences[0])
  }, [mode, sentences, target])

  useEffect(() => {
    void probeBackend().then(setBackend)
  }, [])

  useEffect(() => {
    if (!playback) return
    const seconds = playback.durationMs / 1000
    const element = new Audio(playback.url)
    const tick = () => setPlayed(seconds > 0 ? Math.min(1, element.currentTime / seconds) : 0)
    const ended = () => {
      setPlaying((track) => (track === 'mine' ? null : track))
      setPlayed(0)
    }
    element.addEventListener('timeupdate', tick)
    element.addEventListener('ended', ended)
    player.current = element

    return () => {
      element.pause()
      element.removeEventListener('timeupdate', tick)
      element.removeEventListener('ended', ended)
      player.current = null
      decoded.current = null
      setPlayed(0)
      URL.revokeObjectURL(playback.url)
    }
  }, [playback])

  const silence = useCallback(() => {
    stopSpeaking()
    const element = player.current
    if (element) {
      element.pause()
      element.currentTime = 0
    }
    const node = source.current
    if (node) {
      node.onended = null
      try {
        node.stop()
      } catch {
        // Already finished
      }
      source.current = null
    }
    setPlayed(0)
    setPlaying(null)
  }, [])

  const speak = useCallback(
    (phrase: string) => {
      silence()
      if (!phrase) return
      setError(null)
      setPlaying('target')
      onSpeak(phrase, () => setPlaying((track) => (track === 'target' ? null : track)), (message) => {
        setPlaying(null)
        setError(message)
      })
    },
    [silence, onSpeak],
  )

  const toggle = useCallback(
    (track: Track) => {
      const wasPlaying = playing === track
      silence()
      if (wasPlaying) return

      if (track === 'target') {
        speak(target)
        return
      }

      const element = player.current
      if (!element) return
      setPlaying('mine')
      void element.play().catch(() => setPlaying(null))
    },
    [playing, silence, target, speak],
  )

  const playWord = useCallback(
    async (span: { start: number; end: number }) => {
      if (!playback) return
      silence()
      try {
        context.current ??= new AudioContext()
        await context.current.resume()
        if (!decoded.current) {
          decoded.current = await context.current.decodeAudioData(await playback.blob.arrayBuffer())
        }

        const node = context.current.createBufferSource()
        node.buffer = decoded.current
        node.connect(context.current.destination)
        node.onended = () => {
          source.current = null
          setPlaying((track) => (track === 'mine' ? null : track))
        }
        const totalDuration = decoded.current.duration
        const from = Math.max(0, span.start - LEAD_IN)
        const to = Math.min(totalDuration, span.end + TRAIL_OUT)
        const duration = Math.max(MIN_SLICE, to - from)
        node.start(0, from, duration)
        source.current = node
        setPlaying('mine')
      } catch {
        setPlaying(null)
      }
    },
    [playback, silence],
  )

  const seek = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const element = player.current
      if (!element || !playback) return
      const box = event.currentTarget.getBoundingClientRect()
      const at = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
      element.currentTime = at * (playback.durationMs / 1000)
      setPlayed(at)
    },
    [playback],
  )

  const wordsFor = useCallback((phrase: string) => (dict ? targetWords(phrase, dict) : []), [dict])
  const words = useMemo(() => wordsFor(target), [wordsFor, target])
  const expectedIPA = words.map((word) => word.ipa).join(' ')
  const report = useMemo(() => (aligned ? byWord(words, aligned) : []), [words, aligned])
  const produced = useMemo(() => {
    if (!aligned || aligned.length === 0) return ''
    if (report.length > 0) {
      const wordParts = report
        .map((w) => w.steps.map((s) => s.actual ?? '').filter(Boolean).join(' '))
        .filter(Boolean)
      if (wordParts.length > 0) return wordParts.join('   ')
    }
    return aligned.map((step) => step.actual ?? '').filter(Boolean).join(' ')
  }, [aligned, report])

  const earlier = useMemo(() => {
    const others = attempts.filter((a, i) => i !== editing && sameLine(a.target, target))
    if (others.length === 0) return null
    return against === 'best'
      ? others.reduce((top, a) => (a.score.overall > top.score.overall ? a : top))
      : others[others.length - 1]
  }, [attempts, editing, target, against])

  const earlierReport = useMemo(
    () => (earlier ? byWord(wordsFor(earlier.target), earlier.aligned) : []),
    [earlier, wordsFor],
  )
  const wordChange = useMemo(() => compareWords(report, earlierReport), [report, earlierReport])
  const phoneChange = useMemo<Map<number, Change>>(
    () => (earlier && aligned ? comparePhones(aligned, earlier.aligned) : new Map()),
    [earlier, aligned],
  )

  const history = useMemo(() => {
    const groups: { label: string; items: { attempt: Attempt; index: number }[] }[] = []
    for (let i = attempts.length - 1; i >= 0; i--) {
      const label = dayLabel(attempts[i].at)
      let group = groups[groups.length - 1]
      if (!group || group.label !== label) {
        group = { label, items: [] }
        groups.push(group)
      }
      group.items.push({ attempt: attempts[i], index: i })
    }
    return groups
  }, [attempts])

  useEffect(() => {
    if (report.length === 0) return
    let worst = 0
    report.forEach((word, i) => { if (word.score < report[worst].score) worst = i })
    setOpened(worst)
  }, [report])

  const updateStrugglesWithTake = useCallback(
    (phrase: string, alignedResult: AlignedPhone[], at: number) => {
      const w = wordsFor(phrase)
      if (w.length === 0 || alignedResult.length === 0) return
      const reports = byWord(w, alignedResult)
      setStruggles((prev) => {
        const next = recordWordReports(prev, reports, at, phrase)
        saveStruggles(next)
        return next
      })
    },
    [wordsFor],
  )

  const syncedHistory = useRef(false)
  useEffect(() => {
    if (syncedHistory.current || attempts.length === 0 || !dict) return
    syncedHistory.current = true
    setStruggles((prev) => {
      if (prev.length > 0) return prev
      const seeded = syncStrugglesFromAttempts([], attempts, dict)
      if (seeded.length > 0) {
        saveStruggles(seeded)
        return seeded
      }
      return prev
    })
  }, [attempts, dict])

  const stopLevelMeter = () => {
    window.clearInterval(levelTimer.current)
    setLevel(0)
  }

  const rescore = useCallback(
    async (phrase: string) => {
      if (heard.length === 0) return
      const at = (editing !== null ? attempts[editing]?.at : undefined) ?? Date.now()
      const wordList = wordsFor(phrase)
      const expected = flatten(wordList)
      const variantMap = extractVariantMap(wordList)

      if (backend && expected.length > 0) {
        const blob = playback?.blob ?? (await getClip(at))?.blob
        if (blob) {
          try {
            const remote = await analyzeRemote(await decodeToMono16k(blob), expected)
            setAligned(remote.aligned)
            updateStrugglesWithTake(phrase, remote.aligned, at)
            onAttempt(
              {
                target: phrase,
                aligned: remote.aligned,
                score: { ...scoreAlignment(remote.aligned), overall: remote.overall },
                at,
                scorer: 'gop',
                rev: SCORER_REVISION,
              },
              editing ?? undefined,
            )
            return
          } catch {
            // fallback to browser aligner
          }
        }
      }

      const result = alignPhones(expected, heard, variantMap)
      setAligned(result)
      updateStrugglesWithTake(phrase, result, at)
      onAttempt(
        { target: phrase, aligned: result, score: scoreAlignment(result), at, scorer: 'browser' },
        editing ?? undefined,
      )
    },
    [heard, wordsFor, onAttempt, editing, attempts, backend, playback, updateStrugglesWithTake],
  )

  const migrated = useRef(false)
  useEffect(() => {
    if (!backend || migrated.current || !dict) return
    const total = pendingRescore(attempts)
    if (total === 0) return

    migrated.current = true
    const currentDict = dict
    void (async () => {
      setBackfill({ done: 0, total })
      try {
        const result = await rescoreAll(attempts, currentDict, (done, count) =>
          setBackfill({ done, total: count }),
        )
        onReplaceAttempts(result.attempts)
      } catch {
        // service error
      } finally {
        setBackfill(null)
      }
    })()
  }, [backend, attempts, dict, onReplaceAttempts])

  const editTarget = (value: string) => {
    setTarget(value)
    if (heard.length > 0 && phase === 'done') {
      setCorrected(true)
      void rescore(value)
    } else {
      setAligned(null)
    }
  }

  const beginRecording = useCallback(async () => {
    silence()
    setError(null)
    try {
      await recorder.current.start()
      setPhase('recording')
      if (!backend) prewarm(mode, setLoad)
      levelTimer.current = window.setInterval(() => setLevel(recorder.current.level()), 80)
    } catch (err) {
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow it from the address bar, then try again.'
          : `Could not start the microphone: ${(err as Error).message}`,
      )
      setPhase('idle')
    }
  }, [mode, silence, backend])

  const finishRecording = useCallback(async () => {
    stopLevelMeter()
    setPhase('analysing')
    try {
      const taken = await recorder.current.stop()

      const discard = () => {
        URL.revokeObjectURL(taken.url)
        setPhase('idle')
      }

      if (taken.peak < 0.02) {
        setError('That recording was silent. Check the microphone input and try again.')
        discard()
        return
      }

      let phrase = target
      if (mode === 'free') {
        phrase = backend
          ? (await transcribeRemote(taken.samples)).trim()
          : (await (await loadTranscriber(setLoad))(taken.samples)).trim()
        if (!phrase) {
          setError('Nothing recognisable in that recording. Try again, a little louder.')
          discard()
          return
        }
        setTarget(phrase)
      }

      if (backend) {
        const wantedList = flatten(wordsFor(phrase))
        if (wantedList.length === 0) {
          setError('No pronounceable words in that line, so there was nothing to score.')
          discard()
          return
        }

        const remote = await analyzeRemote(taken.samples, wantedList)
        setHeard(remote.free)
        setCorrected(false)

        const at = Date.now()
        setAligned(remote.aligned)
        updateStrugglesWithTake(phrase, remote.aligned, at)
        setPhase('done')
        setPlayback({ url: taken.url, durationMs: taken.durationMs, blob: taken.blob })
        setEditing(attempts.length)
        void putClip({ at, blob: taken.blob, durationMs: taken.durationMs }).then(() =>
          setClips((known) => new Set(known).add(at)),
        )
        onAttempt({
          target: phrase,
          aligned: remote.aligned,
          score: { ...scoreAlignment(remote.aligned), overall: remote.overall },
          at,
          scorer: 'gop',
          rev: SCORER_REVISION,
        })
        return
      }

      const recognise = await loadRecognizer(setLoad)
      let units = await recognise(taken.samples)
      let said = normalizeRecognized(units)

      if (units.length === 0 && demote('phonemes')) {
        const retry = await loadRecognizer(setLoad)
        units = await retry(taken.samples)
        said = normalizeRecognized(units)
      }

      if (said.length === 0) {
        const { device: on, quality } = buildInfo('phonemes')
        const where = quality ? ` (phoneme model at ${quality} on ${on})` : ''
        const raw = units.map((unit) => unit.phone).join(' ')
        setError(
          raw
            ? `The model heard sounds but none of them are English phones${where}: “${raw.slice(0, 80)}”. ` +
              'Nothing was scored.'
            : `The model returned no sounds at all for this recording${where}, though the words ` +
              'came through. Nothing was scored.',
        )
        discard()
        return
      }
      setHeard(said)
      setCorrected(false)

      const at = Date.now()
      const wordList = wordsFor(phrase)
      const variantMap = extractVariantMap(wordList)
      const result = alignPhones(flatten(wordList), said, variantMap)
      setAligned(result)
      updateStrugglesWithTake(phrase, result, at)
      setPhase('done')

      setPlayback({ url: taken.url, durationMs: taken.durationMs, blob: taken.blob })
      setEditing(attempts.length)
      void putClip({ at, blob: taken.blob, durationMs: taken.durationMs }).then(() =>
        setClips((known) => new Set(known).add(at)),
      )

      onAttempt({
        target: phrase, aligned: result, score: scoreAlignment(result), at, scorer: 'browser',
      })
    } catch (err) {
      setError(`Analysis failed: ${(err as Error).message}`)
      setPhase('idle')
    }
  }, [mode, target, wordsFor, onAttempt, attempts.length, backend, updateStrugglesWithTake])

  useEffect(() => () => {
    stopLevelMeter()
    recorder.current.cancel()
    stopSpeaking()
    void context.current?.close()
  }, [])

  const handleClearHistory = useCallback(() => {
    const many = attempts.length
    if (!window.confirm(`Delete all ${many} saved attempt${many === 1 ? '' : 's'}? This cannot be undone.`)) return
    setEditing(null)
    setClips(new Set())
    onClearHistory()
  }, [attempts.length, onClearHistory])

  const reopen = useCallback(
    async (index: number) => {
      const attempt = attempts[index]
      if (!attempt) return
      silence()
      setError(null)
      setPhase('done')
      setEditing(index)
      setTarget(attempt.target)
      setAligned(attempt.aligned)
      setHeard(
        attempt.aligned
          .filter((step) => step.actual !== null)
          .map((step) => ({ phone: step.actual!, start: step.start ?? 0, end: step.end ?? 0 })),
      )
      setCorrected(false)
      setPlayback(null)

      const clip = await getClip(attempt.at)
      if (clip) {
        setPlayback({
          url: URL.createObjectURL(clip.blob),
          durationMs: clip.durationMs,
          blob: clip.blob,
        })
      }
    },
    [attempts, silence],
  )

  useEffect(() => {
    let live = true
    void pruneClips(attempts.map((attempt) => attempt.at))
      .then(listClips)
      .then((known) => { if (live) setClips(known) })
    return () => { live = false }
  }, [attempts])

  const removeAttempt = useCallback(
    (index: number) => {
      const attempt = attempts[index]
      if (!attempt) return
      const said = attempt.target.length > 44 ? `${attempt.target.slice(0, 42)}…` : attempt.target
      if (!window.confirm(`Delete this attempt and its recording?\n\n“${said}”`)) return

      if (editing === index) {
        silence()
        setEditing(null)
        setPlayback(null)
      } else if (editing !== null && editing > index) {
        setEditing(editing - 1)
      }
      onDeleteAttempt(index)
    },
    [attempts, editing, onDeleteAttempt, silence],
  )

  const again = useCallback(() => {
    setMode('scripted')
    void beginRecording()
  }, [beginRecording])

  const setLine = useCallback(
    (line: string) => {
      silence()
      setMode('scripted')
      setPhase('idle')
      setAligned(null)
      setHeard([])
      setPlayback(null)
      setEditing(null)
      setCorrected(false)
      setError(null)
      setTarget(line)
    },
    [silence],
  )

  const phrases = useMemo(() => (dict ? phraseIndex(dict) : []), [dict])

  const practise = useCallback(
    (drillItem: Drill) => {
      if (!dict) return
      const contextual = contextsForWord(drillItem.word, dict, [text, ...attempts.map((attempt) => attempt.target), ...phrases.map((phrase) => phrase.text)])[0]
      if (contextual) setLine(contextual)
      else setError(`Add a full sentence containing ${drillItem.word} in Practice Studio; there is no checked context for this word yet.`)
    },
    [dict, text, attempts, phrases, setLine],
  )

  const sayPhrase = useCallback((phraseItem: DrillPhrase) => setLine(phraseItem.text), [setLine])

  const stepTo = useCallback(
    (index: number, set: DrillSet | null = session) => {
      const s = set?.steps[index]
      if (!s) return
      setStepAt(index)
      setLine(s.phrase.text)
    },
    [session, setLine],
  )

  const startDrill = useCallback(
    (wantedPhones: string[]) => {
      if (wantedPhones.length === 0 || !dict) return
      const built = buildDrill(phrases, wantedPhones, 8, { randomize: true })
      if (built.steps.length === 0) return
      setSession(built)
      setSessionSource({ type: 'sounds', sounds: wantedPhones })
      setPicked(wantedPhones)
      stepTo(0, built)
      requestAnimationFrame(() =>
        drillPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    },
    [phrases, dict, stepTo],
  )

  const drillWord = useCallback(
    (entry: StruggledWord) => {
      if (!dict) return
      const built = buildDrillForWord(entry, phrases, dict, { randomize: true, contexts: [text, ...attempts.map((attempt) => attempt.target)] })
      if (built.steps.length === 0) { setError(`Add a full sentence containing ${entry.display} in Practice Studio first.`); return }
      setSession(built)
      setSessionSource({ type: 'word', word: entry })
      stepTo(0, built)
      requestAnimationFrame(() =>
        drillPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    },
    [phrases, dict, text, attempts, stepTo],
  )

  /** Load the first contextual line for a trouble word without starting a full drill. */
  const practiseWord = useCallback(
    (entry: StruggledWord) => {
      if (!dict) return
      const built = buildDrillForWord(entry, phrases, dict, { randomize: true, contexts: [text, ...attempts.map((attempt) => attempt.target)] })
      const first = built.steps[0]
      if (first) setLine(first.phrase.text)
      else setError(`Add a full sentence containing ${entry.display} in Practice Studio first.`)
    },
    [phrases, dict, text, attempts, setLine],
  )

  const drillAllTrouble = useCallback(() => {
    if (!dict) return
    const targets = struggles.filter(isStrugglingLot)
    const list = targets.length > 0 ? targets : struggles
    if (list.length === 0) return
    const built = buildDrillForStruggledWords(list, phrases, dict, { randomize: true, contexts: [text, ...attempts.map((attempt) => attempt.target)] })
    if (built.steps.length === 0) { setError('Add full sentences containing your trouble words in Practice Studio first.'); return }
    setSession(built)
    setSessionSource({ type: 'trouble' })
    stepTo(0, built)
    requestAnimationFrame(() =>
      drillPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    )
  }, [struggles, phrases, dict, text, attempts, stepTo])

  const shuffleCurrentDrill = useCallback(() => {
    if (sessionSource?.type === 'word') {
      drillWord(sessionSource.word)
    } else if (sessionSource?.type === 'trouble') {
      drillAllTrouble()
    } else if (sessionSource?.type === 'sounds') {
      startDrill(sessionSource.sounds)
    } else if (session) {
      const fallbackSounds = session.steps.flatMap((s) => s.covers.map((c) => c.phone))
      if (fallbackSounds.length > 0) startDrill([...new Set(fallbackSounds)])
    }
  }, [sessionSource, session, drillWord, drillAllTrouble, startDrill])

  const endDrill = useCallback(() => {
    setSession(null)
    setSessionSource(null)
    setStepAt(0)
  }, [])

  const handleAddWord = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault()
      const query = newWordInput.trim()
      if (!query || !dict) return
      const next = addManualWord(struggles, query, dict)
      if (!next) {
        setNewWordError(`“${query}” was not found in the pronunciation dictionary.`)
        return
      }
      setStruggles(next)
      setNewWordInput('')
      setNewWordError(null)
    },
    [newWordInput, struggles, dict],
  )

  const removeWord = useCallback((wordKey: string) => {
    setStruggles((prev) => removeStruggledWord(prev, wordKey))
  }, [])

  const togglePin = useCallback((wordKey: string) => {
    setStruggles((prev) => togglePinnedWord(prev, wordKey))
  }, [])

  const clearTroubles = useCallback(() => {
    if (struggles.length === 0) return
    if (!window.confirm(`Clear all ${struggles.length} words from your Trouble Words Bank?`)) return
    setStruggles([])
    saveStruggles([])
  }, [struggles.length])

  const visibleStruggles = useMemo(() => {
    let list = struggles
    if (troubleFilter === 'struggles') list = list.filter(isStrugglingLot)
    else if (troubleFilter === 'pinned') list = list.filter((e) => e.pinned)
    if (troubleSearch.trim()) {
      const q = troubleSearch.toLowerCase().trim()
      list = list.filter((e) => e.word.includes(q) || e.ipa.includes(q))
    }
    return list
  }, [struggles, troubleFilter, troubleSearch])

  useEffect(() => {
    if (!drill) return
    startDrill([drill])
    onDrillStarted?.()
  }, [drill, startDrill, onDrillStarted])

  const score = aligned ? scoreAlignment(aligned) : null
  const line = lineProgress(attempts, target)
  const weak = aggregate(attempts).filter((s) => s.errorRate > 0.15).slice(0, 4)
  const average = recentAverage(attempts)

  const step = session?.steps[stepAt] ?? null
  const onStep = !!step && sameLine(step.phrase.text, target)
  const focus = useMemo(
    () =>
      aligned && step && onStep ? focusScore(aligned, step.covers.map((hit) => hit.phone)) : [],
    [aligned, step, onStep],
  )

  const wanted = picked ?? weak.map((stat) => stat.phone)
  const toggleSound = (phone: string) =>
    setPicked(
      wanted.includes(phone) ? wanted.filter((p) => p !== phone) : [...wanted, phone],
    )
  const busy = phase === 'analysing'
  const fetching = load.stage === 'library' || load.stage === 'weights'

  useEffect(() => {
    if (weak.length === 0 || drills || !dict) return
    let live = true
    void drillIndex(dict).then((index) => { if (live) setDrills(index) }).catch(() => {})
    return () => { live = false }
  }, [weak.length, dict, drills])

  const open = report[opened] ?? null
  const sessionSounds = session
    ? [...new Set(session.steps.flatMap((s) => s.covers.map((hit) => hit.phone)))]
    : []

  return {
    mode, setMode,
    target, setTarget, editTarget,
    phase, load, playback, setPlayback,
    aligned, setAligned,
    heard, setHeard,
    corrected, level,
    error, setError,
    playing, played, opened, setOpened,
    drills, editing, setEditing, clips, against, setAgainst,
    session, sessionSource, stepAt,
    struggles, troubleFilter, setTroubleFilter,
    troubleSearch, setTroubleSearch,
    newWordInput, setNewWordInput, newWordError, setNewWordError,
    picked, browsing, setBrowsing,
    backend, backfill,
    drillPanel,
    sentences, words, expectedIPA, report, open, produced,
    earlier, wordChange, phoneChange, history, score,
    line, weak, average, step, onStep, focus, wanted,
    busy, fetching, visibleStruggles, sessionSounds, phrases,
    silence, speak, toggle, playWord, seek,
    beginRecording, finishRecording,
    clearHistory: handleClearHistory,
    reopen, removeAttempt, again, setLine, practise, sayPhrase,
    stepTo, startDrill, drillWord, practiseWord, drillAllTrouble, shuffleCurrentDrill, endDrill,
    handleAddWord, removeWord, togglePin, clearTroubles, toggleSound,
    display,
    attempts,
  }
}

export type PracticeState = ReturnType<typeof usePracticeState>

export function dayLabel(at: number): string {
  const day = new Date(at).toDateString()
  const today = new Date()
  if (day === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (day === yesterday.toDateString()) return 'Yesterday'
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function stamp(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function changeOf(delta: number): string {
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'level'
}

export function band(score: number): string {
  return score >= 85 ? 'good' : score >= 65 ? 'ok' : 'poor'
}

export function tooltip(step: AlignedPhone): string {
  if (step.verdict === 'missing') return `/${step.expected}/ was not pronounced`
  if (step.verdict === 'extra') return `extra sound /${step.actual}/`
  if (step.verdict === 'correct') return `/${step.expected}/ — correct`
  return `/${step.expected}/ → /${step.actual}/: ${describeSubstitution(step.expected!, step.actual!)}`
}

export function notesFor(word: WordReport): string[] {
  return word.steps
    .filter((s) => s.verdict === 'wrong' || s.verdict === 'missing' || s.verdict === 'close')
    .sort((a, b) => (b.distance ?? 1) - (a.distance ?? 1))
    .slice(0, 3)
    .map((step) => {
      if (step.verdict === 'missing') {
        const info = PHONES[step.expected!]
        return `You dropped /${step.expected}/${info ? ` (as in ${info.example})` : ''}.`
      }
      return `/${step.expected}/ came out as /${step.actual}/ — ${describeSubstitution(step.expected!, step.actual!)}.`
    })
}
