import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Dictionary } from '../lib/dict.ts'
import { formatIPA, type DisplayOptions } from '../lib/display.ts'
import {
  alignPhones, normalizeRecognized, scoreAlignment,
  type AlignedPhone, type Heard,
} from '../lib/align.ts'
import { describeSubstitution } from '../lib/phonefeatures.ts'
import {
  buildInfo, demote, isLoaded, loadRecognizer, loadTranscriber, prewarm, type LoadState,
} from '../lib/asr.ts'
import { decodeToMono16k, Recorder, supportsRecording } from '../lib/recorder.ts'
import {
  analyze as analyzeRemote, probe as probeBackend, transcribe as transcribeRemote,
  type BackendInfo,
} from '../lib/backend.ts'
import { getClip, listClips, putClip, pruneClips } from '../lib/clips.ts'
import { stop as stopSpeaking } from '../lib/speech.ts'
import {
  aggregate, lineProgress, mixedScorers, recentAverage, sameLine, SCORER_REVISION,
  toSentences,
  type Attempt,
} from '../lib/practice.ts'
import { pending as pendingRescore, rescoreAll } from '../lib/rescore.ts'
import {
  byWord, comparePhones, compareWords, dominant, flatten, focusScore, targetWords,
  type Change, type WordReport,
} from '../lib/report.ts'
import { drillIndex, findDrills, type Drill, type DrillIndex } from '../lib/drills.ts'
import {
  buildDrill, phraseIndex, phrasesFor, type DrillPhrase, type DrillSet,
} from '../lib/phrasebank.ts'
import { PHONES } from '../lib/phones.ts'
import { contextsForWord } from '../lib/context.ts'
import {
  loadStruggles, saveStruggles, recordWordReports, removeStruggledWord,
  togglePinnedWord, addManualWord, syncStrugglesFromAttempts, isStrugglingLot,
  buildDrillForWord, buildDrillForStruggledWords, type StruggledWord,
} from '../lib/struggles.ts'

interface Props {
  text: string
  dict: Dictionary
  display: DisplayOptions
  attempts: Attempt[]
  /** A sound to open a drill on, sent from elsewhere in the app. */
  drill?: string | null
  onDrillStarted?: () => void
  onAttempt: (attempt: Attempt, replaceAt?: number) => void
  /** Bulk rewrite, for re-scoring the history in one pass. */
  onReplaceAttempts: (attempts: Attempt[]) => void
  onClearHistory: () => void
  onDeleteAttempt: (index: number) => void
  onSpeak: (text: string, onEnd?: () => void) => void
}

/**
 * Scripted: choose the words first, then say them.
 * Free: say anything, and the words are recovered from the audio afterwards.
 */
type Mode = 'scripted' | 'free'
type Phase = 'idle' | 'recording' | 'analysing' | 'done'
/** The two things that can be heard: the words as they should sound, and you. */
type Track = 'target' | 'mine'

/**
 * Sounds a drill can be built for. Dictionary transcriptions are canonical — no
 * flapping, no glottalling — so the flap and the glottal stop are never
 * *expected* by anything, and there is nothing to practise them against.
 */
const DRILLABLE = Object.entries(PHONES).filter(([phone]) => phone !== 'ɾ' && phone !== 'ʔ')

/** Seconds of run-up when playing one word, to catch its onset. */
const LEAD_IN = 0.06
/** No slice is shorter than this; a clipped consonant is inaudible. */
const MIN_SLICE = 0.15

/** A take that can be played: this session's, or one read back from storage. */
interface Playback {
  url: string
  durationMs: number
  blob: Blob
}

