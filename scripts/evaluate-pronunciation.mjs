/** Compare provider predictions with independent annotations; never generate gold labels. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const rate = (n, d) => d ? n / d : null
const mean = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
const quantile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1] : null
const finite = (n) => typeof n === 'number' && Number.isFinite(n)

export function evaluatePronunciation(gold, predictions) {
  assert(Array.isArray(gold) && gold.length, 'Gold annotations must be a nonempty array')
  assert(Array.isArray(predictions), 'Predictions must be an array')
  const predicted = new Map(predictions.map((row) => [row.id, row]))
  assert.equal(predicted.size, predictions.length, 'Duplicate prediction IDs')
  const ids = new Set(gold.map((row) => row.id))
  assert.equal(ids.size, gold.length, 'Duplicate annotation IDs')
  for (const id of predicted.keys()) assert(ids.has(id), `Prediction ${id} has no annotation`)
  const sources = new Set(gold.map((row) => row.source))
  assert(sources.size === 1 && ['human', 'synthetic'].includes([...sources][0]), 'Run human and synthetic evaluations separately')
  const engines = new Set(predictions.map((row) => `${row.scorer}@${row.revision}`))
  assert(engines.size <= 1, 'Evaluate one scorer/revision per run')
  const errors = []
  let words = 0, timed = 0, leaked = 0, judged = 0, correctScored = 0, incorrectScored = 0, falseAccepts = 0, falseRejects = 0
  for (const row of gold) {
    assert(typeof row.id === 'string' && row.id && row.split === 'test', 'Only explicitly held-out test rows may be evaluated')
    assert(Array.isArray(row.words) && row.words.length, `Missing words for ${row.id}`)
    const prediction = predicted.get(row.id)
    if (prediction) {
      assert(typeof prediction.scorer === 'string' && prediction.scorer && prediction.revision != null, 'Record the scorer and revision')
      assert(Array.isArray(prediction.words) && prediction.words.length === row.words.length, `Word count mismatch for ${row.id}; represent omitted/unscored words explicitly`)
    }
    row.words.forEach((expected, i) => {
      assert(typeof expected.text === 'string' && expected.text && typeof expected.correct === 'boolean', `Missing human judgment for ${row.id}/${i}`)
      assert(finite(expected.start) && finite(expected.end) && expected.start >= 0 && expected.end > expected.start, `Invalid gold timing for ${row.id}/${i}`)
      if (i) assert(expected.start >= row.words[i - 1].end, `Gold words overlap for ${row.id}`)
      words++
      const actual = prediction?.words[i]
      if (!actual) return
      assert(actual.text === expected.text, `Word identity mismatch for ${row.id}/${i}`)
      assert(typeof actual.correct === 'boolean' || actual.correct === null, 'Use null for unscored/uncertain judgments')
      if (actual.correct !== null) {
        judged++
        if (expected.correct) {
          correctScored++
          if (!actual.correct) falseRejects++
        } else {
          incorrectScored++
          if (actual.correct) falseAccepts++
        }
      }
      if (actual.start === null && actual.end === null) return
      assert(finite(actual.start) && finite(actual.end) && actual.start >= 0 && actual.end > actual.start, `Invalid predicted timing for ${row.id}/${i}`)
      timed++
      errors.push(Math.abs(actual.start - expected.start) * 1000, Math.abs(actual.end - expected.end) * 1000)
      // Any intersection with another annotated word is audible-neighbor risk.
      if (row.words.some((other, j) => j !== i && actual.start < other.end && actual.end > other.start)) leaked++
    })
  }
  return {
    annotationSource: [...sources][0], scorer: [...engines][0] ?? null,
    recordings: gold.length, predictedRecordings: predictions.length, words,
    boundary: { timedWords: timed, coverage: rate(timed, words), meanErrorMs: mean(errors), p95ErrorMs: quantile(errors, 0.95),
      within20ms: rate(errors.filter((e) => e <= 20).length, errors.length),
      within50ms: rate(errors.filter((e) => e <= 50).length, errors.length),
      clipsWithNeighborSpeech: leaked, neighborLeakageRate: rate(leaked, timed) },
    pronunciation: { judgedWords: judged, coverage: rate(judged, words), unscoredWords: words - judged,
      falseAccepts, falseRejects, falseAcceptanceRate: rate(falseAccepts, incorrectScored),
      falseRejectionRate: rate(falseRejects, correctScored) },
  }
}

async function readJsonl(path) {
  return (await readFile(path, 'utf8')).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , goldPath, predictionPath] = process.argv
  if (!goldPath || !predictionPath) {
    console.error('Usage: node scripts/evaluate-pronunciation.mjs GOLD.jsonl PREDICTIONS.jsonl')
    process.exitCode = 1
  } else {
    const [gold, predictions] = await Promise.all([readJsonl(goldPath), readJsonl(predictionPath)])
    console.log(JSON.stringify(evaluatePronunciation(gold, predictions), null, 2))
  }
}
