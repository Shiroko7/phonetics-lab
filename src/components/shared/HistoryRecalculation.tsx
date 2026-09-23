import type { PracticeState } from '../../lib/usePracticeState.ts'

export function HistoryRecalculation({ practice }: { practice: PracticeState }) {
  const { attempts, refreshedCount, backfill, rescoreSummary, refreshHistory } = practice
  if (!attempts.length) return null
  return <section className="history-recalculation" aria-label="History recalculation">
    <div role="status">
      <strong>{backfill ? `Recalculating history: ${backfill.done}/${backfill.total}` : `Current analysis: ${refreshedCount}/${attempts.length} recordings`}</strong>
      <span>Updates diagnostics, Trouble Words, Stats and Daily. Original assessments and recording dates are preserved.</span>
      {backfill && <progress value={backfill.done} max={backfill.total} aria-label="Recalculation progress" />}
      {rescoreSummary && <span>{rescoreSummary.error ? 'Stopped: ' : ''}{rescoreSummary.rescored} recalculated · {rescoreSummary.skipped.length} could not be updated.</span>}
      {rescoreSummary?.error && <span role="alert">{rescoreSummary.error}</span>}
      {!backfill && !practice.backend && refreshedCount < attempts.length && <span>Start the local scoring service, then choose Recalculate all.</span>}
    </div>
    <button className="ghost small" disabled={practice.busy || practice.phase === 'recording'} onClick={() => void refreshHistory(true)}>Recalculate all</button>
    {!!rescoreSummary?.skipped.length && <details><summary>Recordings that could not be updated</summary>
      <ul>{rescoreSummary.skipped.map(item => <li key={item.at}>{new Date(item.at).toLocaleString()} · {item.target || '(no transcript)'}: {item.reason}</li>)}</ul>
    </details>}
  </section>
}
