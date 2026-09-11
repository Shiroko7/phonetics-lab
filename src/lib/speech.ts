/**
 * Pronunciation audio.
 *
 * Speech synthesis is the primary path because it is instant, offline and can
 * say anything — including invented words and names. Human recordings from
 * dictionaryapi.dev are an optional garnish: they are fetched in the background
 * and only used once already cached, so a slow or unreachable API can never
 * delay a click.
 */

const AUDIO_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/'
const FETCH_TIMEOUT_MS = 2500

/** word -> recording URL, null once we know there is none, undefined if unasked. */
const audioCache = new Map<string, string | null>()
const inFlight = new Set<string>()

let current: HTMLAudioElement | null = null

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
}

const MALE = /\b(david|mark|guy|christopher|eric|roger|steffan|alex|daniel|george|james|ryan|thomas|william|brian|liam|arthur|fred|oliver|aaron|tom|rishi|connor|neerja)\b/i
const FEMALE = /\b(zira|aria|jenny|michelle|ana|samantha|susan|catherine|hazel|linda|natasha|clara|emily|sonia|libby|maisie|olivia|ava|allison|joanna|karen|moira|tessa|fiona|victoria|serena|nicky|amelie)\b/i

function guessGender(name: string): Voice['gender'] {
  if (MALE.test(name)) return 'male'
  if (FEMALE.test(name)) return 'female'
  return 'unknown'
}

/**
 * English voices the browser offers. Locally installed voices sort first
 * because they start speaking immediately, which matters far more when
 * pronouncing single words than the extra polish of a cloud voice.
 */
export function listVoices(): Voice[] {
  if (!supportsSpeech()) return []
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith('en'))
    .map((v) => ({
      uri: v.voiceURI,
      name: v.name,
      lang: v.lang,
      gender: guessGender(v.name),
      local: v.localService,
    }))
    .sort((a, b) => {
      // Local before cloud, then en-US, then male voices, then alphabetical.
      if (a.local !== b.local) return a.local ? -1 : 1
      const region = Number(!a.lang.startsWith('en-US')) - Number(!b.lang.startsWith('en-US'))
      if (region) return region
      if (a.gender !== b.gender) {
        if (a.gender === 'male') return -1
        if (b.gender === 'male') return 1
      }
      return a.name.localeCompare(b.name)
    })
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
  if (!supportsSpeech()) return () => {}

  const emit = () => {
    const voices = listVoices()
    if (voices.length) callback(voices)
  }
  emit()
  window.speechSynthesis.addEventListener('voiceschanged', emit)
  return () => window.speechSynthesis.removeEventListener('voiceschanged', emit)
}

function resolveVoice(uri?: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (uri) {
    const chosen = voices.find((v) => v.voiceURI === uri)
    if (chosen) return chosen
  }
  return (
    voices.find((v) => v.lang === 'en-US' && /natural|google/i.test(v.name)) ??
    voices.find((v) => v.lang === 'en-US') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
    null
  )
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
}

export function synthesise(text: string, { rate = 1, voiceURI, onEnd }: SpeakOptions = {}): void {
  if (!supportsSpeech()) return
  window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  utterance.rate = rate
  const voice = resolveVoice(voiceURI)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  }
  if (onEnd) {
    utterance.onend = onEnd
    utterance.onerror = onEnd
  }
  window.speechSynthesis.speak(utterance)
}

export function stop(): void {
  if (supportsSpeech()) window.speechSynthesis.cancel()
  current?.pause()
  current = null
}

/**
 * Say one word. Returns immediately with synthesis unless a human recording is
 * already cached, so there is never a network wait between click and sound.
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
