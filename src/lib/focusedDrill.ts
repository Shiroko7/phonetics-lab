import { DAILY_TRAINING_SENTENCES } from '../data/dailyContent.ts'
import type { Dictionary } from './dict.ts'
import { PHONES } from './phones.ts'
import { flatten, targetWords } from './report.ts'
import type { DrillPhrase, DrillSet, DrillStep } from './phrasebank.ts'

const UNFOCUSED_WORDS = new Set(
  'a an the and or but if so as at by for from in into of on onto to up with after before during near over under through around beside between beyond about against across behind below above is am are was were be been being do does did have has had can could will would should may might must this that these those it its i me my we us our you your he him his she her they them their who what which when where why how not no'.split(' '),
)

export interface DrillFocusWord {
  word: string
  phones: string[]
}

export interface FocusedDrillStep extends DrillStep {
  focusWords: DrillFocusWord[]
}

interface Candidate extends FocusedDrillStep {
  covers: { phone: string; count: number; indices: number[] }[]
  priority: number
}

/**
 * Build one short, ordinary carrier sentence for every history problem sound.
 * The drill corpus contains complete sentences; we select no more than three
 * content words per sentence and score only the selected words' phone slots.
 */
export function buildFocusedDrill(
  wanted: string[],
  dict: Dictionary,
  commonRanks: ReadonlyMap<string, number> = new Map(),
  sentences: string[] = DAILY_TRAINING_SENTENCES,
  options: { randomize?: boolean } = {},
): DrillSet {
  const phones = [...new Set(wanted)].filter((phone) => phone in PHONES && phone !== 'ɾ' && phone !== 'ʔ')
  if (phones.length === 0) return { steps: [], missing: [] }

  const candidates = sentences.map((text) => candidateFor(text, phones, dict, commonRanks)).filter((one): one is Candidate => one !== null)
  const steps: FocusedDrillStep[] = []
  const missing = new Set(phones)
  const used = new Set<string>()

  while (missing.size > 0) {
    const eligible = candidates.filter((candidate) => !used.has(candidate.phrase.text) && candidate.covers.some((cover) => missing.has(cover.phone)))
    if (eligible.length === 0) break

    const freshCount = (candidate: Candidate) => candidate.covers.filter((cover) => missing.has(cover.phone)).length
    const maxFresh = Math.max(...eligible.map(freshCount))
    const contenders = eligible
      .filter((candidate) => freshCount(candidate) === maxFresh)
      .sort((a, b) => b.priority - a.priority)
      .slice(0, options.randomize ? 6 : 1)
    const best = contenders[options.randomize ? Math.floor(Math.random() * contenders.length) : 0]

    // Do not count a sound from this line unless one of its highlighted words
    // actually contains it. Already-covered words stay visible as ordinary
    // context if they also happen to contain another weak sound.
    const selectedCovers = best.covers.filter((cover) => missing.has(cover.phone))
    const selectedPhones = new Set(selectedCovers.map((cover) => cover.phone))
    const focusWords = best.focusWords
      .map((focus) => ({ ...focus, phones: focus.phones.filter((phone) => selectedPhones.has(phone)) }))
      .filter((focus) => focus.phones.length > 0)
    if (focusWords.length > 3) focusWords.length = 3
    const limitedPhones = new Set(focusWords.flatMap((focus) => focus.phones))
    const covers = selectedCovers.filter((cover) => limitedPhones.has(cover.phone))

    if (covers.length === 0) break
    const step: FocusedDrillStep = {
      phrase: best.phrase,
      focusWords,
      covers,
    }
    steps.push(step)
    used.add(best.phrase.text)
    covers.forEach((cover) => missing.delete(cover.phone))
  }

  // Ensure every history sound is drillable, even if the carrier library has
  // no natural sentence for it. The IPA inventory's own example is verified
  // against the loaded dictionary before it is used.
  for (const phone of [...missing]) {
    const example = PHONES[phone]?.example.split(',')[0]?.trim().toLowerCase()
    const word = example && dict.has(example) && targetWords(example, dict).some((entry) => entry.phones.includes(phone))
      ? example
      : [...commonRanks.keys()].find((candidate) => targetWords(candidate, dict).some((entry) => entry.phones.includes(phone)))
    if (!word) continue

    const phrase = `Please say “${word}” once, then read the next line.`
    const carrier = measurePhrase(phrase, [], dict)
    if (!carrier) continue
    const carrierWords = targetWords(phrase, dict)
    const focusAt = carrierWords.findIndex((entry) => entry.text.toLowerCase() === word.toLowerCase())
    if (focusAt < 0) continue
    const offsets = wordOffsets(carrierWords)
    const selected = carrierWords[focusAt].phones.flatMap((seen, phoneIndex) => seen === phone
      ? [{ index: offsets[focusAt] + phoneIndex }]
      : [])
    if (selected.length === 0) continue
    steps.push({
      phrase: carrier,
      focusWords: [{ word, phones: [phone] }],
      covers: [{ phone, count: selected.length, indices: selected.map((hit) => hit.index) }],
    })
    missing.delete(phone)
  }

  return { steps, missing: [...missing] }
}

