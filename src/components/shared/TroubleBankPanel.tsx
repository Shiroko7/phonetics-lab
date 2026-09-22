import { formatIPA } from '../../lib/display.ts'
import { isStrugglingLot } from '../../lib/struggles.ts'
import { band, type PracticeState } from '../../lib/usePracticeState.ts'
import { SoundReviewPatterns } from './SoundReviewPatterns.tsx'

interface Props {
  practice: PracticeState
  layout?: 'compact' | 'grid'
}

export function TroubleBankPanel({ practice, layout = 'compact' }: Props) {
  const {
    struggles,
    visibleStruggles,
    troubleFilter,
    setTroubleFilter,
    troubleSearch,
    setTroubleSearch,
    newWordInput,
    setNewWordInput,
    newWordError,
    setNewWordError,
    handleAddWord,
    drillAllTrouble,
    clearTroubles,
    togglePin,
    removeWord,
    speak,
    practiseWord,
    drillWord,
    display,
  } = practice

  return (
    <div className={`trouble-bank-panel ${layout}`}>
      <SoundReviewPatterns practice={practice} />
      <p className="daily-help">Current review queue · {practice.reviewPatterns.scale} · sound threshold {practice.practiceThreshold}/100. Pins are your choices; original recordings and legacy trouble history are retained.</p>
      <div className="trouble-panel-header">
        <div className="trouble-header-info">
          <h4>
            Trouble Words
            <span className="trouble-count-pill">{struggles.length}</span>
          </h4>
        </div>

        <div className="trouble-panel-top-actions">
          {struggles.length > 0 && (
            <button
              className="primary tiny"
              onClick={drillAllTrouble}
              title="Generate drill covering your trouble words"
            >
              ⚡ Drill all
            </button>
          )}
          {struggles.length > 0 && (
            <button
              className="ghost tiny danger-text"
              onClick={clearTroubles}
              title="Reset trouble bank"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Add word form */}
      <form className="trouble-add-bar" onSubmit={handleAddWord}>
        <input
          type="text"
          value={newWordInput}
          onChange={(e) => {
            setNewWordInput(e.target.value)
            setNewWordError(null)
          }}
          placeholder="Add trouble word..."
          className="trouble-add-field"
        />
        <button type="submit" disabled={!newWordInput.trim()} className="small">
          + Add
        </button>
      </form>
      {newWordError && <div className="trouble-error-msg">{newWordError}</div>}

      {/* Filters & Search */}
      {struggles.length > 0 && (
        <div className="trouble-filter-bar">
          <div className="filter-pill-group">
            <button
              className={`pill-btn ${troubleFilter === 'all' ? 'active' : ''}`}
              onClick={() => setTroubleFilter('all')}
            >
              All ({struggles.length})
            </button>
            <button
              className={`pill-btn ${troubleFilter === 'struggles' ? 'active' : ''}`}
              onClick={() => setTroubleFilter('struggles')}
            >
              Weak ({struggles.filter(isStrugglingLot).length})
            </button>
            <button
              className={`pill-btn ${troubleFilter === 'pinned' ? 'active' : ''}`}
              onClick={() => setTroubleFilter('pinned')}
            >
              Pinned ({struggles.filter((e) => e.pinned).length})
            </button>
          </div>

          {struggles.length > 3 && (
            <input
              type="search"
              value={troubleSearch}
              onChange={(e) => setTroubleSearch(e.target.value)}
              placeholder="Search..."
              className="trouble-search-field"
            />
          )}
        </div>
      )}

      {/* Items list or grid */}
      {visibleStruggles.length > 0 ? (
        <div className={`trouble-items-container ${layout}`}>
          {visibleStruggles.map((entry) => {
            const lot = isStrugglingLot(entry)
            return (
              <div
                key={entry.word}
                className={`trouble-card-item ${lot ? 'struggling' : ''}`}
              >
                <div className="trouble-card-header">
                  <div className="word-meta">
                    <span className="trouble-word-text">{entry.display}</span>
                    <span className="trouble-word-ipa">/{formatIPA(entry.ipa, display)}/</span>
                  </div>
                  <div className="trouble-card-controls">
                    <button
                      className={`pin-toggle ${entry.pinned ? 'pinned' : ''}`}
                      onClick={() => togglePin(entry.word)}
                      title={entry.pinned ? 'Unpin word' : 'Pin word'}
                    >
                      {entry.pinned ? '★' : '☆'}
                    </button>
                    <button
                      className="remove-toggle"
                      onClick={() => removeWord(entry.word)}
                      title="Remove from bank"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="trouble-stats-row">
                  <span className="attempts-tag">
                    {entry.struggleCount}/{entry.totalAttempts} first takes flagged
                  </span>
                  {entry.lastScore > 0 && (
                    <span className={`score-mini-tag ${band(entry.lastScore, practice.practiceThreshold)}`}>
                      {entry.lastScore}
                    </span>
                  )}
                  {entry.weakPhones.length > 0 && (
                    <div className="weak-sounds-tags">
                      {entry.weakPhones.slice(0, 3).map((p) => (
                        <span key={p.phone} className="weak-sound-pill">
                          /{p.phone}/
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="trouble-card-actions">
                  <button
                    className="ghost tiny"
                    onClick={() => speak(entry.display)}
                    title="Hear native pronunciation"
                  >
                    ♪ Hear
                  </button>
                  <button
                    className="ghost tiny"
                    onClick={() => practiseWord(entry)}
                    title="Load a contextual phrase into practice"
                  >
                    Context
                  </button>
                  <button
                    className="tiny accent"
                    onClick={() => drillWord(entry)}
                    title="Build custom drill around this word"
                  >
                    ⚡ Drill
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="trouble-empty-state">
          {struggles.length === 0 ? (
            <span>Words you struggle with will be automatically saved here for drill practice.</span>
          ) : (
            <span>No words match current filter.</span>
          )}
        </div>
      )}
    </div>
  )
}
