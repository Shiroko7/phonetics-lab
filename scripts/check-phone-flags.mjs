import assert from 'node:assert/strict'
import { evaluatePhoneFlags, parsePhoneAnnotation } from './evaluate-phone-flags.mjs'
import { ANALYSIS_REVISION } from '../src/lib/backend.ts'
const ref = ['K', 'AE1', 'T']
assert.deepEqual(parsePhoneAnnotation('K {AE1} (T) [AH0]', ref), { labels: [2, 1, 0], insertions: 1 })
for (const text of ['K AE1', 'K AE1 T garbage', 'K AE1 (T', 'K [T] AE1', 'K AE0 T', 'K AE1 T*', 'K AE1 T [BOGUS]']) assert.equal(parsePhoneAnnotation(text, ref), null)
const word = { text: 'CAT', phones: ref, phoneAccuracy: [2, 1, 0], phoneAnnotations: Array(5).fill('K {AE1} (T)') }
const gold = [{ id: 'x', speaker: 's', source: 'synthetic', split: 'test', dataset: 'fixture', datasetRevision: '1', words: [word] }]
const raw = [{ id: 'x', status: 200, words: [{ text: 'CAT', phones: ['k', 'æ', 't'], ipa: 'kæt' }], body: {
  revision: ANALYSIS_REVISION, overall: 60, free: [], phones: ['k', 'æ', 't'].map((expected, index) => ({ index, expected, realized: expected,
    score: [100, 60, 20][index], gop: -1, posterior: 0.3, verdict: 'correct', start: index / 10, end: (index + 1) / 10 })) } }]
const check = evaluatePhoneFlags(gold, raw)
assert.equal(check.eligible, 3)
assert.equal(check.scored, 3)
assert.equal(check.metrics.precision, 0.5, 'accent-only annotation is not an error')
assert.equal(check.metrics.recall, 1)
assert.equal(check.metrics.falsePositive, 1)
assert.equal(evaluatePhoneFlags(gold, []).metrics.precision, null)
assert.equal(evaluatePhoneFlags(gold, []).coverage, 0)
const altered = (change) => { const value = structuredClone(raw); change(value[0]); return value }
assert.throws(() => evaluatePhoneFlags(gold, altered(r => r.words[0].phones[1] = 'a')), /Mismatched/)
assert.equal(evaluatePhoneFlags(gold, altered(r => { r.words[0].phones[1] = 'a'; r.body.phones[1].expected = 'a' })).excluded.canonicalSequenceMismatch, 3)
assert.equal(evaluatePhoneFlags(gold, altered(r => r.body.phones[1].realized = 'a')).excluded.variantOrUnspecifiedRealization, 3)
assert.equal(evaluatePhoneFlags(gold, altered(r => delete r.body.phones[1].realized)).scored, 0)
const merged = evaluatePhoneFlags(gold, altered(r => { r.body.phones[1].start = 0; r.body.phones[1].end = 0.1 }))
assert.equal(merged.excluded.sharedOrOverlappingPhoneSpan, 2)
assert.equal(merged.scored, 1)
assert.equal(evaluatePhoneFlags(gold, altered(r => r.body.phones[0].end = 0)).excluded.unassessedWordTiming, 3)
assert.throws(() => evaluatePhoneFlags(gold, altered(r => r.body.phones[0].score = NaN)), /numerical/)
assert.throws(() => evaluatePhoneFlags(gold, altered(r => r.body.phones[0].index = 1)), /Mismatched|duplicate/)
assert.throws(() => evaluatePhoneFlags(gold, [...raw, ...raw]), /Duplicate/)
assert.throws(() => evaluatePhoneFlags([...gold, ...gold], raw), /Duplicate/)
assert.throws(() => evaluatePhoneFlags(gold, altered(r => r.id = 'other')), /Unknown/)
assert.throws(() => evaluatePhoneFlags(gold, altered(r => r.words[0].text = 'CAP')), /identity/)
assert.throws(() => evaluatePhoneFlags(gold, raw, 80.5), /integer/)
const noMap = structuredClone(gold); noMap[0].words[0].phoneAnnotations[0] = 'K AE1'
assert.equal(evaluatePhoneFlags(noMap, raw).excluded.unmappableHumanAnnotation, 3)
assert.equal(evaluatePhoneFlags(gold, altered(r => r.body.phones.reverse())).metrics.precision, check.metrics.precision)
const twoWords = structuredClone(raw)
twoWords[0].words.push(structuredClone(twoWords[0].words[0]))
twoWords[0].body.phones.push(...raw[0].body.phones.map(p => ({ ...p, index: p.index + 3, start: p.start + 1, end: p.end + 1 })))
const twoGold = structuredClone(gold); twoGold[0].words.push(word)
assert.equal(evaluatePhoneFlags(twoGold, twoWords).scored, 6, 'repeated words retain their distinct slots')
console.log('Phone benchmark: strict annotations, conservative mapping, coverage and flag metrics passed (synthetic fixtures).')
