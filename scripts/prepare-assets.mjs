/** First-run, versioned resource installation. Does not download evaluation corpora. */
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, readFile, writeFile, rename, unlink, copyFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { buildDictionary } from './build-dict.mjs'
import { buildCommonWords } from './build-common.mjs'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
export const digest = (value) => createHash('sha256').update(value).digest('hex')
export const resourceManifest = JSON.parse(await readFile(new URL('./resources.json', import.meta.url), 'utf8'))
const transformerHash = digest(Buffer.concat(await Promise.all([
  './build-dict.mjs', './build-common.mjs', '../src/lib/phonology.ts',
].map((name) => readFile(new URL(name, import.meta.url))))))

async function readOptional(path) {
  try { return await readFile(path) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function jsonOptional(path) {
  const raw = await readOptional(path)
  if (!raw) return null
  try { return JSON.parse(raw.toString('utf8')) } catch { return null }
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, value, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error })
  }
}

async function cachedDownload(file, cache, { fetcher, offline, log }) {
  const url = new URL(file.url)
  if (url.protocol !== 'https:' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid resource URL or checksum')
  const path = join(cache, `${file.sha256}.txt`)
  const cached = await readOptional(path)
  if (cached && digest(cached) === file.sha256) return cached.toString('utf8')
  if (offline) throw new Error(`Offline: missing or damaged resource ${file.url}. Run npm run assets with a connection.`)
  log(`Downloading ${file.url}`)
  const response = await fetcher(file.url, { signal: AbortSignal.timeout(60_000) })
  if (!response.ok) throw new Error(`Resource download failed (${response.status}): ${file.url}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (digest(data) !== file.sha256) throw new Error(`Checksum mismatch: ${file.url}. Existing resources were not replaced.`)
  await atomicWrite(path, data)
  return data.toString('utf8')
}

export async function prepareAssets({
  root = ROOT, manifest = resourceManifest, acceptPersonalUse = false, confirm,
  force = false, offline = false, fetcher = fetch, log = console.log,
} = {}) {
  const resources = manifest.resources
  if (manifest.schemaVersion !== 1 || !Array.isArray(resources) || resources.length !== 2
    || resources[0].id !== 'cmudict' || resources[1].id !== 'common-words') throw new Error('Unsupported resource manifest')
  const cache = join(root, '.cache', 'resources')
  const output = join(root, 'public', 'dict')
  const fingerprint = digest(JSON.stringify({ manifest, transformerHash }))
  const consentPath = join(cache, 'personal-use.json')
  const consent = await jsonOptional(consentPath)
  // Changing a source revision or license requires a new acknowledgment.
  const required = resources.filter((r) => r.personalUseOptIn)
  const consentKey = digest(JSON.stringify(required))
  if (required.length && consent?.key !== consentKey) {
    const warning = required.map((r) => `${r.name}: ${r.license}\nReview: ${r.notice.url}`).join('\n')
    if (!acceptPersonalUse && !(await confirm?.(warning))) {
      throw new Error(`${warning}\nThis list is not cleared for commercial use. After reviewing the terms for your personal/research use, run:\n  npm run assets -- --accept-personal-use\nNo new restricted resource was downloaded. Commercial deployments need a separately cleared replacement.`)
    }
    await atomicWrite(consentPath, JSON.stringify({ key: consentKey, purpose: 'personal/research', acknowledgedAt: new Date().toISOString() }, null, 2))
  }
  const files = ['cmudict-ipa.txt', 'common-words.txt', 'CMUDICT-LICENSE.txt', 'COMMON-WORDS-LICENSE.md']
  const installed = await jsonOptional(join(output, 'resources.json'))
  if (!force && installed?.fingerprint === fingerprint) {
    const matches = await Promise.all(files.map(async (name) => {
      const data = await readOptional(join(output, name))
      return !!data && digest(data) === installed.files?.[name]
    }))
    if (matches.every(Boolean)) {
      log('Local dictionaries and license notices are ready (no network needed).')
      return { cached: true, output }
    }
  }
  const downloads = await Promise.allSettled(resources.map(async (resource) => ({
    data: await cachedDownload(resource.data, cache, { fetcher, offline, log }),
    notice: await cachedDownload(resource.notice, cache, { fetcher, offline, log }),
  })))
  const failed = downloads.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
  const [dictionary, common] = downloads.map((result) => result.value)
  const dictionaryText = buildDictionary(dictionary.data)
  const content = [dictionaryText, buildCommonWords(common.data, dictionaryText), dictionary.notice, common.notice]
  // Save an existing pre-installer copy once; do not discard local resources.
  if (!installed) {
    await mkdir(join(cache, 'legacy'), { recursive: true })
    for (const name of files.slice(0, 2)) {
      if (await readOptional(join(output, name))) {
        await copyFile(join(output, name), join(cache, 'legacy', name), constants.COPYFILE_EXCL)
          .catch((error) => { if (error.code !== 'EEXIST') throw error })
      }
    }
  }
  for (let i = 0; i < files.length; i++) await atomicWrite(join(output, files[i]), content[i])
  await atomicWrite(join(output, 'resources.json'), JSON.stringify({
    schemaVersion: 1, fingerprint, installedAt: new Date().toISOString(),
    purpose: required.length ? 'personal/research; not commercially cleared' : 'see individual licenses',
    resources, files: Object.fromEntries(files.map((name, i) => [name, digest(content[i])])),
  }, null, 2))
  log(`Prepared local dictionaries and upstream notices in ${output}. These files must stay out of Git.`)
  return { cached: false, output }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const flags = new Set(process.argv.slice(2))
  const allowed = new Set(['--accept-personal-use', '--force', '--offline', '--help'])
  if ([...flags].some((flag) => !allowed.has(flag))) {
    console.error('Unknown option. Use --help.')
    process.exitCode = 1
  } else if (flags.has('--help')) {
    console.log('npm run assets -- [--accept-personal-use] [--offline] [--force]\nThe legacy frequency list needs an explicit personal/research-use acknowledgment. See THIRD_PARTY.md.')
  } else {
    const confirm = process.stdin.isTTY && process.stdout.isTTY ? async (warning) => {
      const reader = createInterface({ input: process.stdin, output: process.stdout })
      try {
        console.log(warning)
        return /^y(es)?$/i.test((await reader.question('Have you reviewed these terms and confirmed your personal/research use is permitted? [y/N] ')).trim())
      } finally { reader.close() }
    } : undefined
    try {
      await prepareAssets({ acceptPersonalUse: flags.has('--accept-personal-use'), force: flags.has('--force'), offline: flags.has('--offline'), confirm })
    } catch (error) {
      console.error(`Resource setup: ${error.message}`)
      process.exitCode = 1
    }
  }
}
