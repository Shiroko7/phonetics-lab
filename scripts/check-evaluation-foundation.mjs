/** Authored synthetic fixtures only. No external downloads, real license acceptance or human-performance claims. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, join } from 'node:path'
import { makeSplitPlan, validatePlan, assertNotReserved, loadSelection, PROTOCOL } from './benchmark-splits.mjs'
import { ROOT, jsonl, sha256 } from './prepare-speechocean.mjs'
import { parseTextGrid, boundaryRow, importLocalBoundaries, wavInfo, selectBoundaryCandidates } from './import-l2-arctic.mjs'
import { evaluateBoundaries } from './evaluate-boundaries.mjs'

const training = Array.from({ length: 40 }, (_, i) => ({ id: `train-${i}`, speaker: `t${i % 10}` }))
const testing = Array.from({ length: 20 }, (_, i) => ({ id: `test-${i}`, speaker: `s${i % 5}` }))
const plan = makeSplitPlan(training, testing, ['test-0', 'test-1'])
assert.equal(plan.partitions.training.speakers.length, 6)
assert.equal(plan.partitions.calibration.speakers.length, 2)
assert.equal(plan.partitions.validation.speakers.length, 2)
assert.equal(plan.partitions.regression.speakers.length, 2)
assert.equal(plan.partitions.final.speakers.length, 3)
assert.deepEqual(makeSplitPlan([...training].reverse().map(r => ({ ...r, score: Math.random() })), [...testing].reverse(), ['test-1', 'test-0']), plan)
assert.equal(validatePlan(plan), plan)
assert.throws(() => makeSplitPlan([...training, training[0]], testing, ['test-0']), /Duplicate/)
assert.throws(() => makeSplitPlan(training, [{ id: 'x', speaker: 't0' }], ['x']), /overlap/)
assert.throws(() => makeSplitPlan(training, testing, testing.map(r => r.id)), /No unexposed/)
assert.throws(() => makeSplitPlan(training, testing, ['missing']), /Known exposed/)
const unlocked = structuredClone(plan); unlocked.partitions.final.locked = false
assert.throws(() => validatePlan(unlocked), /locked/)
const overlap = structuredClone(plan); overlap.partitions.final.speakers.push(plan.partitions.training.speakers[0])
assert.throws(() => validatePlan(overlap), /overlap/)
const temp = await mkdtemp(join(tmpdir(), 'phonetics-splits-test-'))
try {
  await assertNotReserved(testing, temp) // no protocol yet
  const planBytes = JSON.stringify(plan)
  await writeFile(join(temp, 'plan.json'), planBytes)
  await assertNotReserved([testing[0]], temp)
  await assert.rejects(assertNotReserved([testing[2]], temp), /reserved final/)
  await assert.rejects(assertNotReserved([{ id: 'new-id', speaker: testing[2].speaker }], temp), /reserved final/)
  await assert.rejects(loadSelection('final', 1, temp), /locked/)
  const id = plan.partitions.calibration.ids[0], original = training.find(r => r.id === id)
  const rows = [{ ...original, split: 'calibration', officialSplit: 'train', protocol: PROTOCOL }], gold = jsonl(rows)
  const manifest = { partition: 'calibration', ids: [id], goldSha256: sha256(gold), planSha256: sha256(planBytes) }
  await writeFile(join(temp, 'calibration-1.jsonl'), gold)
  await writeFile(join(temp, 'calibration-1.manifest.json'), JSON.stringify(manifest))
  assert.deepEqual((await loadSelection('calibration', 1, temp)).gold, rows)
  await writeFile(join(temp, 'calibration-1.jsonl'), gold + ' ')
  await assert.rejects(loadSelection('calibration', 1, temp), /labels changed/)
} finally {
  assert.equal(dirname(temp), tmpdir()); assert(temp.includes('phonetics-splits-test-'))
  await rm(temp, { recursive: true, force: true })
}

// Shared filenames must not force every speaker to read the same pilot sentence.
const boundaryPool = Array.from({ length: 24 }, (_, s) => Array.from({ length: 20 }, (_, i) => ({ speaker: `speaker-${s}`, name: `arctic_a${String(i).padStart(4, '0')}.TextGrid` }))).flat()
const boundaryV1 = selectBoundaryCandidates(boundaryPool, 24, 'v1')
const boundaryV2 = selectBoundaryCandidates(boundaryPool, 24)
assert.equal(new Set(boundaryV1.map(r => r.name)).size, 1, 'legacy selection stays reproducible')
assert(new Set(boundaryV2.map(r => r.name)).size > 10, 'speaker-qualified ranks diversify a shared prompt pool')
assert.equal(new Set(boundaryV2.map(r => r.speaker)).size, 24, 'speaker round-robin remains balanced')
assert.deepEqual(selectBoundaryCandidates([...boundaryPool].reverse(), 24), boundaryV2)
assert.throws(() => selectBoundaryCandidates(boundaryPool, 24, 'future'), /Unknown/)

// Original fixture, not a copied corpus sentence or annotation.
const textGrid = (tiers = [
  { name: 'words', intervals: [[0, 0.1, ''], [0.1, 0.4, 'we'], [0.4, 0.9, 'go'], [0.9, 1, '']] },
  { name: 'phones', intervals: [[0, 0.1, 'sil'], [0.1, 0.25, 'W'], [0.25, 0.4, 'IY1'], [0.4, 0.6, 'G,K,s'], [0.6, 0.9, 'OW1'], [0.9, 1, 'sil']] },
  { name: 'comments', intervals: [[0, 1, 'Authored "fixture" only']] },
]) => `File type = "ooTextFile"\nObject class = "TextGrid"\nxmin = 0\nxmax = 1\ntiers? <exists>\nsize = ${tiers.length}\nitem []:\n` + tiers.map((t, i) => `item [${i + 1}]:\nclass = "IntervalTier"\nname = "${t.name}"\nxmin = 0\nxmax = 1\nintervals: size = ${t.intervals.length}\n` + t.intervals.map(([start, end, text], j) => `intervals [${j + 1}]:\nxmin = ${start}\nxmax = ${end}\ntext = "${text.replaceAll('"', '""')}"\n`).join('')).join('')
const grid = parseTextGrid(textGrid())
assert.equal(grid.tiers[2].intervals[0].text, 'Authored "fixture" only')
assert.equal(parseTextGrid('\uFEFF' + textGrid().replaceAll('\n', '\r\n')).tiers.length, 3)
for (const malformed of [textGrid() + 'garbage', textGrid().replace('size = 3', 'size = 4'), textGrid().replace('xmax = 0.4', 'xmax = 0.05'), textGrid().replace('name = "phones"', 'name = "words"')]) {
  assert.throws(() => parseTextGrid(malformed))
}
const config = { grid, transcript: 'We go.', speaker: 'ABC', stem: 'arctic_a0001', annotationPath: 'ABC/annotation/arctic_a0001.TextGrid', revision: 'synthetic-v1', source: 'synthetic' }
const row = boundaryRow(config)
assert.equal(row.words.length, 2)
assert(row.words.every(w => w.correct === null))
assert.equal(row.phoneAnnotations[3].text, 'G,K,s', 'phone labels retained without inventing word verdicts')
assert.equal(row.source, 'synthetic')
assert.throws(() => boundaryRow({ ...config, annotationPath: 'ABC/textgrid/arctic_a0001.TextGrid' }), /manual/)
assert.throws(() => boundaryRow({ ...config, transcript: 'We stay.' }), /identity/)
assert.throws(() => boundaryRow({ ...config, split: 'test' }), /untouched final/)
const prediction = { id: row.id, scorer: 'authored-fixture', revision: 1, words: row.words.map(w => ({ text: w.text, start: w.start, end: w.end, correct: null })) }
const evaluate = (rows, predictions) => evaluateBoundaries(rows, predictions, { split: 'validation' })
const perfect = evaluate([row], [prediction])
assert.equal(perfect.boundary.coverage, 1)
assert.equal(perfect.boundary.meanErrorMs, 0)
assert.equal(perfect.pronunciation.coverage, null, 'unlabeled pronunciation is not 100% correct')
assert.equal(perfect.pronunciation.humanJudgedWords, 0)
const padded = structuredClone(prediction); padded.words[0].playback = { start: 0.1, end: 0.5 }
const leaking = evaluate([row], [padded])
assert.equal(leaking.boundary.meanErrorMs, 0, 'playback is independent of acoustic timestamps')
assert.equal(leaking.boundary.clipsWithNeighborSpeech, 1)
assert(Math.abs(leaking.boundary.meanNeighborIncludedMs - 50) < 1e-8)
const short = structuredClone(prediction); short.words[0].playback = { start: 0.2, end: 0.3 }
const clipped = evaluate([row], [short])
assert.equal(clipped.boundary.targetClippingRate, 0.5)
assert(Math.abs(clipped.boundary.meanTargetClippedMs - 100) < 1e-8)
assert(Math.abs(clipped.boundary.targetDurationClippedFraction - 0.25) < 1e-8)
const unknown = structuredClone(row); unknown.words[0].boundaryStatus = 'uncertain'
const partly = evaluate([unknown], [prediction])
assert.equal(partly.boundary.unavailableOrUnresolvedWords, 1)
assert.equal(partly.boundary.coverage, 0.5)
assert.equal(partly.boundary.neighborLeakageRate, null, 'unknown neighbor timing cannot prove no leakage')
const ranged = structuredClone(row)
ranged.words[0].boundaryStatus = 'uncertain'; ranged.words[0].endRange = [0.38, 0.42]
ranged.words[1].boundaryStatus = 'uncertain'; ranged.words[1].startRange = [0.38, 0.42]
const rangeResult = evaluate([ranged], [prediction])
assert.equal(rangeResult.boundary.meanErrorMs, 0)
assert.equal(rangeResult.boundary.neighborLeakageRate, 0)
assert.equal(rangeResult.boundary.possibleNeighborLeakageRate, 1)
assert.equal(rangeResult.boundary.targetClippingRate, 0)
assert.equal(rangeResult.boundary.possibleTargetClippingRate, 1)
const missing = evaluate([row], [])
assert.equal(missing.boundary.coverage, 0)
assert.equal(missing.boundary.targetClippingRate, null)
const noReplay = structuredClone(prediction); noReplay.words.forEach(w => w.playback = null)
assert.equal(evaluate([row], [noReplay]).boundary.replayCoverage, 0)
assert.equal(evaluate([row], [noReplay]).boundary.coverage, 1)
assert.throws(() => evaluate([row, row], []), /Duplicate/)
assert.throws(() => evaluate([row], [{ ...prediction, id: 'unknown' }]), /no annotation/)
assert.throws(() => evaluate([row], [{ ...prediction, words: [] }]), /Word count/)

// Exercise local I/O with authored fixture files; never real upstream resources/terms.
const datasetRoot = resolve(ROOT, 'datasets')
await mkdir(datasetRoot, { recursive: true })
const disk = await mkdtemp(join(datasetRoot, '.boundary-fixture-'))
try {
  const source = join(disk, 'source'), output = join(disk, 'output')
  for (const dir of ['annotation', 'textgrid', 'transcript', 'wav']) await mkdir(join(source, 'ABC', dir), { recursive: true })
  await writeFile(join(source, 'LICENSE'), 'AUTHORED TEST FIXTURE. Token: CC BY-NC 4.0. Not real corpus terms.')
  await writeFile(join(source, 'ABC/annotation/arctic_a0001.TextGrid'), textGrid())
  await writeFile(join(source, 'ABC/textgrid/arctic_a0002.TextGrid'), textGrid())
  await writeFile(join(source, 'ABC/transcript/arctic_a0001.txt'), 'We go.')
  const audio = Buffer.alloc(32044)
  audio.write('RIFF'); audio.writeUInt32LE(32036, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16)
  audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(16000, 24); audio.writeUInt32LE(32000, 28)
  audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(32000, 40)
  assert.deepEqual(wavInfo(audio), { sampleRate: 16000, channels: 1, duration: 1 })
  assert.throws(() => wavInfo(audio.subarray(0, 30000)), /Truncated/)
  const invalidFloat = Buffer.from(audio); invalidFloat.writeUInt16LE(3, 20)
  assert.throws(() => wavInfo(invalidFloat), /Inconsistent/)
  await writeFile(join(source, 'ABC/wav/arctic_a0001.wav'), audio)
  await assert.rejects(importLocalBoundaries({ root: source, output, revision: 'synthetic' }), /review.*terms/)
  const imported = await importLocalBoundaries({ root: source, output, revision: 'synthetic', acknowledgeTerms: true })
  assert.equal(imported.manifest.selected, 1, 'automatic alignment directory is never scanned')
  assert.equal(imported.manifest.requestedLimit, 100)
  assert.equal(imported.manifest.availableManualFiles, 1)
  assert.equal(imported.rows[0].words[0].correct, null)
  assert.equal(imported.manifest.goldSha256, sha256(await readFile(join(output, 'gold.jsonl'))))
  await assert.rejects(importLocalBoundaries({ root: source, output, revision: 'synthetic', acknowledgeTerms: true }), /EEXIST/)
  await assert.rejects(importLocalBoundaries({ root: source, output: resolve(ROOT, 'public/forbidden'), revision: 'synthetic', acknowledgeTerms: true }), /new directory under/)
  const alias = join(disk, 'source-alias')
  await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(importLocalBoundaries({ root: source, output: join(alias, 'forbidden'), revision: 'synthetic', acknowledgeTerms: true }), /inside source corpus/)
  await writeFile(join(source, 'ABC/annotation/arctic_a0003.TextGrid'), textGrid().replace('xmax = 1\n', 'xmax = 2\n'))
  await writeFile(join(source, 'ABC/transcript/arctic_a0003.txt'), 'We go.')
  await writeFile(join(source, 'ABC/wav/arctic_a0003.wav'), audio)
  const partial = await importLocalBoundaries({ root: source, output: join(disk, 'partial'), revision: 'synthetic', acknowledgeTerms: true })
  assert.equal(partial.manifest.selected, 2)
  assert.equal(partial.manifest.imported, 1)
  assert.equal(partial.manifest.excluded.length, 1)
  assert.match(partial.manifest.excluded[0].reason, /durations disagree/)
  assert.equal(sha256(await readFile(join(source, 'ABC/wav/arctic_a0001.wav'))), sha256(audio), 'source audio is unchanged')
} finally {
  assert.equal(dirname(disk), datasetRoot); assert(disk.includes('.boundary-fixture-'))
  await rm(disk, { recursive: true, force: true })
}
console.log('Evaluation foundation passed: disjoint speakers, reserved holdout, manual-only import, uncertain boundaries, replay leakage and target clipping (synthetic fixtures).')
