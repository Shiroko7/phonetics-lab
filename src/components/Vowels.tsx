import { useEffect, useMemo, useState } from 'react'
import {
  CHART, DIPHTHONGS, place, VOWELS, type Diphthong, type Vowel,
} from '../data/vowels.ts'
import type { Dictionary } from '../lib/dict.ts'
import { loadCommonWords } from '../lib/drills.ts'
import { describeSubstitution } from '../lib/phonefeatures.ts'
import { PHONES } from '../lib/phones.ts'
import { aggregate, type Attempt } from '../lib/practice.ts'
import { spellingGuide } from '../lib/vowelref.ts'

interface Props {
  dict: Dictionary
  attempts: Attempt[]
  /** Speak a word. */
  onPlay: (word: string) => void
  /** Send this sound to Practise as a drill. */
  onPractise: (phone: string) => void
}

/**
 * The vowel quadrilateral.
 *
 * Drawn rather than pictured, because the positions are data: the same two
 * numbers that place a dot also say what the tongue is doing, and a vowel that
 * moves — a diphthong — is the same drawing with an arrow on it.
 *
 * The shape is a trapezium and not a rectangle because the mouth is: as the jaw
 * drops, the range of places the tongue can reach at the front narrows, so the
 * left edge slants inwards. Which is why /i/ and /u/ are far apart at the top
 * and /ɑ/ has almost nowhere left to go at the bottom.
 */
const { width: W, height: H, pad: PAD } = CHART

/** The rows the chart is ruled into, and where they sit. */
const ROWS: [string, number][] = [
  ['high', 0],
  ['mid-high', 0.33],
  ['mid', 0.5],
  ['mid-low', 0.66],
  ['low', 1],
]
/** Rows that are drawn as a line rather than only labelled. */
const RULED = [0.33, 0.66]

