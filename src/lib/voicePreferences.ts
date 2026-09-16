import { isNaturalVoice, rankVoices, type Voice } from './speech.ts'

export interface ExcludedVoice { key: string; name: string; lang: string }
export interface VoicePreferences { excluded: ExcludedVoice[]; accent: 'en-US' | 'all' }
export const VOICE_PREFERENCES_KEY = 'phonetics-lab:voice-preferences'

export function voiceLabel(voice: Pick<Voice, 'name'>): string {
  return voice.name.replace(/^(Microsoft|Google)\s+/i, '').replace(/\s*-\s*English.*$/i, '')
    .replace(/\b(Online|Multilingual)\b/gi, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()
}

/** Block the speaker, including browser/online variants of the same named voice. */
export function voiceKey(voice: Pick<Voice, 'name' | 'lang'>): string {
  return `${voice.lang.toLowerCase()}:${voiceLabel(voice).toLowerCase().replace(/[^a-z0-9]/g, '')}`
}

export function loadVoicePreferences(): VoicePreferences {
  try {
    const raw = JSON.parse(localStorage.getItem(VOICE_PREFERENCES_KEY) ?? '{}')
    return { accent: raw?.accent === 'all' ? 'all' : 'en-US', excluded: Array.isArray(raw?.excluded)
      ? raw.excluded.filter((entry: ExcludedVoice) => entry && typeof entry.key === 'string'
        && typeof entry.name === 'string' && typeof entry.lang === 'string') : [] }
  } catch { return { excluded: [], accent: 'en-US' } }
}

const listeners = new Set<(preferences: VoicePreferences) => void>()
export function subscribeVoicePreferences(listener: (preferences: VoicePreferences) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function saveVoicePreferences(preferences: VoicePreferences): void {
  try { localStorage.setItem(VOICE_PREFERENCES_KEY, JSON.stringify(preferences)) } catch { /* Keep this session usable. */ }
  listeners.forEach((listener) => listener(preferences))
}

export function excludeVoice(preferences: VoicePreferences, voice: Voice): VoicePreferences {
  const key = voiceKey(voice)
  return { ...preferences, excluded: [...preferences.excluded.filter((item) => item.key !== key),
    { key, name: voiceLabel(voice), lang: voice.lang }] }
}

export function isExcluded(voice: Voice, preferences: VoicePreferences): boolean {
  return preferences.excluded.some((entry) => entry.key === voiceKey(voice))
}

export function uniqueEnglishVoices(voices: Voice[]): Voice[] {
  // Prefer the online version of duplicate speakers so a browser variant cannot
  // defeat an exclusion or make adjacent cards sound like the same person.
  const sorted = rankVoices(voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang)))
    .sort((a, b) => Number(b.source === 'edge') - Number(a.source === 'edge'))
  return rankVoices(sorted.filter((voice, index) => sorted.findIndex((other) => voiceKey(other) === voiceKey(voice)) === index))
}

export function dailyVoiceCandidates(voices: Voice[], preferences: VoicePreferences): Voice[] {
  const english = uniqueEnglishVoices(voices)
  const accent = preferences.accent === 'all' ? english : english.filter((voice) => /^en[-_]US$/i.test(voice.lang))
  const natural = accent.filter(isNaturalVoice)
  // Choose quality before filtering exclusions. Excluding all natural speakers
  // must not silently substitute robotic voices or an unwanted accent.
  return natural.length ? natural : accent
}

export function allowedDailyVoices(voices: Voice[], preferences: VoicePreferences): Voice[] {
  return dailyVoiceCandidates(voices, preferences).filter((voice) => !isExcluded(voice, preferences))
}
