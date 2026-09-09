/**
 * Practice words for a sound that keeps going wrong.
 *
 * Naming the fault is only half of it. "You say /s/ where /θ/ belongs" is worth
 * knowing; what fixes it is saying *think* against *sink* until the tongue
 * learns the difference. So for each weak sound the app looks for **minimal
 * pairs** — two real words that differ in exactly that one phone — and falls
 * back to plain examples when the contrast does not happen to exist.
 *
 * Candidates come from a frequency-ordered list rather than from the
 * dictionary at large, because CMUdict offers *thole* as readily as *think*
 * and a drill on a word nobody says is no drill at all.
 */

import { expectedPhones } from './align.ts'
import type { Dictionary } from './dict.ts'

/** How many words deep to look. The list is ordered, so this is a quality cut. */
const CANDIDATES = 5000

export interface Drill {
  word: string
  ipa: string
  /**
   * A word identical but for the sound being drilled — *sink* for *think*.
   * Absent when English happens to offer no such pair.
   */
  contrast?: { word: string; ipa: string }
}

interface Entry {
  word: string
  ipa: string
  phones: string[]
  /** Position in the frequency list; lower is commoner. */
  rank: number
}

export interface DrillIndex {
  /** Most frequent first, so the best drill is also the first one found. */
  entries: Entry[]
  /** Phone sequence -> the most common word pronounced that way. */
  byPhones: Map<string, Entry>
}

let words: Promise<string[]> | null = null

/** The frequency list, fetched once. Kept apart from the indexing below so the
 *  index itself stays a pure function of its inputs. */
export function loadCommonWords(): Promise<string[]> {
  words ??= (async () => {
    const url = new URL('./dict/common-words.txt', document.baseURI).href
    const res = await fetch(url)
    if (!res.ok) throw new Error(`could not load the word list (${res.status})`)
    return (await res.text()).split('\n').map((w) => w.trim()).filter(Boolean)
  })().catch((err: Error) => {
    words = null
    throw err
  })
  return words
}

/** Index a frequency-ordered word list against the pronunciation dictionary. */
export function buildDrillIndex(dict: Dictionary, list: string[]): DrillIndex {
  const entries: Entry[] = []
  const byPhones = new Map<string, Entry>()
  for (const word of list.slice(0, CANDIDATES)) {
    const ipa = dict.get(word)?.[0]
    if (!ipa) continue
    const phones = expectedPhones(ipa)
    if (phones.length === 0) continue
    const entry = { word, ipa, phones, rank: entries.length }
    entries.push(entry)
    // First writer wins, so a key resolves to the commonest spelling of it.
    const key = phones.join(' ')
    if (!byPhones.has(key)) byPhones.set(key, entry)
  }
  return { entries, byPhones }
}

const indexes = new WeakMap<Dictionary, Promise<DrillIndex>>()

/** Built once per dictionary, on the first request. A few thousand lookups. */
export function drillIndex(dict: Dictionary): Promise<DrillIndex> {
  let index = indexes.get(dict)
  if (!index) {
    index = loadCommonWords().then((list) => buildDrillIndex(dict, list))
    indexes.set(dict, index)
  }
  return index
}

/**
 * Words worth practising `phone` with, best first.
 *
 * When `insteadOf` is given — the sound actually produced — pairs that turn on
 * exactly that swap come first, since they are the ones that make the mistake
 * audible as a change of meaning.
 */
export function findDrills(
  index: DrillIndex,
  phone: string,
  insteadOf?: string,
  limit = 5,
): Drill[] {
  const found: { drill: Drill; cost: number }[] = []
  const plain: Entry[] = []

  for (const entry of index.entries) {
    if (!entry.phones.includes(phone)) continue
    const partner = insteadOf ? findPartner(index, entry, phone, insteadOf) : null
    if (partner) {
      // A pair is only as good as its rarer half: *path*/*pass* teaches more
      // than *death*/*des*, however common the first word of each is.
      found.push({
        drill: { word: entry.word, ipa: entry.ipa, contrast: { word: partner.word, ipa: partner.ipa } },
        cost: Math.max(entry.rank, partner.rank),
      })
    } else {
      plain.push(entry)
    }
  }

  found.sort((a, b) => a.cost - b.cost)

  const drills: Drill[] = []
  const used = new Set<string>()
  for (const { drill } of found) {
    if (drills.length >= limit) break
    if (used.has(drill.word) || used.has(drill.contrast!.word)) continue
    used.add(drill.word)
    used.add(drill.contrast!.word)
    drills.push(drill)
  }

  // Pairs are the point; plain examples only make up the shortfall, short ones
  // first so the sound is not buried in four other syllables.
  const short = plain.filter((entry) => entry.phones.length <= 6)
  for (const entry of (short.length >= limit ? short : plain)) {
    if (drills.length >= limit) break
    if (used.has(entry.word)) continue
    used.add(entry.word)
    drills.push({ word: entry.word, ipa: entry.ipa })
  }

  return drills
}

/** The same word with one occurrence of `phone` swapped for `insteadOf`. */
function findPartner(
  index: DrillIndex,
  entry: Entry,
  phone: string,
  insteadOf: string,
): Entry | null {
  for (let i = 0; i < entry.phones.length; i++) {
    if (entry.phones[i] !== phone) continue
    const swapped = entry.phones.slice()
    swapped[i] = insteadOf
    const partner = index.byPhones.get(swapped.join(' '))
    if (partner && partner.word !== entry.word) return partner
  }
  return null
}
