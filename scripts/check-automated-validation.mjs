/** Original synthetic fixtures only. No real recordings, downloads or human-performance claims. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { fitCutoff, compareCutoff, flagCounts, diagnoseFlags, EXPERIMENT } from './validate-pronunciation.mjs'
import { speakerBootstrap } from './validation-statistics.mjs'
import { boundaryPrediction, runBoundaryBenchmark, verifiedAudio, newDatasetDirectory } from './benchmark-boundaries.mjs'
import { compareBoundaries } from './compare-boundaries.mjs'
import { ROOT, sha256, jsonl } from './prepare-speechocean.mjs'
import { ANALYSIS_REVISION } from '../src/lib/backend.ts'

const pairs = Array.from({ length: 10 }, (_, i) => Array.from({ length: 8 }, (_, j) => ({
  id: `r${i}`, speaker: `s${i}`, score: j < 4 ? 20 : 70, concern: j < 4,
  category: j < 4 ? 'incorrectOrMissed' : 'correct', phone: 'k', wordText: 'cat', position: 'initial', stress: null, durationMs: 60,
}))).flat()
const calibration = { split: 'calibration', pairs, eligible: 100, scored: 80, coverage: 0.8 }
const fitted = fitCutoff(calibration)
assert.equal(fitted.threshold, 70)
assert.equal(fitted.candidate.falsePositive, 0)
assert.equal(fitted.candidate.recall, 1)
assert.equal(EXPERIMENT.maximumRecallLoss, 0.05)
assert.throws(() => fitCutoff({ ...calibration, split: 'validation' }), /calibration/)
assert.throws(() => fitCutoff({ ...calibration, split: 'final' }), /calibration/)
assert.equal(fitCutoff({ ...calibration, pairs: pairs.slice(0, 8) }).sufficientSupport, false)
assert.equal(fitCutoff({ ...calibration, pairs: [] }).threshold, 80)
const validated = compareCutoff({ ...calibration, split: 'validation' }, fitted)
assert(validated.gatePassed)
assert.equal(validated.changes.falseFlagsRemoved, 40)
assert.equal(validated.changes.additionalMissedErrors, 0)
assert.equal(validated.coverage.fraction, 0.8, 'excluded mappings never disappear from coverage')
const regress = pairs.map(p => ({ ...p, score: p.concern ? 75 : p.score }))
assert.equal(compareCutoff({ ...calibration, split: 'validation', pairs: regress }, fitted).gatePassed, false, 'fewer flags alone cannot pass')
const noErrors = pairs.map(p => ({ ...p, concern: false, category: 'correct' }))
assert.equal(compareCutoff({ ...calibration, split: 'validation', pairs: noErrors }, fitted).gatePassed, false, 'undefined recall cannot pass')
assert.equal(flagCounts([], 80).precision, null)
const diagnostics = diagnoseFlags(calibration)
assert.equal(diagnostics.byPhone.k.fullyCorrectFlags, 40)
assert.equal(diagnostics.lowestScoringHumanCorrect.length, 30)
const clustered = [{ speaker: 'a', value: 1 }, { speaker: 'a', value: 3 }, { speaker: 'b', value: 10 }]
const measure = rows => ({ total: rows.reduce((n, r) => n + r.value, 0) })
const bootstrap = speakerBootstrap(clustered, measure, { replicates: 100 })
assert.deepEqual(bootstrap, speakerBootstrap(clustered, measure, { replicates: 100 }))
assert.deepEqual(bootstrap.metrics.total.interval95, [8, 20], 'each sampled speaker brings all their observations')
assert.equal(speakerBootstrap(clustered.slice(0, 2), measure).metrics.total.interval95, null)
assert.throws(() => speakerBootstrap([{ value: 1 }], measure), /Speaker/)

const response = expected => ({ revision: ANALYSIS_REVISION, overall: 90, free: [], phones: expected.map((phone, i) => ({
  index: i, expected: phone, realized: phone, verdict: 'correct', score: 90, gop: -0.1, posterior: 0.9,
  start: 0.1 + i * 0.1, end: 0.1 + (i + 1) * 0.1,
})) })
const words = [{ text: 'we', phones: ['w', 'i'], ipa: 'wi' }, { text: 'go', phones: ['g', 'oʊ'], ipa: 'goʊ' }]
const row = { id: 'x', words: words.map(w => ({ text: w.text })) }
const body = response(words.flatMap(w => w.phones))
const prediction = boundaryPrediction(row, words, body, { duration: 1, sampleRate: 16000 })
assert(prediction.every(w => w.correct === null))
assert(prediction[0].playback.start >= prediction[0].start && prediction[0].playback.end <= prediction[0].end)
const overlapping = structuredClone(body); overlapping.phones[2].start = 0.2
const ambiguous = boundaryPrediction(row, words, overlapping, { duration: 1, sampleRate: 16000 })
assert(ambiguous.every(w => w.playback === null), 'shared spans disable isolated replay')
assert(ambiguous.every(w => w.start !== null), 'keep acoustic estimates separate from replay availability')
const invalid = structuredClone(body); invalid.phones[3].end = 1.5
assert.throws(() => boundaryPrediction(row, words, invalid, { duration: 1, sampleRate: 16000 }), /outside recording/)
const gold = ['a', 'b'].map((speaker, i) => ({ id: `g${i}`, speaker, split: 'validation', source: 'synthetic', dataset: 'fixture', datasetRevision: '1',
  words: [{ text: 'we', start: 0.1, end: 0.3, correct: null }, { text: 'go', start: 0.3, end: 0.5, correct: null }] }))
const baseline = gold.map(r => ({ id: r.id, scorer: 'fixture', revision: 1, milliseconds: 10, words: r.words.map(w => ({ ...w, playback: { start: w.start, end: w.end } })) }))
const missing = baseline.map(r => ({ ...r, scorer: 'missing-fixture', words: r.words.map(w => ({ ...w, start: null, end: null, playback: null })) }))
const comparison = compareBoundaries(gold, baseline, missing)
assert.equal(comparison.deltaBootstrap.metrics.timingCoverage.estimate, -1)
assert.equal(comparison.deltaBootstrap.metrics.meanErrorMs.estimate, null)
assert.equal(comparison.candidate.boundary.replayCoverage, 0)
assert.throws(() => compareBoundaries(gold, baseline, []), /every selected/)
assert.throws(() => compareBoundaries(gold.map(r => ({ ...r, split: 'test' })), baseline, missing), /development/)
assert.throws(() => compareBoundaries(gold, baseline, baseline.map(r => ({ ...r, milliseconds: -1 }))), /runtime/)

// Exercise a complete runner with fake loopback responses and synthetic WAV/annotation files.
const datasetRoot = resolve(ROOT, 'datasets')
await mkdir(datasetRoot, { recursive: true })
const disk = await mkdtemp(join(datasetRoot, '.automated-validation-test-'))
try {
  const source = join(disk, 'source'), imported = join(disk, 'import')
  await mkdir(source); await mkdir(imported)
  const audio = Buffer.alloc(32044)
  audio.write('RIFF'); audio.writeUInt32LE(32036, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28)
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(32000, 40)
  await writeFile(join(source, 'one.wav'), audio)
  const rows = gold.map(r => ({ ...r, source: 'human', dataset: 'l2-arctic', text: 'we go', duration: 1,
    annotation: { kind: 'provider-manually-corrected' }, audio: 'one.wav', audioSha256: sha256(audio) }))
  const goldPath = join(imported, 'gold.jsonl')
  await writeFile(goldPath, jsonl(rows))
  const manifest = { dataset: 'l2-arctic', datasetRevision: '1', annotationSource: 'human', termsAcknowledgedLocally: true, split: 'validation',
    imported: 2, selected: 3, excluded: [{ reason: 'synthetic exclusion' }], goldSha256: sha256(jsonl(rows)),
    sourceFiles: rows.map(r => ({ id: r.id, audio: r.audio, audioSha256: r.audioSha256 })) }
  await writeFile(join(imported, 'manifest.json'), JSON.stringify(manifest))
  let calls = 0
  const request = async (url, options) => {
    assert(url.startsWith('http://127.0.0.1:8000/')); assert.equal(options.redirect, 'error')
    if (url.endsWith('/health')) return Response.json({ scorer_revision: ANALYSIS_REVISION, phoneme_model: 'synthetic-fixture', phoneme_model_revision: 'f'.repeat(40) })
    calls++
    if (calls === 2) return Response.json({ detail: 'synthetic refusal' }, { status: 400 })
    return Response.json(response(JSON.parse(options.body.get('expected'))))
  }
  const run = await runBoundaryBenchmark({ gold: goldPath, root: source, output: join(disk, 'success'), request })
  assert.equal(run.report.predictedRecordings, 2)
  assert.equal(run.report.failures.length, 1)
  assert.equal(run.report.boundary.coverage, 0.5)
  assert.equal(run.report.importCoverage.excluded.length, 1)
  assert.equal(run.report.pronunciation.humanJudgedWords, 0)
  const saved = (await readFile(join(run.directory, 'predictions.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse)
  assert(saved[1].words.every(w => w.start === null && w.playback === null))
  assert.equal(run.report.provenance.predictionsSha256, sha256(await readFile(join(run.directory, 'predictions.jsonl'))))
  await assert.rejects(runBoundaryBenchmark({ gold: goldPath, root: source, output: join(disk, 'success'), request }), /EEXIST/)
  const broken = async (url, options) => url.endsWith('/health') ? request(url, options) : Response.json({ detail: 'failure' }, { status: 500 })
  await assert.rejects(runBoundaryBenchmark({ gold: goldPath, root: source, output: join(disk, 'broken'), request: broken }), /incomplete/)
  await assert.rejects(access(join(disk, 'broken', 'report.json')), /ENOENT/)
  await assert.rejects(verifiedAudio(source, { ...rows[0], audioSha256: 'changed' }), /Changed audio/)
  await writeFile(join(disk, 'outside.wav'), audio)
  await assert.rejects(verifiedAudio(source, { ...rows[0], audio: '../outside.wav' }), /escapes/)
  await symlink(join(disk, 'outside.wav'), join(source, 'escape.wav'), 'file')
  await assert.rejects(verifiedAudio(source, { ...rows[0], audio: 'escape.wav' }), /escapes/)
  await assert.rejects(newDatasetDirectory(resolve(ROOT, 'public/not-allowed')), /under datasets/)
  await writeFile(goldPath, jsonl(rows) + ' ')
  await assert.rejects(runBoundaryBenchmark({ gold: goldPath, root: source, output: join(disk, 'changed'), request }), /Changed imported gold/)
} finally {
  assert.equal(dirname(disk), datasetRoot); assert(disk.includes('.automated-validation-test-'))
  await rm(disk, { recursive: true, force: true })
}
console.log('Automated validation passed: calibration-only selection, paired speaker intervals, recall-loss gate, boundary predictions, refusals, hashes and local-only audio (synthetic fixtures).')