export function Vowels({ dict, attempts, onPlay, onPractise }: Props) {
  const [chart, setChart] = useState<'pure' | 'gliding'>('pure')
  const [selected, setSelected] = useState('ɑ')
  /** The frequency list the examples are drawn from; fetched once. */
  const [words, setWords] = useState<string[] | null>(null)

  useEffect(() => {
    let live = true
    void loadCommonWords()
      .then((list) => { if (live) setWords(list) })
      .catch(() => { if (live) setWords([]) })
    return () => { live = false }
  }, [])

  const all: Vowel[] = useMemo(() => [...VOWELS, ...DIPHTHONGS], [])
  const vowel = all.find((one) => one.phone === selected) ?? VOWELS[0]

  const guide = useMemo(
    () => (words ? spellingGuide(vowel.phone, vowel.spellings, dict, words, 6) : []),
    [vowel, dict, words],
  )

  /** What this sound has actually done in practice, if there is any history. */
  const record = useMemo(
    () => aggregate(attempts).find((stat) => stat.phone === vowel.phone) ?? null,
    [attempts, vowel.phone],
  )

  const pick = (phone: string, keyword: string) => {
    setSelected(phone)
    onPlay(keyword)
  }

  const shown: Vowel[] = chart === 'pure' ? VOWELS : DIPHTHONGS
  const info = PHONES[vowel.phone]

  return (
    <div className="main-column vowels">
      <div className="panel">
        <h3 className="panel-title">
          The vowel chart
          <span className="chart-switch view-switch">
            <button className={chart === 'pure' ? 'on' : ''} onClick={() => setChart('pure')}>
              Single
            </button>
            <button className={chart === 'gliding' ? 'on' : ''} onClick={() => setChart('gliding')}>
              Gliding
            </button>
          </span>
        </h3>
        <p className="desc" style={{ marginBottom: 10 }}>
          A map of the mouth seen from the side: left is the front of the tongue, right is the
          back, top is a closed jaw and bottom an open one. Click any vowel to hear it.
          {chart === 'gliding' &&
            ' A diphthong is one vowel sliding into another, so each is drawn as the journey it makes.'}
        </p>

        <svg
          className="quad"
          viewBox={`0 0 ${PAD.left + W + PAD.right} ${PAD.top + H + PAD.bottom}`}
          role="group"
          aria-label={chart === 'pure' ? 'Vowel chart' : 'Diphthong chart'}
        >
          <defs>
            {/* Markers live outside the group that uses them, so they cannot
                inherit its colour — hence one of each. */}
            {['glide', 'glide-on'].map((id) => (
              <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5"
                markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className={id === 'glide' ? 'head' : 'head on'} />
              </marker>
            ))}
          </defs>

          {/* The quadrilateral itself. */}
          <path
            className="frame"
            d={
              `M ${place(0, 0).x} ${place(0, 0).y} L ${place(1, 0).x} ${place(1, 0).y} ` +
              `L ${place(1, 1).x} ${place(1, 1).y} L ${place(0, 1).x} ${place(0, 1).y} Z`
            }
          />

          {RULED.map((height) => (
            <line
              key={height}
              className="rule"
              x1={place(0, height).x}
              y1={place(0, height).y}
              x2={place(1, height).x}
              y2={place(1, height).y}
            />
          ))}

          {/* Front from central: the divide slants with the jaw, like the edge. */}
          <line
            className="rule"
            x1={place(0.45, 0).x} y1={place(0.45, 0).y}
            x2={place(0.45, 1).x} y2={place(0.45, 1).y}
          />

          {(['front', 'central', 'back'] as const).map((label, i) => (
            <text key={label} className="axis" x={place(i * 0.5, 0).x} y={PAD.top - 10}
              textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>
              {label}
            </text>
          ))}

          {ROWS.map(([label, height]) => (
            <text key={label} className="axis" x={PAD.left + W + 26} y={place(1, height).y + 4}>
              {label}
            </text>
          ))}

          {shown.map((one) => {
            const at = place(one.backness, one.height)
            const to =
              'toBackness' in one
                ? place((one as Diphthong).toBackness, (one as Diphthong).toHeight)
                : null
            const front = one.labelSide ? one.labelSide === 'left' : one.backness < 0.5
            const on = one.phone === selected
            return (
              <g
                key={one.phone}
                className={`vowel${on ? ' on' : ''}`}
                onClick={() => pick(one.phone, one.keyword)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    pick(one.phone, one.keyword)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`${one.phone}, as in ${one.keyword}`}
              >
                {to && (
                  <line className="glide" x1={at.x} y1={at.y} x2={to.x} y2={to.y}
                    markerEnd={`url(#glide${on ? '-on' : ''})`} />
                )}
                <circle className="hit" cx={at.x} cy={at.y} r={15} />
                <circle className="dot" cx={at.x} cy={at.y} r={on ? 8 : 6} />
                <text
                  className="sym"
                  x={at.x + (front ? -13 : 13)}
                  y={at.y + 6}
                  textAnchor={front ? 'end' : 'start'}
                >
                  {one.phone}
                </text>
              </g>
            )
          })}
        </svg>

        <p className="legend">
          {chart === 'pure'
            ? 'Two vowels close together on the chart are made in almost the same place — which is exactly why those are the pairs that get confused.'
            : 'The tail of each arrow is where the vowel starts, the head where it lands. Stopping short of the head is what flattens a diphthong.'}
        </p>
      </div>

      <div className="panel vowel-detail">
        <div className="vowel-head">
          <span className="sym">{vowel.phone}</span>
          <div className="who">
            <b>{vowel.keyword}</b>
            <span className="desc">{info ? info.name : ''}</span>
          </div>
          <button onClick={() => onPlay(vowel.keyword)}>♪ hear “{vowel.keyword}”</button>
          <button className="ghost" onClick={() => onPractise(vowel.phone)}>
            practise this sound
          </button>
        </div>

        <p className="vowel-how">{vowel.how}</p>

        {vowel.note && <p className="vowel-note">{vowel.note}</p>}

        {record && record.seen > 0 && (
          <p className="vowel-record">
            In your own attempts this sound has come up <b>{record.seen}</b>{' '}
            {record.seen === 1 ? 'time' : 'times'} and gone wrong <b>{record.wrong + record.missing}</b>{' '}
            of them
            {record.confusions.length > 0 && (
              <> — most often as <b className="ipa">/{record.confusions[0][0]}/</b></>
            )}
            .
          </p>
        )}

        <h4 className="vowel-sub">Mistaken for</h4>
        <div className="near">
          {vowel.confusable.map((other) => (
            <button
              key={other}
              className="other"
              onClick={() => {
                const target = all.find((one) => one.phone === other)
                if (target) pick(target.phone, target.keyword)
                else onPlay(PHONES[other]?.example.split(',')[0].trim() ?? other)
              }}
              title={
                PHONES[other]
                  ? `${PHONES[other].name} — as in ${PHONES[other].example}`
                  : other
              }
            >
              <b className="ipa">{other}</b>
              <span className="why">{describeSubstitution(vowel.phone, other)}</span>
            </button>
          ))}
        </div>

        <h4 className="vowel-sub">How it is written</h4>
        {words === null ? (
          <p className="desc">Loading example words…</p>
        ) : guide.length === 0 ? (
          <p className="desc">No example words could be found for this sound.</p>
        ) : (
          <div className="spellings">
            {guide.map((spelling) => (
              <div key={spelling.pattern} className="spelling">
                <span className="pattern">{spelling.pattern.replace(/_/g, '·')}</span>
                <div className="egs">
                  {spelling.examples.map((word) => (
                    <button key={word} className="eg" onClick={() => onPlay(word)}>
                      {mark(word, spelling.pattern)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="legend">
          Drawn from the five thousand commonest English words, and checked against the
          dictionary: every one of these really does make the sound with those letters.
        </p>
      </div>
    </div>
  )
}

/** Show a word with the letters that make the sound picked out. */
function mark(word: string, pattern: string) {
  const at = word.match(new RegExp(`(?<![aeiouy])${pattern.replace(/_/g, '[a-z]')}(?![aeiouyw])`))
  if (!at || at.index === undefined) return word
  const end = at.index + at[0].length
  const body = word.slice(at.index, end)
  return (
    <>
      {word.slice(0, at.index)}
      {pattern.includes('_') ? (
        // A split digraph: the letter in the middle belongs to neither half.
        <>
          <b>{body.slice(0, 1)}</b>
          {body.slice(1, -1)}
          <b>{body.slice(-1)}</b>
        </>
      ) : (
        <b>{body}</b>
      )}
      {word.slice(end)}
    </>
  )
}
