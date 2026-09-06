import { useLayoutEffect, useRef, useState } from 'react'
import type { Pronunciation } from '../lib/lookup.ts'
import { MARK_INFO, PHONES } from '../lib/phones.ts'
import { formatIPA, type DisplayOptions } from '../lib/display.ts'
import { respell, splitPhones, syllableCount } from '../lib/phonology.ts'

const SOURCE_LABEL: Record<Pronunciation['source'], string> = {
  dictionary: 'dictionary',
  derived: 'derived',
  spelled: 'letters',
  guessed: 'guess',
}

interface Props {
  pron: Pronunciation
  anchor: DOMRect
  display: DisplayOptions
  onPlay: (word: string) => void
  onEnter: () => void
  onLeave: () => void
}

/** Places the card near its word, flipping above and clamping to the viewport. */
function usePosition(anchor: DOMRect) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const gap = 8

    const below = anchor.bottom + gap
    const top = below + height > window.innerHeight - 8 ? anchor.top - height - gap : below

    const wanted = anchor.left + anchor.width / 2 - width / 2
    const left = Math.max(8, Math.min(wanted, window.innerWidth - width - 8))

    setStyle({ top: Math.max(8, top), left })
  }, [anchor])

  return { ref, style }
}

export function WordCard({ pron, anchor, display, onPlay, onEnter, onLeave }: Props) {
  const { ref, style } = usePosition(anchor)
  const [focused, setFocused] = useState<string | null>(null)

  const ipa = formatIPA(pron.ipa, display)
  const units = splitPhones(ipa)
  const info = focused ? PHONES[focused] : null
  const mark = focused ? MARK_INFO[focused] : null

  return (
    <div
      ref={ref}
      className="card"
      style={{ top: style?.top ?? -9999, left: style?.left ?? -9999, visibility: style ? 'visible' : 'hidden' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="card-head">
        <span className="card-word">{pron.word}</span>
        <span className={`badge ${pron.source}`}>{SOURCE_LABEL[pron.source]}</span>
        <span className="card-syllables">
          {syllableCount(pron.ipa)} syl
        </span>
      </div>

      <div className="card-ipa">
        /
        {units.map((unit, i) => {
          const known = unit in PHONES
          const isMark = unit === 'ˈ' || unit === 'ˌ'
          const isBreak = unit === '.'
          return (
            <span
              key={i}
              className={
                'phone' + (known ? ' known' : '') + (isMark ? ' mark' : '') + (isBreak ? ' break' : '')
              }
              onMouseEnter={() => setFocused(known || isMark || isBreak ? unit : null)}
              onMouseLeave={() => setFocused(null)}
            >
              {unit}
            </span>
          )
        })}
        /
      </div>

      <div className="card-respell">{respell(pron.ipa)}</div>

      <div className="card-phone-info">
        {info ? (
          <>
            <span className="sym">{focused}</span>
            {info.name}
            <br />
            <span className="eg">as in {info.example}</span>
          </>
        ) : mark ? (
          <>
            <span className="sym">{focused}</span>
            {mark}
          </>
        ) : (
          <span className="hint">Hover a symbol to identify it.</span>
        )}
      </div>

      <div className="card-row">
        <button className="primary" onClick={() => onPlay(pron.word)}>
          ▶ Pronounce
        </button>
      </div>

      {pron.variants.length > 1 && (
        <div className="card-variants">
          <span className="label">also:</span>
          {pron.variants.slice(1).map((v) => (
            <span key={v} className="alt">
              /{formatIPA(v, display)}/
            </span>
          ))}
        </div>
      )}

      {pron.note && <div className="card-note">{pron.note}</div>}
    </div>
  )
}
