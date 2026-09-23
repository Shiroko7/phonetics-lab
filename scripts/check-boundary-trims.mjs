/** Synthetic policy checks only. Never load corpus audio in a unit check. */
import assert from 'node:assert/strict'
import { sweepBoundaryTrims, trimPlayback } from './benchmark-boundary-trims.mjs'

const gold = ['a', 'b'].map(speaker => ({
  id: `fixture/${speaker}`, speaker, source: 'human', split: 'validation', dataset: 'l2-arctic', datasetRevision: 'v5.0',
  text: 'one two', duration: 1, audioInfo: { sampleRate: 1000 },
  annotation: { kind: 'provider-manually-corrected' },
  words: [
    { text: 'one', start: 0, end: 0.5, correct: null, boundaryStatus: 'human-corrected' },
    { text: 'two', start: 0.5, end: 1, correct: null, boundaryStatus: 'human-corrected' },
  ],
}))
const predictions = gold.map(row => ({
  id: row.id, scorer: 'fixture-aligner', revision: 'fixture-1',
  words: [
    { text: 'one', start: 0.05, end: 0.55, playback: { start: 0.05, end: 0.55 }, correct: null },
    { text: 'two', start: 0.45, end: 0.95, playback: { start: 0.45, end: 0.95 }, correct: null },
  ],
}))

const trimmed = trimPlayback(predictions[0], gold[0], 20)
assert.deepEqual(trimmed.words.map(word => word.playback), [
  { start: 0.07, end: 0.53 }, { start: 0.471, end: 0.929 },
])
assert.deepEqual(trimmed.words.map(word => [word.start, word.end]), predictions[0].words.map(word => [word.start, word.end]),
  'Playback trim never rewrites acoustic estimates')
assert.equal(trimPlayback({ ...predictions[0], words: [{ ...predictions[0].words[0], playback: null }] }, gold[0], 0).words[0].playback,
  null, 'Explicitly unavailable playback remains unavailable')
assert.equal(trimPlayback(predictions[0], gold[0], 250).words[0].playback, null, 'Collapsed replay interval is withheld')

const sweep = sweepBoundaryTrims(gold, predictions, [0, 20, 40])
const closeTo = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} should be close to ${expected}`)
closeTo(sweep.baseline.meanNeighborIncludedMs, 50)
closeTo(sweep.sweep[20].meanNeighborIncludedMs, 29.5)
closeTo(sweep.sweep[20].meanTargetClippedMs, 70.5)
assert.equal(sweep.sweep[20].timingCoverage, 1)
assert.equal(sweep.pairedChangesVsUntrimmed[20].speakers, 2)
closeTo(sweep.pairedChangesVsUntrimmed[20].metrics.meanNeighborIncludedMs.estimate, -20.5)
closeTo(sweep.pairedChangesVsUntrimmed[20].metrics.meanTargetClippedMs.estimate, 20.5)
closeTo(sweep.pairedChangesVsUntrimmed[20].metrics.meanErrorMs.estimate, 0)
assert.throws(() => sweepBoundaryTrims(gold.map(row => ({ ...row, split: 'final' })), predictions), /development data/)
console.log('Boundary trim sweep passed: acoustic estimates stay fixed, clipping/leakage trade off, coverage and null replays persist.')
