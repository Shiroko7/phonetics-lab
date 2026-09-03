/**
 * Builds the offline pronunciation dictionary shipped with the app.
 *
 * Downloads CMUdict (CMU's hand-curated 134k-word pronouncing dictionary),
 * converts each ARPAbet pronunciation to syllabified General American IPA and
 * writes one compact TSV that the browser fetches once and keeps in a Map.
 *
 * Output line: word <TAB> ipa [ "|" ipa ... ]      (variants in CMUdict order)
 *
 * Transcriptions are stored canonically — no flapping, no cot-caught merger —
 * because those are display options the UI applies on the fly.
 */

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transcribe } from '../src/lib/phonology.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_URL = 'https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict'
const CACHE = join(ROOT, 'scripts', '.cache', 'cmudict.dict')
const OUT = join(ROOT, 'public', 'dict', 'cmudict-ipa.txt')

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function source() {
  if (await exists(CACHE)) {
    console.log('using cached CMUdict')
    return readFile(CACHE, 'utf8')
  }
  console.log('downloading CMUdict...')
  const res = await fetch(SOURCE_URL)
  if (!res.ok) throw new Error(`CMUdict download failed: ${res.status} ${res.statusText}`)
  const text = await res.text()
  await mkdir(dirname(CACHE), { recursive: true })
  await writeFile(CACHE, text)
  return text
}

const raw = await source()

/** word -> ordered list of IPA transcriptions */
const entries = new Map()
let skipped = 0

for (const line of raw.split('\n')) {
  const clean = line.split('#')[0].trim()
  if (!clean) continue

  const space = clean.indexOf(' ')
  if (space === -1) continue

  // "read(2)" marks an alternate pronunciation of an existing headword.
  const headword = clean.slice(0, space).replace(/\(\d+\)$/, '')
  const ipa = transcribe(clean.slice(space + 1))
  if (!ipa) {
    skipped++
    continue
  }

  const list = entries.get(headword)
  if (list) {
    if (!list.includes(ipa)) list.push(ipa)
  } else {
    entries.set(headword, [ipa])
  }
}

const out = []
for (const [word, list] of entries) out.push(`${word}\t${list.join('|')}`)
out.sort()

await mkdir(dirname(OUT), { recursive: true })
const text = out.join('\n')
await writeFile(OUT, text)

const variants = [...entries.values()].filter((l) => l.length > 1).length
console.log(`wrote ${OUT}`)
console.log(
  `  ${entries.size.toLocaleString()} headwords, ` +
    `${variants.toLocaleString()} with variants, ` +
    `${skipped} skipped, ` +
    `${(Buffer.byteLength(text) / 1024 / 1024).toFixed(2)} MB`,
)
