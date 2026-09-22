/** Strict, partial phone-slot evaluation of archived local scoring responses. No fitted calibration. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { arpaToPhones } from '../src/lib/phonology.ts'
import { byWord, flatten } from '../src/lib/report.ts'
import { decodeAnalysisResponse } from '../src/lib/backend.ts'
import { soundScore, wordPracticeStatus } from '../src/lib/practicePolicy.ts'
import { validateResponse } from './benchmark-assessment.mjs'
import { pearson, ranks } from './evaluate-assessment.mjs'
import { readJsonl, sha256 } from './prepare-speechocean.mjs'

/** Strict grammar: never silently discard unexpected markup or align by edit distance. */
export function parsePhoneAnnotation(text, canonical) {
  if (typeof text !== 'string') return null
  const labels = [], phones = []
  let insertions = 0, rest = text.trim()
  while (rest) {
    const match = /^(?:\{([A-Z]+[0-2]?)\}|\(([A-Z]+[0-2]?)\)|\[([A-Z]+[0-2]?)\]|([A-Z]+[0-2]?))(?=\s|$)/.exec(rest)
    if (!match) return null
    const token = match[1] ?? match[2] ?? match[3] ?? match[4]
    if (arpaToPhones(token).length !== 1) return null
    if (match[3]) insertions++
    else { phones.push(token); labels.push(match[1] ? 1 : match[2] ? 0 : 2) }
    rest = rest.slice(match[0].length).trimStart()
  }
  return JSON.stringify(phones) === JSON.stringify(canonical) ? { labels, insertions } : null
}
const ratio = (n, d) => d ? n / d : null
function summarize(pairs, threshold) {
  const counts = { truePositive: 0, falsePositive: 0, falseNegative: 0, trueNegative: 0 }
  for (const p of pairs) counts[p.score < threshold ? p.concern ? 'truePositive' : 'falsePositive' : p.concern ? 'falseNegative' : 'trueNegative']++
  const { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn } = counts
  return { scored: pairs.length, humanConcerns: tp + fn, modelFlags: tp + fp, ...counts,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), falsePositiveRate: ratio(fp, fp + tn),
    pearson: pearson(pairs.map(p => p.score), pairs.map(p => p.human)),
    spearman: pearson(ranks(pairs.map(p => p.score)), ranks(pairs.map(p => p.human))),
    unanimousHumanSlots: pairs.filter(p => p.unanimous).length }
}
function summarizeRubrics(pairs, threshold) {
  const subset = (category) => pairs.filter(p => p.category === category)
  return {
    majorityIncorrectOrMissed: summarize(pairs, threshold),
    // Alternate target explicitly includes heavy-accent annotations; never call these all wrong sounds.
    majorityAccentOrError: summarize(pairs.map(p => ({ ...p, concern: p.nonPerfectMajority })), threshold),
    humanCategories: Object.fromEntries(['incorrectOrMissed', 'heavyAccent', 'correct', 'noCategoryMajority'].map(category => {
      const items = subset(category), flagged = items.filter(p => p.score < threshold).length
      return [category, { slots: items.length, flagged, flagRate: ratio(flagged, items.length) }]
    })),
  }
}

