/** Speaker-disjoint development protocol. Final-test speakers are reserved, not scored here. */
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CORPUS, spec, sha256, gitBlob, jsonl, readJsonl, parseTable, importCorpus, selectPilot, verifiedDownload, atomicWrite } from './prepare-speechocean.mjs'

export const PROTOCOL = 'speaker-disjoint-v1'
export const SPLIT_ROOT = resolve(CORPUS, PROTOCOL)
const rank = (value) => sha256(`${PROTOCOL}:${value}`)
const ordered = (values) => [...values].sort((a, b) => rank(a).localeCompare(rank(b), 'en'))
export const PARTITIONS = ['training', 'calibration', 'validation', 'regression']

export function makeSplitPlan(training, testing, exposedIds) {
  const all = [...training, ...testing], ids = new Set(all.map(r => r.id))
  assert.equal(ids.size, all.length, 'Duplicate corpus IDs')
  assert(all.every(r => typeof r.id === 'string' && r.id && typeof r.speaker === 'string' && r.speaker), 'Missing identity')
  const trainSpeakers = ordered(new Set(training.map(r => r.speaker))), testSpeakers = ordered(new Set(testing.map(r => r.speaker)))
  assert(trainSpeakers.length >= 5, 'At least five training-side speakers required')
  assert(testSpeakers.every(s => !trainSpeakers.includes(s)), 'Official train/test speaker overlap')
  const testById = new Map(testing.map(r => [r.id, r]))
  assert(exposedIds.length && exposedIds.every(id => testById.has(id)), 'Known exposed test IDs required')
  const exposed = new Set(exposedIds.map(id => testById.get(id).speaker))
  const size = Math.floor(trainSpeakers.length / 5)
  const speakers = {
    training: trainSpeakers.slice(size * 2), calibration: trainSpeakers.slice(0, size), validation: trainSpeakers.slice(size, size * 2),
    regression: testSpeakers.filter(s => exposed.has(s)), final: testSpeakers.filter(s => !exposed.has(s)),
  }
  assert(speakers.final.length, 'No unexposed test speakers remain; do not invent a fresh final set')
  return { schemaVersion: 1, protocol: PROTOCOL, seed: PROTOCOL, dataset: spec.id, datasetRevision: spec.revision,
    selection: 'Hash-ranked speakers only; never use ratings or predictions to select partitions.',
    partitions: Object.fromEntries(Object.entries(speakers).map(([name, group]) => [name, {
      officialSplit: ['regression', 'final'].includes(name) ? 'test' : 'train', speakers: group,
      ids: all.filter(r => group.includes(r.speaker)).map(r => r.id).sort(), locked: name === 'final',
    }])),
    limits: ['Final means unexposed to this project evaluation, not proven absent from upstream model training.',
      'Public source label files are available locally; this is a workflow guard, not a secure label vault.',
      'Shared prompts across speakers are allowed; this tests speaker generalization, not unseen-text generalization.'] }
}

export function validatePlan(plan) {
  assert(plan.protocol === PROTOCOL && plan.datasetRevision === spec.revision && plan.dataset === spec.id, 'Wrong protocol/corpus revision')
  const speakers = new Set(), ids = new Set()
  for (const name of [...PARTITIONS, 'final']) {
    const p = plan.partitions[name]
    assert(p && Array.isArray(p.speakers) && p.speakers.length && Array.isArray(p.ids) && p.ids.length, `Empty partition ${name}`)
    assert.equal(p.locked, name === 'final', 'Final partition must remain locked')
    assert.equal(p.officialSplit, ['regression', 'final'].includes(name) ? 'test' : 'train')
    for (const speaker of p.speakers) { assert(!speakers.has(speaker), 'Partition speaker overlap'); speakers.add(speaker) }
    for (const id of p.ids) { assert(!ids.has(id), 'Partition ID overlap'); ids.add(id) }
  }
  return plan
}

/** Legacy preparation/inference also respects a previously frozen final reservation. */
export async function assertNotReserved(rows, root = SPLIT_ROOT) {
  let plan
  try { plan = validatePlan(JSON.parse(await readFile(resolve(root, 'plan.json'), 'utf8'))) }
  catch (error) { if (error.code === 'ENOENT') return; throw error }
  const reserved = plan.partitions.final
  assert(rows.every(r => !reserved.ids.includes(r.id) && !reserved.speakers.includes(r.speaker)),
    'Selection touches reserved final-test speakers. Final release requires a separately approved frozen comparison; do not use them for development.')
}

export async function loadSelection(partition, limit, root = SPLIT_ROOT) {
  assert(PARTITIONS.includes(partition), 'Only training, calibration, validation or regression may run; final is locked')
  const planBytes = await readFile(resolve(root, 'plan.json'))
  const plan = validatePlan(JSON.parse(planBytes))
  const path = resolve(root, `${partition}-${limit}.jsonl`)
  const goldBytes = await readFile(path), gold = await readJsonl(path)
  const manifest = JSON.parse(await readFile(resolve(root, `${partition}-${limit}.manifest.json`), 'utf8'))
  assert.equal(manifest.planSha256, sha256(planBytes), 'Split plan changed')
  assert.equal(manifest.goldSha256, sha256(goldBytes), 'Prepared labels changed')
  assert.equal(manifest.partition, partition, 'Partition mismatch')
  assert.equal(gold.length, limit)
  assert.deepEqual(manifest.ids, gold.map(r => r.id))
  const selected = plan.partitions[partition]
  assert(gold.every(r => r.split === partition && r.officialSplit === selected.officialSplit
    && r.protocol === PROTOCOL && selected.ids.includes(r.id) && selected.speakers.includes(r.speaker)), 'Gold does not belong to this partition')
  await assertNotReserved(gold, root)
  return { gold, manifest, goldPath: path }
}

