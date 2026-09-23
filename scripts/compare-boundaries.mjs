/** Compare frozen aligner outputs, retaining failures and coverage. Never selects candidates on final data. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { evaluateBoundaries } from './evaluate-boundaries.mjs'
import { readJsonl, sha256 } from './prepare-speechocean.mjs'
import { ratio, quantile, speakerBootstrap } from './validation-statistics.mjs'

export function compareBoundaries(gold, baseline, candidate) {
  const split = gold[0]?.split
  assert(['validation', 'regression'].includes(split), 'Compare development boundaries only; final/test data is not permitted')
  for (const predictions of [baseline, candidate]) {
    assert.equal(predictions.length, gold.length, 'Retain every selected recording, including failed predictions with null word spans')
    assert(predictions.every(p => p.milliseconds === undefined || Number.isFinite(p.milliseconds) && p.milliseconds >= 0), 'Invalid runtime')
  }
  const a = evaluateBoundaries(gold, baseline, { split }), b = evaluateBoundaries(gold, candidate, { split })
  const byA = new Map(baseline.map(p => [p.id, p])), byB = new Map(candidate.map(p => [p.id, p]))
  const rows = gold.map(row => ({ speaker: row.speaker, id: row.id,
    a: evaluateBoundaries([row], [byA.get(row.id)], { split }), b: evaluateBoundaries([row], [byB.get(row.id)], { split }) }))
  const aggregate = (rows, engine) => {
    const reports = rows.map(r => r[engine]), sum = fn => reports.reduce((n, r) => n + fn(r), 0)
    const words = sum(r => r.words), timed = sum(r => r.boundary.timedWords), replayed = sum(r => r.boundary.replayedWords)
    return { meanErrorMs: ratio(sum(r => (r.boundary.meanErrorMs ?? 0) * r.boundary.timedWords), timed),
      meanNeighborIncludedMs: ratio(sum(r => (r.boundary.meanNeighborIncludedMs ?? 0) * r.boundary.leakageEvaluatedWords), sum(r => r.boundary.leakageEvaluatedWords)),
      meanTargetClippedMs: ratio(sum(r => (r.boundary.meanTargetClippedMs ?? 0) * r.boundary.replayedWords), replayed),
      timingCoverage: ratio(timed, words), replayCoverage: ratio(replayed, words) }
  }
  const bootstrap = speakerBootstrap(rows, sample => {
    const a = aggregate(sample, 'a'), b = aggregate(sample, 'b')
    return Object.fromEntries(Object.keys(a).map(key => [key, a[key] === null || b[key] === null ? null : b[key] - a[key]]))
  })
  const runtime = predictions => {
    const values = predictions.map(p => p.milliseconds).filter(Number.isFinite)
    return { measured: values.length, total: predictions.length, medianMs: quantile(values, 0.5), p95Ms: quantile(values, 0.95) }
  }
  return { schemaVersion: 1, split, baseline: a, candidate: b, deltaBootstrap: bootstrap,
    runtime: { baseline: runtime(baseline), candidate: runtime(candidate) },
    worstCandidateRecordings: rows.sort((x, y) => (y.b.boundary.meanErrorMs ?? -1) - (x.b.boundary.meanErrorMs ?? -1)).slice(0, 20)
      .map(r => ({ id: r.id, speaker: r.speaker, baseline: r.a.boundary, candidate: r.b.boundary })),
    caveats: ['Lower errors with lower coverage are not evidence of a better aligner. Compare both acoustic and playback coverage.',
      'Intervals are paired by speaker and describe candidate minus baseline; they do not account for systematic annotation bias.',
      'No automatic deployment decision. Candidate adapters must record their actual playback policy and model/configuration revision.'] }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [goldPath, baselinePath, candidatePath, output, ...extra] = process.argv.slice(2)
    assert(goldPath && baselinePath && candidatePath && output && !extra.length,
      'Usage: npm run benchmark:boundaries:compare -- GOLD.jsonl BASELINE.jsonl CANDIDATE.jsonl NEW_REPORT.json')
    const result = compareBoundaries(await readJsonl(goldPath), await readJsonl(baselinePath), await readJsonl(candidatePath))
    result.provenance = Object.fromEntries(await Promise.all([['gold', goldPath], ['baseline', baselinePath], ['candidate', candidatePath]]
      .map(async ([name, path]) => [name, { path, sha256: sha256(await readFile(path)) }])))
    await writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ output, changes: result.deltaBootstrap, runtime: result.runtime }, null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
