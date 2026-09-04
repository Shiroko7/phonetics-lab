/**
 * General American phonology: ARPAbet -> IPA, syllabification, stress and flapping.
 *
 * Shared by the offline dictionary build script (scripts/build-dict.mjs) and the
 * runtime fallbacks, so both produce identically-shaped transcriptions.
 */

export type Stress = 0 | 1 | 2 | null

export interface Phone {
  ipa: string
  stress: Stress
}

export interface Syllable {
  onset: string[]
  nucleus: string
  coda: string[]
  stress: Stress
}

/** ARPAbet consonants and vowel qualities in General American IPA. */
const ARPA_IPA: Record<string, string> = {
  AA: 'ɑ', AE: 'æ', AH: 'ʌ', AO: 'ɔ', AW: 'aʊ', AY: 'aɪ',
  EH: 'ɛ', ER: 'ɝ', EY: 'eɪ', IH: 'ɪ', IY: 'i',
  OW: 'oʊ', OY: 'ɔɪ', UH: 'ʊ', UW: 'u',
  B: 'b', CH: 'tʃ', D: 'd', DH: 'ð', F: 'f', G: 'ɡ', HH: 'h', JH: 'dʒ',
  K: 'k', L: 'l', M: 'm', N: 'n', NG: 'ŋ', P: 'p', R: 'ɹ', S: 's',
  SH: 'ʃ', T: 't', TH: 'θ', V: 'v', W: 'w', Y: 'j', Z: 'z', ZH: 'ʒ',
}

/** Every IPA symbol that can head a syllable. */
export const NUCLEI = new Set([
  'ɑ', 'æ', 'ʌ', 'ə', 'ɔ', 'aʊ', 'aɪ', 'ɛ', 'ɝ', 'ɚ', 'eɪ',
  'ɪ', 'i', 'oʊ', 'ɔɪ', 'ʊ', 'u',
])

/** Lax vowels that must close their syllable when stressed (happy -> hap.py). */
const LAX = new Set(['æ', 'ɛ', 'ɪ', 'ʌ', 'ʊ'])

/** Consonant clusters English permits word-initially. */
const ONSETS = new Set([
  'p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ',
  'h', 'tʃ', 'dʒ', 'm', 'n', 'l', 'ɹ', 'w', 'j',
  'pl', 'pɹ', 'bl', 'bɹ', 'tɹ', 'tw', 'dɹ', 'dw', 'kl', 'kɹ', 'kw',
  'ɡl', 'ɡɹ', 'ɡw', 'fl', 'fɹ', 'θɹ', 'θw', 'ʃɹ', 'ʃl', 'ʃm', 'ʃn',
  'ʃp', 'ʃt', 'ʃv', 'sl', 'sw', 'sp', 'st', 'sk', 'sm', 'sn', 'sf', 'sv',
  'hw', 'hj', 'vɹ', 'vj', 'mj', 'nj', 'lj', 'pj', 'bj', 'tj', 'dj',
  'kj', 'ɡj', 'fj', 'θj', 'sj', 'zj', 'zw', 'dz',
  'spl', 'spɹ', 'stɹ', 'skɹ', 'skw', 'spj', 'stj', 'skj', 'skl', 'sfɹ',
])

/** Parse one CMUdict pronunciation (W AO1 T ER0) into stressed IPA phones. */
export function arpaToPhones(arpa: string): Phone[] {
  const out: Phone[] = []
  for (const raw of arpa.trim().split(/\s+/)) {
    if (!raw) continue
    const m = /^([A-Z]+)([0-2])?$/.exec(raw)
    if (!m) continue
    const [, sym, digit] = m
    let ipa = ARPA_IPA[sym]
    if (!ipa) continue
    const stress = digit === undefined ? null : (Number(digit) as Stress)
    // Reduced vowels have their own symbols in IPA.
    if (sym === 'AH' && stress === 0) ipa = 'ə'
    if (sym === 'ER' && stress === 0) ipa = 'ɚ'
    out.push({ ipa, stress })
  }
  return out
}

/**
 * Split phones into syllables by the maximal onset principle, then pull one
 * consonant back as a coda when a stressed lax vowel would otherwise be open.
 *
 * `boundaries` holds phone indices that must begin a syllable. Morphology uses
 * it to stop a prefix bleeding into its stem: mis+configured is mɪs.kən-, not
 * the mɪ.skən- that maximal onset would otherwise produce.
 */
