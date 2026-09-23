/** Run imported human boundaries through the app scorer. Original local WAVs only. */
import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, sha256, readJsonl, jsonl, atomicWrite } from './prepare-speechocean.mjs'
import { localEndpoint, validateResponse, sourceFingerprint } from './benchmark-assessment.mjs'
import { wavInfo } from './import-l2-arctic.mjs'
import { evaluateBoundaries } from './evaluate-boundaries.mjs'
import { targetWords, flatten, byWord } from '../src/lib/report.ts'
import { wordPronunciations } from '../src/lib/wordAlignment.ts'
import { decodeAnalysisResponse, ANALYSIS_REVISION } from '../src/lib/backend.ts'
import { playbackSlice } from '../src/lib/playback.ts'
import { quantile } from './validation-statistics.mjs'

const inside = (root, path) => {
  const rel = relative(root, path)
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
export async function newDatasetDirectory(output) {
  const root = await realpath(resolve(ROOT, 'datasets')), destination = resolve(output)
  const parent = await realpath(dirname(destination))
  assert(inside(root, destination) && (parent === root || inside(root, parent)), 'Output must be a new directory under datasets/, without escaping symlinks')
  await mkdir(destination)
  return destination
}
export async function verifiedAudio(root, row) {
  const source = await realpath(root), path = await realpath(resolve(source, row.audio))
  assert(inside(source, path), 'Audio path escapes corpus root')
  const bytes = await readFile(path)
  assert.equal(sha256(bytes), row.audioSha256, `Changed audio: ${row.id}`)
  const info = wavInfo(bytes)
  assert(Math.abs(info.duration - row.duration) <= 0.05, 'Changed annotation/audio duration')
  return { bytes, info }
}
export function boundaryPrediction(row, words, body, audioInfo) {
  validateResponse(body, flatten(words))
  assert(words.length === row.words.length && words.every((w, i) => w.text === row.words[i].text), 'Prediction word identity mismatch')
  assert(body.phones.every(p => p.end <= audioInfo.duration + 0.001), 'Backend timestamp outside recording')
  const reports = byWord(words, decodeAnalysisResponse(body).aligned)
  return reports.map(word => {
    // Preserve acoustic estimates even when shared spans disable isolated replay in the app.
    const timed = word.steps.filter(s => s.expectedIndex !== null && Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    const start = timed.length ? Math.min(...timed.map(s => s.start)) : null
    const end = timed.length ? Math.max(...timed.map(s => s.end)) : null
    return { text: word.text, start, end, correct: null, timing: word.timing,
      playback: word.span ? playbackSlice(word.span, audioInfo.duration, audioInfo.sampleRate) : null }
  })
}
export async function runBoundaryBenchmark({ gold: goldPath, root, output, endpoint = 'http://127.0.0.1:8000', request = fetch } = {}) {
  assert(goldPath && root, 'Supply --gold IMPORT/gold.jsonl and --root ORIGINAL_CORPUS')
  const base = localEndpoint(endpoint), goldBytes = await readFile(goldPath), gold = await readJsonl(goldPath)
  const manifestBytes = await readFile(resolve(dirname(goldPath), 'manifest.json')), manifest = JSON.parse(manifestBytes)
  assert(manifest.dataset === 'l2-arctic' && manifest.annotationSource === 'human' && manifest.termsAcknowledgedLocally === true,
    'Use an existing acknowledged manual-boundary import')
  assert(['validation', 'regression'].includes(manifest.split), 'Only development boundary imports may be run')
  assert.equal(manifest.goldSha256, sha256(goldBytes), 'Changed imported gold')
  assert.equal(manifest.imported, gold.length, 'Incomplete imported rows')
  assert(Number.isInteger(manifest.selected) && manifest.selected >= manifest.imported
    && Array.isArray(manifest.excluded) && manifest.excluded.length === manifest.selected - manifest.imported, 'Inconsistent import coverage')
  assert(gold.every(r => r.source === 'human' && r.dataset === manifest.dataset && r.datasetRevision === manifest.datasetRevision
    && r.speaker && r.annotation?.kind === 'provider-manually-corrected'), 'Missing manual boundary provenance')
  assert.deepEqual(gold.map(r => ({ id: r.id, audio: r.audio, audioSha256: r.audioSha256 })),
    manifest.sourceFiles.map(r => ({ id: r.id, audio: r.audio, audioSha256: r.audioSha256 })), 'Imported audio identities changed')
  evaluateBoundaries(gold, [], { split: manifest.split })
  const health = async () => {
    const response = await request(`${base}/health`, { redirect: 'error', signal: AbortSignal.timeout(10000) })
    assert(response.ok, `Backend health failed: ${response.status}`)
    const info = await response.json()
    assert.equal(info.scorer_revision, ANALYSIS_REVISION, 'Restart/update the local scorer')
    return info
  }
  const before = await health(), source = await sourceFingerprint()
  const dictionaryBytes = await readFile(resolve(ROOT, 'public/dict/cmudict-ipa.txt'))
  const dictionary = new Map(dictionaryBytes.toString('utf8').trim().split(/\r?\n/).map(line => {
    const [word, variants] = line.split('\t'); return [word, variants.split('|')]
  }))
  const destination = resolve(output ?? resolve(dirname(goldPath), `run-${new Date().toISOString().replace(/[:.]/g, '-')}`))
  const sourceRoot = await realpath(root), destinationParent = await realpath(dirname(destination))
  assert(destinationParent !== sourceRoot && !inside(sourceRoot, destinationParent), 'Output must not be inside the source corpus')
  const directory = await newDatasetDirectory(destination)
  const config = sha256(JSON.stringify({ source: source.sha256, dictionary: sha256(dictionaryBytes), revision: ANALYSIS_REVISION }))
  const run = { schemaVersion: 1, startedAt: new Date().toISOString(), dataset: manifest,
    manifestSha256: sha256(manifestBytes), source, dictionarySha256: sha256(dictionaryBytes), backendBefore: before,
    mode: 'Original corpus WAV; app word aggregation; isolated replay simulated at corpus sample rate. No browser codec or device playback measured.' }
  await atomicWrite(resolve(directory, 'run.json'), JSON.stringify(run, null, 2) + '\n')
  const predictions = [], raw = []
  for (const row of gold) {
    const { bytes, info } = await verifiedAudio(root, row), words = targetWords(row.text, dictionary)
    const prediction = { id: row.id, speaker: row.speaker, datasetRevision: row.datasetRevision, scorer: 'local-gop-app', revision: config,
      words: row.words.map(w => ({ text: w.text, start: null, end: null, playback: null, correct: null })) }
    if (words.length !== row.words.length || words.some((w, i) => w.text !== row.words[i].text)) {
      prediction.error = 'target-word-mismatch'
      raw.push({ id: row.id, words, error: prediction.error })
    } else {
      const form = new FormData()
      form.append('audio', new Blob([bytes], { type: 'audio/wav' }), `${row.id}.wav`)
      form.append('expected', JSON.stringify(flatten(words)))
      form.append('words', JSON.stringify(words.map(w => ({ text: w.text, phones: w.phones, pronunciations: wordPronunciations(w) }))))
      const start = performance.now()
      const response = await request(`${base}/analyze`, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(180000) })
      const body = await response.json()
      prediction.milliseconds = performance.now() - start
      raw.push({ id: row.id, status: response.status, body, words, milliseconds: prediction.milliseconds })
      if (response.status === 400) prediction.error = 'backend-refused-recording'
      else {
        assert(response.ok, `Backend failure ${response.status}; run incomplete, no report`)
        prediction.words = boundaryPrediction(row, words, body, info)
      }
    }
    predictions.push(prediction)
    await atomicWrite(resolve(directory, 'raw.jsonl'), jsonl(raw))
    await atomicWrite(resolve(directory, 'predictions.jsonl'), jsonl(predictions))
    if (predictions.length % 10 === 0 || predictions.length === gold.length) console.log(`Measured ${predictions.length}/${gold.length}`)
  }
  const after = await health()
  assert.equal(after.phoneme_model, before.phoneme_model, 'Model changed during run')
  assert(/^[a-f0-9]{40}$/.test(after.phoneme_model_revision ?? ''), 'Loaded model revision unavailable')
  if (before.phoneme_model_revision) assert.equal(after.phoneme_model_revision, before.phoneme_model_revision, 'Model changed during run')
  assert.equal((await sourceFingerprint()).sha256, source.sha256, 'Source changed during run')
  assert.equal(sha256(await readFile(goldPath)), manifest.goldSha256, 'Gold changed during run')
  const revision = `${ANALYSIS_REVISION}:${config}:${after.phoneme_model_revision}`
  for (const p of predictions) p.revision = revision
  await atomicWrite(resolve(directory, 'predictions.jsonl'), jsonl(predictions))
  const report = evaluateBoundaries(gold, predictions, { split: manifest.split })
  const milliseconds = predictions.map(p => p.milliseconds).filter(Number.isFinite)
  report.runtime = { requests: milliseconds.length, medianMs: quantile(milliseconds, 0.5), p95Ms: quantile(milliseconds, 0.95) }
  report.importCoverage = { selected: manifest.selected, imported: manifest.imported, excluded: manifest.excluded }
  report.failures = predictions.filter(p => p.error).map(p => ({ id: p.id, reason: p.error }))
  report.provenance = { goldSha256: manifest.goldSha256, predictionsSha256: sha256(jsonl(predictions)), revision,
    replay: run.mode, modelLimit: 'Configuration commit recorded; complete weights/vocabulary provenance remains future work.' }
  await atomicWrite(resolve(directory, 'run.json'), JSON.stringify({ ...run, revision, backendAfter: after, completedAt: new Date().toISOString() }, null, 2) + '\n')
  await writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: directory, boundary: report.boundary, runtime: report.runtime, failures: report.failures.length }, null, 2))
  return { report, directory }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = {}
    for (let i = 0; i < args.length; i += 2) {
      assert(['--gold', '--root', '--output', '--endpoint'].includes(args[i]) && args[i + 1],
        'Usage: npm run benchmark:boundaries:run -- --gold IMPORT/gold.jsonl --root ORIGINAL_CORPUS [--output datasets/NEW]')
      options[args[i].slice(2)] = args[i + 1]
    }
    await runBoundaryBenchmark(options)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
