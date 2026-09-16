import { useEffect, useRef, useState } from 'react'
import { stop, synthesise, type Voice } from '../../lib/speech.ts'
import { dailyVoiceCandidates, excludeVoice, isExcluded, uniqueEnglishVoices, voiceKey, voiceLabel, type VoicePreferences } from '../../lib/voicePreferences.ts'
import { OnlineVoiceNotice } from './OnlineVoiceNotice.tsx'

interface Props {
  voices: Voice[]
  preferences: VoicePreferences
  onPreferences: (change: (previous: VoicePreferences) => VoicePreferences) => void
  onClose: () => void
  onChoose?: (voice: Voice) => void
  selectedURI?: string
  mode?: 'daily' | 'studio'
}
const PAGE_SIZE = 5

/** Deliberately bounded: the catalogue never becomes a giant dropdown or list. */
export function VoiceLibrary({ voices, preferences, onPreferences, onClose, onChoose, selectedURI, mode = 'daily' }: Props) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'allowed' | 'excluded'>('allowed')
  const [page, setPage] = useState(0)
  const [playing, setPlaying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const previewActive = useRef(false)
  const silence = () => { generation.current++; if (previewActive.current) stop(); previewActive.current = false; setPlaying(null) }
  useEffect(() => () => { generation.current++; if (previewActive.current) stop() }, [])
  const candidates = mode === 'daily' ? dailyVoiceCandidates(voices, preferences) : uniqueEnglishVoices(voices)
  const allowed = candidates.filter((voice) => !isExcluded(voice, preferences))
  const search = query.trim().toLowerCase()
  const rows = tab === 'allowed'
    ? allowed.filter((voice) => `${voiceLabel(voice)} ${voice.lang} ${voice.source ?? 'browser'}`.toLowerCase().includes(search))
      .map((voice) => ({ key: voiceKey(voice), name: voiceLabel(voice), lang: voice.lang, voice }))
    : preferences.excluded.filter((voice) => `${voice.name} ${voice.lang}`.toLowerCase().includes(search))
      .map((voice) => ({ ...voice, voice: voices.find((item) => voiceKey(item) === voice.key) }))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages - 1)
  const preview = (voice: Voice) => {
    const wasPlaying = playing === voice.uri
    silence(); setError(null)
    if (wasPlaying) return
    const token = generation.current
    previewActive.current = true
    setPlaying(voice.uri)
    synthesise('The river carried the little boat beyond the old bridge.', {
      voiceURI: voice.uri,
      onEnd: () => { if (generation.current === token) { previewActive.current = false; setPlaying(null) } },
      onError: (message) => { if (generation.current === token) { previewActive.current = false; setPlaying(null); setError(message) } },
    })
  }
  return <section className="voice-library" aria-label="Voice library">
    <div className="voice-library-heading"><div><h3>Your voices</h3><p>Exclude any speaker you dislike. Restore them here anytime.</p></div>
      <button className="ghost small" onClick={onClose} aria-label="Close voice library">Done</button></div>
    {mode === 'daily' && <div className="voice-accent-filter" role="group" aria-label="Daily voice accents">
      {(['en-US', 'all'] as const).map((accent) => <button key={accent} className="ghost small" aria-pressed={preferences.accent === accent}
        onClick={() => { silence(); setPage(0); onPreferences((previous) => ({ ...previous, accent })) }}>{accent === 'en-US' ? 'US English' : 'All English accents'}</button>)}
    </div>}
    <div className="voice-library-toolbar">
      <div className="voice-library-tabs" role="group" aria-label="Voice lists">
        <button aria-pressed={tab === 'allowed'} onClick={() => { setTab('allowed'); setPage(0) }}>Allowed ({allowed.length})</button>
        <button aria-pressed={tab === 'excluded'} onClick={() => { setTab('excluded'); setPage(0) }}>Excluded ({preferences.excluded.length})</button>
      </div>
      <input type="search" aria-label="Search voices" placeholder="Search name or accent" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} />
    </div>
    <div className="voice-library-list">{rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map((item) => <div className="voice-library-item" key={item.key}>
      <div><strong>{item.name}</strong><small>{item.lang} · {item.voice?.source === 'edge' ? 'Free online' : item.voice ? 'Browser voice' : 'Currently unavailable'}{item.voice?.uri === selectedURI ? ' · Current' : ''}</small></div>
      <div className="voice-library-actions">
        {item.voice && <button className="ghost small" aria-label={`Preview ${item.name}`} onClick={() => preview(item.voice!)}>{playing === item.voice.uri ? 'Stop' : 'Preview'}</button>}
        {tab === 'excluded' ? <button className="ghost small" aria-label={`Restore ${item.name}`} onClick={() => {
          silence(); onPreferences((previous) => ({ ...previous, excluded: previous.excluded.filter((entry) => entry.key !== item.key) }))
        }}>Restore</button> : <>
          {onChoose && item.voice && <button className="ghost small" disabled={item.voice.uri === selectedURI} aria-label={`Use ${item.name}`} onClick={() => { silence(); onChoose(item.voice!); onClose() }}>Use</button>}
          <button className="ghost small" aria-label={`Exclude ${item.name}`} onClick={() => { silence(); onPreferences((previous) => excludeVoice(previous, item.voice!)) }}>Exclude</button>
        </>}
      </div>
    </div>)}</div>
    {!rows.length && <p className="voice-library-empty">{query ? 'No voices match your search.' : tab === 'excluded' ? 'No excluded voices. Dislike a speaker? Exclude them directly on a card.' : 'No allowed voices in this pool. Restore an excluded speaker, change the accent filter, or refresh voices below.'}</p>}
    {pages > 1 && <div className="voice-library-pagination"><button className="ghost small" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous voices</button>
      <span>{currentPage + 1} / {pages}</span><button className="ghost small" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>More voices</button></div>}
    {error && <p className="transport-error-banner" role="alert">{error}</p>}
    <details className="voice-service-details"><summary>Voice service &amp; privacy</summary><OnlineVoiceNotice /></details>
  </section>
}
