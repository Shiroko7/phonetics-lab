import { useState } from 'react'
import type { DisplayOptions } from '../../lib/display.ts'
import { synthesise, type Voice } from '../../lib/speech.ts'
import { voiceLabel } from '../../lib/voicePreferences.ts'
import { useVoicePreferences } from '../../lib/useVoicePreferences.ts'
import { VoiceLibrary } from './VoiceLibrary.tsx'

interface Props {
  open: boolean
  onClose: () => void
  display: DisplayOptions
  onDisplay: (next: DisplayOptions) => void
  preferRecording: boolean
  onPreferRecording: (v: boolean) => void
  rate: number
  onRate: (v: number) => void
  voices: Voice[]
  voiceURI: string
  onVoice: (uri: string) => void
  onPreviewVoice: () => void
}

export function SettingsDrawer({
  open,
  onClose,
  display,
  onDisplay,
  preferRecording,
  onPreferRecording,
  rate,
  onRate,
  voices,
  voiceURI,
  onVoice,
  onPreviewVoice: _onPreviewVoice,
}: Props) {
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [showVoices, setShowVoices] = useState(false)
  const [voicePreferences, updateVoicePreferences] = useVoicePreferences()
  if (!open) return null

  const set = <K extends keyof DisplayOptions>(key: K, value: DisplayOptions[K]) =>
    onDisplay({ ...display, [key]: value })

  const currentVoice = voices.find((voice) => voice.uri === voiceURI)

  return (
    <div className="settings-drawer-backdrop" onClick={onClose}>
      <div className="settings-drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-drawer-header">
          <h3>Settings</h3>
          <button className="close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="settings-drawer-content">
          {/* Display settings */}
          <section className="settings-section">
            <h4 className="section-title">Phonetic Display</h4>
            <div className="settings-options-list">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={display.syllables}
                  onChange={(e) => set('syllables', e.target.checked)}
                />
                <div className="checkbox-meta">
                  <span className="checkbox-label">Syllable boundaries</span>
                  <span className="checkbox-sub">Display syllable dots between phones</span>
                </div>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={display.flapping}
                  onChange={(e) => set('flapping', e.target.checked)}
                />
                <div className="checkbox-meta">
                  <span className="checkbox-label">Flapped t/d ([ɾ])</span>
                  <span className="checkbox-sub">Represent General American tap in water [ˈwɑ.ɾɚ]</span>
                </div>
              </label>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={display.merged}
                  onChange={(e) => set('merged', e.target.checked)}
                />
                <div className="checkbox-meta">
                  <span className="checkbox-label">Cot–caught merger</span>
                  <span className="checkbox-sub">Merge /ɔ/ into /ɑ/</span>
                </div>
              </label>
            </div>
          </section>

          {/* Voice synthesis settings */}
          <section className="settings-section">
            <h4 className="section-title">Speech Audio</h4>
            <div className="settings-options-list">
              <div className="studio-voice-summary">
                <div><span className="voice-caption">Studio reference voice</span><strong>{currentVoice ? voiceLabel(currentVoice) : 'No allowed voice'}</strong>
                  <small>{currentVoice?.lang ?? 'Restore a speaker below'} · Daily rotates voices separately</small></div>
                <div className="voice-card-actions"><button className="ghost small" disabled={!currentVoice} onClick={() => {
                  setPreviewError(null)
                  synthesise('The river carried the little boat beyond the old bridge.', { voiceURI, rate, onError: setPreviewError })
                }}>Preview</button><button className="ghost small" aria-expanded={showVoices} onClick={() => setShowVoices((value) => !value)}>Change voice</button></div>
              </div>
              {showVoices && <VoiceLibrary mode="studio" voices={voices} preferences={voicePreferences} selectedURI={voiceURI}
                onPreferences={updateVoicePreferences} onChoose={(voice) => { onVoice(voice.uri); setPreviewError(null) }} onClose={() => setShowVoices(false)} />}
              {previewError && <p className="transport-error-banner" role="alert">{previewError}</p>}

              <div className="speed-slider-box">
                <div className="speed-slider-header">
                  <label className="control-label">Speech Speed</label>
                  <span className="speed-value">{rate.toFixed(1)}×</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.1}
                  value={rate}
                  onChange={(e) => onRate(Number(e.target.value))}
                  className="range-input"
                />
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={preferRecording}
                  onChange={(e) => onPreferRecording(e.target.checked)}
                />
                <div className="checkbox-meta">
                  <span className="checkbox-label">Human recordings</span>
                  <span className="checkbox-sub">Play real speaker audio when available</span>
                </div>
              </label>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
