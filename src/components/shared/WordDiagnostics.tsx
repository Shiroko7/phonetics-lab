import { formatIPA } from '../../lib/display.ts'
import { practiceClass, soundPracticeStatus, soundScore, wordPracticeStatus } from '../../lib/practicePolicy.ts'
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
  const threshold = practice.practiceThreshold
  const choice = practice.reviewChoices[opened]
  const statuses = report.flatMap((word, i) => word.steps.filter((s) => s.expected).map((s) =>
    soundPracticeStatus(s, threshold, wordPracticeStatus(word, threshold) === 'unscored' || practice.reviewChoices[i] === 'bad-cut')))
  const focused = focus.map((hit) => {
    const sounds = report.flatMap((word, i) => word.steps.filter((s) => s.expected === hit.phone).map((s) =>
      soundPracticeStatus(s, threshold, wordPracticeStatus(word, threshold) === 'unscored' || practice.reviewChoices[i] === 'bad-cut')))
    return { phone: hit.phone, seen: sounds.length, right: sounds.filter((s) => s === 'met').length,
      unscored: sounds.filter((s) => s === 'unscored').length }
  })

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
          <div className={`score-badge-large ${band(score.overall, threshold)}`}>
            <span className="score-value">{score.overall}</span>
            <span className="score-label">AVERAGE</span>
          </div>

          <div className="score-meta">
            <span className="inspection-said">Pronunciation estimate · stress and rhythm aren’t assessed yet</span>
            <span className="inspection-said">Sound practice threshold: {threshold}/100 · a high average can still contain a sound to review</span>
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
              <span className="count-item good"><b>{statuses.filter((s) => s === 'met').length}</b> meet threshold</span>
              <span className="count-item poor"><b>{statuses.filter((s) => s === 'review').length}</b> to review</span>
              <span className="count-item"><b>{statuses.filter((s) => s === 'unscored').length}</b> unassessed</span>
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
          <span className="focus-title">Target sounds meeting threshold:</span>
          {focused.map((hit) => (
            <span
              key={hit.phone}
              className={`focus-chip ${
                hit.unscored > 0
                  ? 'uncertain'
                  : hit.right === hit.seen
                  ? 'good'
                  : 'poor'
              }`}
            >
              <span className="ipa">/{hit.phone}/</span>
              <span className="num">
                {hit.right}/{hit.seen}{hit.unscored > 0 ? ` · ${hit.unscored} unassessed` : ''}
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
              className={`word-chip ${practiceClass(practice.reviewChoices[i] === 'bad-cut' ? 'unscored' : wordPracticeStatus(word, threshold))}${i === opened ? ' active' : ''}`}
              onClick={() => setOpened(i)}
              title={`${word.text}: ${word.score}/100 average · ${wordPracticeStatus(word, threshold) === 'review' ? 'contains a sound below threshold' : wordPracticeStatus(word, threshold) === 'met' ? 'assessed sounds meet threshold' : 'timing unavailable or ambiguous'}`}
            >
              <span className="word-text">{word.text}</span>
              {word.connectedNote && (
                <span className="word-connected-badge" title="Spelling vs. connected speech sound shift">
                  ~
                </span>
              )}
              <span className="word-score">{word.score}</span>
              {practice.reviewChoices[i] && <small>Reviewed</small>}
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
              {open.said && <span className="inspection-said">estimated sounds: /{open.said}/</span>}
            </div>

            <div className="inspection-audio-actions">
              <button
                className="ghost tiny"
                onClick={() => speak(open.text)}
                title="Hear the reference word in isolation"
              >
                ♪ Target
              </button>
              {open.span && playback && choice !== 'bad-cut' && (
                <button
                  className="ghost tiny"
                  onClick={() => void playWord(open.span!)}
                  title="Hear your pronunciation"
                >
                  ▶ Yours
                </button>
              )}
              {open.contextSpan && playback && (
                <button className="ghost tiny" onClick={() => void playWord(open.contextSpan!)} title="Hear your recording with neighboring words">
                  ▶ In context
                </button>
              )}
              <button className="ghost tiny" onClick={() => speak(target)} title="Hear the full reference sentence with connected speech">
                ♪ Reference sentence
              </button>
            </div>
          </div>
          {open.timing === 'ambiguous' && <p className="inspection-said">This word’s estimated timing overlaps another word. Use “In context” to hear it.</p>}

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
              const status = soundPracticeStatus(step, threshold, wordPracticeStatus(open, threshold) === 'unscored' || choice === 'bad-cut')
              const value = status === 'unscored' ? null : soundScore(step)
              return (
                <div
                  key={i}
                  className={`phone-slot ${status === 'met' ? 'correct' : status === 'review' ? 'wrong' : 'unscored'}${moved && moved !== 'same' ? ` ${moved}` : ''}`}
                  title={value === null ? 'Unassessed timing; no pronunciation error inferred.' : tooltip(step, threshold)}
                >
                  <div className="slot-expected">{step.expected ?? '–'}</div>
                  <div className="slot-actual">{step.actual ?? '–'}</div>
                  <span className="slot-score">{value === null ? 'Unassessed' : `${value}/100`}</span>
                  {status === 'review' && <small>Review</small>}
                  {moved === 'better' && <span className="slot-arrow up">▲</span>}
                  {moved === 'worse' && <span className="slot-arrow down">▼</span>}
                </div>
              )
            })}
          </div>

          <div className="review-actions" aria-label="Review this word">
            <p>These choices affect practice suggestions for this observation only—not its score or human benchmark labels.</p>
            <button className="ghost small" aria-pressed={choice === 'accepted'} onClick={() => practice.resolveWordReview(opened, 'accepted')}>Sounds acceptable to me</button>
            <button className="ghost small" aria-pressed={choice === 'later'} onClick={() => practice.resolveWordReview(opened, 'later')}>Practise later</button>
            <button className="ghost small" aria-pressed={choice === 'bad-cut'} onClick={() => practice.resolveWordReview(opened, 'bad-cut')}>Bad word cut</button>
            {choice && <button className="ghost small" onClick={() => practice.resolveWordReview(opened)}>Undo review choice</button>}
            {choice && <p role="status">{choice === 'accepted' ? 'Accepted for practice. Original score preserved.' : choice === 'later' ? 'Kept for later practice; no immediate retry required.' : 'Flagged as a bad cut. Isolated replay is disabled; use In context or record again.'}</p>}
          </div>
          {wordPracticeStatus(open, threshold) === 'unscored' || choice === 'bad-cut' ? <p className="inspection-said">This word needs a timing check, not a pronunciation verdict. Listen in context or record again.</p> : notesFor(open, threshold).length > 0 ? (
            <ul className="inspection-notes">
              {notesFor(open, threshold).map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          ) : (
            <div className="clean-verdict">Assessed sounds meet your practice threshold. This is an estimate, not a guarantee.</div>
          )}
        </div>
      )}

      {produced && (
        <div className="take-acoustic-heard">
          <span className="acoustic-label">Estimated aligned sounds:</span>
          <span className="acoustic-ipa">/{produced}/</span>
        </div>
      )}
    </div>
  )
}
