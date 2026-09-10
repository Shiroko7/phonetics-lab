import type { Stats } from '../lib/analyze.ts'
import type { DisplayOptions } from '../lib/display.ts'
import { PHONES, type PhoneKind } from '../lib/phones.ts'
import type { Voice } from '../lib/speech.ts'
import type { Annotation } from './Reading.tsx'

interface ToggleProps {
  label: string
  desc: string
  checked: boolean
  onChange: (value: boolean) => void
}

function Toggle({ label, desc, checked, onChange }: ToggleProps) {
  return (
    <label className="control">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="control-text">
        {label}
        <span className="desc">{desc}</span>
      </span>
    </label>
  )
}

interface ControlsProps {
  display: DisplayOptions
  onDisplay: (next: DisplayOptions) => void
  annotation: Annotation
  onAnnotation: (next: Annotation) => void
  preferRecording: boolean
  onPreferRecording: (value: boolean) => void
  rate: number
  onRate: (value: number) => void
  voices: Voice[]
  voiceURI: string
  onVoice: (uri: string) => void
  onPreviewVoice: () => void
}

const GENDER_MARK: Record<Voice['gender'], string> = {
  male: '♂',
  female: '♀',
  unknown: '·',
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

/** Tidy a voice for the dropdown: "Microsoft Guy Online (Natural) - English…" -> "Guy · US". */
function label(voice: Voice): string {
  const name = voice.name
    .replace(/^Microsoft /, '')
    .replace(/^Google /, '')
    .replace(/ - .*$/, '')
    .replace(/\s*Online\s*/, ' ')
    .replace(/\s*\(Natural\)\s*/, ' ')
    .trim()
  return `${GENDER_MARK[voice.gender]} ${name} · ${REGIONS[voice.lang] ?? voice.lang}`
}

export function Controls({
  display,
  onDisplay,
  annotation,
  onAnnotation,
  preferRecording,
  onPreferRecording,
  rate,
  onRate,
  voices,
  voiceURI,
  onVoice,
  onPreviewVoice,
}: ControlsProps) {
  const set = <K extends keyof DisplayOptions>(key: K, value: DisplayOptions[K]) =>
    onDisplay({ ...display, [key]: value })

  const localVoices = voices.filter((v) => v.local)
  const cloudVoices = voices.filter((v) => !v.local)
  const selected = voices.find((v) => v.uri === voiceURI)

  return (
    <div className="panel">
      <h3 className="panel-title">Display</h3>

      <div className="segmented" role="group" aria-label="Inline annotation">
        {(
          [
            ['none', 'Hover only'],
            ['ipa', 'IPA above'],
            ['respelling', 'Respelled'],
          ] as [Annotation, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            className={annotation === value ? 'on' : ''}
            onClick={() => onAnnotation(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 10 }}>
        <Toggle
          label="Syllable breaks"
          desc="Show the dots between syllables"
          checked={display.syllables}
          onChange={(v) => set('syllables', v)}
        />
        <Toggle
          label="Flapped t and d"
          desc="water as [ˈwɑ.ɾɚ], the usual American tap"
          checked={display.flapping}
          onChange={(v) => set('flapping', v)}
        />
        <Toggle
          label="Cot–caught merged"
          desc="Collapse /ɔ/ into /ɑ/, as most Americans do"
          checked={display.merged}
          onChange={(v) => set('merged', v)}
        />
      </div>

      <h3 className="panel-title" style={{ marginTop: 16 }}>
        Voice
      </h3>

      {voices.length > 0 ? (
        <>
          <div className="voice-row">
            <select value={voiceURI} onChange={(e) => onVoice(e.target.value)} aria-label="Voice">
              {localVoices.length > 0 && (
                <optgroup label="Installed — instant">
                  {localVoices.map((v) => (
                    <option key={v.uri} value={v.uri}>
                      {label(v)}
                    </option>
                  ))}
                </optgroup>
              )}
              {cloudVoices.length > 0 && (
                <optgroup label="Online — slower, needs network">
                  {cloudVoices.map((v) => (
                    <option key={v.uri} value={v.uri}>
                      {label(v)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button className="ghost" onClick={onPreviewVoice} title="Hear this voice">
              ▶
            </button>
          </div>

          {localVoices.length === 0 ? (
            <p className="notice">
              Every English voice here is a cloud voice, so each word is synthesised over the
              network and the first press is slow. Installing an offline voice fixes it:{' '}
              <strong>Settings → Time &amp; language → Speech → Manage voices → Add voices →
              English</strong>, then reload.
            </p>
          ) : (
            selected &&
            !selected.local && (
              <p className="notice">
                This is a cloud voice, so each word waits on the network. You have{' '}
                {localVoices.length} installed {localVoices.length === 1 ? 'voice' : 'voices'} that
                respond instantly —{' '}
                <button className="link" onClick={() => onVoice(localVoices[0].uri)}>
                  switch to {label(localVoices[0])}
                </button>
                .
              </p>
            )
          )}
        </>
      ) : (
        <p className="desc" style={{ margin: '2px 0 0' }}>
          No speech voices available in this browser.
        </p>
      )}

      <div className="rate-row">
        <span className="desc">Speed</span>
        <input
          type="range"
          min={0.5}
          max={1.5}
          step={0.1}
          value={rate}
          onChange={(e) => onRate(Number(e.target.value))}
        />
        <span className="value">{rate.toFixed(1)}×</span>
      </div>

      <Toggle
        label="Use human recordings"
        desc="Play a real speaker when one has been fetched. Off by default: the lookup is slow and only covers common words, so speech stays instant without it."
        checked={preferRecording}
        onChange={onPreferRecording}
      />
    </div>
  )
}

export function StatsPanel({ stats }: { stats: Stats }) {
  return (
    <div className="panel">
      <h3 className="panel-title">This passage</h3>
      <div className="stats">
        <div className="stat">
          <span className="n">{stats.words.toLocaleString()}</span>
          <span className="k">words</span>
        </div>
        <div className="stat">
          <span className="n">{stats.unique.toLocaleString()}</span>
          <span className="k">unique</span>
        </div>
        <div className="stat">
          <span className="n">{stats.syllables.toLocaleString()}</span>
          <span className="k">syllables</span>
        </div>
        <div className="stat">
          <span className="n">{stats.dictionary.toLocaleString()}</span>
          <span className="k">in dict</span>
        </div>
        <div className="stat derived">
          <span className="n">{stats.derived.toLocaleString()}</span>
          <span className="k">derived</span>
        </div>
        <div className="stat guessed">
          <span className="n">{stats.guessed.toLocaleString()}</span>
          <span className="k">guessed</span>
        </div>
      </div>
    </div>
  )
}

const GROUPS: [PhoneKind, string][] = [
  ['vowel', 'Vowels'],
  ['diphthong', 'Diphthongs'],
  ['r-coloured', 'R-coloured'],
  ['consonant', 'Consonants'],
]

export function PhoneKey({ onPlay }: { onPlay: (word: string) => void }) {
  return (
    <div className="panel">
      <h3 className="panel-title">IPA key</h3>
      {GROUPS.map(([kind, title]) => (
        <div key={kind} className="key-group">
          <h4>{title}</h4>
          <div className="key-grid">
            {Object.entries(PHONES)
              .filter(([, info]) => info.kind === kind)
              .map(([symbol, info]) => {
                const example = info.example.split(',')[0].trim()
                return (
                  <button
                    key={symbol}
                    className="key-cell"
                    title={info.name}
                    onClick={() => onPlay(example)}
                  >
                    <span className="sym">{symbol}</span>
                    <span className="eg">{example}</span>
                  </button>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}
