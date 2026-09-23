/** Deterministic paired cluster bootstrap. Resample speakers, never independent phones. */
import assert from 'node:assert/strict'

export const ratio = (a, b) => b ? a / b : null
export function quantile(values, fraction) {
  assert(Number.isFinite(fraction) && fraction >= 0 && fraction <= 1, 'Quantile must be within 0–1')
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * fraction, lower = Math.floor(index), upper = Math.ceil(index)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}
export function speakerBootstrap(rows, measure, { replicates = 2000, seed = 762 } = {}) {
  assert(Number.isInteger(replicates) && replicates >= 100 && replicates <= 10000, 'Use 100–10000 bootstrap replicates')
  const groups = new Map()
  for (const row of rows) {
    assert(typeof row.speaker === 'string' && row.speaker, 'Speaker identity required for bootstrap')
    if (!groups.has(row.speaker)) groups.set(row.speaker, [])
    groups.get(row.speaker).push(row)
  }
  const speakers = [...groups.keys()].sort(), point = measure(rows)
  const samples = Object.fromEntries(Object.keys(point).map(key => [key, []]))
  let state = seed >>> 0
  const random = () => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 4294967296 }
  if (speakers.length >= 2) for (let i = 0; i < replicates; i++) {
    const selected = Array.from({ length: speakers.length }, () => groups.get(speakers[Math.floor(random() * speakers.length)])).flat()
    const value = measure(selected)
    for (const key of Object.keys(point)) if (Number.isFinite(value[key])) samples[key].push(value[key])
  }
  return { method: 'paired percentile bootstrap by speaker', speakers: speakers.length, replicates, seed,
    metrics: Object.fromEntries(Object.entries(point).map(([key, estimate]) => [key, { estimate,
      validReplicates: samples[key].length,
      interval95: samples[key].length >= replicates * 0.95 ? [quantile(samples[key], 0.025), quantile(samples[key], 0.975)] : null,
    }])) }
}
