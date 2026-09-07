import { useCallback, useRef } from 'react'
import type { AnalyzedToken } from '../lib/analyze.ts'
import { formatIPA, type DisplayOptions } from '../lib/display.ts'
import { respell } from '../lib/phonology.ts'

export type Annotation = 'none' | 'ipa' | 'respelling'

interface Props {
  tokens: AnalyzedToken[]
  display: DisplayOptions
  annotation: Annotation
  activeIndex: number | null
  speaking: string | null
  onHover: (index: number | null, rect: DOMRect | null) => void
  onSelect: (index: number) => void
}

/**
 * Renders the passage with every word hoverable. Pointer handling is delegated
 * to the container so a long document does not attach thousands of listeners.
 */
export function Reading({
  tokens,
  display,
  annotation,
  activeIndex,
  speaking,
  onHover,
  onSelect,
}: Props) {
  const container = useRef<HTMLDivElement>(null)

  const wordAt = (target: EventTarget | null): HTMLElement | null => {
    const el = target as HTMLElement | null
    const word = el?.closest?.('[data-index]') as HTMLElement | null
    return word && container.current?.contains(word) ? word : null
  }

  const handleOver = useCallback(
    (event: React.MouseEvent) => {
      const word = wordAt(event.target)
      if (!word) return
      const index = Number(word.dataset.index)
      if (!tokens[index]?.pron) return
      onHover(index, word.getBoundingClientRect())
    },
    [tokens, onHover],
  )

  const handleOut = useCallback(
    (event: React.MouseEvent) => {
      const from = wordAt(event.target)
      const to = wordAt(event.relatedTarget)
      if (from && from !== to) onHover(null, null)
    },
    [onHover],
  )

  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      const word = wordAt(event.target)
      if (!word) return
      const index = Number(word.dataset.index)
      if (tokens[index]?.pron) onSelect(index)
    },
    [tokens, onSelect],
  )

  if (tokens.length === 0) {
    return (
      <div className="panel reading">
        <p className="empty">Paste a passage above and it will appear here, word by word.</p>
      </div>
    )
  }

  return (
    <div
      ref={container}
      className={`panel reading${annotation !== 'none' ? ' inline-annotations' : ''}`}
      onMouseOver={handleOver}
      onMouseOut={handleOut}
      onClick={handleClick}
    >
      {tokens.map((token, i) => {
        if (!token.isWord) return <span key={i}>{token.text}</span>

        const { pron } = token
        if (!pron) {
          return (
            <span key={i} className="word unknown" title="No pronunciation found">
              {token.text}
            </span>
          )
        }

        const classes = [
          'word',
          `src-${pron.source}`,
          activeIndex === i ? 'active' : '',
          speaking === pron.word ? 'speaking' : '',
        ]
          .filter(Boolean)
          .join(' ')

        if (annotation === 'none') {
          return (
            <span key={i} className={classes} data-index={i}>
              {token.text}
            </span>
          )
        }

        // Ruby reserves room for the annotation, so a long expansion such as
        // "1,250" widens its own word instead of colliding with its neighbours.
        // Spaces inside the annotation would split it into several ruby pairs
        // and scatter the base word, so they are held together as hard spaces.
        const text = annotation === 'ipa' ? formatIPA(pron.ipa, display) : respell(pron.ipa)
        return (
          <ruby key={i} className={classes} data-index={i}>
            {token.text}
            <rt className={annotation === 'respelling' ? 'respelling' : undefined}>
              {text.replace(/ /g, ' ')}
            </rt>
          </ruby>
        )
      })}
    </div>
  )
}
