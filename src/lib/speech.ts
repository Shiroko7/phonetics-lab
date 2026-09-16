/**
 * Pronunciation audio.
 *
 * Speech synthesis is the primary path and can say arbitrary text. Available
 * voices depend on the browser; online voices require a connection. Recordings from
 * dictionaryapi.dev are an optional garnish: they are fetched in the background
 * and only used once already cached, so a slow or unreachable API can never
 * delay a click.
 */

const AUDIO_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/'
const FETCH_TIMEOUT_MS = 2500
const VOICE_API = 'http://127.0.0.1:8000/tts'

/** word -> recording URL, null once we know there is none, undefined if unasked. */
const audioCache = new Map<string, string | null>()
const inFlight = new Set<string>()

let current: HTMLAudioElement | null = null
let currentURL: string | null = null
let currentRequest: AbortController | null = null
let generation = 0
let onlineVoices: Voice[] = []
let voiceRequest: Promise<void> | null = null
const voiceListeners = new Set<(voices: Voice[]) => void>()
let onlineStatus: { phase: 'idle' | 'loading' | 'ready' | 'error'; message: string } = {
  phase: 'idle', message: '',
}

export function onlineVoiceStatus() { return onlineStatus }

export function supportsSpeech(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/* ------------------------------------------------------------------ voices */

export interface Voice {
  uri: string
  name: string
  lang: string
  /** Best-effort guess from the voice name, for labelling only. */
  gender: 'male' | 'female' | 'unknown'
  /**
   * Installed on the machine rather than synthesised in the cloud. Windows
   * "Online (Natural)" voices are remote: they sound better but every phrase
   * costs a network round-trip, which is very noticeable word by word.
   */
  local: boolean
  source?: 'browser' | 'edge'
}

const MALE = /\b(david|mark|guy|christopher|eric|roger|steffan|alex|daniel|george|james|ryan|thomas|william|brian|liam|arthur|fred|oliver|aaron|tom|rishi|connor|neerja)\b/i
const FEMALE = /\b(zira|aria|jenny|michelle|ana|samantha|susan|catherine|hazel|linda|natasha|clara|emily|sonia|libby|maisie|olivia|ava|allison|joanna|karen|moira|tessa|fiona|victoria|serena|nicky|amelie)\b/i

function guessGender(name: string): Voice['gender'] {
  if (MALE.test(name)) return 'male'
  if (FEMALE.test(name)) return 'female'
  return 'unknown'
}

/** Brian is the preferred reference; matching ignores vendor prefixes. */
export function isBrianVoice(voice: Pick<Voice, 'name'>): boolean {
  return /\bbrian(?:\b|multilingual|neural)/i.test(voice.name)
}

/** A vendor label, not a claim that we have evaluated the voice's quality. */
export function isNaturalVoice(voice: Pick<Voice, 'name'>): boolean {
  return /natural|neural|premium|enhanced|dragonhd/i.test(voice.name)
}

export function rankVoices(voices: Voice[]): Voice[] {
  return [...voices].sort((a, b) => {
    const brian = Number(isBrianVoice(b)) - Number(isBrianVoice(a))
    if (brian) return brian
    const natural = Number(isNaturalVoice(b)) - Number(isNaturalVoice(a))
    if (natural) return natural
    const american = Number(/^en[-_]US$/i.test(b.lang)) - Number(/^en[-_]US$/i.test(a.lang))
    if (american) return american
    return a.name.localeCompare(b.name)
  })
}

export function defaultVoice(voices: Voice[]): Voice | undefined {
  return rankVoices(voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang)))[0]
}

/** Browser and free online English voices, with Brian and natural voices first. */
export function listVoices(): Voice[] {
  const browserVoices: Voice[] = !supportsSpeech() ? [] : window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .map((v) => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
      gender: guessGender(v.name),
      local: v.localService,
      source: 'browser' as const,
    }))
  return rankVoices([...browserVoices, ...onlineVoices])
}

function emitVoices(): void {
  const voices = listVoices()
  voiceListeners.forEach((listener) => listener(voices))
}

