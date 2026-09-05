/**
 * Derives pronunciations for words CMUdict does not list but which are regular
 * formations of words it does — "refactored", "unfriendliest", "podcasters".
 *
 * The spelling rules undo English orthography (doubled consonants, dropped e,
 * y -> ie) to find a candidate stem; the phonology rules then attach the affix
 * with the right allomorph and re-syllabify the whole word.
 */

import { type Phone, parseIPA, rebuild } from './phonology.ts'

export interface Derived {
  ipa: string
  /** Human-readable account of the decomposition, e.g. "refactor + -ed". */
  via: string
}

type Lookup = (word: string) => string[] | undefined

const VOICELESS = new Set(['p', 't', 'k', 'f', 'θ', 's', 'ʃ', 'tʃ', 'h'])
const SIBILANT = new Set(['s', 'z', 'ʃ', 'ʒ', 'tʃ', 'dʒ'])
const ALVEOLAR_STOP = new Set(['t', 'd'])

const unstressed = (...ipa: string[]): Phone[] => ipa.map((s) => ({ ipa: s, stress: null }))
const vowel = (ipa: string, stress: 0 | 2 = 0): Phone => ({ ipa, stress })

/** Drop a doubled final consonant: "stopp" -> "stop", "runn" -> "run". */
function undouble(stem: string): string | null {
  const n = stem.length
  if (n < 3) return null
  const last = stem[n - 1]
  return last === stem[n - 2] && !'aeiou'.includes(last) ? stem.slice(0, -1) : null
}

function uniq(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.length >= 2))]
}

interface SuffixRule {
  /** Spelling the word must end with. */
  ending: string
  /** Candidate stem spellings, most likely first. */
  stems: (base: string) => string[]
  /** Phones to append, chosen by the stem's final phone. */
  phones: (finalPhone: string) => Phone[]
  label: string
}

const SUFFIXES: SuffixRule[] = [
  {
    // Plural and third person: cats, boxes, cities.
    ending: 's',
    label: '-s',
    stems: (w) =>
      uniq([
        w.slice(0, -1),
        w.endsWith('es') ? w.slice(0, -2) : null,
        w.endsWith('ies') ? w.slice(0, -3) + 'y' : null,
        w.endsWith('ves') ? w.slice(0, -3) + 'f' : null,
        w.endsWith('ves') ? w.slice(0, -3) + 'fe' : null,
      ]),
    phones: (last) =>
      SIBILANT.has(last)
        ? [vowel('ɪ'), ...unstressed('z')]
        : unstressed(VOICELESS.has(last) ? 's' : 'z'),
  },
  {
    // Past tense: walked, loved, tried, stopped.
    ending: 'ed',
    label: '-ed',
    stems: (w) =>
      uniq([
        w.slice(0, -2),
        w.slice(0, -1),
        w.endsWith('ied') ? w.slice(0, -3) + 'y' : null,
        undouble(w.slice(0, -2)),
      ]),
    phones: (last) =>
      ALVEOLAR_STOP.has(last)
        ? [vowel('ɪ'), ...unstressed('d')]
        : unstressed(VOICELESS.has(last) ? 't' : 'd'),
  },
  {
    // Progressive: walking, hoping, running.
    ending: 'ing',
    label: '-ing',
    stems: (w) => uniq([w.slice(0, -3), w.slice(0, -3) + 'e', undouble(w.slice(0, -3))]),
    phones: () => [vowel('ɪ'), ...unstressed('ŋ')],
  },
  {
    ending: 'ly',
    label: '-ly',
    stems: (w) => uniq([w.slice(0, -2), w.endsWith('ily') ? w.slice(0, -3) + 'y' : null]),
    phones: () => [...unstressed('l'), vowel('i')],
  },
  {
    ending: 'est',
    label: '-est',
    stems: (w) =>
      uniq([
        w.slice(0, -3),
        w.slice(0, -2),
        w.endsWith('iest') ? w.slice(0, -4) + 'y' : null,
        undouble(w.slice(0, -3)),
      ]),
    phones: () => [vowel('ɪ'), ...unstressed('s', 't')],
  },
  {
    ending: 'er',
    label: '-er',
    stems: (w) =>
      uniq([
        w.slice(0, -2),
        w.slice(0, -1),
        w.endsWith('ier') ? w.slice(0, -3) + 'y' : null,
        undouble(w.slice(0, -2)),
      ]),
    phones: () => [vowel('ɚ')],
  },
  {
    ending: 'ness',
    label: '-ness',
    stems: (w) => uniq([w.slice(0, -4), w.endsWith('iness') ? w.slice(0, -5) + 'y' : null]),
    phones: () => [...unstressed('n'), vowel('ə'), ...unstressed('s')],
  },
  {
    ending: 'less',
    label: '-less',
    stems: (w) => uniq([w.slice(0, -4)]),
    phones: () => [...unstressed('l'), vowel('ə'), ...unstressed('s')],
  },
  {
    ending: 'ful',
    label: '-ful',
    stems: (w) => uniq([w.slice(0, -3)]),
    phones: () => [...unstressed('f'), vowel('ə'), ...unstressed('l')],
  },
  {
    ending: 'ment',
    label: '-ment',
    stems: (w) => uniq([w.slice(0, -4)]),
    phones: () => [...unstressed('m'), vowel('ə'), ...unstressed('n', 't')],
  },
  {
    ending: 'able',
    label: '-able',
    stems: (w) => uniq([w.slice(0, -4), w.slice(0, -4) + 'e', undouble(w.slice(0, -4))]),
    phones: () => [vowel('ə'), ...unstressed('b'), vowel('ə'), ...unstressed('l')],
  },
  {
    ending: 'ish',
    label: '-ish',
    stems: (w) => uniq([w.slice(0, -3), w.slice(0, -3) + 'e', undouble(w.slice(0, -3))]),
    phones: () => [vowel('ɪ'), ...unstressed('ʃ')],
  },
]