export function evaluatePhoneFlags(gold, raw, threshold = 80, { split = 'test' } = {}) {
  assert(['test', 'training', 'calibration', 'validation', 'regression'].includes(split), 'Unknown evaluation partition; final is locked')
  assert(Number.isInteger(threshold) && threshold >= 0 && threshold <= 100, 'Threshold must be an integer 0–100')
  assert(Array.isArray(gold) && gold.length && Array.isArray(raw), 'Nonempty gold and response arrays required')
  const ids = new Set(gold.map(r => r.id)), byId = new Map(raw.map(r => [r.id, r]))
  assert.equal(ids.size, gold.length, 'Duplicate gold IDs')
  assert.equal(byId.size, raw.length, 'Duplicate response IDs')
  for (const id of byId.keys()) assert(ids.has(id), 'Unknown response ID')
  const sources = new Set(gold.map(r => r.source)), datasets = new Set(gold.map(r => `${r.dataset}@${r.datasetRevision}`))
  assert(sources.size === 1 && ['human', 'synthetic'].includes([...sources][0]), 'Do not mix annotation sources')
  assert.equal(datasets.size, 1, 'Do not mix dataset revisions')
  const revisions = new Set(raw.filter(r => r.status === 200).map(r => r.body?.revision))
  assert(revisions.size <= 1, 'Do not mix scoring revisions')
  const excluded = {}, pairs = []
  let eligible = 0, insertedAnnotations = 0
  const exclude = (reason, count) => { excluded[reason] = (excluded[reason] ?? 0) + count }
  for (const row of gold) {
    assert(row.id && row.speaker && row.split === split && row.dataset && row.datasetRevision, 'Missing declared-partition provenance')
    assert(Array.isArray(row.words) && row.words.length, 'Missing word annotations')
    const response = byId.get(row.id)
    let reports, phones
    if (response?.status === 200) {
      assert(Array.isArray(response.words) && response.words.length === row.words.length, 'Word identity/count mismatch')
      response.words.forEach((w, i) => assert.equal(w.text, row.words[i].text, 'Word identity/order mismatch'))
      validateResponse(response.body, flatten(response.words))
      // Sorting indices avoids depending on the serialization order of backend phones.
      phones = [...response.body.phones].sort((a, b) => a.index - b.index)
      reports = byWord(response.words, decodeAnalysisResponse({ ...response.body, phones }).aligned)
    }
    let offset = 0
    row.words.forEach((word, wi) => {
      assert(Array.isArray(word.phones) && word.phones.length, 'Missing canonical phones')
      assert(Array.isArray(word.phoneAccuracy) && word.phoneAccuracy.length === word.phones.length
        && word.phoneAccuracy.every(n => Number.isFinite(n) && n >= 0 && n <= 2), 'Invalid human phone scores')
      assert(Array.isArray(word.phoneAnnotations) && word.phoneAnnotations.length === 5, 'Five independent phone annotations required')
      eligible += word.phones.length
      const start = offset
      offset += response?.words?.[wi]?.phones?.length ?? 0
      if (!reports) { exclude('missingOrFailedResponse', word.phones.length); return }
      const canonical = word.phones.map(p => arpaToPhones(p))
      if (canonical.some(p => p.length !== 1)) { exclude('unsupportedArpabet', word.phones.length); return }
      const expected = canonical.map(p => p[0].ipa)
      if (JSON.stringify(expected) !== JSON.stringify(response.words[wi].phones)) {
        exclude('canonicalSequenceMismatch', word.phones.length); return
      }
      const wordPhones = phones.slice(start, offset)
      if (wordPhones.some(p => !p.realized || p.realized !== p.expected)) {
        exclude('variantOrUnspecifiedRealization', word.phones.length); return
      }
      if (wordPracticeStatus(reports[wi], threshold) === 'unscored') { exclude('unassessedWordTiming', word.phones.length); return }
      const annotations = word.phoneAnnotations.map(a => parsePhoneAnnotation(a, word.phones))
      if (annotations.some(a => !a)) { exclude('unmappableHumanAnnotation', word.phones.length); return }
      insertedAnnotations += annotations.reduce((sum, a) => sum + a.insertions, 0)
      wordPhones.forEach((phone, pi) => {
        // Merged rhotics, copied spans and overlapping paths cannot identify independent phone slots.
        if (phones.some(other => other.index !== phone.index && other.start < phone.end && other.end > phone.start)) {
          exclude('sharedOrOverlappingPhoneSpan', 1); return
        }
        const value = soundScore(reports[wi].steps[pi])
        if (value === null) { exclude('unscoredPhone', 1); return }
        const labels = annotations.map(a => a.labels[pi])
        const counts = [0, 1, 2].map(value => labels.filter(n => n === value).length)
        pairs.push({ id: row.id, speaker: row.speaker, word: wi, slot: pi, phone: expected[pi], score: value,
          human: word.phoneAccuracy[pi], concern: counts[0] >= 3, nonPerfectMajority: counts[0] + counts[1] >= 3,
          category: counts[0] >= 3 ? 'incorrectOrMissed' : counts[1] >= 3 ? 'heavyAccent' : counts[2] >= 3 ? 'correct' : 'noCategoryMajority',
          unanimous: labels.every(n => n === labels[0]) })
      })
    })
  }
  assert.equal(pairs.length + Object.values(excluded).reduce((a, b) => a + b, 0), eligible)
  return { schemaVersion: 2, split, adapter: 'exact-canonical-distinct-span-v1', annotationSource: [...sources][0],
    dataset: [...datasets][0], scorerRevision: [...revisions][0] ?? null, threshold,
    rubric: 'Human concern = at least 3 of 5 experts mark incorrect/missed (0). Heavy accent (1) is not an error. Model flag = score strictly below threshold.',
    recordings: gold.length, speakers: new Set(gold.map(r => r.speaker)).size,
    eligible, scored: pairs.length, coverage: ratio(pairs.length, eligible), excluded,
    insertionAnnotationsNotEvaluated: insertedAnnotations, metrics: summarize(pairs, threshold),
    rubrics: summarizeRubrics(pairs, threshold),
    rubricDefinitions: { majorityIncorrectOrMissed: 'At least 3/5 raters mark 0.', majorityAccentOrError: 'At least 3/5 raters mark either 0 or 1; an accent/quality target, not solely error detection.',
      humanCategories: 'Separate exact-category majority (0, 1 or 2); otherwise no category majority. Never force a tie into correct.' },
    byPhone: Object.fromEntries([...new Set(pairs.map(p => p.phone))].sort().map(p => {
      const items = pairs.filter(item => item.phone === p)
      return [p, { ...summarize(items, threshold), rubrics: summarizeRubrics(items, threshold) }]
    })),
    caveats: [
      'Partial exact-match subset, not an end-to-end detector evaluation. Excluded errors may differ systematically.',
      'No human boundaries. Distinct model spans are a mapping safeguard, not validated timing.',
      'Majority incorrect/missed is an operational rubric, not objective truth; accent-only concerns are not positives.',
      'Connected-speech variants, dictionary disagreements, insertions and merged phone spans are not graded here.',
      'Mandarin-L1 read speech is not representative of the user or native US speech; no speaker-bootstrap intervals.',
      'The 80-point user preference is not tuned here. Correlations and flags are not correctness probabilities.',
    ] }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [goldPath, rawPath, outputPath, cutoff = '80', ...extra] = process.argv.slice(2)
    assert(goldPath && rawPath && outputPath && !extra.length, 'Usage: npm run benchmark:phones -- GOLD.jsonl RUN/raw.jsonl OUTPUT.json [80]')
    const runPath = resolve(dirname(rawPath), 'run.json')
    const run = JSON.parse(await readFile(runPath, 'utf8'))
    const goldBytes = await readFile(goldPath), rawBytes = await readFile(rawPath)
    assert.equal(sha256(goldBytes), run.dataset.goldSha256, 'Gold differs from archived scoring run')
    const gold = await readJsonl(goldPath), raw = await readJsonl(rawPath)
    assert.deepEqual(raw.map(r => r.id), run.dataset.ids, 'Archived raw IDs differ from run manifest')
    const report = evaluatePhoneFlags(gold, raw, Number(cutoff), { split: run.dataset.partition ?? 'test' })
    report.provenance = { runRevision: run.revision, goldSha256: sha256(goldBytes), rawSha256: sha256(rawBytes),
      runSha256: sha256(await readFile(runPath)), adapterSha256: sha256(await readFile(fileURLToPath(import.meta.url))),
      derivedAt: new Date().toISOString(), mode: 'Offline replay of archived model outputs; no model rerun or calibration.' }
    // Never overwrite an existing report or a source file.
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    console.log(JSON.stringify({ output: outputPath, eligible: report.eligible, scored: report.scored,
      coverage: report.coverage, excluded: report.excluded, metrics: report.metrics }, null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
