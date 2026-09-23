import type { PracticeState } from '../../lib/usePracticeState.ts'

export function SoundReviewPatterns({ practice }: { practice: PracticeState }) {
  const review = practice.reviewPatterns
  const patterns = review.sounds.filter((p) => p.flagged > 0).slice(0, 8)
  return <section className="sound-review-patterns" aria-label="Recurring sound review">
    <h4>Sounds to check over time</h4>
    <p>{review.scale} · below {practice.practiceThreshold}/100 · first takes only · all retained history</p>
    {patterns.length ? <ul>{patterns.map((p) => <li key={p.phone}>
      <button className="ghost small" onClick={() => practice.startDrill([p.phone])}>Practise /{p.phone}/</button>
      <span>{p.flagged} of {p.seen} first takes flagged · {p.words.length} words · {p.contexts} contexts · {p.sessions} sessions{p.recurring ? ' · recurring flag' : ' · early observation'}</span>
    </li>)}</ul> : <p>No repeated sound evidence yet. First takes in new contexts build this view.</p>}
    <small>{review.retriesExcluded} retries and {review.legacyExcluded} older takes excluded from independent first-take counts. Legacy takes still update word analysis and can suggest Daily targets. Repeated flags can still be model errors. A Studio session lasts until page reload; Daily uses its saved session.</small>
  </section>
}