/** The -s rule on its own, for possessives resolved outside the suffix table. */
export function attachS(ipa: string): string {
  const phones = parseIPA(ipa)
  const last = phones[phones.length - 1]
  if (!last) return ipa
  const suffix = SIBILANT.has(last.ipa)
    ? [vowel('ɪ'), ...unstressed('z')]
    : unstressed(VOICELESS.has(last.ipa) ? 's' : 'z')
  return rebuild([...phones, ...suffix])
}

/** Prefixes with stable pronunciations that leave the stem's stress intact. */
const PREFIXES: { prefix: string; phones: Phone[] }[] = [
  { prefix: 'un', phones: [vowel('ʌ', 2), ...unstressed('n')] },
  { prefix: 'non', phones: [...unstressed('n'), vowel('ɑ', 2), ...unstressed('n')] },
  { prefix: 'mis', phones: [...unstressed('m'), vowel('ɪ', 2), ...unstressed('s')] },
  { prefix: 'dis', phones: [...unstressed('d'), vowel('ɪ', 2), ...unstressed('s')] },
  { prefix: 're', phones: [...unstressed('ɹ'), vowel('i', 2)] },
  { prefix: 'pre', phones: [...unstressed('p', 'ɹ'), vowel('i', 2)] },
  { prefix: 'over', phones: [vowel('oʊ', 2), ...unstressed('v'), vowel('ɚ')] },
  { prefix: 'under', phones: [vowel('ʌ', 2), ...unstressed('n', 'd'), vowel('ɚ')] },
  { prefix: 'super', phones: [...unstressed('s'), vowel('u', 2), ...unstressed('p'), vowel('ɚ')] },
  { prefix: 'anti', phones: [vowel('æ', 2), ...unstressed('n', 't'), vowel('aɪ')] },
  { prefix: 'auto', phones: [vowel('ɔ', 2), ...unstressed('t'), vowel('oʊ')] },
  { prefix: 'co', phones: [...unstressed('k'), vowel('oʊ', 2)] },
]

/**
 * Try to build a pronunciation for `word` out of a dictionary entry plus one
 * affix. Returns null when no decomposition lands on a known stem.
 */
export function derive(word: string, lookup: Lookup): Derived | null {
  for (const rule of SUFFIXES) {
    if (!word.endsWith(rule.ending)) continue
    if (word.length <= rule.ending.length + 1) continue

    for (const stem of rule.stems(word)) {
      const entries = lookup(stem)
      if (!entries?.length) continue

      const phones = parseIPA(entries[0])
      const last = phones[phones.length - 1]
      if (!last) continue

      return {
        ipa: rebuild([...phones, ...rule.phones(last.ipa)]),
        via: `${stem} + ${rule.label}`,
      }
    }
  }

  for (const { prefix, phones } of PREFIXES) {
    if (!word.startsWith(prefix)) continue
    const stem = word.slice(prefix.length).replace(/^-/, '')
    if (stem.length < 3) continue

    // The stem may itself need a suffix rule (un + friend + ly).
    const entries = lookup(stem)
    const stemIPA = entries?.[0] ?? derive(stem, lookup)?.ipa
    if (!stemIPA) continue

    // The stem keeps its own first syllable: mis+configured stays mɪs.kən-.
    return {
      ipa: rebuild([...phones, ...parseIPA(stemIPA)], new Set([phones.length])),
      via: `${prefix}- + ${stem}`,
    }
  }

  return null
}
