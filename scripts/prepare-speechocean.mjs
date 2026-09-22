/** Explicit, local-only public benchmark download. Never a first-launch dependency. */
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const spec = JSON.parse(await readFile(new URL('./speechocean.json', import.meta.url), 'utf8'))
export const CORPUS = resolve(ROOT, 'datasets', spec.id, spec.revision)
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
export const gitBlob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
export const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n'
export const readJsonl = async (path) => (await readFile(path, 'utf8')).split(/\r?\n/).filter((s) => s.trim()).map((s) => JSON.parse(s))
const mean = (ns) => ns.reduce((a, b) => a + b, 0) / ns.length

export async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  try { await writeFile(temp, bytes, { flag: 'wx' }); await rename(temp, path) }
  finally { await unlink(temp).catch((err) => { if (err.code !== 'ENOENT') throw err }) }
}

export async function verifiedDownload(path, url, verify, { offline = false, fetcher = fetch } = {}) {
  try {
    const cached = await readFile(path)
    if (verify(cached)) return cached
  } catch (err) { if (err.code !== 'ENOENT') throw err }
  assert(!offline, `Missing or corrupt offline resource: ${path}`)
  assert(url.startsWith('https://'), 'Downloads must use HTTPS')
  const response = await fetcher(url, { signal: AbortSignal.timeout(120_000) })
  assert(response.ok, `Download failed (${response.status}): ${url}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert(verify(bytes), `Checksum mismatch: ${url}`)
  await atomicWrite(path, bytes)
  return bytes
}

export function parseTable(text) {
  const result = new Map()
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^(\S+)\s+(.+)$/.exec(line)
    assert(match && !result.has(match[1]), 'Malformed or duplicate metadata row')
    result.set(match[1], match[2].trim())
  }
  return result
}

function rating(value, max = 10) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max, 'Invalid human rating')
  return value
}
function ratings(values) {
  assert(Array.isArray(values) && values.length === 5, 'Expected five independent expert ratings')
  return values.map((v) => rating(v))
}
const transcriptKey = (text) => text.replace(/[.,!?;:"]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()

/** Keep published aggregates AND individual ratings; never infer timestamps or binary truth. */
export function importCorpus(files, resource = spec) {
  const scores = JSON.parse(files['resource/scores.json'])
  const details = JSON.parse(files['resource/scores-detail.json'])
  const texts = parseTable(files['test/text'])
  const speakers = parseTable(files['test/utt2spk'])
  const ages = parseTable(files['test/spk2age'])
  const waves = parseTable(files['test/wav.scp'])
  const training = parseTable(files['train/utt2spk'])
  const trainSpeakers = new Set(training.values())
  assert.equal(texts.size, speakers.size, 'Mismatched test metadata')
  assert.equal(texts.size, waves.size, 'Mismatched audio metadata')
  return [...texts].map(([id, text]) => {
    const s = scores[id], d = details[id], speaker = speakers.get(id), path = waves.get(id)
    assert(s && d && speaker && !training.has(id) && !trainSpeakers.has(speaker), `Train/test overlap or missing metadata: ${id}`)
    assert.equal(transcriptKey(s.text), transcriptKey(text), `Transcript mismatch: ${id}`)
    assert.equal(transcriptKey(d.text), transcriptKey(text), `Rater transcript mismatch: ${id}`)
    assert(/^WAVE\/SPEAKER\d+\/\d+\.WAV$/.test(path), 'Unsafe/non-file audio path; never execute wav.scp commands')
    const age = Number(ages.get(speaker))
    assert(Number.isInteger(age) && age > 0 && age < 120, `Missing age: ${speaker}`)
    assert.equal(transcriptKey(s.words.map((w) => w.text).join(' ')), transcriptKey(text), `Word sequence mismatch: ${id}`)
    assert.equal(s.words.length, d.words.length, `Rater word count mismatch: ${id}`)
    return {
      schemaVersion: 1, id, source: 'human', split: 'test', dataset: resource.id,
      datasetRevision: resource.revision, speaker, age, text, audio: path,
      sentence: {
        accuracy: rating(s.accuracy), accuracyRaters: ratings(d.accuracy),
        fluency: rating(s.fluency), fluencyRaters: ratings(d.fluency),
        prosody: rating(s.prosodic), prosodyRaters: ratings(d.prosodic),
      },
      words: s.words.map((w, i) => {
        const dw = d.words[i]
        assert.equal(w.text, dw.text, `Rater word mismatch: ${id}/${i}`)
        const phones = Array.isArray(w.phones) ? w.phones : w.phones.split(/\s+/)
        assert(phones.length && phones.every((p) => /^[A-Z]+[012]?$/.test(p)), 'Invalid reference phones')
        assert.equal(phones.join(' '), dw['ref-phones'], 'Reference phones disagree')
        assert.equal(phones.length, w['phones-accuracy'].length, 'Phone label count mismatch')
        assert(Array.isArray(dw.phones) && dw.phones.length === 5 && dw.phones.every((p) => typeof p === 'string'), 'Missing rater phone annotations')
        return {
          text: w.text, accuracy: rating(w.accuracy), accuracyRaters: ratings(dw.accuracy),
          stress: rating(w.stress), stressRaters: ratings(dw.stress),
          phones, phoneAccuracy: w['phones-accuracy'].map((v) => rating(v, 2)),
          phoneAnnotations: dw.phones, start: null, end: null,
        }
      }),
    }
  })
}

/** Fixed, label-blind speaker round-robin; no cherry-picking by model or human score. */
export function selectPilot(rows, limit = 100) {
  assert(Number.isInteger(limit) && limit >= 1 && limit <= rows.length, `Limit must be 1–${rows.length}`)
  const ranked = (value) => sha256(`speechocean-pilot-v1:${value}`)
  const compare = (a, b) => ranked(a).localeCompare(ranked(b), 'en')
  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.speaker)) groups.set(row.speaker, [])
    groups.get(row.speaker).push(row)
  }
  for (const group of groups.values()) group.sort((a, b) => compare(a.id, b.id))
  const speakers = [...groups.keys()].sort(compare)
  const picked = []
  for (let round = 0; picked.length < limit; round++) {
    for (const speaker of speakers) {
      if (groups.get(speaker)[round]) picked.push(groups.get(speaker)[round])
      if (picked.length === limit) break
    }
  }
  return picked
}

export async function prepareSpeechocean({ limit = 100, offline = false, log = console.log } = {}) {
  assert(Number.isInteger(limit) && limit >= 1 && limit <= 2500, 'Limit must be 1–2500')
  const options = { offline }
  const base = `https://raw.githubusercontent.com/${spec.repository}/${spec.revision}/`
  const files = {}
  for (const [path, hash] of Object.entries(spec.files)) {
    files[path] = (await verifiedDownload(resolve(CORPUS, 'upstream', path), base + path, (b) => sha256(b) === hash, options)).toString('utf8')
  }
  const entries = (bytes) => {
    const tree = JSON.parse(bytes)
    assert(!tree.truncated && Array.isArray(tree.tree), 'Incomplete Git tree')
    return tree.tree.filter((x) => x.type === 'blob').map(({ path, sha, size }) => ({ path, sha, size }))
  }
  const tree = await verifiedDownload(resolve(CORPUS, 'upstream', 'tree.json'),
    `https://api.github.com/repos/${spec.repository}/git/trees/${spec.revision}?recursive=1`,
    (b) => { try { return sha256(JSON.stringify(entries(b))) === spec.treeEntriesSha256 } catch { return false } }, options)
  const blobs = new Map(entries(tree).map((entry) => [entry.path, entry]))
  const all = importCorpus(files)
  assert.equal(all.length, 2500, 'The pinned official test set must contain 2500 recordings')
  const selected = selectPilot(all, limit)
  log(`Selected ${limit} official test recordings from ${new Set(selected.map((r) => r.speaker)).size} speakers (label-blind pilot-v1).`)
  for (let i = 0; i < selected.length; i++) {
    const row = selected[i], blob = blobs.get(row.audio)
    assert(blob && /^[0-9a-f]{40}$/.test(blob.sha), `Audio not in pinned tree: ${row.audio}`)
    const bytes = await verifiedDownload(resolve(CORPUS, row.audio), base + row.audio,
      (b) => b.length === blob.size && gitBlob(b) === blob.sha, options)
    row.audioSha256 = sha256(bytes)
    if ((i + 1) % 25 === 0 || i + 1 === selected.length) log(`Verified audio ${i + 1}/${selected.length}`)
  }
  const gold = jsonl(selected)
  const goldPath = resolve(CORPUS, `test-${limit}.jsonl`)
  await atomicWrite(resolve(CORPUS, 'ATTRIBUTION.txt'), `${spec.attribution}\nhttps://github.com/${spec.repository}/tree/${spec.revision}\nLicense: ${spec.license} — ${spec.licenseUrl}\nPublisher declaration: ${spec.licenseDeclaration}\nChanges: selected audio unchanged; ratings converted to project JSONL; unavailable timestamps left null.\nOriginal README preserved under upstream/README.md. No endorsement implied.\n`)
  await atomicWrite(goldPath, gold)
  await atomicWrite(resolve(CORPUS, `test-${limit}.manifest.json`), JSON.stringify({
    schemaVersion: 1, resource: spec, selection: 'label-blind-speaker-round-robin-pilot-v1',
    goldSha256: sha256(gold), ids: selected.map((r) => r.id),
    recordings: selected.length, speakers: new Set(selected.map((r) => r.speaker)).size,
    childrenUnder18: selected.filter((r) => r.age < 18).length, meanAge: mean(selected.map((r) => r.age)),
    humanBoundaries: false, use: 'held-out public assessment benchmark; never practice/training content',
  }, null, 2) + '\n')
  log(`Ready: ${goldPath}`)
  return goldPath
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2)
    assert(args.every((arg, i) => arg === '--offline' || arg === '--limit' || (args[i - 1] === '--limit' && /^\d+$/.test(arg))), 'Usage: npm run benchmark:prepare -- [--limit 100] [--offline]')
    const index = args.indexOf('--limit')
    await prepareSpeechocean({ limit: index < 0 ? 100 : Number(args[index + 1]), offline: args.includes('--offline') })
  } catch (err) { console.error(err.message); process.exitCode = 1 }
}
