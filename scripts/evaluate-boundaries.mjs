/** Independent boundary and pronunciation evaluation; timing need not imply a correctness label. */
import assert from 'node:assert/strict'
const rate = (n, d) => d ? n / d : null
const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
const quantile = (xs, p) => xs.length ? [...xs].sort((a, b) => a - b)[Math.ceil(p * xs.length) - 1] : null
const finite = n => typeof n === 'number' && Number.isFinite(n)
const intersection = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
const distance = (n, range) => Math.max(range[0] - n, 0, n - range[1])
const epsilon = 1e-9
function span(start, end, label) {
  if (start === null && end === null) return null
  assert(finite(start) && finite(end) && start >= 0 && end > start, `Invalid ${label} timing`)
  return { start, end }
}
function reference(word) {
  const nominal = span(word.start, word.end, 'gold')
  assert(word.boundaryStatus === undefined || ['human-corrected', 'uncertain', 'unavailable'].includes(word.boundaryStatus), 'Unknown boundary status')
  if (!nominal || word.boundaryStatus === 'unavailable') return null
  if (word.boundaryStatus === 'uncertain' && !word.startRange && !word.endRange) return null
  const range = (value, fallback) => {
    if (value === undefined) return [fallback, fallback]
    assert(Array.isArray(value) && value.length === 2 && value.every(finite)
      && value[0] >= 0 && value[0] <= fallback && fallback <= value[1], 'Invalid human boundary range')
    return value
  }
  const start = range(word.startRange, nominal.start), end = range(word.endRange, nominal.end)
  assert(start[1] < end[0], 'Human ranges must retain a nonempty definite word core')
  return { start, end, core: { start: start[1], end: end[0] }, envelope: { start: start[0], end: end[1] },
    ranged: start[0] !== start[1] || end[0] !== end[1] }
}
function unionLength(intervals) {
  let total = 0, right = -Infinity
  for (const interval of intervals.sort((a, b) => a.start - b.start)) {
    total += Math.max(0, interval.end - Math.max(interval.start, right)); right = Math.max(right, interval.end)
  }
  return total
}
function neighborDuration(clip, refs, index, which) {
  return unionLength(refs.flatMap((r, i) => {
    if (i === index) return []
    const start = Math.max(clip.start, r[which].start), end = Math.min(clip.end, r[which].end)
    return end > start ? [{ start, end }] : []
  }))
}
export function evaluateBoundaries(gold, predictions, { split = 'test' } = {}) {
  assert(['test', 'validation', 'regression', 'calibration'].includes(split), 'Declare an evaluation split')
  assert(Array.isArray(gold) && gold.length, 'Gold annotations must be a nonempty array')
  assert(Array.isArray(predictions), 'Predictions must be an array')
  const predicted = new Map(predictions.map(row => [row.id, row])), ids = new Set(gold.map(row => row.id))
  assert.equal(predicted.size, predictions.length, 'Duplicate prediction IDs')
  assert.equal(ids.size, gold.length, 'Duplicate annotation IDs')
  for (const id of predicted.keys()) assert(ids.has(id), `Prediction ${id} has no annotation`)
  const sources = new Set(gold.map(row => row.source)), engines = new Set(predictions.map(row => `${row.scorer}@${row.revision}`))
  assert(sources.size === 1 && ['human', 'synthetic'].includes([...sources][0]), 'Run human and synthetic evaluations separately')
  assert(engines.size <= 1, 'Evaluate one scorer/revision per run')
  const datasets = new Set(gold.map(row => `${row.dataset ?? 'legacy'}@${row.datasetRevision ?? 'legacy'}`))
  assert(datasets.size === 1, 'Do not mix boundary datasets/revisions')
  const errors = [], clipping = [], clippingPossible = [], leakage = [], leakagePossible = []
  let words = 0, annotated = 0, ranged = 0, timed = 0, replayed = 0, humanJudgments = 0
  let judged = 0, correctScored = 0, incorrectScored = 0, falseAccepts = 0, falseRejects = 0
  let totalCore = 0, totalEnvelope = 0
  for (const row of gold) {
    assert(typeof row.id === 'string' && row.id && row.split === split, 'Rows must match the declared evaluation split')
    assert(Array.isArray(row.words) && row.words.length, `Missing words for ${row.id}`)
    const refs = row.words.map(reference), prediction = predicted.get(row.id)
    refs.filter(Boolean).forEach((r, i, known) => {
      if (i) assert(r.core.start >= known[i - 1].core.end - epsilon, 'Definite gold word cores overlap; mark uncertain boundaries explicitly')
    })
    if (prediction) {
      assert(typeof prediction.scorer === 'string' && prediction.scorer && prediction.revision != null, 'Record the scorer and revision')
      assert(Array.isArray(prediction.words) && prediction.words.length === row.words.length, 'Word count mismatch; retain omissions/unscored words')
      if (prediction.datasetRevision !== undefined) assert.equal(prediction.datasetRevision, row.datasetRevision, 'Corpus revision mismatch')
    }
    row.words.forEach((expected, i) => {
      assert(typeof expected.text === 'string' && expected.text && (expected.correct === null || typeof expected.correct === 'boolean'), 'Gold needs text and explicit correct: null when pronunciation was not judged')
      words++
      const ref = refs[i]
      if (ref) { annotated++; ranged += Number(ref.ranged) }
      if (expected.correct !== null) humanJudgments++
      const actual = prediction?.words[i]
      if (!actual) return
      assert(actual.text === expected.text, `Word identity mismatch for ${row.id}/${i}`)
      assert(actual.correct === null || typeof actual.correct === 'boolean', 'Use explicit null for unscored pronunciation judgments')
      if (expected.correct !== null && actual.correct !== null) {
        judged++
        if (expected.correct) { correctScored++; falseRejects += Number(!actual.correct) }
        else { incorrectScored++; falseAccepts += Number(actual.correct) }
      }
      const acoustic = span(actual.start, actual.end, 'predicted')
      let clip = acoustic
      if (Object.hasOwn(actual, 'playback')) {
        assert(actual.playback === null || typeof actual.playback === 'object', 'Invalid playback interval')
        clip = actual.playback === null ? null : span(actual.playback.start, actual.playback.end, 'playback')
      }
      if (!ref) return
      if (acoustic) {
        timed++
        errors.push(distance(acoustic.start, ref.start) * 1000, distance(acoustic.end, ref.end) * 1000)
      }
      if (!clip) return
      replayed++
      const coreDuration = ref.core.end - ref.core.start, envelopeDuration = ref.envelope.end - ref.envelope.start
      totalCore += coreDuration; totalEnvelope += envelopeDuration
      clipping.push(Math.max(0, coreDuration - intersection(clip, ref.core)))
      clippingPossible.push(Math.max(0, envelopeDuration - intersection(clip, ref.envelope)))
      // Unknown neighboring intervals prevent an honest no-leakage claim.
      if (refs.every(Boolean)) {
        leakage.push(neighborDuration(clip, refs, i, 'core'))
        leakagePossible.push(neighborDuration(clip, refs, i, 'envelope'))
      }
    })
  }
  const leaked = leakage.filter(n => n > epsilon).length, clipped = clipping.filter(n => n > epsilon).length
  return {
    schemaVersion: 2, split, annotationSource: [...sources][0], dataset: [...datasets][0], scorer: [...engines][0] ?? null,
    recordings: gold.length, predictedRecordings: predictions.length, words,
    boundary: { annotatedWords: annotated, unavailableOrUnresolvedWords: words - annotated, rangedWords: ranged,
      annotationCoverage: rate(annotated, words), timedWords: timed, coverage: rate(timed, words), meanErrorMs: mean(errors), p95ErrorMs: quantile(errors, 0.95),
      within20ms: rate(errors.filter(e => e <= 20).length, errors.length), within50ms: rate(errors.filter(e => e <= 50).length, errors.length),
      replayedWords: replayed, replayCoverage: rate(replayed, words), leakageEvaluatedWords: leakage.length,
      clipsWithNeighborSpeech: leaked, neighborLeakageRate: rate(leaked, leakage.length),
      possibleNeighborLeakageRate: rate(leakagePossible.filter(n => n > epsilon).length, leakagePossible.length),
      meanNeighborIncludedMs: mean(leakage.map(n => n * 1000)), meanPossibleNeighborIncludedMs: mean(leakagePossible.map(n => n * 1000)),
      clipsWithTargetClipping: clipped, targetClippingRate: rate(clipped, clipping.length),
      possibleTargetClippingRate: rate(clippingPossible.filter(n => n > epsilon).length, clippingPossible.length),
      meanTargetClippedMs: mean(clipping.map(n => n * 1000)), meanPossibleTargetClippedMs: mean(clippingPossible.map(n => n * 1000)),
      targetDurationClippedFraction: rate(clipping.reduce((a, b) => a + b, 0), totalEnvelope),
      possibleTargetDurationClippedFraction: totalCore ? Math.min(1, clippingPossible.reduce((a, b) => a + b, 0) / totalCore) : null },
    pronunciation: { humanJudgedWords: humanJudgments, judgedWords: judged, coverage: rate(judged, humanJudgments), unscoredWords: words - judged,
      falseAccepts, falseRejects, falseAcceptanceRate: rate(falseAccepts, incorrectScored), falseRejectionRate: rate(falseRejects, correctScored) },
    caveats: ['Boundary error is distance to the supplied human range (an exact timestamp is a zero-width range).',
      'Clipping/leakage measure annotated word intervals, not phonation or intelligibility; uncertain ranges give definite/possible bounds.',
      'Duration-clipped fractions use conservative lower/upper bounds when gold ranges are uncertain; with exact boundaries both coincide.',
      'No fabricated pronunciation labels. Missing human judgments are independent of boundary coverage.',
      'No confidence intervals or universal quality threshold are claimed. Compare coverage and worst cases, not only means.'],
  }
}