/** No credentials or paid provider. The local service fetches the free catalogue. */
export function refreshOnlineVoices(): Promise<void> {
  if (voiceRequest) return voiceRequest
  onlineStatus = { phase: 'loading', message: 'Loading free online voices…' }
  emitVoices()
  voiceRequest = (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await fetch(`${VOICE_API}/voices`, { signal: controller.signal })
      if (!response.ok) throw new Error('Voice catalogue unavailable')
      const data = await response.json() as { voices?: { id: string; name: string; lang: string; gender: string }[] }
      if (!Array.isArray(data.voices)) throw new Error('Invalid voice catalogue')
      const catalogue = data.voices
      onlineVoices = catalogue.filter((voice) => typeof voice.id === 'string' && /^en-[A-Z]{2}-[A-Za-z]+Neural$/.test(voice.id))
        .filter((voice) => voice.id.includes('Multilingual') || !catalogue.some((other) => other.id === voice.id.replace(/Neural$/, 'MultilingualNeural')))
        .map((voice) => ({
          uri: `edge:${voice.id}`, name: `${voice.id.replace(/^en-[A-Z]{2}-/, '').replace(/(?:Multilingual)?Neural$/, '')}${voice.id.includes('Multilingual') ? ' Multilingual' : ''} (Natural · free online)`,
          lang: voice.lang, gender: voice.gender === 'male' ? 'male' : voice.gender === 'female' ? 'female' : 'unknown',
          local: false, source: 'edge',
        }))
      onlineStatus = { phase: 'ready', message: `${onlineVoices.length} free online voices available.` }
    } catch {
      onlineStatus = { phase: 'error', message: 'Free online voices need the local voice service and an internet connection. Start the app with npm run dev, then refresh voices.' }
    } finally {
      clearTimeout(timer)
      voiceRequest = null
      emitVoices()
    }
  })()
  return voiceRequest
}

/**
 * Nudge the speech engine into life with a silent utterance, so the first word
 * the reader actually clicks does not pay for engine or connection start-up.
 */
export function warmUp(): void {
  if (!supportsSpeech()) return
  try {
    const utterance = new SpeechSynthesisUtterance(' ')
    utterance.volume = 0
    utterance.lang = 'en-US'
    window.speechSynthesis.speak(utterance)
  } catch {
    // Priming is an optimisation; failing to prime changes nothing else.
  }
}

/**
 * Voices load asynchronously in Chromium browsers: the first getVoices() is
 * usually empty. Calls back once the real list arrives.
 */
export function onVoicesReady(callback: (voices: Voice[]) => void): () => void {
  voiceListeners.add(callback)
  callback(listVoices())
  if (supportsSpeech() && voiceListeners.size === 1) window.speechSynthesis.addEventListener('voiceschanged', emitVoices)
  if (onlineStatus.phase === 'idle') void refreshOnlineVoices()
  return () => {
    voiceListeners.delete(callback)
    if (supportsSpeech() && voiceListeners.size === 0) window.speechSynthesis.removeEventListener('voiceschanged', emitVoices)
  }
}

function resolveVoice(uri?: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (uri) {
    const chosen = voices.find((v) => v.voiceURI === uri)
    if (chosen) return chosen
  }
  const preferred = defaultVoice(listVoices().filter((voice) => voice.source !== 'edge'))
  return voices.find((voice) => voice.voiceURI === preferred?.uri) ?? null
}

/* ------------------------------------------------------------- recordings */

/**
 * Fetch a recording URL in the background. Never awaited by a click path; it
 * simply warms the cache so a later click can use it.
 */
export function prefetchRecording(word: string): void {
  const key = word.toLowerCase()
  if (audioCache.has(key) || inFlight.has(key)) return
  inFlight.add(key)

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), FETCH_TIMEOUT_MS)

  void (async () => {
    let url: string | null = null
    try {
      const res = await fetch(AUDIO_API + encodeURIComponent(key), { signal: abort.signal })
      if (res.ok) {
        const entries: unknown = await res.json()
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            const phonetics = (entry as { phonetics?: { audio?: string }[] }).phonetics ?? []
            const withAudio = phonetics.find((p) => p.audio)
            if (withAudio?.audio) {
              url = withAudio.audio
              break
            }
          }
        }
      }
    } catch {
      // Offline, blocked, rate-limited or timed out: synthesis covers it.
      url = null
    } finally {
      clearTimeout(timer)
      inFlight.delete(key)
      audioCache.set(key, url)
    }
  })()
}

/** A recording already known to be available, if any. */
function cachedRecording(word: string): string | null {
  return audioCache.get(word.toLowerCase()) ?? null
}

