/** CLI and compatibility export for independent boundary/pronunciation evaluation. */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { readJsonl } from './prepare-speechocean.mjs'
import { evaluateBoundaries } from './evaluate-boundaries.mjs'
export const evaluatePronunciation = evaluateBoundaries

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert([4, 5].includes(process.argv.length), 'Usage: node scripts/evaluate-pronunciation.mjs GOLD.jsonl PREDICTIONS.jsonl [PARTITION]')
    console.log(JSON.stringify(evaluatePronunciation(await readJsonl(process.argv[2]), await readJsonl(process.argv[3]), { split: process.argv[4] ?? 'test' }), null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