async function exposures(testIds) {
  const sources = [], ids = new Set()
  const add = async (path, select) => {
    const bytes = await readFile(path), value = JSON.parse(bytes)
    for (const id of select(value).filter(id => testIds.has(id))) ids.add(id)
    sources.push({ path: path.slice(CORPUS.length + 1).replaceAll('\\', '/'), sha256: sha256(bytes) })
  }
  for (const name of (await readdir(CORPUS)).sort()) if (/^test-\d+\.manifest\.json$/.test(name)) await add(resolve(CORPUS, name), m => m.ids)
  let runs = []
  try { runs = await readdir(resolve(CORPUS, 'runs'), { withFileTypes: true }) } catch (error) { if (error.code !== 'ENOENT') throw error }
  for (const run of runs.filter(r => r.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try { await add(resolve(CORPUS, 'runs', run.name, 'run.json'), m => m.dataset.ids) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return { ids: [...ids].sort(), sources }
}

export async function prepareEvaluation({ partition, limit = 100, offline = false } = {}) {
  assert(partition === undefined || PARTITIONS.includes(partition), 'Final is locked; choose training/calibration/validation/regression')
  assert(Number.isInteger(limit) && limit > 0 && limit <= 2500, 'Invalid limit')
  const base = `https://raw.githubusercontent.com/${spec.repository}/${spec.revision}/`
  const files = {}
  for (const [path, hash] of Object.entries({ ...spec.files, ...spec.developmentFiles })) {
    files[path] = (await verifiedDownload(resolve(CORPUS, 'upstream', path), base + path, b => sha256(b) === hash, { offline })).toString('utf8')
  }
  // Freeze on metadata identities before importing or consulting any human ratings.
  const identities = (subset) => [...parseTable(files[`${subset}/utt2spk`])].map(([id, speaker]) => ({ id, speaker }))
  const training = identities('train'), testing = identities('test')
  const exposure = await exposures(new Set(testing.map(r => r.id)))
  const candidate = makeSplitPlan(training, testing, exposure.ids)
  const planPath = resolve(SPLIT_ROOT, 'plan.json')
  await mkdir(SPLIT_ROOT, { recursive: true })
  const bytes = JSON.stringify({ ...candidate, exposureAudit: exposure }, null, 2) + '\n'
  try { await writeFile(planPath, bytes, { flag: 'wx' }) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    const existing = validatePlan(JSON.parse(await readFile(planPath, 'utf8')))
    assert.deepEqual(existing.partitions, candidate.partitions, 'Existing frozen plan differs or its holdout has been exposed; never silently repartition')
  }
  const planBytes = await readFile(planPath), plan = validatePlan(JSON.parse(planBytes))
  console.log(JSON.stringify({ plan: planPath, partitions: Object.fromEntries(Object.entries(plan.partitions).map(([name, p]) => [name, { speakers: p.speakers.length, recordings: p.ids.length, locked: p.locked }])) }, null, 2))
  if (!partition) return plan
  const p = plan.partitions[partition]
  const all = importCorpus(files, spec, p.officialSplit).filter(r => p.ids.includes(r.id))
  const selected = selectPilot(all, limit).map(r => ({ ...r, officialSplit: r.split, split: partition, protocol: PROTOCOL }))
  await assertNotReserved(selected)
  const entries = bytes => {
    const tree = JSON.parse(bytes)
    assert(!tree.truncated && Array.isArray(tree.tree), 'Incomplete Git tree')
    return tree.tree.filter(x => x.type === 'blob').map(({ path, sha, size }) => ({ path, sha, size }))
  }
  const tree = await verifiedDownload(resolve(CORPUS, 'upstream/tree.json'),
    `https://api.github.com/repos/${spec.repository}/git/trees/${spec.revision}?recursive=1`,
    b => { try { return sha256(JSON.stringify(entries(b))) === spec.treeEntriesSha256 } catch { return false } }, { offline })
  const blobs = new Map(entries(tree).map(e => [e.path, e]))
  for (const row of selected) {
    const blob = blobs.get(row.audio)
    assert(blob, 'Missing pinned audio identity')
    const audio = await verifiedDownload(resolve(CORPUS, row.audio), base + row.audio, b => b.length === blob.size && gitBlob(b) === blob.sha, { offline })
    row.audioSha256 = sha256(audio)
  }
  const gold = jsonl(selected), goldPath = resolve(SPLIT_ROOT, `${partition}-${limit}.jsonl`)
  await atomicWrite(goldPath, gold)
  await atomicWrite(resolve(SPLIT_ROOT, `${partition}-${limit}.manifest.json`), JSON.stringify({ schemaVersion: 1,
    resource: spec, protocol: PROTOCOL, partition, planSha256: sha256(planBytes), selection: 'label-blind-speaker-round-robin-pilot-v1',
    goldSha256: sha256(gold), ids: selected.map(r => r.id), recordings: selected.length,
    speakers: new Set(selected.map(r => r.speaker)).size, humanBoundaries: false, use: partition }, null, 2) + '\n')
  console.log(`Prepared ${partition}: ${goldPath}. Final-test audio was not downloaded.`)
  return loadSelection(partition, limit)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = {}
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--offline') options.offline = true
      else {
        assert(['--partition', '--limit'].includes(args[i]) && args[i + 1], 'Usage: npm run benchmark:splits -- [--partition calibration] [--limit 100] [--offline]')
        options[args[i].slice(2)] = args[i] === '--limit' ? Number(args[++i]) : args[++i]
      }
    }
    await prepareEvaluation(options)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
