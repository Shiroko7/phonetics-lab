/** Installer tests use only authored synthetic resources, never accept real dataset terms. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareAssets, digest, resourceManifest } from './prepare-assets.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url))
const root = await mkdtemp(join(tmpdir(), 'phonetics-assets-test-'))
const manifest = structuredClone(resourceManifest)
const bodies = new Map()
const sourceTexts = ['test T EH1 S T\nship SH IH1 P\n', 'ship\ntest\nwww\nship\n']
for (const [i, resource] of manifest.resources.entries()) {
  resource.revision = 'synthetic-fixture'
  resource.license = 'Synthetic test terms, not an actual third-party license'
  for (const [key, content] of [['data', sourceTexts[i]], ['notice', `Authored test notice ${i}`]]) {
    const url = `https://example.test/${resource.id}/${key}`
    bodies.set(url, content)
    resource[key] = { url, sha256: digest(content) }
  }
}
let requests = []
const fetcher = async (url) => {
  requests.push(url)
  assert(bodies.has(url), 'test must never call a real provider')
  return new Response(bodies.get(url))
}
const opts = { root, manifest, fetcher, log: () => {} }
const output = join(root, 'public', 'dict')
const cache = join(root, '.cache', 'resources')
try {
  // Refusal does not download data or overwrite an existing installation.
  await mkdir(output, { recursive: true })
  await writeFile(join(output, 'common-words.txt'), 'pre-installer local copy')
  await assert.rejects(prepareAssets(opts), /accept-personal-use/)
  await assert.rejects(prepareAssets({ ...opts, confirm: async () => false }), /not cleared for commercial/)
  assert.equal(requests.length, 0)
  assert.equal(await readFile(join(output, 'common-words.txt'), 'utf8'), 'pre-installer local copy')

  // First install verifies both data and notices, and preserves legacy local data.
  assert.equal((await prepareAssets({ ...opts, acceptPersonalUse: true })).cached, false)
  assert.equal(requests.length, 4)
  const original = await readFile(join(output, 'cmudict-ipa.txt'), 'utf8')
  assert(original.includes('test\t'))
  assert.equal(await readFile(join(output, 'common-words.txt'), 'utf8'), 'ship\ntest\n')
  assert.equal(await readFile(join(cache, 'legacy', 'common-words.txt'), 'utf8'), 'pre-installer local copy')
  const state = JSON.parse(await readFile(join(output, 'resources.json'), 'utf8'))
  assert(state.purpose.includes('not commercially cleared'))
  assert.equal(state.resources[0].revision, 'synthetic-fixture')
  assert.equal(state.files['cmudict-ipa.txt'], digest(original))
  assert.equal(await readFile(join(output, 'CMUDICT-LICENSE.txt'), 'utf8'), 'Authored test notice 0')

  // Subsequent startup and regeneration can be fully offline.
  requests = []
  assert.equal((await prepareAssets({ ...opts, offline: true })).cached, true)
  assert.equal(requests.length, 0)
  await unlink(join(output, 'common-words.txt'))
  assert.equal((await prepareAssets({ ...opts, offline: true })).cached, false)
  assert.equal(requests.length, 0)

  // Damaged outputs are rebuilt; damaged source cache cannot masquerade as valid.
  await writeFile(join(output, 'cmudict-ipa.txt'), 'corrupted generated file')
  await prepareAssets({ ...opts, offline: true })
  assert.equal(await readFile(join(output, 'cmudict-ipa.txt'), 'utf8'), original)
  const rawPath = join(cache, `${manifest.resources[0].data.sha256}.txt`)
  await writeFile(rawPath, 'damaged download')
  await assert.rejects(prepareAssets({ ...opts, offline: true, force: true }), /Offline: missing or damaged/)
  assert.equal(await readFile(join(output, 'cmudict-ipa.txt'), 'utf8'), original)

  // Untrusted response bytes never replace a working derived dictionary.
  await assert.rejects(prepareAssets({ ...opts, force: true, fetcher: async () => new Response('wrong content') }), /Checksum mismatch/)
  assert.equal(await readFile(join(output, 'cmudict-ipa.txt'), 'utf8'), original)
  await assert.rejects(prepareAssets({ ...opts, force: true, fetcher: async () => new Response('', { status: 503 }) }), /503/)
  await prepareAssets({ ...opts, force: true })

  // A changed license/revision needs a fresh acknowledgment, even with old outputs.
  const changed = structuredClone(manifest)
  changed.resources[1].revision = 'updated-synthetic-license'
  requests = []
  await assert.rejects(prepareAssets({ ...opts, manifest: changed }), /accept-personal-use/)
  assert.equal(requests.length, 0)
  // Completely permissive configurations have no consent requirement.
  const unrestricted = structuredClone(manifest)
  unrestricted.resources[1].personalUseOptIn = false
  await prepareAssets({ ...opts, root: join(root, 'permissive'), manifest: unrestricted })
  await assert.rejects(readFile(join(root, 'permissive', '.cache', 'resources', 'personal-use.json')), /ENOENT/)

  // Resource caches/recordings must not enter the repository through git add .
  const protectedPaths = ['public/dict/cmudict-ipa.txt', 'public/dict/common-words.txt', '.cache/resources/x.txt',
    'datasets/example.jsonl', 'models/model.bin', 'recordings/example.json', 'audio.wav', 'weights.onnx']
  for (const path of protectedPaths) {
    assert.equal(execFileSync('git', ['check-ignore', '--no-index', path], { cwd: repo, encoding: 'utf8' }).trim(), path)
  }
  const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).trim().split(/\r?\n/)
  assert(!tracked.some((path) => /^(public\/dict|\.cache|datasets|models|recordings)\//.test(path)
    || /\.(onnx|safetensors|pt|pth|wav|flac|mp3|webm)$/.test(path)), 'Downloaded resources must be untracked, not just ignored')
  for (const resource of resourceManifest.resources) {
    assert.match(resource.revision, /^[a-f0-9]{40}$/)
    for (const file of [resource.data, resource.notice]) {
      assert(file.url.includes(resource.revision))
      assert.match(file.sha256, /^[a-f0-9]{64}$/)
    }
  }
  const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'))
  assert.equal(pkg.license, 'Apache-2.0')
  for (const hook of ['predev', 'predev:web', 'prebuild', 'precheck']) assert(pkg.scripts[hook].includes('prepare-assets.mjs'))
  assert((await readFile(join(repo, 'LICENSE'), 'utf8')).includes('END OF TERMS AND CONDITIONS'))
  console.log('Resource installer checks passed (synthetic resources; no real terms accepted).')
} finally {
  // Only remove the exact temporary directory created by this test.
  assert.equal(dirname(resolve(root)), resolve(tmpdir()))
  assert(basename(root).startsWith('phonetics-assets-test-'))
  await rm(root, { recursive: true, force: true })
}