function candidateFor(
  text: string,
  wanted: string[],
  dict: Dictionary,
  commonRanks: ReadonlyMap<string, number>,
): Candidate | null {
  const words = targetWords(text, dict)
  if (words.length < 4 || words.length > 17) return null
  const offsets = wordOffsets(words)
  const phones = flatten(words)
  const counts = new Map<string, number>()
  for (const phone of phones) if (wanted.includes(phone)) counts.set(phone, (counts.get(phone) ?? 0) + 1)
  // A carrier can contain incidental examples, but never more than three of
  // any one target sound. This keeps the other words from becoming a chant.
  if ([...counts.values()].some((count) => count > 3)) return null

  const wordOptions = words.flatMap((word, index) => {
    const key = word.text.toLowerCase().replace(/[^a-z']/g, '')
    if (!key || UNFOCUSED_WORDS.has(key)) return []
    const matched = [...new Set(word.phones.filter((phone) => wanted.includes(phone)))]
    if (matched.length === 0) return []
    const rank = commonRanks.get(key) ?? Number.MAX_SAFE_INTEGER / 4
    return [{ word: word.text, key, matched, rank, index, positions: word.phones.flatMap((phone, phoneIndex) => wanted.includes(phone)
      ? [{ phone, index: offsets[index] + phoneIndex }]
      : []) }]
  })
  if (wordOptions.length === 0) return null

  const uncovered = new Set(wanted)
  const selected: typeof wordOptions = []
  while (selected.length < 3) {
    const remaining = wordOptions.filter((option) => !selected.some((chosen) => chosen.index === option.index))
    const best = remaining
      .map((option) => ({ option, fresh: option.matched.filter((phone) => uncovered.has(phone)).length }))
      .filter((entry) => entry.fresh > 0)
      .sort((a, b) => b.fresh - a.fresh || a.option.rank - b.option.rank || a.option.key.length - b.option.key.length)[0]?.option
    if (!best) break
    selected.push(best)
    best.matched.forEach((phone) => uncovered.delete(phone))
  }
  if (selected.length === 0) return null

  const focusWords = selected.map((option) => ({ word: option.word, phones: option.matched }))
  const covers = wanted.flatMap((phone) => {
    const indices = selected.flatMap((option) => option.positions.filter((hit) => hit.phone === phone).map((hit) => hit.index))
    return indices.length ? [{ phone, count: indices.length, indices }] : []
  })
  const phrase = measurePhrase(text, covers.map((cover) => cover.phone), dict)
  if (!phrase) return null
  const rankSum = selected.reduce((sum, option) => sum + Math.min(option.rank, 10000), 0)
  return { phrase, focusWords, covers, priority: covers.length * 100 - words.length - rankSum / 10000 }
}

function wordOffsets(words: ReturnType<typeof targetWords>): number[] {
  const offsets: number[] = []
  let index = 0
  for (const word of words) {
    offsets.push(index)
    index += word.phones.length
  }
  return offsets
}

function measurePhrase(text: string, focus: string[], dict: Dictionary): DrillPhrase | null {
  const words = targetWords(text, dict)
  const phones = flatten(words)
  if (phones.length === 0) return null
  const counts = new Map<string, number>()
  for (const phone of phones) counts.set(phone, (counts.get(phone) ?? 0) + 1)
  return { text, focus, counts, length: phones.length, words: words.length }
}
