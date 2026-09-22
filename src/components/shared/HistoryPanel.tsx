import { band, stamp, type PracticeState } from '../../lib/usePracticeState.ts'

interface Props {
  practice: PracticeState
  layout?: 'compact' | 'expanded'
}

export function HistoryPanel({ practice, layout = 'compact' }: Props) {
  const {
    history,
    editing,
    clips,
    reopen,
    removeAttempt,
    clearHistory,
    attempts,
  } = practice

  if (attempts.length === 0) {
    return (
      <div className={`history-panel ${layout}`}>
        <div className="history-empty-state">
          No practice takes recorded yet. Press Record to capture your first take.
        </div>
      </div>
    )
  }

  return (
    <div className={`history-panel ${layout}`}>
      <div className="history-panel-header">
        <h4>
          History
          <span className="history-count-tag">{attempts.length}</span>
        </h4>
        <button
          className="ghost tiny danger-text"
          onClick={clearHistory}
          title="Clear all attempts"
        >
          Reset
        </button>
      </div>

      <div className="history-groups-container">
        {history.map((group) => (
          <div key={group.label} className="history-day-group">
            <div className="history-day-label">{group.label}</div>
            <div className="history-rows-list">
              {group.items.map(({ attempt, index }) => (
                <div
                  key={`${attempt.at}-${index}`}
                  className={`history-take-row ${index === editing ? 'active' : ''}`}
                >
                  <button
                    className="take-open-btn"
                    onClick={() => void reopen(index)}
                    title={attempt.target}
                  >
                    <span className={`take-score-pill ${band(attempt.score.overall, practice.practiceThreshold)}`}>
                      {attempt.score.overall}
                    </span>
                    <span className="take-phrase-text">{attempt.target}</span>
                    {clips.has(attempt.at) && (
                      <span className="take-audio-indicator" title="Audio recording available">
                        ▶
                      </span>
                    )}
                    <span className="take-time">{stamp(attempt.at)}</span>
                  </button>
                  <button
                    className="take-delete-btn"
                    onClick={() => removeAttempt(index)}
                    title="Delete attempt"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
