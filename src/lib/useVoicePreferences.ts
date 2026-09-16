import { useEffect, useState } from 'react'
import { loadVoicePreferences, saveVoicePreferences, subscribeVoicePreferences, VOICE_PREFERENCES_KEY, type VoicePreferences } from './voicePreferences.ts'

export function useVoicePreferences() {
  const [preferences, setPreferences] = useState(loadVoicePreferences)
  useEffect(() => {
    const unsubscribe = subscribeVoicePreferences(setPreferences)
    const changed = (event: StorageEvent) => {
      if (event.key === VOICE_PREFERENCES_KEY || event.key === null) setPreferences(loadVoicePreferences())
    }
    window.addEventListener('storage', changed)
    return () => { unsubscribe(); window.removeEventListener('storage', changed) }
  }, [])
  const update = (change: (previous: VoicePreferences) => VoicePreferences) => saveVoicePreferences(change(preferences))
  return [preferences, update] as const
}
