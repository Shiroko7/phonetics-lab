import { formatIPA } from '../../lib/display.ts'
import {
  band,
  changeOf,
  notesFor,
  tooltip,
  type PracticeState,
} from '../../lib/usePracticeState.ts'

interface Props {
  practice: PracticeState
  compact?: boolean
  hideReplayButtons?: boolean
}

export function WordDiagnostics({ practice, compact, hideReplayButtons }: Props) {
  const {
    aligned,
    score,
    report,
    open,
    opened,
    setOpened,
    earlier,
    against,
    setAgainst,
    wordChange,
    phoneChange,
    focus,
    again,
    busy,
    phase,
    target,
    session,
    onStep,
    stepAt,
    stepTo,
    display,
    speak,
    playWord,
    playback,
    produced,
    editing,
    attempts,
  } = practice

  if (!aligned || !score || report.length === 0) return null

  return (
    <div className={`word-diagnostics-deck ${compact ? 'compact' : ''}`}>
      {editing !== null && attempts[editing] && editing !== attempts.length - 1 && (
        <div className="history-notice">
          <span>Reopened attempt · editing re-scores this attempt</span>
        </div>
      )}

      {/* Top Score Banner */}
      <div className="score-summary-card">
        <div className="score-summary-left">
          <div className={`score-badge-large ${band(score.overall)}`}>
            <span className="score-value">{score.overall}</span>
            <span className="score-label">SCORE</span>
          </div>

          <div className="score-meta">
            {earlier && (
              <div className={`score-delta-chip ${changeOf(score.overall - earlier.score.overall)}`}>
                {score.overall === earlier.score.overall ? (
                  <span>Equal to {against === 'best' ? 'best' : 'last go'}</span>
                ) : (
                  <span>
                    <strong>
                      {score.overall > earlier.score.overall ? '+' : '−'}
                      {Math.abs(score.overall - earlier.score.overall)}
                    </strong>{' '}
                    vs {against === 'best' ? 'best' : 'last go'}
                  </span>
                )}
              </div>
            )}

            <div className="score-counts-row">
              <span className="count-item good"><b>{score.correct}</b> right</span>
              <span className="count-item ok"><b>{score.close}</b> close</span>
              <span className="count-item poor"><b>{score.wrong}</b> wrong</span>
              {score.missing > 0 && <span className="count-item poor"><b>{score.missing}</b> missed</span>}
              {score.extra > 0 && <span className="count-item poor"><b>{score.extra}</b> extra</span>}
            </div>
          </div>
        </div>

        {!hideReplayButtons && (
          <div className="score-actions">
            <button
              className="primary small"
              onClick={again}
              disabled={busy || phase === 'recording' || !target}
            >
              ● Say it again
            </button>
            {session && onStep && stepAt < session.steps.length - 1 && (
              <button className="small accent" onClick={() => stepTo(stepAt + 1)}>
                Next line →
              </button>
            )}
            {earlier && (
              <div className="compare-toggle">
                <button
                  className={against === 'previous' ? 'on' : ''}
                  onClick={() => setAgainst('previous')}
                >
                  Last
                </button>
                <button
                  className={against === 'best' ? 'on' : ''}
                  onClick={() => setAgainst('best')}
                >
                  Best
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {focus.length > 0 && (
        <div className="focus-chips-bar">
          <span className="focus-title">Target sounds:</span>
          {focus.map((hit) => (
            <span
              key={hit.phone}
              className={`focus-chip ${
                hit.right === hit.seen
                  ? 'good'
                  : hit.right + hit.close >= hit.seen
                    ? 'ok'
                    : 'poor'
              }`}
            >
              <span className="ipa">/{hit.phone}/</span>
              <span className="num">
                {hit.right}/{hit.seen}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Word-by-word Strip */}
      <div className="word-by-word-section">
        <div className="word-strip-scroll">
          {report.map((word, i) => (
            <button
              key={`${word.text}-${i}`}
              className={`word-chip ${word.verdict}${i === opened ? ' active' : ''}`}
              onClick={() => setOpened(i)}
              title={word.connectedNote ? `${word.text}: ${word.score}/100 · Connected speech variation` : `${word.score}/100`}
            >
              <span className="word-text">{word.text}</span>
              {word.connectedNote && (
                <span className="word-connected-badge" title="Spelling vs. connected speech sound shift">
                  ~
                </span>
              )}
              <span className="word-score">{word.score}</span>
              {!!wordChange[i] && (
                <span className={`word-delta ${changeOf(wordChange[i]!)}`}>
                  {wordChange[i]! > 0 ? '▲' : '▼'}{Math.abs(wordChange[i]!)}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Word Detail Inspection */}
      {open && (
        <div className="word-inspection-card">
          <div className="inspection-header">
            <div className="inspection-word-info">
              <span className="inspection-text">{open.text}</span>
              <span className="inspection-ipa">/{formatIPA(open.ipa, display)}/</span>
              {open.said && <span className="inspection-said">heard: /{open.said}/</span>}
            </div>

            <div className="inspection-audio-actions">
              <button
                className="ghost tiny"
                onClick={() => speak(open.text)}
                title="Hear reference audio"
              >
                ♪ Target
              </button>
              {open.span && playback && (
                <button
                  className="ghost tiny"
                  onClick={() => void playWord(open.span!)}
                  title="Hear your pronunciation"
                >
                  ▶ Yours
                </button>
              )}
            </div>
          </div>

          {/* Connected Speech Spelling vs Sound Callout */}
          {open.connectedNote && (
            <div className="connected-speech-callout">
              <div className="callout-badge-row">
                <span className="callout-tag">CONNECTED SPEECH</span>
                {open.spellingNote && (
                  <span className="callout-spelling-tag">{open.spellingNote}</span>
                )}
              </div>
              <p className="callout-text">{open.connectedNote}</p>
            </div>
          )}

          {/* Phoneme Alignment Diff */}
          <div className="phone-diff-grid">
            {open.steps.map((step, i) => {
              const moved =
                step.expectedIndex === null ? undefined : phoneChange.get(step.expectedIndex)
              return (
                <div
                  key={i}
                  className={`phone-slot ${step.verdict}${moved && moved !== 'same' ? ` ${moved}` : ''}`}
                  title={tooltip(step)}
                >
                  <div className="slot-expected">{step.expected ?? '–'}</div>
                  <div className="slot-actual">{step.actual ?? '–'}</div>
                  {moved === 'better' && <span className="slot-arrow up">▲</span>}
                  {moved === 'worse' && <span className="slot-arrow down">▼</span>}
                </div>
              )
            })}
          </div>

          {notesFor(open).length > 0 ? (
            <ul className="inspection-notes">
              {notesFor(open).map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          ) : (
            <div className="clean-verdict">All sounds in this word landed cleanly.</div>
          )}
        </div>
      )}

      {produced && (
        <div className="take-acoustic-heard">
          <span className="acoustic-label">Acoustic transcript heard:</span>
          <span className="acoustic-ipa">/{produced}/</span>
        </div>
      )}
    </div>
  )
}
