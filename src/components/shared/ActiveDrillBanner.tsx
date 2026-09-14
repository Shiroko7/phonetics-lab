import type { PracticeState } from '../../lib/usePracticeState.ts'

interface Props {
  practice: PracticeState
  compact?: boolean
}

export function ActiveDrillBanner({ practice, compact }: Props) {
  const { session, sessionSource, sessionSounds, stepAt, stepTo, endDrill, shuffleCurrentDrill, onStep } = practice
  if (!session) return null

  const title =
    sessionSource?.type === 'word'
      ? `Drill · ${sessionSource.word.display}`
      : sessionSource?.type === 'trouble'
        ? 'Trouble Words Drill'
        : 'Sound Drill'

  return (
    <div className={`active-drill-banner ${compact ? 'compact' : ''}`}>
      <div className="drill-banner-header">
        <div className="drill-banner-title">
          <span className="badge-live">ACTIVE DRILL</span>
          <h4>{title}</h4>
          {sessionSounds.length > 0 && (
            <div className="sound-badges">
              {sessionSounds.map((p) => (
                <span key={p} className="badge-sound">/{p}/</span>
              ))}
            </div>
          )}
        </div>
        <div className="drill-banner-actions">
          <button
            className="ghost tiny"
            onClick={shuffleCurrentDrill}
            title="Randomize new lines for this drill"
          >
            ↻ New lines
          </button>
          <button className="ghost tiny danger-text" onClick={endDrill}>
            ✕ End drill
          </button>
        </div>
      </div>

      <div className="drill-steps-bar">
        {session.steps.map((one, i) => {
          const isCurrent = i === stepAt
          return (
            <button
              key={`${one.phrase.text}-${i}`}
              className={`step-chip ${isCurrent ? 'active' : ''}`}
              onClick={() => stepTo(i)}
              title={one.phrase.text}
            >
              <span className="step-num">{i + 1}</span>
              <span className="step-text">{one.phrase.text}</span>
            </button>
          )
        })}
      </div>

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
