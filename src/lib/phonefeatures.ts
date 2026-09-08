/**
 * Articulatory features for every phone in the General American inventory.
 *
 * Pronunciation feedback needs more than "right or wrong": saying /s/ for /θ/ is
 * a near miss (same place-ish, same manner, same voicing) while saying /ɡ/ for
 * /θ/ is a different sound entirely. Scoring substitutions by how many features
 * differ lets the UI say "close" where it is genuinely close.
 */

export type Manner = 'stop' | 'fricative' | 'affricate' | 'nasal' | 'lateral' | 'approximant' | 'tap'
export type Place =
  | 'bilabial' | 'labiodental' | 'dental' | 'alveolar'
  | 'postalveolar' | 'palatal' | 'velar' | 'glottal'

interface Consonant {
  type: 'consonant'
  place: Place
  manner: Manner
  voiced: boolean
}

interface Vowel {
  type: 'vowel'
  /** 1 = close (i) … 4 = open (ɑ). */
  height: number
  /** 1 = front … 3 = back. */
  back: number
  rounded: boolean
  /** Tense/long vowels versus lax/short ones. */
  tense: boolean
  rhotic: boolean
  /** Diphthongs glide towards a second target. */
  offglide?: 'ɪ' | 'ʊ'
}

export type Features = Consonant | Vowel

const PLACES: Place[] = [
  'bilabial', 'labiodental', 'dental', 'alveolar',
  'postalveolar', 'palatal', 'velar', 'glottal',
]

/** Manners ordered by aperture, so neighbouring rows are genuinely similar. */
const MANNERS: Manner[] = ['stop', 'affricate', 'fricative', 'tap', 'nasal', 'lateral', 'approximant']

const c = (place: Place, manner: Manner, voiced: boolean): Consonant => ({
  type: 'consonant', place, manner, voiced,
})
const v = (
  height: number, back: number, rounded: boolean, tense: boolean,
  extra: { rhotic?: boolean; offglide?: 'ɪ' | 'ʊ' } = {},
): Vowel => ({
  type: 'vowel', height, back, rounded, tense, rhotic: extra.rhotic ?? false, offglide: extra.offglide,
})

export const FEATURES: Record<string, Features> = {
  // Stops
  p: c('bilabial', 'stop', false),
  b: c('bilabial', 'stop', true),
  t: c('alveolar', 'stop', false),
  d: c('alveolar', 'stop', true),
  k: c('velar', 'stop', false),
  'ɡ': c('velar', 'stop', true),
  'ʔ': c('glottal', 'stop', false),
  'ɾ': c('alveolar', 'tap', true),

  // Affricates
  'tʃ': c('postalveolar', 'affricate', false),
  'dʒ': c('postalveolar', 'affricate', true),

  // Fricatives
  f: c('labiodental', 'fricative', false),
  v: c('labiodental', 'fricative', true),
  'θ': c('dental', 'fricative', false),
  'ð': c('dental', 'fricative', true),
  s: c('alveolar', 'fricative', false),
  z: c('alveolar', 'fricative', true),
  'ʃ': c('postalveolar', 'fricative', false),
  'ʒ': c('postalveolar', 'fricative', true),
  h: c('glottal', 'fricative', false),

  // Sonorants
  m: c('bilabial', 'nasal', true),
  n: c('alveolar', 'nasal', true),
  'ŋ': c('velar', 'nasal', true),
  l: c('alveolar', 'lateral', true),
  'ɹ': c('postalveolar', 'approximant', true),
  j: c('palatal', 'approximant', true),
  w: c('velar', 'approximant', true),

  // Monophthongs
  i: v(1, 1, false, true),
  'ɪ': v(2, 1, false, false),
  'ɛ': v(3, 1, false, false),
  'æ': v(4, 1, false, false),
  'ə': v(2.5, 2, false, false),
  'ʌ': v(3, 2, false, false),
  'ɑ': v(4, 3, false, true),
  'ɔ': v(3, 3, true, true),
  'ʊ': v(2, 3, true, false),
  u: v(1, 3, true, true),

  // R-coloured
  'ɝ': v(2.5, 2, false, true, { rhotic: true }),
  'ɚ': v(2.5, 2, false, false, { rhotic: true }),

  // Diphthongs
  'eɪ': v(2, 1, false, true, { offglide: 'ɪ' }),
  'aɪ': v(4, 2, false, true, { offglide: 'ɪ' }),
  'ɔɪ': v(3, 3, true, true, { offglide: 'ɪ' }),
  'oʊ': v(2, 3, true, true, { offglide: 'ʊ' }),
  'aʊ': v(4, 2, false, true, { offglide: 'ʊ' }),
}

