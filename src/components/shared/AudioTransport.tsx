import { clock, type PracticeState } from '../../lib/usePracticeState.ts'

interface Props {
  practice: PracticeState
  size?: 'normal' | 'large'
}

export function AudioTransport({ practice, size = 'normal' }: Props) {
  const {
    phase,
    playing,
    played,
    playback,
    level,
    error,
    busy,
    fetching,
    load,
    target,
    mode,
    toggle,
    seek,
    beginRecording,
    finishRecording,
  } = practice

  return (
    <div className={`audio-transport-deck ${size}`}>
      {/* Action buttons bar */}
      <div className="transport-controls-row">
        <div className="transport-record-col">
          {phase === 'recording' ? (
            <button className="record-btn recording" onClick={finishRecording}>
              <span className="record-dot" />
              <span className="record-label">Stop &amp; Score</span>
            </button>
          ) : (
            <button
              className="record-btn idle"
              onClick={beginRecording}
              disabled={busy || (mode === 'scripted' && !target)}
              title="Record your voice"
            >
              <span className="record-dot" />
              <span className="record-label">Record</span>
            </button>
          )}
        </div>

        <div className="transport-playback-col">
          {(mode === 'scripted' || target) && (
            <button
              className={`listen-ref-btn ${playing === 'target' ? 'playing' : ''}`}
              onClick={() => toggle('target')}
              disabled={!target || busy || phase === 'recording'}
              title="Hear native reference pronunciation"
            >
              <span className="btn-icon">{playing === 'target' ? '■' : '♪'}</span>
              <span className="btn-label">{playing === 'target' ? 'Stop' : 'Reference'}</span>
            </button>
          )}

          {playback && phase !== 'recording' && (
            <button
              className={`playback-mine-btn ${playing === 'mine' ? 'playing' : ''}`}
              onClick={() => toggle('mine')}
              disabled={busy}
              title="Play your recording"
            >
              <span className="btn-icon">{playing === 'mine' ? '■' : '▶'}</span>
              <span className="btn-label">{playing === 'mine' ? 'Stop' : 'Your Take'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Live level meter when recording */}
      {phase === 'recording' && (
        <div className="live-mic-meter">
          <div
            className="live-mic-fill"
            style={{ width: `${Math.min(100, Math.max(6, level * 140))}%` }}
          />
        </div>
      )}

      {/* Audio scrubber for user take */}
      {playback && phase !== 'recording' && (
        <div className="playback-scrubber-bar">
          <span className="scrubber-label">Your take</span>
          <div
            className="scrubber-track"
            onClick={seek}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(played * 100)}
          >
            <div className="scrubber-progress" style={{ width: `${played * 100}%` }} />
          </div>
          <span className="scrubber-time">
            {clock(played * playback.durationMs)} / {clock(playback.durationMs)}
          </span>
        </div>
      )}

      {/* Error display */}
      {error && <div className="transport-error-banner">{error}</div>}

      {/* Model download loading bar */}
      {(busy || (phase === 'recording' && fetching)) && (
        <div className="model-loading-indicator">
          <div className="loading-msg">
            {load.stage === 'weights'
              ? `${load.detail ?? 'Loading model'} (${Math.round(load.progress * 100)}%)`
              : load.stage === 'library'
                ? 'Initializing speech runtime...'
                : 'Scoring phonemes...'}
          </div>
          {load.stage === 'weights' && (
            <div className="loading-track">
              <div
                className="loading-progress"
                style={{ width: `${Math.round(load.progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
