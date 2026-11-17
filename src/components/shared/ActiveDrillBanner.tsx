import type { PracticeState } from '../../lib/usePracticeState.ts'

interface Props {
  practice: PracticeState
  compact?: boolean
}

export function ActiveDrillBanner({ practice, compact }: Props) {
  const { session, sessionSource, sessionSounds, step, stepAt, stepTo, endDrill, shuffleCurrentDrill, onStep } = practice
  if (!session) return null

  const title =
    sessionSource?.type === 'word'
      ? `Drill · ${sessionSource.word.display}`
      : sessionSource?.type === 'trouble'
        ? 'Trouble Words Drill'
        : sessionSource?.type === 'focused'
          ? 'Focused History Drill'
          : 'Sound Drill'

  return (
    <div className={`active-drill-banner ${compact ? 'compact' : ''}`}>
      <div className="drill-banner-header">
        <div className="drill-banner-title">
          <span className="badge-live">ACTIVE DRILL</span>
          <h4>{title}</h4>
        </div>
        <div className="drill-banner-actions">
          <button
            className="ghost tiny drill-new-set"
            onClick={shuffleCurrentDrill}
            title="Randomize new lines for this drill"
          >
            ↻ New lines
          </button>
          <button className="ghost tiny danger-text drill-end" onClick={endDrill}>
            ✕ End drill
          </button>
        </div>
      </div>

      {sessionSounds.length > 0 && (
        <details className="drill-sounds-details">
          <summary>{sessionSounds.length} target sounds</summary>
          <div className="sound-badges">
            {sessionSounds.map((p) => (
              <span key={p} className="badge-sound">/{p}/</span>
            ))}
          </div>
        </details>
      )}

      <nav className="drill-steps-bar" aria-label="Choose a drill line">
        {session.steps.map((one, i) => {
          const isCurrent = i === stepAt
          return (
            <button
              key={`${one.phrase.text}-${i}`}
              className={`step-chip ${isCurrent ? 'active' : ''}`}
              onClick={() => stepTo(i)}
              title={`Line ${i + 1}: ${one.phrase.text}`}
              aria-label={`Line ${i + 1}: ${one.phrase.text}`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="step-num">{i + 1}</span>
            </button>
          )
        })}
      </nav>

      {step?.focusWords && step.focusWords.length > 0 && (
        <div className="drill-focus-words" aria-label="Focus words for this line">
          <div className="drill-focus-heading">
            <span className="drill-focus-label">Focus words</span>
            <span className="drill-focus-hint">Read the full sentence naturally.</span>
          </div>
          <div className="drill-focus-list">
            {step.focusWords.map((focus, index) => (
              <span className="drill-focus-word" key={`${focus.word}-${index}`}>
                <strong>{focus.word}</strong>
                <span>{focus.phones.map((phone) => `/${phone}/`).join(' · ')}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="drill-banner-footer">
        <button
          className="ghost small"
          onClick={() => stepTo(stepAt - 1)}
          disabled={stepAt === 0}
        >
          ← Prev line
        </button>
        <span className="drill-progress-text">
          Line <strong>{stepAt + 1}</strong> of {session.steps.length}
          {!onStep && ' (text modified)'}
        </span>
        <button
          className="ghost small"
          onClick={() => stepTo(stepAt + 1)}
          disabled={stepAt >= session.steps.length - 1}
        >
          Next line →
        </button>
      </div>
    </div>
  )
}
