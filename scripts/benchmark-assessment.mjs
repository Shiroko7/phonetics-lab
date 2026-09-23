/** Run the current app scorer against a frozen local public test selection. No cloud uploads. */
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { targetWords, flatten, byWord } from '../src/lib/report.ts'
import { wordPronunciations } from '../src/lib/wordAlignment.ts'
import { decodeAnalysisResponse, ANALYSIS_REVISION } from '../src/lib/backend.ts'
import { ROOT, CORPUS, spec, sha256, readJsonl, jsonl, atomicWrite } from './prepare-speechocean.mjs'
import { evaluateAssessment } from './evaluate-assessment.mjs'
import { assertNotReserved, loadSelection } from './benchmark-splits.mjs'

export function localEndpoint(endpoint) {
  const url = new URL(endpoint)
  assert(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)
    && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/',
  'Benchmark recordings may only be posted to literal loopback HTTP addresses')
  return url.origin
}

export function validateResponse(body, expected) {
  assert.equal(body.revision, ANALYSIS_REVISION, 'Stale scoring service')
  assert(Array.isArray(body.phones) && body.phones.length === expected.length, 'Incomplete phone response')
  assert(Number.isFinite(body.overall) && body.overall >= 0 && body.overall <= 100, 'Invalid overall score')
  const indices = new Set()
  for (const p of body.phones) {
    assert(Number.isInteger(p.index) && p.index >= 0 && p.index < expected.length && !indices.has(p.index), 'Invalid/duplicate phone index')
    indices.add(p.index)
    assert.equal(p.expected, expected[p.index], 'Mismatched phone response')
    assert(Number.isFinite(p.score) && p.score >= 0 && p.score <= 100 && Number.isFinite(p.gop) && Number.isFinite(p.posterior), 'Invalid numerical phone score')
    assert(['correct', 'close', 'wrong', 'missing'].includes(p.verdict), 'Unknown verdict')
    assert(Number.isFinite(p.start) && Number.isFinite(p.end) && p.start >= 0 && p.end >= p.start, 'Invalid model timestamps')
  }
}

/** Hash working-tree bytes, not just HEAD: uncommitted scoring changes must be distinguishable. */
export async function sourceFingerprint() {
  const paths = ['scripts/benchmark-assessment.mjs', 'scripts/benchmark-boundaries.mjs', 'scripts/evaluate-boundaries.mjs', 'scripts/import-l2-arctic.mjs', 'scripts/validation-statistics.mjs', 'scripts/benchmark-splits.mjs', 'scripts/evaluate-assessment.mjs', 'scripts/prepare-speechocean.mjs', 'scripts/speechocean.json', 'backend/uv.lock', 'package-lock.json']
  for (const [dir, extension] of [['src/lib', '.ts'], ['backend/app', '.py']]) {
    for (const name of await readdir(resolve(ROOT, dir))) if (name.endsWith(extension)) paths.push(`${dir}/${name}`)
  }
  const files = {}
  for (const path of paths.sort()) files[path] = sha256(await readFile(resolve(ROOT, path)))
  return { files, sha256: sha256(JSON.stringify(files)) }
}

