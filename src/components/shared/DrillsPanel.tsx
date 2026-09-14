import { PHONES } from '../../lib/phones.ts'
import { dominant } from '../../lib/report.ts'
import { findDrills } from '../../lib/drills.ts'
import { phrasesFor } from '../../lib/phrasebank.ts'
import { DRILLABLE, type PracticeState } from '../../lib/usePracticeState.ts'

interface Props {
  practice: PracticeState
  layout?: 'compact' | 'expanded'
}

export function DrillsPanel({ practice, layout = 'compact' }: Props) {
  const {
    weak,
    wanted,
    toggleSound,
    browsing,
    setBrowsing,
    startDrill,
    drills,
    phrases,
    practise,
    sayPhrase,
    attempts,
  } = practice

  return (
    <div className={`drills-panel ${layout}`}>
      <div className="drills-panel-header">
        <h4>{weak.length > 0 ? 'Weak Sounds & Drills' : 'Custom Sound Drills'}</h4>
      </div>

      {/* Sound selector */}
      <div className="drill-builder-box">
        <div className="sound-chips-row">
          {[...new Set([...weak.map((stat) => stat.phone), ...wanted])].map((phone) => (
            <button
              key={phone}
              className={`sound-chip-btn ${wanted.includes(phone) ? 'selected' : ''}`}
              onClick={() => toggleSound(phone)}
              title={PHONES[phone]?.name ?? phone}
            >
              /{phone}/
            </button>
          ))}
          <button
            className={`pill-btn small ${browsing ? 'active' : ''}`}
            onClick={() => setBrowsing(!browsing)}
          >
            {browsing ? 'Close inventory' : '+ Any sound'}
          </button>
        </div>

        {browsing && (
          <div className="full-inventory-matrix">
            {(['vowel', 'diphthong', 'r-coloured', 'consonant'] as const).map((kind) => (
              <div key={kind} className="inventory-kind-group">
                <span className="kind-label">{kind}</span>
                <div className="kind-chips">
                  {DRILLABLE.filter(([, info]) => info.kind === kind).map(([phone, info]) => (
                    <button
                      key={phone}
                      className={`sound-chip-btn small ${wanted.includes(phone) ? 'selected' : ''}`}
                      onClick={() => toggleSound(phone)}
                      title={`${info.name} — ${info.example}`}
                    >
                      /{phone}/
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="drill-build-action">
          <button
            className="primary small"
            onClick={() => startDrill(wanted)}
            disabled={wanted.length === 0}
          >
            ⚡ Start drill ({wanted.length} sound{wanted.length === 1 ? '' : 's'})
          </button>
        </div>
      </div>

      {/* Weak sounds list */}
      {weak.length > 0 && (
        <div className="weak-sounds-list">
          {weak.map((stat) => {
            const swap = dominant(stat.confusions)
            const suggestions = drills ? findDrills(drills, stat.phone, swap?.[0], 3, { randomize: true }) : []
            const lines = phrasesFor(phrases, stat.phone, swap?.[0], 2, { randomize: true })

            return (
              <div key={stat.phone} className="weak-sound-card">
                <div className="weak-sound-head">
                  <div className="sound-metric">
                    <span className="sound-ipa">/{stat.phone}/</span>
                    <div className="error-meter-bar">
                      <div
                        className="error-meter-fill"
                        style={{ width: `${Math.round(stat.errorRate * 100)}%` }}
                      />
                    </div>
                    <span className="error-pct">{Math.round(stat.errorRate * 100)}% off</span>
                  </div>
                  <button
                    className="ghost tiny"
                    onClick={() => startDrill([stat.phone])}
                    title="Generate drill for this sound"
                  >
                    Drill /{stat.phone}/
                  </button>
                </div>

                {swap && (
                  <div className="weak-sound-note">
                    Often heard as <strong>/{swap[0]}/</strong>
                  </div>
                )}

                {/* Minimal pair / Word suggestions */}
                {suggestions.length > 0 && (
                  <div className="drill-pairs-row">
                    {suggestions.map((drill) => (
                      <button
                        key={drill.word}
                        className="pair-chip-btn"
                        onClick={() => practise(drill)}
                        title="Practice this pair"
                      >
                        <span>{drill.word}</span>
                        {drill.contrast && (
                          <>
                            <span className="vs">vs</span>
                            <span>{drill.contrast.word}</span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* Phrase lines */}
                {lines.length > 0 && (
                  <div className="drill-phrases-col">
                    {lines.map((phrase) => (
                      <button
                        key={phrase.text}
                        className="phrase-line-btn"
                        onClick={() => sayPhrase(phrase)}
                        title="Load line into practice"
                      >
                        <span className="phrase-text">{phrase.text}</span>
                        <span className="phrase-badge">
                          /{stat.phone}/×{phrase.counts.get(stat.phone)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {attempts.length === 0 && (
        <div className="drills-empty-hint">
          Pick any sounds above to generate targeted speech exercises.
        </div>
      )}
    </div>
  )
}
