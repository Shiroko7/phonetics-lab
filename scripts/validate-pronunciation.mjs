/** Offline development experiment. Fits a review cutoff, never numerical scores or final-test labels. */
import assert from 'node:assert/strict'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CORPUS, ROOT, sha256, readJsonl } from './prepare-speechocean.mjs'
import { loadSelection } from './benchmark-splits.mjs'
import { evaluatePhoneFlags } from './evaluate-phone-flags.mjs'
import { ratio, quantile, speakerBootstrap } from './validation-statistics.mjs'
import { newDatasetDirectory } from './benchmark-boundaries.mjs'

// Freeze these rules before opening validation data. They are engineering choices, not validated targets.
export const EXPERIMENT = Object.freeze({ version: 'global-review-cutoff-v1', baselineThreshold: 80,
  maximumRecallLoss: 0.05, minimumConcerns: 20, minimumConcernSpeakers: 5, bootstrapReplicates: 2000,
  selection: 'Lowest false-positive rate with at most 5 percentage points calibration recall loss; ties prefer recall, then higher cutoff.',
  validation: 'Paired 95% upper bound on false-positive-rate change below zero; lower bound on recall change at least -0.05; identical coverage.',
})
export function flagCounts(pairs, threshold) {
  let tp = 0, fp = 0, fn = 0, tn = 0, correctFlags = 0
  for (const p of pairs) {
    if (p.score < threshold) { if (p.concern) tp++; else fp++; if (p.category === 'correct') correctFlags++ }
    else if (p.concern) fn++; else tn++
  }
  return { scored: pairs.length, truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn,
    humanConcerns: tp + fn, modelFlags: tp + fp, fullyCorrectFlags: correctFlags,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), falsePositiveRate: ratio(fp, fp + tn) }
}
export function fitCutoff(report) {
  assert.equal(report.split, 'calibration', 'Fit only on calibration speakers')
  const pairs = report.pairs
  assert(Array.isArray(pairs), 'Mapped phone pairs required')
  const baseline = flagCounts(pairs, EXPERIMENT.baselineThreshold)
  const concernSpeakers = new Set(pairs.filter(p => p.concern).map(p => p.speaker)).size
  const enough = baseline.humanConcerns >= EXPERIMENT.minimumConcerns && concernSpeakers >= EXPERIMENT.minimumConcernSpeakers
  const sweep = Array.from({ length: 81 }, (_, threshold) => ({ threshold, ...flagCounts(pairs, threshold) }))
  const candidates = enough ? sweep.filter(row => row.recall !== null && row.falsePositiveRate !== null
    && row.recall >= baseline.recall - EXPERIMENT.maximumRecallLoss) : []
  candidates.sort((a, b) => a.falsePositiveRate - b.falsePositiveRate || b.recall - a.recall || b.threshold - a.threshold)
  const chosen = candidates[0] ?? { threshold: EXPERIMENT.baselineThreshold, ...baseline }
  return { experiment: EXPERIMENT, threshold: chosen.threshold, fittedPartition: 'calibration',
    sufficientSupport: enough, concernSpeakers, baseline, candidate: chosen, sweep,
    coverage: report.coverage, eligible: report.eligible, scored: report.scored }
}
export function compareCutoff(report, fitted) {
  assert.equal(report.split, 'validation', 'Comparison must use validation speakers')
  assert.equal(fitted.experiment.version, EXPERIMENT.version, 'Unknown experiment')
  const pairs = report.pairs, baseline = flagCounts(pairs, EXPERIMENT.baselineThreshold), candidate = flagCounts(pairs, fitted.threshold)
  const bootstrap = speakerBootstrap(pairs, rows => {
    const a = flagCounts(rows, EXPERIMENT.baselineThreshold), b = flagCounts(rows, fitted.threshold)
    return Object.fromEntries(['falsePositiveRate', 'recall', 'precision'].map(key => [key, a[key] === null || b[key] === null ? null : b[key] - a[key]]))
  }, { replicates: EXPERIMENT.bootstrapReplicates })
  const fp = bootstrap.metrics.falsePositiveRate.interval95, recall = bootstrap.metrics.recall.interval95
  const concernSpeakers = new Set(pairs.filter(p => p.concern).map(p => p.speaker)).size
  const gatePassed = fitted.sufficientSupport && baseline.humanConcerns >= EXPERIMENT.minimumConcerns
    && concernSpeakers >= EXPERIMENT.minimumConcernSpeakers && !!fp && fp[1] < 0 && !!recall && recall[0] >= -EXPERIMENT.maximumRecallLoss
  return { baseline, candidate, bootstrap, gatePassed,
    decision: gatePassed ? 'Development gate passed; broader phone mapping and representative-speaker evidence still required before changing the app default.'
      : 'Keep the app default. This candidate has not established fewer false flags within the allowed recall loss.',
    coverage: { eligible: report.eligible, scored: report.scored, fraction: report.coverage, identicalForBothPolicies: true },
    changes: { falseFlagsRemoved: baseline.falsePositive - candidate.falsePositive, additionalMissedErrors: candidate.falseNegative - baseline.falseNegative },
  }
}
export function diagnoseFlags(report, threshold = 80) {
  const pairs = report.pairs
  const group = key => Object.fromEntries([...new Set(pairs.map(key))].sort().map(value => {
    const rows = pairs.filter(p => key(p) === value)
    return [value, { ...flagCounts(rows, threshold), speakers: new Set(rows.map(p => p.speaker)).size }]
  }))
  return { byPhone: group(p => p.phone), byPosition: group(p => p.position),
    byStress: group(p => p.stress ?? 'consonant'), byDuration: group(p => p.durationMs < 40 ? '<40ms' : p.durationMs < 100 ? '40–100ms' : '>=100ms'),
    byWord: group(p => p.wordText.toLowerCase()),
    lowestScoringHumanCorrect: pairs.filter(p => p.category === 'correct' && p.score < threshold).sort((a, b) => a.score - b.score).slice(0, 30),
    missedHumanErrors: pairs.filter(p => p.concern && p.score >= threshold).sort((a, b) => b.score - a.score).slice(0, 30),
    interpretation: 'Descriptive groups and examples, not causal diagnoses or reliable per-phone calibration. Small groups are retained with support counts.' }
}
async function archive(partition, limit, runDirectory) {
  const selection = await loadSelection(partition, limit)
  let directory = runDirectory && resolve(runDirectory)
  if (!directory) {
    const root = resolve(CORPUS, 'runs')
    for (const name of (await readdir(root)).sort().reverse()) {
      let run
      try { run = JSON.parse(await readFile(resolve(root, name, 'run.json'), 'utf8')) } catch { continue }
      if (run.completedAt && run.dataset?.partition === partition && run.dataset.goldSha256 === sha256(await readFile(selection.goldPath))) {
        directory = resolve(root, name); break
      }
    }
  }
  assert(directory, `No completed ${partition}-${limit} archive. Run benchmark:run for that partition first.`)
  const runBytes = await readFile(resolve(directory, 'run.json')), run = JSON.parse(runBytes)
  const rawPath = resolve(directory, 'raw.jsonl'), rawBytes = await readFile(rawPath), raw = await readJsonl(rawPath)
  assert(run.completedAt && run.revision, 'Archived run must be complete and versioned')
  assert.equal(run.dataset.partition, partition, 'Wrong archived partition')
  assert.equal(run.dataset.goldSha256, sha256(await readFile(selection.goldPath)), 'Archive does not match frozen labels')
  assert.deepEqual(raw.map(r => r.id), selection.gold.map(r => r.id), 'Incomplete or changed archived recordings')
  const report = evaluatePhoneFlags(selection.gold, raw, 80, { split: partition, includePairs: true })
  const latencies = raw.map(r => r.milliseconds).filter(Number.isFinite)
  return { report, speakers: selection.gold.map(r => r.speaker), ids: selection.gold.map(r => r.id),
    provenance: { directory: relative(ROOT, directory), revision: run.revision, goldSha256: run.dataset.goldSha256,
      rawSha256: sha256(rawBytes), runSha256: sha256(runBytes) },
    latency: { recordings: latencies.length, medianMs: quantile(latencies, 0.5), p95Ms: quantile(latencies, 0.95),
      note: 'Archived inference runtime, including any cold start. Changing a cutoff adds no model inference.' } }
}
const percent = n => n === null ? 'unavailable' : `${(100 * n).toFixed(1)}%`
export function validationMarkdown(result) {
  const { fitted, validation } = result, a = validation.baseline, b = validation.candidate
  const top = Object.entries(result.calibrationDiagnostics.byPhone).sort((a, b) => b[1].fullyCorrectFlags - a[1].fullyCorrectFlags).slice(0, 8)
  return `# Automated pronunciation validation\n\n${validation.decision}\n\n` +
    `Candidate cutoff: **${fitted.threshold}**, selected on calibration speakers only. Scores are unchanged. This is a review-policy experiment, not probability calibration.\n\n` +
    `| Validation measure | Existing cutoff 80 | Candidate cutoff ${fitted.threshold} |\n| --- | ---: | ---: |\n` +
    [['Error detection precision', percent(a.precision), percent(b.precision)], ['Error recall', percent(a.recall), percent(b.recall)],
      ['Flags without majority-human error', a.falsePositive, b.falsePositive], ['Flags on majority-human-correct sounds', a.fullyCorrectFlags, b.fullyCorrectFlags],
      ['Missed majority-human errors', a.falseNegative, b.falseNegative]].map(row => `| ${row.join(' | ')} |`).join('\n') +
    `\n\nMapped coverage: ${validation.coverage.scored}/${validation.coverage.eligible} (${percent(validation.coverage.fraction)}) for both policies. Exclusions remain in the JSON report.\n\n` +
    `Paired speaker-bootstrap 95% intervals for candidate minus baseline:\n\n` +
    Object.entries(validation.bootstrap.metrics).map(([key, value]) => `- ${key}: ${value.interval95 ? value.interval95.map(n => `${(100 * n).toFixed(1)} pp`).join(' to ') : 'unavailable'}`).join('\n') +
    `\n\n## Calibration diagnostics\n\n| Phone | Human-correct flags at 80 | Mapped slots | Speakers |\n| --- | ---: | ---: | ---: |\n` +
    top.map(([phone, row]) => `| /${phone}/ | ${row.fullyCorrectFlags} | ${row.scored} | ${row.speakers} |`).join('\n') +
    `\n\nThe detailed JSON includes word, stress, duration and position breakdowns, example IDs, five-rater labels, hashes and archived runtimes. These groups suggest where to investigate; they do not establish causes.\n\n` +
    `This is a partial exact-canonical mapping of Mandarin-L1 read speech. It does not validate word cuts, browser capture, native-US speech or a particular learner. The reserved final set is untouched. No app settings or saved recordings were changed.\n`
}
export async function runValidation({ limit = 100, output, calibrationRun, validationRun } = {}) {
  const calibration = await archive('calibration', limit, calibrationRun)
  const fitted = fitCutoff(calibration.report)
  const directory = await newDatasetDirectory(output ?? resolve(ROOT, 'datasets', `validation-${new Date().toISOString().replace(/[:.]/g, '-')}`))
  const adapterFiles = ['validate-pronunciation.mjs', 'validation-statistics.mjs', 'evaluate-phone-flags.mjs']
  fitted.provenance = { ...calibration.provenance, implementation: Object.fromEntries(await Promise.all(adapterFiles.map(async name => [name, sha256(await readFile(new URL(name, import.meta.url)))]))) }
  // A concrete frozen candidate is written before opening validation labels or results.
  await writeFile(resolve(directory, 'candidate.json'), JSON.stringify(fitted, null, 2) + '\n', { flag: 'wx' })
  const validation = await archive('validation', limit, validationRun)
  assert.equal(calibration.provenance.revision, validation.provenance.revision, 'Use the same archived scoring system for both partitions')
  const calSpeakers = new Set(calibration.speakers), calIds = new Set(calibration.ids)
  assert(validation.speakers.every(s => !calSpeakers.has(s)) && validation.ids.every(id => !calIds.has(id)), 'Calibration and validation must be disjoint')
  const compact = ({ pairs, ...report }) => report
  const result = { schemaVersion: 1, createdAt: new Date().toISOString(), fitted,
    validation: compareCutoff(validation.report, fitted),
    calibrationDiagnostics: diagnoseFlags(calibration.report),
    calibration: { report: compact(calibration.report), provenance: calibration.provenance, latency: calibration.latency },
    validationData: { report: compact(validation.report), provenance: validation.provenance, latency: validation.latency },
    finalHoldoutUsed: false, appDefaultChanged: false }
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' })
  await writeFile(resolve(directory, 'report.md'), validationMarkdown(result), { flag: 'wx' })
  console.log(JSON.stringify({ output: directory, threshold: fitted.threshold, ...result.validation }, null, 2))
  return result
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = {}
    const keys = { '--limit': 'limit', '--output': 'output', '--calibration-run': 'calibrationRun', '--validation-run': 'validationRun' }
    for (let i = 0; i < args.length; i += 2) {
      assert(keys[args[i]] && args[i + 1], 'Usage: npm run benchmark:validate -- [--limit 100] [--output datasets/NEW] [--calibration-run RUN] [--validation-run RUN]')
      options[keys[args[i]]] = args[i] === '--limit' ? Number(args[i + 1]) : args[i + 1]
    }
    await runValidation(options)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
