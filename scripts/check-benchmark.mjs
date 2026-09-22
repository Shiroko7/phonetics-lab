/** Authored synthetic fixtures only. No corpus downloads, speech models or human-performance claims. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { importCorpus, parseTable, selectPilot, verifiedDownload, sha256, gitBlob, spec } from './prepare-speechocean.mjs'
import { evaluateAssessment, pearson, ranks } from './evaluate-assessment.mjs'
import { localEndpoint, validateResponse } from './benchmark-assessment.mjs'
import { decodeAnalysisResponse, ANALYSIS_REVISION } from '../src/lib/backend.ts'

const five = (n) => Array(5).fill(n)
const fixture = {
  'test/text': 'a1 TONE MOVES\nb1 TONE MOVES\n',
  'test/utt2spk': 'a1 001\nb1 002\n', 'test/spk2age': '001 12\n002 30\n',
  'test/wav.scp': 'a1 WAVE/SPEAKER001/001.WAV\nb1 WAVE/SPEAKER002/002.WAV\n',
  'train/utt2spk': 'train1 003\n',
}
const score = (accuracy) => ({ text: 'TONE MOVES.', accuracy, fluency: 8, prosodic: 7, words: [
  { text: 'TONE', accuracy, stress: 10, phones: ['T', 'OW1', 'N'], 'phones-accuracy': [2, 1, 2] },
  { text: 'MOVES', accuracy: accuracy + 1, stress: 5, phones: ['M', 'UW1', 'V', 'Z'], 'phones-accuracy': [2, 2, 1, 2] },
] })
const detail = (s) => ({ text: s.text, accuracy: five(s.accuracy), fluency: five(s.fluency), prosodic: five(s.prosodic),
  words: s.words.map((w) => ({ text: w.text, accuracy: five(w.accuracy), stress: five(w.stress),
    'ref-phones': w.phones.join(' '), phones: five(w.phones.join(' ')) })) })
const scores = { a1: score(4), b1: score(8) }
fixture['resource/scores.json'] = JSON.stringify(scores)
fixture['resource/scores-detail.json'] = JSON.stringify(Object.fromEntries(Object.entries(scores).map(([id, s]) => [id, detail(s)])))
const gold = importCorpus(fixture, { id: 'authored-synthetic-fixture', revision: 'fixture-v1' }).map((row) => ({ ...row, source: 'synthetic' }))
assert(gold.every((row) => row.words.every((w) => w.start === null && w.end === null)))
assert.equal(gold[0].words[0].accuracyRaters.length, 5)
assert.equal(gold[0].words[0].phoneAnnotations.length, 5)
assert.throws(() => parseTable('id x\nid y'), /duplicate/)
assert.throws(() => importCorpus({ ...fixture, 'train/utt2spk': 'else 001' }), /overlap/)
assert.throws(() => importCorpus({ ...fixture, 'test/wav.scp': 'a1 command |\nb1 WAVE/SPEAKER002/002.WAV' }), /Unsafe/)
assert.throws(() => importCorpus({ ...fixture, 'test/text': 'a1 TONE LEAPS\nb1 TONE MOVES' }), /Transcript/)
assert.throws(() => importCorpus({ ...fixture, 'test/spk2age': '001 NaN\n002 30' }), /age/)
const badDetails = JSON.parse(fixture['resource/scores-detail.json'])
badDetails.a1.words[0].accuracy = [1, 2]
assert.throws(() => importCorpus({ ...fixture, 'resource/scores-detail.json': JSON.stringify(badDetails) }), /five/)
const badPhones = structuredClone(scores)
badPhones.a1.words[0]['phones-accuracy'] = [2]
assert.throws(() => importCorpus({ ...fixture, 'resource/scores.json': JSON.stringify(badPhones) }), /count/)
const more = Array.from({ length: 15 }, (_, i) => ({ id: `x${i}`, speaker: `s${i % 5}`, accuracy: i }))
const picked = selectPilot(more, 5)
assert.equal(new Set(picked.map((r) => r.speaker)).size, 5)
assert.deepEqual(selectPilot([...more].reverse().map((r) => ({ ...r, accuracy: 1000 })), 5).map((r) => r.id), picked.map((r) => r.id))
assert.equal(new Set(selectPilot(more, 15).map((r) => r.id)).size, 15)
assert.throws(() => selectPilot(more, 0))
assert.throws(() => selectPilot(more, 16))

const predictions = gold.map((r) => ({ id: r.id, datasetRevision: r.datasetRevision, scorer: 'fixture', revision: '1',
  sentence: { accuracy: r.sentence.accuracy * 10, fluency: null, prosody: null },
  words: r.words.map((w) => ({ text: w.text, accuracy: w.accuracy * 10, stress: null })) }))
const report = evaluateAssessment(gold, predictions)
assert.equal(report.metrics.sentenceAccuracy.pearson, 1)
assert.equal(report.metrics.wordAccuracy.spearman, 1)
assert.equal(report.metrics.wordAccuracy.displayedScaleMae, 0)
assert.equal(report.metrics.wordAccuracy.meanHumanPairwiseDifference, 0)
assert.equal(report.metrics.wordStress.coverage, 0)
assert.equal(report.metrics.wordStress.pearson, null)
assert.equal(report.boundaries.evaluated, false)
assert.equal(report.sentenceAccuracyByAge.childrenUnder18.scored, 1)
assert.equal(report.sentenceAccuracyByAge.childrenUnder18.pearson, null)
const absent = evaluateAssessment(gold, [])
assert.equal(absent.metrics.sentenceAccuracy.coverage, 0)
assert.equal(absent.metrics.sentenceAccuracy.displayedScaleMae, null)
assert.equal(evaluateAssessment(gold, predictions.slice(1)).metrics.wordAccuracy.coverage, 0.5)
assert.equal(pearson([1, 2, 3], [3, 2, 1]), -1)
assert.equal(pearson([1, 1, 1], [1, 2, 3]), null)
assert.deepEqual(ranks([10, 5, 5, 20]), [3, 1.5, 1.5, 4])
assert.throws(() => evaluateAssessment([...gold, gold[0]], predictions), /Duplicate/)
assert.throws(() => evaluateAssessment(gold, [...predictions, predictions[0]]), /Duplicate/)
assert.throws(() => evaluateAssessment(gold, [{ ...predictions[0], id: 'unknown' }]), /Unknown/)
assert.throws(() => evaluateAssessment([{ ...gold[0], source: 'human' }, gold[1]], predictions), /separate/)
assert.throws(() => evaluateAssessment([{ ...gold[0], split: 'train' }, gold[1]], predictions), /partition/)
assert.equal(evaluateAssessment(gold.map(r => ({ ...r, split: 'calibration' })), predictions, { split: 'calibration' }).split, 'calibration')
assert.throws(() => evaluateAssessment(gold, predictions, { split: 'final' }), /locked/)
assert.throws(() => evaluateAssessment(gold, [predictions[0], { ...predictions[1], revision: '2' }]), /revisions/)
assert.throws(() => evaluateAssessment(gold, [{ ...predictions[0], datasetRevision: 'changed' }]), /corpus revision/)
for (const edit of [
  (p) => { p.words.pop() },
  (p) => { p.words[0].text = 'different' },
  (p) => { p.words[0].accuracy = NaN },
  (p) => { p.sentence.accuracy = 101 },
  (p) => { delete p.sentence.prosody },
]) {
  const changed = structuredClone(predictions)
  edit(changed[0]); assert.throws(() => evaluateAssessment(gold, changed))
}
const partial = structuredClone(predictions)
partial[0].words[0].accuracy = null
assert.equal(evaluateAssessment(gold, partial).metrics.wordAccuracy.coverage, 0.75)

assert.equal(localEndpoint('http://127.0.0.1:8001'), 'http://127.0.0.1:8001')
for (const url of ['https://example.com', 'http://example.com', 'http://127.0.0.1.evil.test', 'http://localhost:8000', 'http://127.0.0.1/path', 'http://user:secret@127.0.0.1']) assert.throws(() => localEndpoint(url))
const body = { revision: ANALYSIS_REVISION, overall: 73, free: [], device: 'fixture', phones: [
  { index: 0, expected: 's', score: 73, gop: -1, posterior: 0.5, verdict: 'correct', start: 0, end: 0.2 },
] }
validateResponse(body, ['s'])
assert.equal(decodeAnalysisResponse(body).aligned[0].score, 73)
assert.throws(() => validateResponse({ ...body, revision: 0 }, ['s']), /Stale/)
assert.throws(() => validateResponse({ ...body, phones: [] }, ['s']), /Incomplete/)
assert.throws(() => validateResponse(body, ['t']), /Mismatched/)
assert.throws(() => validateResponse({ ...body, phones: [body.phones[0], body.phones[0]] }, ['s', 's']), /duplicate/)

const temp = await mkdtemp(join(tmpdir(), 'phonetics-benchmark-test-'))
try {
  const file = join(temp, 'download.txt'), bytes = Buffer.from('authored synthetic resource')
  let requests = 0
  const opts = { fetcher: async () => { requests++; return new Response(bytes) } }
  const verify = (b) => sha256(b) === sha256(bytes)
  await verifiedDownload(file, 'https://example.invalid/data', verify, opts)
  assert.equal(requests, 1)
  await verifiedDownload(file, 'https://example.invalid/data', verify, { offline: true, fetcher: () => assert.fail('Network during offline verification') })
  assert.equal(gitBlob(bytes).length, 40)
  await writeFile(file, 'corrupt fixture')
  await assert.rejects(verifiedDownload(file, 'https://example.invalid/data', verify, { offline: true }), /corrupt/)
  await assert.rejects(verifiedDownload(file, 'https://example.invalid/data', verify, { fetcher: async () => new Response('bad') }), /Checksum/)
  assert.equal(await readFile(file, 'utf8'), 'corrupt fixture', 'Failed download must not overwrite existing bytes')
  await verifiedDownload(file, 'https://example.invalid/data', verify, opts)
  assert.equal(await readFile(file, 'utf8'), bytes.toString())
  await assert.rejects(verifiedDownload(join(temp, 'missing'), 'https://example.invalid/data', verify, { fetcher: async () => new Response('', { status: 503 }) }), /503/)
  assert.match(spec.revision, /^[0-9a-f]{40}$/)
  assert.match(spec.treeEntriesSha256, /^[0-9a-f]{64}$/)
  for (const hash of Object.values(spec.files)) assert.match(hash, /^[0-9a-f]{64}$/)
} finally {
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()))
  assert(basename(temp).startsWith('phonetics-benchmark-test-'))
  await rm(temp, { recursive: true, force: true })
}
console.log('Human-benchmark pipeline checks passed (authored synthetic fixtures; no network or models).')