export function syllabify(phones: Phone[], boundaries?: ReadonlySet<number>): Syllable[] {
  const nuclei: number[] = []
  phones.forEach((p, i) => {
    if (NUCLEI.has(p.ipa)) nuclei.push(i)
  })

  // Consonants only (e.g. "hmm"): treat the whole run as one nucleus-less syllable.
  if (nuclei.length === 0) {
    return [{ onset: phones.map((p) => p.ipa), nucleus: '', coda: [], stress: null }]
  }

  const sylls: Syllable[] = nuclei.map((n) => ({
    onset: [],
    nucleus: phones[n].ipa,
    coda: [],
    stress: phones[n].stress,
  }))

  // Anything before the first nucleus is its onset, whatever the cluster.
  sylls[0].onset = phones.slice(0, nuclei[0]).map((p) => p.ipa)

  for (let i = 0; i < nuclei.length - 1; i++) {
    const start = nuclei[i] + 1
    const cluster = phones.slice(start, nuclei[i + 1]).map((p) => p.ipa)

    // A morpheme boundary inside the cluster overrides the phonotactics.
    let forced = -1
    if (boundaries) {
      for (let k = start; k <= nuclei[i + 1]; k++) {
        if (boundaries.has(k)) {
          forced = k - start
          break
        }
      }
    }

    let split: number
    if (forced >= 0) {
      split = Math.min(forced, cluster.length)
    } else {
      // How many consonants stay with the left syllable: as few as English allows.
      split = cluster.length
      for (let take = 0; take <= cluster.length; take++) {
        const candidate = cluster.slice(cluster.length - take)
        if (take === 0 || ONSETS.has(candidate.join(''))) split = cluster.length - take
      }
      // A stressed lax vowel cannot end its syllable: give it the first consonant.
      const stressed = sylls[i].stress === 1 || sylls[i].stress === 2
      if (split === 0 && cluster.length > 0 && stressed && LAX.has(sylls[i].nucleus)) {
        split = 1
      }
    }

    sylls[i].coda = cluster.slice(0, split)
    sylls[i + 1].onset = cluster.slice(split)
  }

  // Trailing consonants close the final syllable.
  const last = nuclei[nuclei.length - 1]
  sylls[sylls.length - 1].coda = phones.slice(last + 1).map((p) => p.ipa)

  return sylls
}

/**
 * Render syllables as IPA with stress marks and "." syllable breaks. A
 * monosyllable carries no mark — there is nothing for the stress to contrast with.
 */
export function toIPA(sylls: Syllable[]): string {
  const multi = sylls.length > 1
  return sylls
    .map((s) => {
      const mark = !multi ? '' : s.stress === 1 ? 'ˈ' : s.stress === 2 ? 'ˌ' : ''
      return mark + s.onset.join('') + s.nucleus + s.coda.join('')
    })
    .join(multi ? '.' : '')
    // A break is redundant where a stress mark already shows the boundary.
    .replace(/\.(?=[ˈˌ])/g, '')
}

export function transcribe(arpa: string): string {
  return toIPA(syllabify(arpaToPhones(arpa)))
}

const IPA_SYMBOLS = [
  'aʊ', 'aɪ', 'eɪ', 'oʊ', 'ɔɪ', 'tʃ', 'dʒ',
  'ɑ', 'æ', 'ʌ', 'ə', 'ɔ', 'ɛ', 'ɝ', 'ɚ', 'ɪ', 'i', 'ʊ', 'u',
  'p', 'b', 't', 'd', 'k', 'ɡ', 'f', 'v', 'θ', 'ð', 's', 'z', 'ʃ', 'ʒ',
  'h', 'm', 'n', 'ŋ', 'l', 'ɹ', 'w', 'j', 'ɾ', 'ʔ',
].sort((a, b) => b.length - a.length)

/** Break a transcription into phones, stress marks and syllable breaks. */
export function splitPhones(ipa: string): string[] {
  const out: string[] = []
  let i = 0
  outer: while (i < ipa.length) {
    for (const sym of IPA_SYMBOLS) {
      if (ipa.startsWith(sym, i)) {
        out.push(sym)
        i += sym.length
        continue outer
      }
    }
    out.push(ipa[i])
    i += 1
  }
  return out
}

/**
 * Read a rendered transcription back into stressed phones, so a stem pulled from
 * the dictionary can take a suffix and be re-syllabified as one word.
 */