/* ---------------------------------------------------------------- speaking */

export interface SpeakOptions {
  rate?: number
  voiceURI?: string
  onEnd?: () => void
  onError?: (message: string) => void
}

export function synthesise(text: string, { rate = 1, voiceURI, onEnd, onError }: SpeakOptions = {}): void {
  stop()
  const token = generation
  const selectedURI = voiceURI ?? defaultVoice(listVoices())?.uri
  if (selectedURI?.startsWith('edge:')) {
    void speakOnline(text, selectedURI.slice(5), rate, token, onEnd, onError)
    return
  }
  if (!supportsSpeech()) {
    onError?.('Speech playback is unavailable in this browser.')
    if (!onError) onEnd?.()
    return
  }
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  utterance.rate = rate
  const voice = resolveVoice(selectedURI)
  if (selectedURI && voice?.voiceURI !== selectedURI) {
    onError?.('This voice is no longer available. Choose another reference voice.')
    if (!onError) onEnd?.()
    return
  }
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }
  utterance.onend = () => { if (token === generation) onEnd?.() }
  utterance.onerror = (event) => {
    if (token !== generation) return
    if (onError) onError(`Reference playback failed (${event.error}). Try another voice.`)
    else onEnd?.()
  }
  try {
    window.speechSynthesis.speak(utterance)
  } catch {
    if (onError) onError('Reference playback failed. Try another voice.')
    else onEnd?.()
  }
}

async function speakOnline(text: string, voice: string, rate: number, token: number,
  onEnd?: () => void, onError?: (message: string) => void): Promise<void> {
  const controller = new AbortController()
  currentRequest = controller
  const timer = setTimeout(() => controller.abort(), 35_000)
  const fail = (message: string) => {
    if (token !== generation) return
    if (onError) onError(message)
    else onEnd?.()
  }
  try {
    const response = await fetch(`${VOICE_API}/speak`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice, rate }), signal: controller.signal,
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null) as { detail?: unknown } | null
      throw new Error(typeof error?.detail === 'string' ? error.detail : 'The free voice service could not play this reference. Try another voice.')
    }
    const blob = await response.blob()
    if (token !== generation) return
    if (!blob.size) throw new Error('The voice service returned no audio. Please try again.')
    const url = URL.createObjectURL(blob)
    currentURL = url
    const audio = new Audio(url)
    current = audio
    let settled = false
    const complete = (failed: boolean) => {
      if (settled || token !== generation) return
      settled = true
      current = null
      currentURL = null
      URL.revokeObjectURL(url)
      if (failed) fail('The reference audio could not be played. Try again or select a browser voice.')
      else onEnd?.()
    }
    audio.onended = () => complete(false)
    audio.onerror = () => complete(true)
    void audio.play().catch(() => complete(true))
  } catch (error) {
    fail(controller.signal.aborted ? 'The free voice service took too long to respond. Please try again.'
      : error instanceof Error ? error.message : 'Free online speech is unavailable. Try a browser voice.')
  } finally {
    clearTimeout(timer)
    if (currentRequest === controller) currentRequest = null
  }
}

export function stop(): void {
  generation++
  currentRequest?.abort()
  currentRequest = null
  if (supportsSpeech()) window.speechSynthesis.cancel()
  if (current) {
    current.onended = null
    current.onerror = null
    current.pause()
  }
  current = null
  if (currentURL) URL.revokeObjectURL(currentURL)
  currentURL = null
}

/**
 * Say one word using the selected voice unless a preferred human recording is
 * already cached. Online synthesis needs a network round-trip before playback.
 */
export function pronounce(
  word: string,
  { preferRecording = false, rate = 1, voiceURI }: SpeakOptions & { preferRecording?: boolean } = {},
): 'recording' | 'synthesis' {
  stop()

  if (preferRecording) {
    const url = cachedRecording(word)
    if (url) {
      try {
        const audio = new Audio(url)
        current = audio
        audio.playbackRate = rate
        void audio.play().catch(() => synthesise(word, { rate, voiceURI }))
        return 'recording'
      } catch {
        // Fall through to synthesis.
      }
    } else {
      // Warm the cache so the next press of this word can use a real voice.
      prefetchRecording(word)
    }
  }

  synthesise(word, { rate, voiceURI })
  return 'synthesis'
}
