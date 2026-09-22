/** Converts separately downloaded CMUdict data; no third-party data lives here. */
import { transcribe } from '../src/lib/phonology.ts'

export function buildDictionary(raw) {
  const entries = new Map()
  for (const line of raw.split('\n')) {
    const clean = line.split('#')[0].trim()
    const space = clean.indexOf(' ')
    if (space === -1) continue
    const headword = clean.slice(0, space).replace(/\(\d+\)$/, '')
    const ipa = transcribe(clean.slice(space + 1))
    if (!ipa) continue
    const list = entries.get(headword)
    if (list) {
      if (!list.includes(ipa)) list.push(ipa)
    } else entries.set(headword, [ipa])
  }
  if (!entries.size) throw new Error('CMUdict contained no usable pronunciations')
  return [...entries].map(([word, list]) => `${word}\t${list.join('|')}`).sort().join('\n')
}
