import type { DisplayOptions } from '../../lib/display.ts'
import type { Voice } from '../../lib/speech.ts'

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

const REGIONS: Record<string, string> = {
  'en-US': 'US',
  'en-GB': 'UK',
  'en-AU': 'AU',
  'en-CA': 'CA',
  'en-IE': 'IE',
  'en-IN': 'IN',
  'en-NZ': 'NZ',
  'en-ZA': 'ZA',
}

function cleanVoiceLabel(voice: Voice): string {
  const name = voice.name
    .replace(/^Microsoft /, '')
    .replace(/^Google /, '')
    .replace(/ - .*$/, '')
    .replace(/\s*Online\s*/, ' ')
    .replace(/\s*\(Natural\)\s*/, ' ')
    .trim()
  return `${name} (${REGIONS[voice.lang] ?? voice.lang})`
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
  onPreviewVoice,
}: Props) {
  if (!open) return null

  const set = <K extends keyof DisplayOptions>(key: K, value: DisplayOptions[K]) =>
    onDisplay({ ...display, [key]: value })

  const localVoices = voices.filter((v) => v.local)
  const cloudVoices = voices.filter((v) => !v.local)

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
              {voices.length > 0 && (
                <div className="voice-selector-box">
                  <label className="control-label">Voice</label>
                  <div className="voice-input-row">
                    <select
                      value={voiceURI}
                      onChange={(e) => onVoice(e.target.value)}
                      className="voice-select"
                    >
                      {localVoices.length > 0 && (
                        <optgroup label="Installed (Instant)">
                          {localVoices.map((v) => (
                            <option key={v.uri} value={v.uri}>
                              {cleanVoiceLabel(v)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {cloudVoices.length > 0 && (
                        <optgroup label="Online">
                          {cloudVoices.map((v) => (
                            <option key={v.uri} value={v.uri}>
                              {cleanVoiceLabel(v)}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button
                      className="ghost small"
                      onClick={onPreviewVoice}
                      title="Preview this voice"
                    >
                      ▶
                    </button>
                  </div>
                </div>
              )}

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
