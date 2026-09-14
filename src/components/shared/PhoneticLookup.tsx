import { useCallback, useRef, useState } from 'react'
import type { AnalyzedToken, Stats } from '../../lib/analyze.ts'
import type { DisplayOptions } from '../../lib/display.ts'
import { toIPAText } from '../../lib/analyze.ts'
import { supportsSpeech } from '../../lib/speech.ts'
import { Reading, type Annotation } from '../Reading.tsx'
import { WordCard } from '../WordCard.tsx'

const SAMPLE = `The rough coughing ploughman thought it through: though a colonel's schedule \
is thorough, the squirrel's laughter echoed. Phonetics reveals that "read" and "read" are \
spelled alike yet sound apart — 1,250 words later, you have debuggable knowledge.`

interface Props {
  text: string
  setText: (t: string) => void
  tokens: AnalyzedToken[]
  stats: Stats
  display: DisplayOptions
  annotation: Annotation
  setAnnotation: (a: Annotation) => void
  onSay: (word: string) => void
  readingAloud: boolean
  toggleReadAloud: () => void
  preferRecording: boolean
  layout?: 'standard' | 'split' | 'minimal'
}

export function PhoneticLookup({
  text,
  setText,
  tokens,
  stats,
  display,
  annotation,
  setAnnotation,
  onSay,
  readingAloud,
  toggleReadAloud,
  layout = 'standard',
}: Props) {
  const [copied, setCopied] = useState(false)
  const [hover, setHover] = useState<{ index: number; rect: DOMRect } | null>(null)
  const [selectedWordIndex, setSelectedWordIndex] = useState<number | null>(null)
  const hideTimer = useRef<number | undefined>(undefined)

  const copyIPA = async () => {
    if (!tokens.length) return
    await navigator.clipboard.writeText(toIPAText(tokens, display))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const handleHover = useCallback((index: number | null, rect: DOMRect | null) => {
    window.clearTimeout(hideTimer.current)
    if (index === null || !rect) {
      hideTimer.current = window.setTimeout(() => setHover(null), 140)
      return
    }
    setHover({ index, rect })
  }, [])

  const keepCard = useCallback(() => window.clearTimeout(hideTimer.current), [])
  const releaseCard = useCallback(() => {
    hideTimer.current = window.setTimeout(() => setHover(null), 140)
  }, [])

  const handleSelect = useCallback(
    (index: number) => {
      setSelectedWordIndex(index)
      const pron = tokens[index]?.pron
      if (pron) void onSay(pron.word)
    },
    [tokens, onSay],
  )

  const hovered = hover !== null ? tokens[hover.index]?.pron ?? null : null
  const inspectedWord = selectedWordIndex !== null ? tokens[selectedWordIndex]?.pron ?? null : null

  return (
    <div className={`phonetic-lookup-view ${layout}`}>
      <div className="lookup-composer-card">
        <div className="lookup-composer-header">
          <div className="composer-header-left">
            <h3>Phonetic Lookup</h3>
            <span className="composer-tagline">Enter English text to analyze pronunciation &amp; General American IPA</span>
          </div>

          <div className="annotation-mode-pills">
            <span className="annotation-label">Notation:</span>
            <button
              className={`pill-btn small ${annotation === 'none' ? 'active' : ''}`}
              onClick={() => setAnnotation('none')}
            >
              Hover only
            </button>
            <button
              className={`pill-btn small ${annotation === 'ipa' ? 'active' : ''}`}
              onClick={() => setAnnotation('ipa')}
            >
              IPA above
            </button>
            <button
              className={`pill-btn small ${annotation === 'respelling' ? 'active' : ''}`}
              onClick={() => setAnnotation('respelling')}
            >
              Respelled
            </button>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or type any English text here..."
          className="lookup-textarea"
          rows={3}
          spellCheck={false}
        />

        <div className="lookup-action-bar">
          <button className="ghost small" onClick={() => setText(SAMPLE)}>
            Sample sentence
          </button>
          <button
            className="ghost small"
            onClick={() => setText('')}
            disabled={!text}
          >
            Clear
          </button>

          <span className="action-spacer" />

          <button
            className="ghost small"
            onClick={copyIPA}
            disabled={!stats.words}
          >
            {copied ? '✓ Copied IPA' : 'Copy IPA'}
          </button>
          <button
            className={`small ${readingAloud ? 'accent' : ''}`}
            onClick={toggleReadAloud}
            disabled={!text || !supportsSpeech()}
          >
            {readingAloud ? '■ Stop audio' : '▶ Read aloud'}
          </button>
        </div>
      </div>

      <div className="lookup-content-layout">
        <div className="lookup-reading-surface">
          <Reading
            tokens={tokens}
            display={display}
            annotation={annotation}
            activeIndex={hover?.index ?? selectedWordIndex}
            speaking={null}
            onHover={handleHover}
            onSelect={handleSelect}
          />
        </div>

        {layout === 'split' && inspectedWord && (
          <div className="lookup-side-inspector">
            <h4>Word Details</h4>
            <div className="inspected-word-card">
              <div className="inspected-word-top">
                <span className="word-text">{inspectedWord.word}</span>
                <button
                  className="primary tiny"
                  onClick={() => onSay(inspectedWord.word)}
                >
                  ♪ Listen
                </button>
              </div>
              <div className="inspected-word-ipa">/{inspectedWord.ipa}/</div>
              <div className="inspected-meta">
                <span className="meta-tag">Source: {inspectedWord.source}</span>
                {inspectedWord.note && (
                  <span className="meta-tag">{inspectedWord.note}</span>
                )}
              </div>
              {inspectedWord.connectedNote && (
                <div className="inspected-connected-box">
                  <div className="connected-tag">CONNECTED SPEECH</div>
                  <p className="connected-desc">{inspectedWord.connectedNote}</p>
                  {inspectedWord.spellingNote && (
                    <div className="connected-spelling">
                      <strong>Spelling vs sound:</strong> {inspectedWord.spellingNote}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {hovered && hover && layout !== 'split' && (
        <WordCard
          pron={hovered}
          anchor={hover.rect}
          display={display}
          onPlay={onSay}
          onEnter={keepCard}
          onLeave={releaseCard}
        />
      )}
    </div>
  )
}