export function parseIPA(ipa: string): Phone[] {
  const out: Phone[] = []
  let pending: Stress = null
  for (const unit of splitPhones(ipa)) {
    if (unit === '.') continue
    if (unit === 'ˈ') { pending = 1; continue }
    if (unit === 'ˌ') { pending = 2; continue }
    if (NUCLEI.has(unit)) {
      out.push({ ipa: unit, stress: pending ?? 0 })
      pending = null
    } else {
      out.push({ ipa: unit, stress: null })
    }
  }
  // Monosyllables are stored without a mark; restore it so that adding a
  // syllable (box -> boxes) still renders the stress it has always had.
  if (!out.some((p) => p.stress === 1)) {
    const first = out.find((p) => NUCLEI.has(p.ipa))
    if (first) first.stress = 1
  }
  return out
}

/** Re-render a word after its phones change, keeping syllabification honest. */
export function rebuild(phones: Phone[], boundaries?: ReadonlySet<number>): string {
  return toIPA(syllabify(phones, boundaries))
}

const FLAPPABLE_BEFORE = new Set([...NUCLEI, 'ɹ'])
const MARKS = new Set(['.', 'ˈ', 'ˌ'])

/**
 * General American tapping: /t/ and /d/ become a flap between a vowel (or /r/)
 * and an unstressed vowel — water, party, ladder.
 *
 * Stress blocks it on either side. A stress mark before the consonant means it
 * opens a stressed syllable (a-TTACK, pho-TO-graphy keep a true /t/); one after
 * it means the next syllable is stressed, which is equally protective.
 */
export function applyFlapping(ipa: string): string {
  const units = splitPhones(ipa)
  for (let i = 0; i < units.length; i++) {
    if (units[i] !== 't' && units[i] !== 'd') continue

    // Look left for a vowel or /r/, refusing to cross a stress mark.
    let prev = i - 1
    let stressedOnset = false
    while (prev >= 0 && MARKS.has(units[prev])) {
      if (units[prev] !== '.') stressedOnset = true
      prev--
    }
    if (stressedOnset) continue
    if (prev < 0 || !FLAPPABLE_BEFORE.has(units[prev])) continue

    // Look right for an unstressed vowel, again refusing to cross a stress mark.
    let next = i + 1
    let stressedNext = false
    while (next < units.length && MARKS.has(units[next])) {
      if (units[next] !== '.') stressedNext = true
      next++
    }
    if (stressedNext) continue
    if (next >= units.length || !NUCLEI.has(units[next])) continue

    units[i] = 'ɾ'
  }
  return units.join('')
}

/**
 * The cot-caught merger, which most General American speakers have: the LOT and
 * THOUGHT vowels collapse onto a single low back vowel. CMUdict keeps them
 * apart, so this is applied on demand rather than baked into the data.
 */
export function mergeCotCaught(ipa: string): string {
  return ipa.replace(/ɔ(?!ɪ)/g, 'ɑ')
}

const RESPELL: Record<string, string> = {
  'ɑ': 'ah', 'æ': 'a', 'ʌ': 'uh', 'ə': 'uh', 'ɔ': 'aw', 'aʊ': 'ow',
  'ɛ': 'eh', 'ɝ': 'ur', 'ɚ': 'er', 'eɪ': 'ay', 'ɪ': 'ih',
  'i': 'ee', 'oʊ': 'oh', 'ɔɪ': 'oy', 'ʊ': 'uu', 'u': 'oo',
  'tʃ': 'ch', 'dʒ': 'j', 'ð': 'dh', 'θ': 'th', 'ʃ': 'sh', 'ʒ': 'zh',
  'ŋ': 'ng', 'ɹ': 'r', 'ɡ': 'g', 'j': 'y', 'ɾ': 't', 'ʔ': '-',
}

/** Plain-English respelling of a transcription: WAH-ter */
export function respell(ipa: string): string {
  const words: string[][] = [[]]
  let current = ''
  let stressed = false

  const flush = () => {
    if (!current) return
    words[words.length - 1].push(stressed ? current.toUpperCase() : current)
    current = ''
    stressed = false
  }

  for (const unit of splitPhones(ipa)) {
    if (unit === ' ') {
      flush()
      words.push([])
      continue
    }
    if (unit === '.' || unit === 'ˌ') {
      flush()
      continue
    }
    if (unit === 'ˈ') {
      flush()
      stressed = true
      continue
    }
    // PRICE is written "eye" on its own but "y" once the syllable has an onset,
    // so "kite" comes out KYT rather than the unreadable KEYET.
    if (unit === 'aɪ') {
      current += current ? 'y' : 'eye'
      continue
    }
    current += RESPELL[unit] ?? unit
  }
  flush()

  return words
    .filter((w) => w.length)
    .map((w) => w.join('-'))
    .join(' ')
}

/** Count syllables in a transcription. */
export function syllableCount(ipa: string): number {
  return splitPhones(ipa).filter((u) => NUCLEI.has(u)).length || 1
}
