/** Offline replay-only trim sweep; leaves every aligner's acoustic estimates unchanged. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { playbackSlice } from '../src/lib/playback.ts'
import { evaluateBoundaries } from './evaluate-boundaries.mjs'
import { ROOT, readJsonl, sha256 } from './prepare-speechocean.mjs'
import { ratio, speakerBootstrap } from './validation-statistics.mjs'

export const TRIM_SWEEP_MS = [0, 20, 40, 60, 80]

export function trimPlayback(prediction, gold, insetMs) {
  assert(Number.isFinite(insetMs) && insetMs >= 0, 'Trim must be a nonnegative number of milliseconds')
  return {
    ...prediction,
    words: prediction.words.map(word => {
      const base = Object.hasOwn(word, 'playback') ? word.playback
        : (Number.isFinite(word.start) && Number.isFinite(word.end) ? { start: word.start, end: word.end } : null)
      if (!base) return { ...word, playback: null }
      const inset = insetMs / 1000
      const span = playbackSlice({ start: base.start + inset, end: base.end - inset }, gold.duration, gold.audioInfo.sampleRate)
      return { ...word, playback: span }
    }),
  }
}

function aggregate(rows, inset) {
  const reports = rows.map(row => row.reports[inset])
  const sum = fn => reports.reduce((total, report) => total + fn(report), 0)
  const words = sum(report => report.words)
  const timed = sum(report => report.boundary.timedWords)
  const replayed = sum(report => report.boundary.replayedWords)
  const leakageEvaluated = sum(report => report.boundary.leakageEvaluatedWords)
  return {
    meanErrorMs: ratio(sum(report => (report.boundary.meanErrorMs ?? 0) * report.boundary.timedWords), timed),
    meanNeighborIncludedMs: ratio(sum(report => (report.boundary.meanNeighborIncludedMs ?? 0) * report.boundary.leakageEvaluatedWords), leakageEvaluated),
    neighborLeakageRate: ratio(sum(report => report.boundary.clipsWithNeighborSpeech), leakageEvaluated),
    meanTargetClippedMs: ratio(sum(report => (report.boundary.meanTargetClippedMs ?? 0) * report.boundary.replayedWords), replayed),
    timingCoverage: ratio(timed, words), replayCoverage: ratio(replayed, words),
  }
}

export function sweepBoundaryTrims(gold, predictions, trims = TRIM_SWEEP_MS) {
  const split = gold[0]?.split
  assert(['validation', 'regression'].includes(split), 'Trim sweeps are restricted to development data')
  assert(trims.length && trims.every(value => Number.isFinite(value) && value >= 0)
    && new Set(trims).size === trims.length && trims.includes(0), 'Trim values must be unique, nonnegative and include zero')
  assert.equal(gold.length, predictions.length, 'Retain every recording')
  evaluateBoundaries(gold, predictions, { split })
  const byPrediction = new Map(predictions.map(row => [row.id, row]))
  assert.equal(byPrediction.size, predictions.length, 'Duplicate prediction IDs')
  for (const row of gold) assert(byPrediction.has(row.id), `Missing prediction ${row.id}`)
  const perRecording = gold.map(row => {
    const original = byPrediction.get(row.id)
    const reports = Object.fromEntries(trims.map(inset => {
      const prediction = trimPlayback(original, row, inset)
      return [inset, evaluateBoundaries([row], [prediction], { split })]
    }))
    return { id: row.id, speaker: row.speaker, reports }
  })
  const measures = Object.fromEntries(trims.map(inset => [inset, aggregate(perRecording, inset)]))
  const paired = Object.fromEntries(trims.filter(inset => inset !== 0).map(inset => [inset, speakerBootstrap(perRecording, sample => {
    const zero = aggregate(sample, 0)
    const trimmed = aggregate(sample, inset)
    return Object.fromEntries(['meanErrorMs', 'meanNeighborIncludedMs', 'neighborLeakageRate', 'meanTargetClippedMs', 'timingCoverage', 'replayCoverage']
      .map(key => [key, zero[key] === null || trimmed[key] === null ? null : trimmed[key] - zero[key]]))
  })]))
  return { schemaVersion: 1, split, recordings: gold.length, words: gold.reduce((n, row) => n + row.words.length, 0),
    scorer: predictions[0]?.scorer, revision: predictions[0]?.revision,
    policy: 'Symmetric inward trim on playback only, then app sample-rounded playbackSlice. Acoustic timestamps never change.',
    baseline: measures[0], sweep: measures,
    pairedChangesVsUntrimmed: paired,
    caveats: ['Development-only descriptive sweep; do not select or deploy a trim from this sample alone.',
      'A trim can increase target clipping and reduce replay coverage; inspect all measures together.',
      'Boundary interval overlap is not a direct measure of audible intelligibility or phonation.'] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [goldPath, predictionsPath, outputPath, ...extra] = process.argv.slice(2)
    assert(goldPath && predictionsPath && outputPath && !extra.length,
      'Usage: npm run benchmark:boundaries:trim -- GOLD.jsonl PREDICTIONS.jsonl NEW_REPORT.json')
    const output = resolve(outputPath), datasets = resolve(ROOT, 'datasets')
    const relativeOutput = relative(datasets, output)
    assert(relativeOutput && !isAbsolute(relativeOutput) && relativeOutput !== '..' && !relativeOutput.startsWith(`..${sep}`),
      'Report must be written under local datasets/')
    const goldBytes = await readFile(goldPath), predictionBytes = await readFile(predictionsPath)
    const gold = await readJsonl(goldPath), predictions = await readJsonl(predictionsPath)
    const report = sweepBoundaryTrims(gold, predictions)
    report.provenance = {
      gold: { path: goldPath, sha256: sha256(goldBytes) },
      predictions: { path: predictionsPath, sha256: sha256(predictionBytes) },
    }
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ output, scorer: report.scorer, sweep: report.sweep }, null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