export function Practice({
  text, dict, display, attempts, drill, onDrillStarted,
  onAttempt, onReplaceAttempts, onClearHistory, onDeleteAttempt, onSpeak,
}: Props) {
  const [mode, setMode] = useState<Mode>('free')
  const [target, setTarget] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [load, setLoad] = useState<LoadState>({ stage: 'idle', progress: 0 })
  /** Whatever take is currently loaded for playback — this run's or an older
   *  one fetched back out of storage. */
  const [playback, setPlayback] = useState<Playback | null>(null)
  const [aligned, setAligned] = useState<AlignedPhone[] | null>(null)
  /** Phones actually produced, with their timings, kept so edits can re-score
   *  without re-recording — and so a word can be cut back out of the take. */
  const [heard, setHeard] = useState<Heard[]>([])
  const [corrected, setCorrected] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** At most one thing makes sound at a time, and it says which. */
  const [playing, setPlaying] = useState<Track | null>(null)
  /** 0-1 through the recording, for the scrubber. */
  const [played, setPlayed] = useState(0)
  /** Which word's sounds are opened up below the strip. */
  const [opened, setOpened] = useState(0)
  /** Practice-word suggestions need their own index; it loads on first use. */
  const [drills, setDrills] = useState<DrillIndex | null>(null)
  /**
   * Which attempt the result on screen *is*. Correcting a transcript rewrites
   * that one rather than always the newest, so going back to an old attempt and
   * fixing its words does not overwrite something else.
   */
  const [editing, setEditing] = useState<number | null>(null)
  /** Attempts whose audio survived, so the history list knows what is playable. */
  const [clips, setClips] = useState<Set<number>>(() => new Set())
  /** Which earlier go at this line the current one is measured against. */
  const [against, setAgainst] = useState<'previous' | 'best'>('previous')
  /** The drill in progress: a queue of lines, and where in it we are. */
  const [session, setSession] = useState<DrillSet | null>(null)
  const [sessionSource, setSessionSource] = useState<
    | { type: 'sounds'; sounds: string[] }
    | { type: 'word'; word: StruggledWord }
    | { type: 'trouble' }
    | null
  >(null)
  const [stepAt, setStepAt] = useState(0)
  /** Words the user struggles with across practice sessions. */
  const [struggles, setStruggles] = useState<StruggledWord[]>(() => loadStruggles())
  const [troubleFilter, setTroubleFilter] = useState<'all' | 'struggles' | 'pinned'>('all')
  const [troubleSearch, setTroubleSearch] = useState('')
  const [newWordInput, setNewWordInput] = useState('')
  const [newWordError, setNewWordError] = useState<string | null>(null)
  /**
   * Sounds ticked for the next drill. Null until the ticks are touched, so an
   * untouched selection follows the weak list as the weak list changes.
   */
  const [picked, setPicked] = useState<string[] | null>(null)
  /** Whether the whole inventory is on show, for drilling something not yet weak. */
  const [browsing, setBrowsing] = useState(false)

  /**
   * The local scoring service, if it is running. Null means it is not, which is
   * the ordinary case and not an error: the browser recogniser handles
   * everything on its own, just less precisely.
   */
  const [backend, setBackend] = useState<BackendInfo | null>(null)

  /** Progress of the history migration, null when one is not running. */
  const [backfill, setBackfill] = useState<{ done: number; total: number } | null>(null)

  const recorder = useRef(new Recorder())
  const drillPanel = useRef<HTMLDivElement | null>(null)
  const levelTimer = useRef<number | undefined>(undefined)
  const player = useRef<HTMLAudioElement | null>(null)
  /** Web Audio, used only for playing a single word out of the take. */
  const context = useRef<AudioContext | null>(null)
  const decoded = useRef<AudioBuffer | null>(null)
  const source = useRef<AudioBufferSourceNode | null>(null)

  const sentences = toSentences(text)

  useEffect(() => {
    if (mode === 'scripted' && !target && sentences.length) setTarget(sentences[0])
  }, [mode, sentences, target])

  // Asked once. If it is not there the app carries on in the browser, so this
  // neither blocks anything nor reports a failure.
  useEffect(() => {
    void probeBackend().then(setBackend)
  }, [])

  /** One element per take, torn down with the blob URL it plays. */
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

  /** Silence whatever is speaking or playing. Every play goes through here
   *  first, which is what stops a second click layering onto the first. */
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
        // Already finished; stopping twice is not an error worth reporting.
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
      setPlaying('target')
      onSpeak(phrase, () => setPlaying((track) => (track === 'target' ? null : track)))
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

  /**
   * Play one word out of the take, so it can be heard against the model saying
   * the same word.
   *
   * Cut with Web Audio rather than by seeking the <audio> element: what
   * MediaRecorder produces carries no seek index, so `currentTime` lands only
   * approximately — and approximately, on a word lasting 300 ms, is the word
   * next door.
   */
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
        // A little lead-in: CTC marks a phone where the model becomes sure of
        // it, which is a fraction after the sound itself begins.
        const from = Math.max(0, span.start - LEAD_IN)
        node.start(0, from, Math.max(MIN_SLICE, span.end - from))
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

  const wordsFor = useCallback((phrase: string) => targetWords(phrase, dict), [dict])

  const words = useMemo(() => wordsFor(target), [wordsFor, target])
  const expectedIPA = words.map((word) => word.ipa).join(' ')

  /** The alignment cut back up into words — what the results panel reads. */
  const report = useMemo(() => (aligned ? byWord(words, aligned) : []), [words, aligned])

  /** Everything actually produced, for the whole-take line. */
  const produced = (aligned ?? []).map((step) => step.actual ?? '').join('')

  /**
   * The go this one is measured against: the one before it at the same line, or
   * the best of them. Never the attempt on screen — a thing cannot improve on
   * itself.
   */
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

  /** Attempts newest first, cut into days. */
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

  // Open the weakest word by default: it is the one worth looking at.
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

  /**
   * Re-score the existing recording against different words.
   *
   * Without the service this is instant: the phones produced are already known
   * and only the target changed, so it is one more pass of the aligner. With
   * the service it has to go back to the audio, because a goodness-of-
   * pronunciation score is measured against the expected phones and those are
   * exactly what just changed — the stored phone list cannot answer for it. A
   * little slower, and it keeps the attempt on the scale it was scored on
   * rather than quietly dropping it back to the browser's.
   */
  const rescore = useCallback(
    async (phrase: string) => {
      if (heard.length === 0) return
      // Keep the original timestamp: it is this attempt's identity, and its
      // recording is filed under it.
      const at = (editing !== null ? attempts[editing]?.at : undefined) ?? Date.now()
      const expected = flatten(wordsFor(phrase))

      const existingDuration = editing !== null ? attempts[editing]?.durationMs : undefined
      const durationMs = playback?.durationMs ?? existingDuration
      const existingMode = editing !== null ? attempts[editing]?.mode : undefined
      const attemptMode = existingMode ?? mode

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
                durationMs,
                mode: attemptMode,
              },
              editing ?? undefined,
            )
            return
          } catch {
            // Fall through to the browser aligner rather than leaving the edit
            // with nothing to show: a re-score is a convenience, not the take.
          }
        }
      }

      const result = alignPhones(expected, heard)
      setAligned(result)
      updateStrugglesWithTake(phrase, result, at)
      onAttempt(
        { target: phrase, aligned: result, score: scoreAlignment(result), at, scorer: 'browser', durationMs, mode: attemptMode },
        editing ?? undefined,
      )
    },
    [heard, wordsFor, onAttempt, editing, attempts, backend, playback, updateStrugglesWithTake],
  )

  /**
   * Bring old attempts onto the service's scale, once, in the background.
   *
   * A score is derived from a recording, and the recordings are untouched — so
   * when the way of deriving them improves this is a migration, not a decision
   * to put to anybody. Leaving it as a choice would have meant explaining two
   * scoring scales to someone who only wanted their history to make sense.
   *
   * Anything that fails keeps its old score and its old tag, so the next load
   * tries it again; nothing here has to succeed for the app to work.
   */
  const migrated = useRef(false)
  useEffect(() => {
    if (!backend || migrated.current) return
    const total = pendingRescore(attempts)
    if (total === 0) return

    migrated.current = true
    void (async () => {
      setBackfill({ done: 0, total })
      try {
        const result = await rescoreAll(attempts, dict, (done, count) =>
          setBackfill({ done, total: count }),
        )
        onReplaceAttempts(result.attempts)
      } catch {
        // The service going away mid-pass is not worth interrupting practice
        // over. What did not convert is still tagged as the browser's.
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
    // Everything from the previous take stays — its words, its score, its audio
    // — until this one has something to replace it with. Pressing record is not
    // a reason to lose what you were working on.
    try {
      await recorder.current.start()
      setPhase('recording')
      // Fetch the weights while the user talks rather than after they stop —
      // but not when the scoring service is up, which would be a gigabyte of
      // download for models that will not be asked anything.
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

      // Any path that does not adopt this take has to let go of its blob URL;
      // nothing else will.
      const discard = () => {
        URL.revokeObjectURL(taken.url)
        setPhase('idle')
      }

      if (taken.peak < 0.02) {
        setError('That recording was silent. Check the microphone input and try again.')
        discard()
        return
      }

      // Free practice has to recover the words before it can judge the sounds.
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

      // With the scoring service up, the take is judged by forced alignment
      // against the expected phones rather than by decoding it blind and
      // matching strings afterwards. Same target, same recording, a better
      // question asked of the model — so this returns early with an alignment
      // the rest of the panel reads exactly as it reads the browser's.
      if (backend) {
        const wanted = flatten(wordsFor(phrase))
        if (wanted.length === 0) {
          setError('No pronounceable words in that line, so there was nothing to score.')
          discard()
          return
        }

        const remote = await analyzeRemote(taken.samples, wanted)
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
        // Verdict tallies come from the shared scorer so history stays
        // comparable, but the headline number is the backend's: an average of
        // per-phone GOPs says more than counting four buckets.
        onAttempt({
          target: phrase,
          aligned: remote.aligned,
          score: { ...scoreAlignment(remote.aligned), overall: remote.overall },
          at,
          scorer: 'gop',
          rev: SCORER_REVISION,
          durationMs: taken.durationMs,
          mode,
        })
        return
      }

      const recognise = await loadRecognizer(setLoad)
      let units = await recognise(taken.samples)
      let said = normalizeRecognized(units)

      // Weights that load, run and return nothing look exactly like silence from
      // here. A build that transcribes real speech as nothing at all is a broken
      // build rather than a quiet speaker, so try the next precision down before
      // believing it.
      if (units.length === 0 && demote('phonemes')) {
        const retry = await loadRecognizer(setLoad)
        units = await retry(taken.samples)
        said = normalizeRecognized(units)
      }

      // Scoring a phrase against nothing marks every sound missing and reports a
      // confident zero, which is a lie about the speaker rather than about the
      // recording. Say what actually happened, and say which of the two things
      // went wrong: no phones at all is a broken model, whereas phones that all
      // fall outside our inventory is a vocabulary or folding fault.
      if (said.length === 0) {
        const { device: on, quality } = buildInfo('phonemes')
        const where = quality ? ` (phoneme model at ${quality} on ${on})` : ''
        const raw = units.map((unit) => unit.phone).join(' ')
        setError(
          raw
            ? `The model heard sounds but none of them are English phones${where}: “${raw.slice(0, 80)}”. ` +
              'Nothing was scored.'
            : `The model returned no sounds at all for this recording${where}, though the words ` +
              'came through. Nothing was scored — this is the phoneme model failing, not the take.',
        )
        discard()
        return
      }
      setHeard(said)
      setCorrected(false)

      const at = Date.now()
      const result = alignPhones(flatten(wordsFor(phrase)), said)
      setAligned(result)
      updateStrugglesWithTake(phrase, result, at)
      setPhase('done')

      // Only now is the previous take replaced — and the old one is not lost
      // with it, because the audio goes to storage under this attempt's stamp.
      setPlayback({ url: taken.url, durationMs: taken.durationMs, blob: taken.blob })
      setEditing(attempts.length)
      void putClip({ at, blob: taken.blob, durationMs: taken.durationMs }).then(() =>
        setClips((known) => new Set(known).add(at)),
      )

      onAttempt({
        target: phrase,
        aligned: result,
        score: scoreAlignment(result),
        at,
        scorer: 'browser',
        durationMs: taken.durationMs,
        mode,
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

  const clearHistory = useCallback(() => {
    const many = attempts.length
    if (!window.confirm(`Delete all ${many} saved attempt${many === 1 ? '' : 's'}? This cannot be undone.`)) return
    setEditing(null)
    setClips(new Set())
    onClearHistory()
  }, [attempts.length, onClearHistory])

  /**
   * Go back to an earlier attempt: its words return to the box, its result to
   * the panel, and its recording to the player. From there it can be listened
   * to, corrected, or said again — it is not a read-only view of the past.
   */
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

  // Tidy away clips whose attempt is gone, then note what is left to play.
  useEffect(() => {
    let live = true
    void pruneClips(attempts.map((attempt) => attempt.at))
      .then(listClips)
      .then((known) => { if (live) setClips(known) })
    return () => { live = false }
  }, [attempts])

  /** Delete one attempt, and the recording filed under it. */
  const removeAttempt = useCallback(
    (index: number) => {
      const attempt = attempts[index]
      if (!attempt) return
      const said = attempt.target.length > 44 ? `${attempt.target.slice(0, 42)}…` : attempt.target
      if (!window.confirm(`Delete this attempt and its recording?\n\n“${said}”`)) return

      // Indices shift under us; keep the one on screen pointing where it was.
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

  /**
   * Say the same line again. Free practice pins its transcript first: the point
   * of another go is to be measured against the same words, not to have them
   * recognised afresh and drift.
   */
  const again = useCallback(() => {
    setMode('scripted')
    void beginRecording()
  }, [beginRecording])

  /**
   * Put a new line in the box, ready to be said. The previous result goes with
   * it — it belongs to different words, and leaving it on screen underneath a
   * new line would be reporting it as this line's.
   */
  const setLine = useCallback(
    (line: string) => {
      silence()
      setMode('scripted')
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

  /** The curated phrase bank, measured against this dictionary. */
  const phrases = useMemo(() => phraseIndex(dict), [dict])

  /** Load a suggested word as the next thing to say. */
  const practise = useCallback(
    (drill: Drill) => {
      const contextual = contextsForWord(drill.word, dict, [text, ...attempts.map((attempt) => attempt.target), ...phrases.map((phrase) => phrase.text)])[0]
      if (contextual) setLine(contextual)
      else setError(`Add a full sentence containing ${drill.word} in Practice Studio; there is no checked context for this word yet.`)
    },
    [dict, text, attempts, phrases, setLine],
  )

  /** Say one curated line on its own, without starting a session. */
  const sayPhrase = useCallback((phrase: DrillPhrase) => setLine(phrase.text), [setLine])

  /** Move to a line of the session in progress. */
  const stepTo = useCallback(
    (index: number, set: DrillSet | null = session) => {
      const step = set?.steps[index]
      if (!step) return
      setStepAt(index)
      setLine(step.phrase.text)
    },
    [session, setLine],
  )

  /**
   * Build a drill over the sounds given and start on its first line. The
   * session is only a queue of things to say: recording, scoring, retrying and
   * comparing all work exactly as they do for any other line.
   */
  const startDrill = useCallback(
    (wanted: string[]) => {
      if (wanted.length === 0) return
      const built = buildDrill(phrases, wanted, 8, { randomize: true })
      if (built.steps.length === 0) return
      setSession(built)
      setSessionSource({ type: 'sounds', sounds: wanted })
      // The ticks follow what is actually being drilled, however it was asked for.
      setPicked(wanted)
      stepTo(0, built)
      // The line to say is at the top of the page; the button that asked for it
      // is at the bottom.
      requestAnimationFrame(() =>
        drillPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      )
    },
    [phrases, stepTo],
  )

  /** Build a targeted drill around a specific trouble word. */
  const drillWord = useCallback(
    (entry: StruggledWord) => {
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

  const practiseWord = useCallback(
    (entry: StruggledWord) => {
      const built = buildDrillForWord(entry, phrases, dict, { randomize: true, contexts: [text, ...attempts.map((attempt) => attempt.target)] })
      const first = built.steps[0]
      if (first) setLine(first.phrase.text)
      else setError(`Add a full sentence containing ${entry.display} in Practice Studio first.`)
    },
    [phrases, dict, text, attempts, setLine],
  )

  /** Build a drill spanning trouble words. */
  const drillAllTrouble = useCallback(() => {
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

  /** Re-roll the drill with completely new randomized phrases. */
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
      if (!query) return
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

  /** A sound picked out on the vowel chart arrives here as a drill to open. */
  useEffect(() => {
    if (!drill) return
    startDrill([drill])
    onDrillStarted?.()
  }, [drill, startDrill, onDrillStarted])

  const score = aligned ? scoreAlignment(aligned) : null
  /** How this same line has gone, across every go at it. */
  const line = lineProgress(attempts, target)
  const weak = aggregate(attempts).filter((s) => s.errorRate > 0.15).slice(0, 4)
  const average = recentAverage(attempts)

  /** The line of the session being worked on, if a session is running. */
  const step = session?.steps[stepAt] ?? null
  /** Whether the box still holds that line — edit it away and it is not a drill. */
  const onStep = !!step && sameLine(step.phrase.text, target)
  /** How the sounds this line was chosen for actually went, in this take. */
  const focus = useMemo(
    () =>
      aligned && step && onStep ? focusScore(aligned, step.covers.map((hit) => hit.phone)) : [],
    [aligned, step, onStep],
  )

  /** Which sounds the next drill would cover: the ticked ones, or the weak ones. */
  const wanted = picked ?? weak.map((stat) => stat.phone)
  const toggleSound = (phone: string) =>
    setPicked(
      wanted.includes(phone) ? wanted.filter((p) => p !== phone) : [...wanted, phone],
    )
  const busy = phase === 'analysing'
  const fetching = load.stage === 'library' || load.stage === 'weights'

  // The suggestions need a word list of their own; fetch it once there is
  // something to suggest for.
  useEffect(() => {
    if (weak.length === 0 || drills) return
    let live = true
    void drillIndex(dict).then((index) => { if (live) setDrills(index) }).catch(() => {})
    return () => { live = false }
  }, [weak.length, dict, drills])

  if (!supportsRecording()) {
    return (
      <div className="panel">
        <p className="notice">
          This browser cannot record audio. Practice needs microphone access via
          <code> getUserMedia</code>, available in Edge, Chrome and Firefox over localhost or HTTPS.
        </p>
      </div>
    )
  }

  const open = report[opened] ?? null

  const sessionSounds = session
    ? [...new Set(session.steps.flatMap((s) => s.covers.map((hit) => hit.phone)))]
    : []

  return (
    <div className="practice">
      {session && (
        <div className="panel drill-session" ref={drillPanel}>
          <h3 className="panel-title">
            {sessionSource?.type === 'word'
              ? `Drill · ${sessionSource.word.display}`
              : sessionSource?.type === 'trouble'
                ? 'Drill · Trouble Words'
                : 'Drill'}
            <button
              className="ghost tiny"
              onClick={shuffleCurrentDrill}
              style={{ marginRight: 6 }}
              title="Get a completely new randomized set of drill lines"
            >
              ↻ new lines
            </button>
            <button className="ghost tiny" onClick={endDrill}>end drill</button>
          </h3>
          <p className="desc" style={{ marginBottom: 12 }}>
            {sessionSource?.type === 'word' ? (
              <>
                Targeted drill built around <b>{sessionSource.word.display}</b> (/{formatIPA(sessionSource.word.ipa, display)}/)
                {sessionSounds.length > 0 && (
                  <> and its difficult sound{sessionSounds.length === 1 ? '' : 's'} {sessionSounds.map((p) => `/${p}/`).join(' ')}</>
                )} — practising the word, its context in speech, and its key sounds.
              </>
            ) : sessionSource?.type === 'trouble' ? (
              <>
                Targeted drill built from your trouble words and their weak sounds
                {sessionSounds.length > 0 && <> ({sessionSounds.map((p) => `/${p}/`).join(' ')})</>} —
                saying them in running speech until the tongue learns the pattern.
              </>
            ) : (
              <>
                {session.steps.length} short line{session.steps.length === 1 ? '' : 's'} chosen to
                work {sessionSounds.map((phone) => `/${phone}/`).join(' ')} into ordinary speech —
                a sound said on its own always comes out better than it does in a sentence.
                {session.missing.length > 0 && (
                  <> Nothing in the bank drills {session.missing.map((p) => `/${p}/`).join(' ')}.</>
                )}
              </>
            )}
          </p>

          <ol className="drill-steps">
            {session.steps.map((one, i) => {
              const gone = lineProgress(attempts, one.phrase.text)
              return (
                <li key={one.phrase.text} className={i === stepAt ? 'on' : ''}>
                  <button className="pick" onClick={() => stepTo(i)}>
                    <span className="i">{i + 1}</span>
                    <span className="t">{one.phrase.text}</span>
                    <span className="covers">
                      {one.covers.map((hit) => (
                        <span key={hit.phone} className="hit">
                          <b className="ipa">{hit.phone}</b>×{hit.count}
                        </span>
                      ))}
                    </span>
                    {gone ? (
                      <span className={`n ${band(gone.best)}`} title={`best of ${gone.tries}`}>
                        {gone.best}
                      </span>
                    ) : (
                      <span className="n empty">–</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ol>

          <div className="drill-nav">
            <button onClick={() => stepTo(stepAt - 1)} disabled={stepAt === 0}>
              ← previous
            </button>
            <span className="where">
              line <b>{stepAt + 1}</b> of {session.steps.length}
              {!onStep && ' · the box has been edited away from it'}
            </span>
            <button
              onClick={() => stepTo(stepAt + 1)}
              disabled={stepAt >= session.steps.length - 1}
            >
              next line →
            </button>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="mode-switch" role="group" aria-label="Practice mode">
          <button
            className={mode === 'scripted' ? 'on' : ''}
            onClick={() => { setMode('scripted'); setAligned(null); setHeard([]) }}
          >
            Read a script
            <span className="desc">Choose the words, then say them</span>
          </button>
          <button
            className={mode === 'free' ? 'on' : ''}
            onClick={() => { setMode('free'); setAligned(null); setHeard([]); setTarget('') }}
          >
            Speak freely
            <span className="desc">Say anything; the words are recognised for you</span>
          </button>
        </div>

        {mode === 'scripted' && sentences.length > 1 && (
          <div className="sentence-picker">
            {sentences.map((s, i) => (
              <button
                key={i}
                className={s === target ? 'on' : ''}
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
                {s.length > 46 ? s.slice(0, 44) + '…' : s}
              </button>
            ))}
          </div>
        )}

        {(mode === 'scripted' || target) && (
          <>
            {mode === 'free' && (
              <p className="heard-label">
                {corrected ? 'Corrected to' : 'Heard you say'} — edit it if that is wrong and the
                score updates instantly:
              </p>
            )}
            <textarea
              className="target-input"
              value={target}
              onChange={(e) => editTarget(e.target.value)}
              placeholder={
                mode === 'free'
                  ? 'Your words will appear here after recording…'
                  : 'Type or paste a phrase to practise…'
              }
              rows={2}
            />
            {expectedIPA && <p className="target-ipa">/{formatIPA(expectedIPA, display)}/</p>}
          </>
        )}

        {mode === 'free' && !target && phase === 'idle' && (
          <p className="free-hint">
            Press record and say whatever you like. The words are recognised from the audio,
            then every sound is checked against how that word should be pronounced.
          </p>
        )}

        <div className="practice-actions">
          {(mode === 'scripted' || target) && (
            <button
              onClick={() => toggle('target')}
              disabled={!target || busy || phase === 'recording'}
            >
              {playing === 'target'
                ? '■ Stop'
                : mode === 'free'
                  ? '♪ Hear it correctly'
                  : '♪ Listen'}
            </button>
          )}

          {phase === 'recording' ? (
            <button className="recording" onClick={finishRecording}>
              ■ Stop &amp; analyse
            </button>
          ) : (
            <button
              className="primary"
              onClick={beginRecording}
              disabled={busy || (mode === 'scripted' && !target)}
            >
              ● Record
            </button>
          )}

          {phase === 'recording' && (
            <span className="level">
              <i style={{ width: `${Math.min(100, level * 140)}%` }} />
            </span>
          )}
        </div>

        {playback && phase !== 'recording' && (
          <div className="mini-player">
            <button
              className="play"
              onClick={() => toggle('mine')}
              disabled={busy}
              aria-label={playing === 'mine' ? 'Stop your recording' : 'Play your recording'}
            >
              {playing === 'mine' ? '■' : '▶'}
            </button>
            <span className="who">your recording</span>
            <span
              className="track"
              onClick={seek}
              role="slider"
              tabIndex={-1}
              aria-label="Position"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(played * 100)}
            >
              <i style={{ width: `${played * 100}%` }} />
            </span>
            <span className="time">
              {clock(played * playback.durationMs)} / {clock(playback.durationMs)}
            </span>
          </div>
        )}

        {error && <p className="notice">{error}</p>}

        {(busy || (phase === 'recording' && fetching)) && (
          <div className="loading" style={{ padding: '14px 0' }}>
            <span>
              {load.stage === 'weights'
                ? `${load.detail ?? 'Downloading'} — ${Math.round(load.progress * 100)}%`
                : load.stage === 'library'
                  ? 'Loading the speech runtime…'
                  : 'Listening to your recording…'}
            </span>
            {load.stage === 'weights' && (
              <>
                <span className="bar">
                  <i style={{ width: `${Math.round(load.progress * 100)}%` }} />
                </span>
                <span className="desc">
                  {phase === 'recording'
                    ? 'Downloading while you speak · cached afterwards'
                    : 'One-time download, cached afterwards'}
                  {load.device ? ` · running on ${load.device}` : ''}
                </span>
              </>
            )}
          </div>
        )}

        {phase === 'idle' && backend && (
          <p className="desc" style={{ marginTop: 8 }}>
            Scoring locally on <b>{backend.gpu ?? backend.device}</b> — every sound is measured
            against the one it should have been, rather than guessed at from a transcript.
            Nothing leaves this machine.
          </p>
        )}

        {phase === 'idle' && !backend && !isLoaded('phonemes') && (
          <p className="desc" style={{ marginTop: 8 }}>
            Pressing record starts the download, so it runs while you speak rather than after:
            the phoneme model (~240 MB)
            {mode === 'free' && !isLoaded('words') ? ', then the word model (~145 MB)' : ''}.
            Once only — later attempts start immediately. For more exact scoring, run{' '}
            <code>make dev</code> to start the local service alongside.
          </p>
        )}
      </div>

      {aligned && score && report.length > 0 && (
        <div className="panel">
          {editing !== null && attempts[editing] && editing !== attempts.length - 1 && (
            <div className="viewing">
              <span>
                Reopened your attempt from <b>{stamp(attempts[editing].at)}</b>
                {playback ? ' — the recording is loaded above.' : '.'} Editing the words
                re-scores this attempt, not the newest one.
              </span>
            </div>
          )}

          <div className="score-head">
            <div className={`score-ring ${band(score.overall)}`}>
              <span className="n">{score.overall}</span>
              <span className="k">score</span>
            </div>
            <div className="score-tally">
              <span><b>{score.correct}</b> right</span>
              <span><b>{score.close}</b> close</span>
              <span><b>{score.wrong}</b> wrong</span>
              <span><b>{score.missing}</b> missed</span>
              <span><b>{score.extra}</b> extra</span>
            </div>
            {earlier && (
              <div className={`overall-change ${changeOf(score.overall - earlier.score.overall)}`}>
                {score.overall === earlier.score.overall ? (
                  <>level with {against === 'best' ? 'your best' : 'your last go'}</>
                ) : (
                  <>
                    <b>
                      {score.overall > earlier.score.overall ? '+' : '−'}
                      {Math.abs(score.overall - earlier.score.overall)}
                    </b>{' '}
                    on {against === 'best' ? 'your best' : 'your last go'}
                  </>
                )}
              </div>
            )}
          </div>

          {focus.length > 0 && (
            <div className="focus-row">
              <span className="desc">drilling</span>
              {focus.map((hit) => (
                <span
                  key={hit.phone}
                  className={`focus-chip ${
                    hit.right === hit.seen
                      ? 'good'
                      : hit.right + hit.close >= hit.seen
                        ? 'ok'
                        : 'poor'
                  }`}
                  title={
                    `/${hit.phone}/ was expected ${hit.seen} time${hit.seen === 1 ? '' : 's'} ` +
                    `in this line; ${hit.right} landed` +
                    (hit.close > 0 ? `, ${hit.close} drifted but stayed recognisable` : '')
                  }
                >
                  <b className="ipa">{hit.phone}</b>
                  <span className="n">
                    {hit.right}/{hit.seen}
                  </span>
                </span>
              ))}
              <span className="desc">
                — the rest of the line is only there to carry these
              </span>
            </div>
          )}

          <div className="again">
            <button
              className="primary"
              onClick={again}
              disabled={busy || phase === 'recording' || !target}
            >
              ● Say it again
            </button>
            {session && onStep && stepAt < session.steps.length - 1 && (
              <button onClick={() => stepTo(stepAt + 1)}>next line →</button>
            )}
            {earlier && (
              <span className="basis" role="group" aria-label="Compare with">
                <span className="desc">compare with</span>
                <button
                  className={against === 'previous' ? 'on' : ''}
                  onClick={() => setAgainst('previous')}
                >
                  last go
                </button>
                <button
                  className={against === 'best' ? 'on' : ''}
                  onClick={() => setAgainst('best')}
                >
                  your best
                </button>
              </span>
            )}
            {line && (
              <span className="streak">
                {line.tries === 1 ? (
                  <>first go at this line</>
                ) : (
                  <>
                    <b>{line.tries}</b> goes at this line · best <b>{line.best}</b> ·{' '}
                    {line.latest > line.first ? (
                      <>up <b>{line.latest - line.first}</b> from your first</>
                    ) : line.latest < line.first ? (
                      <>down <b>{line.first - line.latest}</b> from your first</>
                    ) : (
                      <>level with your first</>
                    )}
                  </>
                )}
              </span>
            )}
          </div>

          <h3 className="panel-title" style={{ marginTop: 16 }}>Word by word</h3>
          <div className="word-strip">
            {report.map((word, i) => (
              <button
                key={`${word.text}-${i}`}
                className={`word-chip ${word.verdict}${i === opened ? ' on' : ''}`}
                onClick={() => setOpened(i)}
                title={
                  wordChange[i]
                    ? `${word.score} / 100, ${wordChange[i]! > 0 ? 'up' : 'down'} ` +
                      `${Math.abs(wordChange[i]!)} — click for the sounds`
                    : `${word.score} / 100 — click for the sounds`
                }
              >
                <span className="w">{word.text}</span>
                <span className="n">{word.score}</span>
                {!!wordChange[i] && (
                  <span className={`d ${changeOf(wordChange[i]!)}`}>
                    {wordChange[i]! > 0 ? '▲' : '▼'}
                    {Math.abs(wordChange[i]!)}
                  </span>
                )}
              </button>
            ))}
          </div>
          <p className="legend">
            green: as expected · amber: close · red: off — click a word for its sounds
            {earlier && ' · ▲ better and ▼ worse than the go you are comparing with'}
          </p>

          {open && (
            <div className="word-detail">
              <div className="word-detail-head">
                <b>{open.text}</b>
                <button className="ghost tiny" onClick={() => speak(open.text)}>♪ correct</button>
                {open.span && playback && (
                  <button className="ghost tiny" onClick={() => void playWord(open.span!)}>
                    ▶ yours
                  </button>
                )}
                <span className="want">want /{formatIPA(open.ipa, display)}/</span>
                <span className="got">said /{open.said || '–'}/</span>
              </div>

              <div className="diff">
                {open.steps.map((step, i) => {
                  const moved =
                    step.expectedIndex === null ? undefined : phoneChange.get(step.expectedIndex)
                  return (
                    <span
                      key={i}
                      className={`slot ${step.verdict}${moved && moved !== 'same' ? ` ${moved}` : ''}`}
                      title={
                        moved && moved !== 'same'
                          ? `${tooltip(step)} — ${moved} than ${against === 'best' ? 'your best' : 'last go'}`
                          : tooltip(step)
                      }
                    >
                      {moved === 'better' && <span className="moved up">▲</span>}
                      {moved === 'worse' && <span className="moved down">▼</span>}
                      <span className="want">{step.expected ?? '–'}</span>
                      <span className="got">{step.actual ?? '–'}</span>
                    </span>
                  )
                })}
              </div>

              {notesFor(open).length > 0 ? (
                <ul className="notes">
                  {notesFor(open).map((note, i) => <li key={i}>{note}</li>)}
                </ul>
              ) : (
                <p className="desc" style={{ marginTop: 10 }}>
                  Every sound in this word landed where it should.
                </p>
              )}
            </div>
          )}

          {produced && <p className="heard">whole take heard as /{produced}/</p>}
        </div>
      )}

      {attempts.length > 0 && (
        <div className="panel">
          <h3 className="panel-title">
            History
            <button className="ghost tiny" onClick={clearHistory}>reset</button>
          </h3>
          <p className="desc" style={{ marginBottom: 12 }}>
            {attempts.length} attempt{attempts.length === 1 ? '' : 's'} kept in this browser.
            Click one to bring its words back into the box above, with its score and — where
            the audio survived (▶) — its recording. Recording again adds to this list rather
            than replacing anything.
          </p>

          {/* Status, not a task: the migration runs itself and needs nothing. */}
          {backfill && (
            <p className="desc" style={{ marginBottom: 12 }}>
              Re-measuring earlier attempts on the local service — {backfill.done} of{' '}
              {backfill.total}. They were scored before it was available; the recordings
              are unchanged.
            </p>
          )}

          {/*
            Only worth saying once the migration has had its go: whatever is
            still on the old scale could not be converted, so the trend arrows
            across it are not comparing like with like.
          */}
          {!backfill && mixedScorers(attempts) && (
            <p className="desc" style={{ marginBottom: 12 }}>
              {pendingRescore(attempts)} of these could not be re-measured — their
              recordings are no longer stored — so they sit on the older scale and
              comparisons against them are rough.
            </p>
          )}

          {history.map((group) => (
            <div key={group.label} className="history-group">
              <p className="history-day">{group.label}</p>
              <div className="history-rows">
                {group.items.map(({ attempt, index }) => (
                  <div
                    key={`${attempt.at}-${index}`}
                    className={`history-row${index === editing ? ' on' : ''}`}
                  >
                    <button className="open" onClick={() => void reopen(index)} title={attempt.target}>
                      <span className={`n ${band(attempt.score.overall)}`}>{attempt.score.overall}</span>
                      <span className="t">{attempt.target}</span>
                      <span className="has-audio" aria-hidden="true">
                        {clips.has(attempt.at) ? '▶' : ''}
                      </span>
                      <span className="when">{stamp(attempt.at)}</span>
                    </button>
                    <button
                      className="drop"
                      onClick={() => removeAttempt(index)}
                      title="Delete this attempt and its recording"
                      aria-label={`Delete the attempt from ${stamp(attempt.at)}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="panel trouble-bank">
        <div className="trouble-toolbar">
          <div>
            <h3 className="panel-title" style={{ margin: 0 }}>
              Trouble Words Bank
              <span className="count-badge">{struggles.length}</span>
            </h3>
            <p className="desc" style={{ margin: '4px 0 0' }}>
              Words that give you trouble across takes. Stored here for reference so you can review them and generate targeted drills around them.
            </p>
          </div>
          <div className="trouble-header-actions">
            {struggles.length > 0 && (
              <>
                <button
                  className="primary"
                  onClick={drillAllTrouble}
                  title="Generate a custom drill session covering your trouble words"
                >
                  ⚡ Drill trouble words
                </button>
                <button className="ghost tiny" onClick={clearTroubles} title="Clear all words from trouble bank">
                  reset bank
                </button>
              </>
            )}
          </div>
        </div>

        <form className="trouble-add-form" onSubmit={handleAddWord}>
          <input
            type="text"
            className="trouble-add-input"
            value={newWordInput}
            onChange={(e) => { setNewWordInput(e.target.value); setNewWordError(null) }}
            placeholder="Add word to bank (e.g. squirrel)"
          />
          <button type="submit" disabled={!newWordInput.trim()}>
            + Add word
          </button>
          {newWordError && <span className="desc" style={{ color: '#dc2626', marginLeft: 8 }}>{newWordError}</span>}
        </form>

        {struggles.length > 0 && (
          <div className="trouble-toolbar" style={{ borderBottom: 'none', marginBottom: 8, paddingBottom: 0 }}>
            <div className="trouble-filters">
              <span className="desc" style={{ marginRight: 4 }}>Filter:</span>
              <button
                className={troubleFilter === 'all' ? 'on' : ''}
                onClick={() => setTroubleFilter('all')}
              >
                All ({struggles.length})
              </button>
              <button
                className={troubleFilter === 'struggles' ? 'on' : ''}
                onClick={() => setTroubleFilter('struggles')}
              >
                Needs practice ({struggles.filter(isStrugglingLot).length})
              </button>
              <button
                className={troubleFilter === 'pinned' ? 'on' : ''}
                onClick={() => setTroubleFilter('pinned')}
              >
                Pinned ({struggles.filter((e) => e.pinned).length})
              </button>
            </div>
            {struggles.length > 4 && (
              <input
                type="search"
                className="trouble-search"
                value={troubleSearch}
                onChange={(e) => setTroubleSearch(e.target.value)}
                placeholder="Search words…"
              />
            )}
          </div>
        )}

        {visibleStruggles.length > 0 ? (
          <div className="trouble-grid">
            {visibleStruggles.map((entry) => {
              const lot = isStrugglingLot(entry)
              return (
                <div
                  key={entry.word}
                  className={`trouble-card${lot ? ' struggles-lot' : ''}`}
                >
                  <div className="trouble-card-top">
                    <span className="word">{entry.display}</span>
                    <span className="ipa">/{formatIPA(entry.ipa, display)}/</span>
                    <span className="spacer" />
                    <button
                      className={`pin-btn${entry.pinned ? ' on' : ''}`}
                      onClick={() => togglePin(entry.word)}
                      title={entry.pinned ? 'Unpin word' : 'Pin word to keep at top'}
                      aria-label={entry.pinned ? 'Unpin word' : 'Pin word'}
                    >
                      {entry.pinned ? '★' : '☆'}
                    </button>
                    <button
                      className="remove-btn"
                      onClick={() => removeWord(entry.word)}
                      title="Remove from bank / mark mastered"
                      aria-label={`Remove ${entry.display}`}
                    >
                      ×
                    </button>
                  </div>

                  <div className="trouble-stats">
                    <span className="count-tag">
                      {entry.struggleCount} struggle{entry.struggleCount === 1 ? '' : 's'} in {entry.totalAttempts} try{entry.totalAttempts === 1 ? '' : 'ies'}
                    </span>
                    {lot && <span className="lot-tag">Needs practice</span>}
                    {entry.lastScore > 0 && (
                      <span className={`score-tag ${band(entry.lastScore)}`}>
                        last: {entry.lastScore}
                      </span>
                    )}
                  </div>

                  {entry.weakPhones.length > 0 && (
                    <div className="trouble-weak">
                      <span>Problem sounds:</span>
                      {entry.weakPhones.map((p) => (
                        <span key={p.phone} className="sound-tag">
                          /{p.phone}/ {p.count > 1 ? `×${p.count}` : ''}
                        </span>
                      ))}
                    </div>
                  )}

                  {entry.recentSaid.length > 0 && (
                    <div className="trouble-said">
                      Recent take heard as: <i>/{entry.recentSaid[0]}/</i>
                    </div>
                  )}

                  <div className="trouble-actions">
                    <button
                      className="ghost tiny"
                      onClick={() => speak(entry.display)}
                      title="Hear correct pronunciation"
                    >
                      ♪ listen
                    </button>
                    <button
                      className="ghost tiny"
                      onClick={() => practiseWord(entry)}
                      title="Load a contextual phrase into the practice box"
                    >
                      context
                    </button>
                    <button
                      className="tiny accent"
                      onClick={() => drillWord(entry)}
                      title="Generate a targeted practice session around this word"
                    >
                      generate drills →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="trouble-empty">
            {struggles.length === 0 ? (
              <>
                No trouble words recorded yet. As you practise, any words you struggle with repeatedly
                will be automatically banked here so you can generate targeted drills around them.
              </>
            ) : (
              <>No words match the current filter.</>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h3 className="panel-title">{attempts.length > 0 ? 'Your weak sounds' : 'Drills'}</h3>
        <p className="desc" style={{ marginBottom: 12 }}>
          {attempts.length > 0 ? (
            <>
              {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
              {average !== null ? ` · last five averaged ${average}` : ''}
              {attempts.length < 3 && ' · one or two takes is not yet a pattern'}
            </>
          ) : (
            <>
              Nothing recorded yet, so nothing is known to be weak. If you already know which
              sound gives you trouble, pick it and drill it anyway.
            </>
          )}
        </p>

        <div className="drill-build">
          <p className="drill-label">
            {wanted.length === 0
              ? 'Pick the sounds to work on:'
              : `Work on ${wanted.length === 1 ? 'this sound' : 'these sounds'} together:`}
          </p>
          <div className="picks">
            {[...new Set([...weak.map((stat) => stat.phone), ...wanted])].map((phone) => (
              <button
                key={phone}
                className={`sound ${wanted.includes(phone) ? 'on' : ''}`}
                onClick={() => toggleSound(phone)}
                title={
                  PHONES[phone]
                    ? `${PHONES[phone].name} — as in ${PHONES[phone].example}`
                    : phone
                }
              >
                {phone}
              </button>
            ))}
            <button
              className={`add ${browsing ? 'on' : ''}`}
              onClick={() => setBrowsing(!browsing)}
            >
              {browsing ? 'done' : wanted.length === 0 ? 'pick a sound' : '+ any other sound'}
            </button>
          </div>

          {browsing && (
            <div className="inventory">
              {(['vowel', 'diphthong', 'r-coloured', 'consonant'] as const).map((kind) => (
                <div key={kind} className="row">
                  <span className="k">{kind}</span>
                  {DRILLABLE.filter(([, info]) => info.kind === kind).map(([phone, info]) => (
                    <button
                      key={phone}
                      className={`sound ${wanted.includes(phone) ? 'on' : ''}`}
                      onClick={() => toggleSound(phone)}
                      title={`${info.name} — as in ${info.example}`}
                    >
                      {phone}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="go">
            <button
              className="primary"
              onClick={() => startDrill(wanted)}
              disabled={wanted.length === 0}
            >
              Build a drill
              {wanted.length > 0 && ` · ${wanted.length} sound${wanted.length === 1 ? '' : 's'}`}
            </button>
            <span className="desc">
              A handful of short phrases that cover every sound ticked, each one giving it a
              couple of different contexts to survive.
            </span>
          </div>
        </div>

        {attempts.length > 0 && weak.length === 0 && (
          <p className="desc">Nothing consistently wrong yet — keep going.</p>
        )}

        {weak.length > 0 && (
          <div className="weak-list">
            {weak.map((stat) => {
              const swap = dominant(stat.confusions)
              const suggestions = drills ? findDrills(drills, stat.phone, swap?.[0], 4, { randomize: true }) : []
              const lines = phrasesFor(phrases, stat.phone, swap?.[0], 2, { randomize: true })
              return (
                <div key={stat.phone} className="weak-card">
                  <div className="weak-head">
                    <span className="sym">{stat.phone}</span>
                    <span className="meter">
                      <i style={{ width: `${Math.round(stat.errorRate * 100)}%` }} />
                    </span>
                    <span className="pct">{Math.round(stat.errorRate * 100)}%</span>
                    <span className="count">
                      {stat.wrong + stat.missing} off in {stat.seen}
                    </span>
                    <button
                      className="ghost tiny"
                      onClick={() => startDrill([stat.phone])}
                      title={`Build a drill for /${stat.phone}/ on its own`}
                    >
                      drill this
                    </button>
                  </div>

                  <p className="weak-say">
                    {swap ? (
                      <>
                        You said <b className="ipa">/{swap[0]}/</b> instead of{' '}
                        <b className="ipa">/{stat.phone}/</b> — {describeSubstitution(stat.phone, swap[0])}.
                      </>
                    ) : stat.missing > stat.wrong ? (
                      <>
                        You left <b className="ipa">/{stat.phone}/</b> out {stat.missing}
                        {stat.missing === 1 ? ' time' : ' times'}.
                      </>
                    ) : (
                      <>
                        <b className="ipa">/{stat.phone}/</b> is not landing consistently.
                      </>
                    )}
                    {PHONES[stat.phone] && (
                      <> It is the sound in <b>{PHONES[stat.phone].example}</b>.</>
                    )}
                  </p>

                  {suggestions.length > 0 && (
                    <>
                      <p className="drill-label">
                        {suggestions[0].contrast
                          ? 'Say these pairs — the only difference is the sound you are missing:'
                          : 'Practise it in these words:'}
                      </p>
                      <div className="drills">
                        {suggestions.map((drill) => (
                          <button
                            key={drill.word}
                            className="drill"
                            onClick={() => practise(drill)}
                            title="Load this as the next thing to say"
                          >
                            <span className="w">{drill.word}</span>
                            {drill.contrast && (
                              <>
                                <span className="vs">vs</span>
                                <span className="w other">{drill.contrast.word}</span>
                              </>
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {lines.length > 0 && (
                    <>
                      <p className="drill-label">
                        Then put it back into a sentence, where it is harder to keep:
                      </p>
                      <div className="phrase-drills">
                        {lines.map((phrase) => (
                          <button
                            key={phrase.text}
                            className="phrase"
                            onClick={() => sayPhrase(phrase)}
                            title="Load this line into the box above"
                          >
                            <span className="t">{phrase.text}</span>
                            <span className="times">
                              <b className="ipa">{stat.phone}</b>×{phrase.counts.get(stat.phone)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** "Today", "Yesterday" or a date — enough to tell one sitting from another. */
function dayLabel(at: number): string {
  const day = new Date(at).toDateString()
  const today = new Date()
  if (day === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (day === yesterday.toDateString()) return 'Yesterday'
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

function stamp(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** m:ss from milliseconds. */
function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Which way a number moved, for colouring. */
function changeOf(delta: number): string {
  return delta > 0 ? 'up' : delta < 0 ? 'down' : 'level'
}

function band(score: number): string {
  return score >= 85 ? 'good' : score >= 65 ? 'ok' : 'poor'
}

function tooltip(step: AlignedPhone): string {
  if (step.verdict === 'missing') return `/${step.expected}/ was not pronounced`
  if (step.verdict === 'extra') return `extra sound /${step.actual}/`
  if (step.verdict === 'correct') return `/${step.expected}/ — correct`
  return `/${step.expected}/ → /${step.actual}/: ${describeSubstitution(step.expected!, step.actual!)}`
}

/** The few most useful corrections for one word, worst first. */
function notesFor(word: WordReport): string[] {
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
