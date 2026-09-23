import { ASSESSMENT_VERSION, type Attempt, type SavedAssessment } from './practice.ts'

export function preserveAssessment(previous: Attempt, updated: Attempt, source: 'history-rescore' | 'text-edit', now = Date.now()): Attempt {
  const original: SavedAssessment = previous.originalAssessment ?? {
    target: previous.target, aligned: previous.aligned, score: previous.score, scorer: previous.scorer, rev: previous.rev,
  }
  return { ...updated, originalAssessment: structuredClone(original), assessment: { version: ASSESSMENT_VERSION, at: now, source } }
}

/** Compare-and-swap one recording; never replace a stale snapshot of the list. */
export function mergeAssessment(current: Attempt[], before: Attempt, updated: Attempt): Attempt[] {
  if (updated.at !== before.at || updated.target !== before.target) throw new Error('Rescoring cannot change recording identity or transcript')
  const matches = current.filter((a) => a.at === before.at)
  if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(before)) return current
  return current.map((a) => a.at === before.at ? updated : a)
}