/**
 * Distance between two phones, 0 (identical) to 1 (unrelated).
 *
 * Vowels and consonants are always maximally far apart; within a class the
 * score is a weighted count of differing articulatory features.
 */
export function phoneDistance(a: string, b: string): number {
  if (a === b) return 0

  const fa = FEATURES[a]
  const fb = FEATURES[b]
  if (!fa || !fb) return 1
  if (fa.type !== fb.type) return 1

  if (fa.type === 'consonant' && fb.type === 'consonant') {
    const place = Math.abs(PLACES.indexOf(fa.place) - PLACES.indexOf(fb.place)) / (PLACES.length - 1)
    const manner =
      Math.abs(MANNERS.indexOf(fa.manner) - MANNERS.indexOf(fb.manner)) / (MANNERS.length - 1)
    const voice = fa.voiced === fb.voiced ? 0 : 1
    // Manner carries the most perceptual weight, then place, then voicing.
    return clamp(0.45 * manner + 0.35 * place + 0.2 * voice)
  }

  const va = fa as Vowel
  const vb = fb as Vowel
  const height = Math.abs(va.height - vb.height) / 3
  const back = Math.abs(va.back - vb.back) / 2
  const round = va.rounded === vb.rounded ? 0 : 1
  const tense = va.tense === vb.tense ? 0 : 1
  const rhotic = va.rhotic === vb.rhotic ? 0 : 1
  const glide = va.offglide === vb.offglide ? 0 : 1

  return clamp(
    0.3 * height + 0.22 * back + 0.12 * round + 0.1 * tense + 0.16 * rhotic + 0.1 * glide,
  )
}

function clamp(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** Plain-language description of what changed, for the feedback line. */
export function describeSubstitution(expected: string, actual: string): string {
  const fe = FEATURES[expected]
  const fa = FEATURES[actual]
  if (!fe || !fa) return `said /${actual}/ instead of /${expected}/`
  if (fe.type !== fa.type) {
    return fe.type === 'vowel' ? 'replaced a vowel with a consonant' : 'replaced a consonant with a vowel'
  }

  if (fe.type === 'consonant' && fa.type === 'consonant') {
    if (fe.place === fa.place && fe.manner === fa.manner) {
      return fe.voiced ? 'devoiced it' : 'voiced it'
    }
    if (fe.manner === fa.manner) return `moved from ${fe.place} to ${fa.place}`
    if (fe.place === fa.place) return `${fa.manner} instead of ${fe.manner}`
    return `${fa.manner} at ${fa.place}, not ${fe.manner} at ${fe.place}`
  }

  const ve = fe as Vowel
  const va2 = fa as Vowel
  if (ve.rhotic !== va2.rhotic) return ve.rhotic ? 'lost the r-colouring' : 'added r-colouring'
  if (ve.offglide !== va2.offglide) return ve.offglide ? 'flattened the diphthong' : 'added a glide'
  if (Math.abs(ve.height - va2.height) >= Math.abs(ve.back - va2.back)) {
    return va2.height < ve.height ? 'tongue too high' : 'tongue too low'
  }
  return va2.back > ve.back ? 'tongue too far back' : 'tongue too far forward'
}
