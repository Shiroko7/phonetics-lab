/** Continuous human-rating evaluation. Separate from the word-boundary evaluator. */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { readJsonl } from './prepare-speechocean.mjs'

const mean = (ns) => ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null
const finite = (n) => typeof n === 'number' && Number.isFinite(n)
const range = (n, max) => finite(n) && n >= 0 && n <= max
export function pearson(xs, ys) {
  assert.equal(xs.length, ys.length)
  if (xs.length < 2) return null
  const mx = mean(xs), my = mean(ys)
  let xy = 0, xx = 0, yy = 0
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] - mx, y = ys[i] - my
    xy += x * y; xx += x * x; yy += y * y
  }
  return xx && yy ? Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy))) : null
}
export function ranks(values) {
  const sorted = values.map((value, i) => ({ value, i })).sort((a, b) => a.value - b.value)
  const out = []
  for (let i = 0; i < sorted.length;) {
    let end = i + 1
    while (end < sorted.length && sorted[end].value === sorted[i].value) end++
    for (let j = i; j < end; j++) out[sorted[j].i] = (i + end - 1) / 2 + 1
    i = end
  }
  return out
}
function summarize(items) {
  const scored = items.filter((p) => p.prediction !== null)
  const actual = scored.map((p) => p.prediction), human = scored.map((p) => p.human)
  const diffs = scored.map((p) => p.prediction - p.human)
  return {
    eligible: items.length, scored: scored.length, unscored: items.length - scored.length,
    coverage: items.length ? scored.length / items.length : null,
    pearson: pearson(actual, human), spearman: pearson(ranks(actual), ranks(human)),
    // These errors describe the existing 0–100 display, NOT fitted calibration or correctness probabilities.
    displayedScaleMae: mean(diffs.map(Math.abs)), displayedScaleBias: mean(diffs),
    meanPrediction: mean(actual), meanHuman: mean(human),
    meanHumanRaterRange: mean(items.map((p) => Math.max(...p.raters) - Math.min(...p.raters))),
    meanHumanPairwiseDifference: mean(items.flatMap((p) => p.raters.flatMap((a, i) => p.raters.slice(i + 1).map((b) => Math.abs(a - b))))),
  }
}

export function evaluateAssessment(gold, predictions) {
  assert(Array.isArray(gold) && gold.length, 'A nonempty held-out set is required')
  assert(Array.isArray(predictions), 'Predictions must be an array')
  const ids = new Set(gold.map((r) => r.id)), byId = new Map(predictions.map((r) => [r.id, r]))
  assert.equal(ids.size, gold.length, 'Duplicate gold IDs')
  assert.equal(byId.size, predictions.length, 'Duplicate prediction IDs')
  for (const id of byId.keys()) assert(ids.has(id), `Unknown prediction ID: ${id}`)
  const sources = new Set(gold.map((r) => r.source))
  assert(sources.size === 1 && ['human', 'synthetic'].includes([...sources][0]), 'Human and synthetic labels must stay separate')
  const datasets = new Set(gold.map((r) => `${r.dataset}@${r.datasetRevision}`))
  assert.equal(datasets.size, 1, 'Do not mix dataset revisions')
  const engines = new Set(predictions.map((r) => `${r.scorer}@${r.revision}`))
  assert(engines.size <= 1, 'Do not mix scorer revisions')
  const metrics = { sentenceAccuracy: [], wordAccuracy: [], sentenceFluency: [], sentenceProsody: [], wordStress: [] }
  const errors = {}
  for (const row of gold) {
    assert(typeof row.id === 'string' && row.id && row.split === 'test' && typeof row.speaker === 'string' && row.speaker, 'Expected identified held-out test rows with speakers')
    assert(typeof row.dataset === 'string' && row.dataset && typeof row.datasetRevision === 'string' && row.datasetRevision, 'Missing dataset provenance')
    assert(Array.isArray(row.words) && row.words.length, 'Missing annotated words')
    const predicted = byId.get(row.id)
    if (predicted) {
      assert(typeof predicted.scorer === 'string' && predicted.scorer && typeof predicted.revision === 'string' && predicted.revision, 'Missing scoring provenance')
      assert.equal(predicted.datasetRevision, row.datasetRevision, 'Prediction uses a different corpus revision')
      assert(Array.isArray(predicted.words) && predicted.words.length === row.words.length, 'Retain omitted/unscored words explicitly')
      if (predicted.error) errors[predicted.error] = (errors[predicted.error] ?? 0) + 1
    }
    const add = (name, label, result, dimension) => {
      assert(label && range(label[dimension], 10), 'Invalid gold rating')
      const raters = label[`${dimension}Raters`]
      assert(Array.isArray(raters) && raters.length === 5 && raters.every((n) => range(n, 10)), 'Keep all five human ratings')
      const value = result?.[dimension] ?? null
      // Missing fields on an existing prediction are schema errors, not silent abstentions.
      if (result) assert(Object.hasOwn(result, dimension), `Use explicit null for unsupported ${dimension}`)
      assert(value === null || range(value, 100), 'Predicted scores must be null or 0–100')
      metrics[name].push({ id: row.id, speaker: row.speaker, age: row.age, human: label[dimension] * 10,
        raters: raters.map((r) => r * 10), prediction: value })
    }
    if (predicted) assert(predicted.sentence && typeof predicted.sentence === 'object', 'Missing sentence predictions')
    add('sentenceAccuracy', row.sentence, predicted?.sentence, 'accuracy')
    add('sentenceFluency', row.sentence, predicted?.sentence, 'fluency')
    add('sentenceProsody', row.sentence, predicted?.sentence, 'prosody')
    row.words.forEach((word, i) => {
      const p = predicted?.words[i]
      if (predicted) assert(p && p.text === word.text, `Word identity mismatch: ${row.id}/${i}`)
      add('wordAccuracy', word, p, 'accuracy')
      add('wordStress', word, p, 'stress')
    })
  }
  return {
    schemaVersion: 1, annotationSource: [...sources][0], dataset: [...datasets][0], scorer: [...engines][0] ?? null,
    recordings: gold.length, predictedRecordings: predictions.length, speakers: new Set(gold.map((r) => r.speaker)).size,
    metrics: Object.fromEntries(Object.entries(metrics).map(([key, pairs]) => [key, summarize(pairs)])),
    sentenceAccuracyByAge: {
      childrenUnder18: summarize(metrics.sentenceAccuracy.filter((p) => range(p.age, 120) && p.age < 18)),
      adults: summarize(metrics.sentenceAccuracy.filter((p) => range(p.age, 120) && p.age >= 18)),
    },
    errors,
    boundaries: { evaluated: false, reason: 'This rating corpus supplies no human word-boundary timestamps.' },
    caveats: [
      'Correlation is not percent correct. Display-scale errors use a linear 0–10 to 0–100 conversion, not calibration.',
      'Word observations are clustered within recordings/speakers; no independence-based confidence intervals are claimed.',
      'Rater spread describes disagreement; it is not a reliability coefficient or a model performance ceiling.',
      'The public corpus is Mandarin-L1 read speech, including children; not a representative American-English or personal-use benchmark.',
      'No binary correctness thresholds, phone-slot mapping, or alignment accuracy are inferred from these ratings.',
    ],
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 4, 'Usage: node scripts/evaluate-assessment.mjs GOLD.jsonl PREDICTIONS.jsonl')
    console.log(JSON.stringify(evaluateAssessment(await readJsonl(process.argv[2]), await readJsonl(process.argv[3])), null, 2))
  } catch (err) { console.error(err.message); process.exitCode = 1 }
}
