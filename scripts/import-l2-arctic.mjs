/** Local-only L2-ARCTIC manual-boundary importer. Never downloads, registers or accepts terms for a user. */
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, sha256, jsonl } from './prepare-speechocean.mjs'
import { evaluateBoundaries } from './evaluate-boundaries.mjs'

const number = '(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)'
const quoted = '"((?:[^"]|"")*)"'
const unquote = s => s.replaceAll('""', '"')
/** Long-text Praat format only. Unsupported formats fail explicitly, never become partial gold. */
export function parseTextGrid(text) {
  let rest = text.replace(/^\uFEFF/, '').trim()
  const take = (pattern) => {
    const match = new RegExp(`^\\s*${pattern}`, 'u').exec(rest)
    assert(match, `Unsupported or malformed TextGrid near: ${rest.slice(0, 60)}`)
    rest = rest.slice(match[0].length); return match
  }
  take('File type\\s*=\\s*"ooTextFile"')
  take('Object class\\s*=\\s*"TextGrid"')
  const xmin = Number(take(`xmin\\s*=\\s*${number}`)[1]), xmax = Number(take(`xmax\\s*=\\s*${number}`)[1])
  assert(Number.isFinite(xmin) && Number.isFinite(xmax) && xmin === 0 && xmax > xmin, 'Invalid recording timeline')
  take('tiers\\?\\s*<exists>')
  const count = Number(take('size\\s*=\\s*(\\d+)')[1])
  assert(count > 0 && count <= 100, 'Invalid tier count')
  take('item\\s*\\[\\]\\s*:')
  const tiers = []
  for (let ti = 1; ti <= count; ti++) {
    assert.equal(Number(take('item\\s*\\[(\\d+)\\]\\s*:')[1]), ti, 'Nonsequential tiers')
    assert.equal(unquote(take(`class\\s*=\\s*${quoted}`)[1]), 'IntervalTier', 'Only interval tiers are supported')
    const name = unquote(take(`name\\s*=\\s*${quoted}`)[1])
    assert(!tiers.some(t => t.name === name), 'Duplicate tier name')
    const start = Number(take(`xmin\\s*=\\s*${number}`)[1]), end = Number(take(`xmax\\s*=\\s*${number}`)[1])
    assert(start >= xmin && end <= xmax && end > start, 'Invalid tier timeline')
    const n = Number(take('intervals:\\s*size\\s*=\\s*(\\d+)')[1]), intervals = []
    assert(n > 0 && n <= 100_000, 'Invalid interval count')
    for (let i = 1; i <= n; i++) {
      assert.equal(Number(take('intervals\\s*\\[(\\d+)\\]\\s*:')[1]), i, 'Nonsequential intervals')
      const from = Number(take(`xmin\\s*=\\s*${number}`)[1]), to = Number(take(`xmax\\s*=\\s*${number}`)[1])
      const label = unquote(take(`text\\s*=\\s*${quoted}`)[1])
      assert(Number.isFinite(from) && Number.isFinite(to) && from >= start && to <= end && to > from, 'Invalid interval')
      assert(!intervals.length || from >= intervals.at(-1).end - 1e-9, 'Overlapping intervals')
      intervals.push({ start: from, end: to, text: label })
    }
    tiers.push({ name, start, end, intervals })
  }
  assert(!rest.trim(), 'Unparsed TextGrid content')
  return { xmin, xmax, tiers }
}
const key = text => text.toLowerCase().replace(/[.,!?;:"“”]/g, ' ').replace(/\s+/g, ' ').trim()
const SILENCE = new Set(['', 'sil', 'sp', '<sil>'])
export function boundaryRow({ grid, transcript, speaker, stem, annotationPath, revision, split = 'validation', source = 'human' }) {
  assert(['validation', 'regression'].includes(split), 'Imported boundary data is development evidence, never an untouched final set')
  assert(['human', 'synthetic'].includes(source), 'Invalid annotation source')
  assert(/^[A-Z]{2,8}$/.test(speaker) && /^(?:[A-Za-z]+_)?arctic_[ab]\d{4}$/.test(stem), 'Unsupported speaker/recording ID')
  assert(new RegExp(`^${speaker}/annotation/[^/]+\\.TextGrid$`, 'i').test(annotationPath), 'Only the manual annotation directory is eligible; never textgrid/')
  const wordsTier = grid.tiers.find(t => t.name === 'words'), phonesTier = grid.tiers.find(t => t.name === 'phones')
  assert(wordsTier && phonesTier, 'Manual words and phones tiers required')
  const words = wordsTier.intervals.filter(w => !SILENCE.has(w.text.trim().toLowerCase()))
  assert(words.length && words.every(w => /^[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*$/.test(w.text)), 'Unsupported word labels; review the source, do not guess identities')
  assert.equal(key(words.map(w => w.text).join(' ')), key(transcript), 'Transcript/annotated-word identity mismatch')
  assert(typeof revision === 'string' && revision.trim(), 'Record a user-supplied corpus release identifier')
  return { schemaVersion: 2, id: `${speaker}/${stem}`, speaker, source, split, dataset: 'l2-arctic', datasetRevision: revision,
    text: words.map(w => w.text).join(' '), duration: grid.xmax,
    annotation: { kind: 'provider-manually-corrected', path: annotationPath, documentation: 'https://psi.engr.tamu.edu/l2-arctic-corpus-docs/',
      limits: 'Provider corrected point boundaries; no independent-rater uncertainty ranges supplied. No word correctness inferred.' },
    words: words.map(w => ({ ...w, correct: null, boundaryStatus: 'human-corrected' })),
    phoneAnnotations: phonesTier.intervals,
    otherTiers: grid.tiers.filter(t => !['words', 'phones'].includes(t.name)),
  }
}
function inside(root, path) {
  const rel = relative(root, path)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
async function containedFile(root, path) {
  const actual = await realpath(path)
  assert(inside(root, actual), 'Source file escapes corpus root (including symlinks)')
  return readFile(actual)
}
function decodeGrid(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}
/** Validate original linear WAV timeline without decoding/re-encoding the signal. */
export function wavInfo(bytes) {
  assert(bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE', 'Expected linear WAV')
  assert(bytes.readUInt32LE(4) + 8 === bytes.length, 'Truncated or trailing WAV bytes')
  let format, dataBytes = 0
  for (let pos = 12; pos < bytes.length;) {
    assert(pos + 8 <= bytes.length, 'Truncated WAV chunk')
    const id = bytes.toString('ascii', pos, pos + 4), size = bytes.readUInt32LE(pos + 4), start = pos + 8
    assert(start + size <= bytes.length, 'WAV chunk exceeds file')
    if (id === 'fmt ') {
      assert(!format && size >= 16, 'Invalid WAV format chunk')
      let kind = bytes.readUInt16LE(start)
      if (kind === 65534) {
        assert(size >= 40 && bytes.readUInt16LE(start + 16) >= 22, 'Incomplete extensible WAV')
        assert(bytes.subarray(start + 28, start + 40).equals(Buffer.from('00001000800000aa00389b71', 'hex')), 'Unsupported WAV subtype GUID')
        kind = bytes.readUInt32LE(start + 24)
      }
      assert([1, 3].includes(kind), 'Only PCM or IEEE-float WAV is supported')
      format = { channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4),
        byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) }
      assert(format.channels > 0 && format.sampleRate > 0 && [8, 16, 24, 32, 64].includes(format.bits)
        && (kind !== 3 || [32, 64].includes(format.bits))
        && format.blockAlign === format.channels * format.bits / 8 && format.byteRate === format.sampleRate * format.blockAlign, 'Inconsistent WAV format')
    }
    if (id === 'data') dataBytes += size
    pos = start + size + size % 2
    assert(pos <= bytes.length, 'Missing WAV chunk padding')
  }
  assert(format && dataBytes > 0 && dataBytes % format.blockAlign === 0, 'Missing or incomplete WAV samples')
  return { sampleRate: format.sampleRate, channels: format.channels, duration: dataBytes / format.byteRate }
}
export async function importLocalBoundaries({ root, output, revision, acknowledgeTerms = false, limit = 100, split = 'validation' }) {
  assert(acknowledgeTerms, 'Obtain the corpus from its provider and review its CC BY-NC terms yourself; pass --acknowledge-terms only after doing so')
  assert(root && output && revision, 'Corpus root, output directory and release identifier are required')
  assert(Number.isInteger(limit) && limit > 0, 'Limit must be positive')
  assert(['validation', 'regression'].includes(split), 'Only development validation/regression imports are supported')
  const sourceRoot = await realpath(root), outputRoot = resolve(output), datasets = resolve(ROOT, 'datasets')
  assert(inside(datasets, outputRoot) && !inside(sourceRoot, outputRoot) && outputRoot !== sourceRoot,
    'Output must be a new directory under this project datasets/, outside the source corpus')
  await mkdir(datasets, { recursive: true })
  const parent = await realpath(resolve(outputRoot, '..'))
  assert(parent === await realpath(datasets) || inside(await realpath(datasets), parent), 'Output parent escapes datasets/')
  const actualOutput = resolve(parent, basename(outputRoot))
  assert(actualOutput !== sourceRoot && !inside(sourceRoot, actualOutput), 'Output resolves inside source corpus')
  const license = await containedFile(sourceRoot, resolve(sourceRoot, 'LICENSE'))
  assert(/Attribution-NonCommercial 4\.0|CC BY-NC 4\.0|creativecommons\.org\/licenses\/by-nc\/4\.0/i.test(license.toString('utf8')), 'Expected upstream CC BY-NC 4.0 license; inspect a different release before importing')
  const candidates = [], absent = []
  for (const entry of (await readdir(sourceRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || !/^[A-Z]{2,8}$/.test(entry.name)) continue
    let files
    try { files = await readdir(resolve(sourceRoot, entry.name, 'annotation')) }
    catch (error) { if (error.code !== 'ENOENT') throw error; absent.push(entry.name); continue }
    for (const name of files.filter(n => /\.TextGrid$/i.test(n))) candidates.push({ speaker: entry.name, name })
  }
  assert(candidates.length, 'No manual annotation/ TextGrids found. Automatic textgrid/ labels are not human gold.')
  // Round-robin speakers, then hash-ranked utterances. No ranking by scores or annotation contents.
  const groups = new Map()
  for (const row of candidates) { if (!groups.has(row.speaker)) groups.set(row.speaker, []); groups.get(row.speaker).push(row) }
  const rank = s => sha256(`l2-boundary-pilot-v1:${s}`), compare = (a, b) => rank(a).localeCompare(rank(b), 'en')
  for (const group of groups.values()) group.sort((a, b) => compare(a.name, b.name))
  const selected = [], speakers = [...groups.keys()].sort(compare)
  for (let round = 0; selected.length < Math.min(limit, candidates.length); round++) {
    for (const speaker of speakers) {
      if (groups.get(speaker)[round]) selected.push(groups.get(speaker)[round])
      if (selected.length === Math.min(limit, candidates.length)) break
    }
  }
  const rows = [], excluded = []
  for (const candidate of selected) {
    const { speaker, name } = candidate, stem = basename(name).replace(/\.TextGrid$/i, '')
    const annotationPath = `${speaker}/annotation/${name}`
    let annotation
    try {
      annotation = await containedFile(sourceRoot, resolve(sourceRoot, annotationPath))
      // Official directory layout uses matching basenames. Do not guess a neighboring recording.
      const audioPath = `${speaker}/wav/${stem}.wav`, transcriptPath = `${speaker}/transcript/${stem}.txt`
      const transcript = await containedFile(sourceRoot, resolve(sourceRoot, transcriptPath))
      const audio = await containedFile(sourceRoot, resolve(sourceRoot, audioPath))
      const audioInfo = wavInfo(audio)
      const row = boundaryRow({ grid: parseTextGrid(decodeGrid(annotation)), transcript: transcript.toString('utf8'), speaker, stem, annotationPath, revision, split })
      assert(Math.abs(audioInfo.duration - row.duration) <= 0.05, 'Annotation/WAV durations disagree by over 50 ms; no trim offset is inferred')
      rows.push({ ...row, audioInfo, audio: audioPath, audioSha256: sha256(audio), annotationSha256: sha256(annotation), transcriptSha256: sha256(transcript) })
    } catch (error) { excluded.push({ annotationPath, annotationSha256: annotation ? sha256(annotation) : null, reason: error.message }) }
  }
  assert(rows.length, `No usable manual records. Exclusions: ${JSON.stringify(excluded.slice(0, 5))}`)
  evaluateBoundaries(rows, [], { split })
  // A fresh directory prevents clobbering a previous import or the original data.
  await mkdir(outputRoot)
  const bytes = jsonl(rows)
  await writeFile(resolve(outputRoot, 'gold.jsonl'), bytes, { flag: 'wx' })
  await writeFile(resolve(outputRoot, 'LICENSE.upstream'), license, { flag: 'wx' })
  const manifest = { schemaVersion: 1, dataset: 'l2-arctic', datasetRevision: revision, annotationSource: 'human', split,
    importer: 'manual-textgrid-long-v1', importerSha256: sha256(await readFile(new URL(import.meta.url))),
    license: 'CC-BY-NC-4.0', licenseSha256: sha256(license), termsAcknowledgedLocally: true,
    sourceUrl: 'https://psi.engr.tamu.edu/l2-arctic-corpus/',
    selection: 'l2-boundary-pilot-v1; speaker round-robin; no replacement for failed imports',
    requestedLimit: limit, availableManualFiles: candidates.length,
    selected: selected.length, imported: rows.length, excluded, speakersWithoutManualDirectory: absent,
    speakers: [...new Set(rows.map(r => r.speaker))].sort(), goldSha256: sha256(bytes),
    sourceFiles: rows.map(r => ({ id: r.id, audio: r.audio, audioSha256: r.audioSha256, annotation: r.annotation.path, annotationSha256: r.annotationSha256, transcriptSha256: r.transcriptSha256 })),
    limits: ['Manual corrected subset only, not the full corpus.', 'This import is development data, not a speaker-disjoint final test.',
      'Per-recording phone annotations are preserved, not converted into binary word correctness.', 'Do not distribute these outputs or audio as Apache-licensed content.'] }
  await writeFile(resolve(outputRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  await writeFile(resolve(outputRoot, 'ATTRIBUTION.txt'), 'L2-ARCTIC corpus, Zhao et al., Interspeech 2018. CC BY-NC 4.0. https://psi.engr.tamu.edu/l2-arctic-corpus/\nChanges: selected manual TextGrid boundaries converted to JSONL; source audio/labels remain unchanged. No endorsement implied.\n', { flag: 'wx' })
  console.log(JSON.stringify({ output: outputRoot, selected: selected.length, imported: rows.length, excluded: excluded.length, speakers: manifest.speakers.length }, null, 2))
  return { rows, manifest }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), options = {}
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--acknowledge-terms') options.acknowledgeTerms = true
      else {
        assert(['--root', '--output', '--revision', '--limit', '--split'].includes(args[i]) && args[i + 1],
          'Usage: npm run benchmark:boundaries:import -- --root CORPUS --output datasets/NEW_IMPORT --revision v5.0 --acknowledge-terms [--limit 100] [--split validation]')
        options[args[i].slice(2)] = args[i] === '--limit' ? Number(args[++i]) : args[++i]
      }
    }
    await importLocalBoundaries(options)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