export async function runBenchmark({ limit = 100, endpoint = 'http://127.0.0.1:8000', partition } = {}) {
  assert(Number.isInteger(limit) && limit > 0 && limit <= 2500, 'Limit must be 1–2500')
  const base = localEndpoint(endpoint)
  const selection = partition ? await loadSelection(partition, limit) : null
  const goldPath = selection?.goldPath ?? resolve(CORPUS, `test-${limit}.jsonl`)
  const gold = selection?.gold ?? await readJsonl(goldPath)
  const manifest = selection?.manifest ?? JSON.parse(await readFile(resolve(CORPUS, `test-${limit}.manifest.json`), 'utf8'))
  assert.equal(manifest.resource.revision, spec.revision)
  assert.equal(manifest.goldSha256, sha256(await readFile(goldPath)), 'Gold selection changed; prepare it again')
  assert.equal(gold.length, limit)
  assert.deepEqual(manifest.ids, gold.map((r) => r.id))
  await assertNotReserved(gold)
  // Validate all gold labels before any inference; an empty prediction set yields zero coverage.
  evaluateAssessment(gold, [], { split: partition ?? 'test' })
  const health = async () => {
    const r = await fetch(`${base}/health`, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
    assert(r.ok, `Health check failed: ${r.status}`)
    const info = await r.json()
    assert.equal(info.scorer_revision, ANALYSIS_REVISION, 'Restart/update the scoring service before benchmarking')
    return info
  }
  const before = await health()
  const source = await sourceFingerprint()
  const dictionaryBytes = await readFile(resolve(ROOT, 'public/dict/cmudict-ipa.txt'))
  const dictionary = new Map(dictionaryBytes.toString('utf8').trim().split(/\r?\n/).map((line) => {
    const [word, variants] = line.split('\t')
    return [word, variants.split('|')]
  }))
  const runPath = resolve(CORPUS, 'runs', new Date().toISOString().replace(/[:.]/g, '-'))
  await mkdir(runPath, { recursive: true })
  const provenance = { schemaVersion: 1, startedAt: new Date().toISOString(), endpoint: base, dataset: manifest,
    source, dictionarySha256: sha256(dictionaryBytes), backendBefore: before,
    input: 'Original corpus WAV, not browser microphone capture; application targetWords, pronunciation alternatives, response decoder and byWord reused.',
    modelProvenanceLimit: 'Loaded model configuration commit is recorded. Feature extractor/vocabulary revisions and weight hashes are not independently pinned yet.',
  }
  await atomicWrite(resolve(runPath, 'run.json'), JSON.stringify(provenance, null, 2) + '\n')
  const predictions = [], raw = []
  // Stable across runs of the same source/dictionary; model commit added after lazy model load.
  const configRevision = sha256(JSON.stringify({ source: source.sha256, dictionary: provenance.dictionarySha256, revision: ANALYSIS_REVISION }))
  for (let i = 0; i < gold.length; i++) {
    const row = gold[i]
    const prediction = { id: row.id, datasetRevision: row.datasetRevision, scorer: 'local-gop-app', revision: configRevision,
      sentence: { accuracy: null, fluency: null, prosody: null },
      words: row.words.map((w) => ({ text: w.text, accuracy: null, stress: null })),
    }
    const audioPath = resolve(CORPUS, row.audio)
    assert(relative(CORPUS, audioPath) && !relative(CORPUS, audioPath).startsWith(`..${sep}`) && !relative(CORPUS, audioPath).startsWith('..'), 'Unsafe audio path')
    const audio = await readFile(audioPath)
    assert.equal(sha256(audio), row.audioSha256, `Changed audio: ${row.id}`)
    const words = targetWords(row.text, dictionary)
    if (words.length !== row.words.length || words.some((w, j) => w.text !== row.words[j].text)) {
      prediction.error = 'target-word-mismatch'
      raw.push({ id: row.id, words, error: prediction.error })
    } else {
      const expected = flatten(words), form = new FormData()
      form.append('audio', new Blob([audio], { type: 'audio/wav' }), `${row.id}.wav`)
      form.append('expected', JSON.stringify(expected))
      form.append('words', JSON.stringify(words.map((w) => ({ text: w.text, phones: w.phones, pronunciations: wordPronunciations(w) }))))
      const start = performance.now()
      // Redirects are refused so a local endpoint cannot redirect a recording to a cloud service.
      const response = await fetch(`${base}/analyze`, { method: 'POST', body: form, redirect: 'error', signal: AbortSignal.timeout(180_000) })
      const body = await response.json()
      raw.push({ id: row.id, words, milliseconds: performance.now() - start, status: response.status, body })
      if (response.status === 400) prediction.error = 'backend-refused-recording'
      else {
        assert(response.ok, `Backend failure ${response.status}; run incomplete, do not treat as a benchmark result`)
        validateResponse(body, expected)
        const remote = decodeAnalysisResponse(body)
        prediction.sentence.accuracy = remote.overall
        prediction.words = byWord(words, remote.aligned).map((w) => ({ text: w.text, accuracy: w.score, stress: null,
          start: w.span?.start ?? null, end: w.span?.end ?? null, timing: w.timing }))
      }
    }
    predictions.push(prediction)
    // Preserve partial evidence on interruption, but write report.json only when every selected row is accounted for.
    await atomicWrite(resolve(runPath, 'raw.jsonl'), jsonl(raw))
    await atomicWrite(resolve(runPath, 'predictions.jsonl'), jsonl(predictions))
    if ((i + 1) % 10 === 0 || i + 1 === gold.length) console.log(`Scored ${i + 1}/${gold.length}`)
  }
  const after = await health()
  assert.equal(after.phoneme_model, before.phoneme_model, 'Model changed during run')
  assert(/^[a-f0-9]{40}$/.test(after.phoneme_model_revision ?? ''), 'Loaded model commit unavailable; baseline lacks provenance')
  if (before.phoneme_model_revision) assert.equal(after.phoneme_model_revision, before.phoneme_model_revision, 'Loaded model changed during run')
  assert.equal((await sourceFingerprint()).sha256, source.sha256, 'Source changed during benchmark; rerun on stable code')
  const revision = `${ANALYSIS_REVISION}:${configRevision}:${after.phoneme_model_revision}`
  for (const prediction of predictions) prediction.revision = revision
  await atomicWrite(resolve(runPath, 'predictions.jsonl'), jsonl(predictions))
  await atomicWrite(resolve(runPath, 'run.json'), JSON.stringify({ ...provenance, backendAfter: after, revision, completedAt: new Date().toISOString() }, null, 2) + '\n')
  const report = evaluateAssessment(gold, predictions, { split: partition ?? 'test' })
  await writeFile(resolve(runPath, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(report, null, 2))
  console.log(`Local report: ${resolve(runPath, 'report.json')}`)
  return { report, runPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = {}
    for (let i = 0; i < args.length; i += 2) {
      assert(['--limit', '--endpoint', '--partition'].includes(args[i]) && args[i + 1], 'Usage: npm run benchmark:run -- [--partition calibration] [--limit 100] [--endpoint http://127.0.0.1:8000]')
      options[args[i].slice(2)] = args[i] === '--limit' ? Number(args[i + 1]) : args[i + 1]
    }
    await runBenchmark(options)
  } catch (err) { console.error(err.message); process.exitCode = 1 }
}
