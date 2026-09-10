/**
 * The vowel chart, and what each vowel is.
 *
 * The quadrilateral is not decoration: it is a map of the mouth. Left to right
 * is how far forward the tongue sits, top to bottom is how far it drops, and
 * the slanted left edge is there because the jaw closes the space at the front
 * as it opens. Two vowels near each other on the chart are two vowels made in
 * nearly the same place — which is exactly why they are the ones that get
 * confused, and why seeing them plotted explains a substitution that a list of
 * symbols never does.
 *
 * Positions here are the standard cardinal ones for General American, given as
 * two fractions each so the chart can be drawn at any size:
 *
 *   backness  0 = front (the slanted left edge), 1 = back (the right edge)
 *   height    0 = close/high (top), 1 = open/low (bottom)
 *
 * Spellings are the patterns English uses to write the sound. Example words for
 * them are not listed here — they are drawn from the frequency list at runtime
 * and checked against the dictionary, so they are both real and common. `_`
 * stands for one letter, which is how the split digraphs are written: `a_e` is
 * the *a…e* of *make*.
 */

export interface Vowel {
  /** IPA symbol, as the rest of the app writes it. */
  phone: string
  /** 0 front … 1 back. */
  backness: number
  /** 0 close … 1 open. */
  height: number
  /** Wells' lexical set keyword — the word the whole class is named for. */
  keyword: string
  /** What the mouth actually does. */
  how: string
  /** Sounds it is commonly replaced with, nearest confusion first. */
  confusable: string[]
  /** Ways English spells it. */
  spellings: string[]
  /** Anything about the sound that a chart position does not say. */
  note?: string
  /** Which side the symbol is written on, where the default would collide. */
  labelSide?: 'left' | 'right'
}

export interface Diphthong extends Vowel {
  /** Where the glide ends up: the chart draws an arrow to it. */
  toBackness: number
  toHeight: number
}

export const VOWELS: Vowel[] = [
  {
    phone: 'i',
    backness: 0.0,
    height: 0.05,
    keyword: 'fleece',
    how: 'Tongue as high and as far forward as it will go, lips spread. Tense: the muscles hold the position rather than relaxing into it.',
    confusable: ['ɪ'],
    spellings: ['ee', 'ea', 'e', 'y', 'ie', 'ei', 'ey', 'e_e'],
    note: 'Longer and tenser than /ɪ/. The pair *seat*/*sit* is the whole difference, and it is not really about length — /ɪ/ stays lax however long you hold it.',
  },
  {
    phone: 'ɪ',
    backness: 0.22,
    height: 0.2,
    keyword: 'kit',
    how: 'Tongue high and forward but relaxed, and a little lower and further back than /i/. Lips neutral.',
    confusable: ['i', 'ə'],
    spellings: ['i', 'y', 'ui', 'e'],
    note: 'Never lengthens into /i/. In unstressed syllables it reduces towards /ə/ — *rabbit* and *abbot* end alike for many speakers.',
  },
  {
    phone: 'ɛ',
    backness: 0.02,
    height: 0.6,
    keyword: 'dress',
    how: 'Front of the tongue mid-height, jaw a little open, lips neutral.',
    confusable: ['æ', 'eɪ'],
    spellings: ['e', 'ea', 'ai', 'ie', 'a'],
    note: 'Kept apart from /æ/ by jaw opening rather than tongue position: *bed* against *bad*.',
  },
  {
    phone: 'æ',
    backness: 0.05,
    height: 0.86,
    keyword: 'trap',
    how: 'Front of the tongue low, jaw well open, lips spread wide.',
    confusable: ['ɛ', 'ʌ', 'ɑ'],
    spellings: ['a'],
    note: 'Almost always spelled *a*, and absent from most other languages, which is why it so often comes out as /ɛ/ or /ɑ/. Before a nasal it stretches and raises — the *a* of *man* is not the *a* of *mat*.',
  },
  {
    phone: 'ɑ',
    backness: 0.82,
    height: 0.97,
    keyword: 'lot',
    how: 'Tongue low and back, jaw at its most open, lips unrounded.',
    confusable: ['ʌ', 'æ', 'ɔ'],
    spellings: ['o', 'a', 'al', 'ea'],
    note: 'In most of the United States this has merged with /ɔ/, so *cot* and *caught* sound the same. The app treats a swap between them as correct for that reason.',
  },
  {
    phone: 'ɔ',
    backness: 0.98,
    height: 0.44,
    keyword: 'thought',
    how: 'Tongue back and mid-low with the lips rounded — the rounding is what separates it from /ɑ/.',
    confusable: ['ɑ', 'ʌ', 'oʊ'],
    spellings: ['aw', 'au', 'ough', 'augh', 'al', 'o'],
    note: 'Merged with /ɑ/ for most American speakers. Where it survives, in the Northeast and the South, the rounding is the audible part.',
  },
  {
    phone: 'ʊ',
    backness: 0.72,
    height: 0.2,
    keyword: 'foot',
    how: 'Tongue high and back but lax, lips lightly rounded. The jaw barely moves.',
    confusable: ['u', 'ʌ', 'ə'],
    spellings: ['oo', 'u', 'ou', 'o'],
    note: 'The lax partner of /u/: *full* against *fool*. A small class — perhaps a dozen common words carry most of it.',
  },
  {
    phone: 'u',
    backness: 0.95,
    height: 0.05,
    keyword: 'goose',
    how: 'Tongue high and back, lips pushed forward and firmly rounded.',
    confusable: ['ʊ', 'ə'],
    spellings: ['oo', 'u', 'ew', 'ue', 'ou', 'ui', 'o'],
    note: 'American /u/ is fronting: for many speakers the *oo* of *goose* is made much further forward than the chart position suggests, especially after /j/ as in *new*.',
  },
  {
    phone: 'ʌ',
    backness: 0.62,
    height: 0.76,
    keyword: 'strut',
    how: 'Tongue central and low-mid, mouth relaxed and lips neutral. Short and sharp.',
    confusable: ['ɑ', 'ə', 'ɔ'],
    spellings: ['u', 'o', 'ou', 'oo'],
    note: 'The same vowel as /ə/, but stressed. Which symbol a syllable gets is a question about stress, not about the sound — which is why the app counts a swap between them as correct.',
  },
  {
    phone: 'ə',
    backness: 0.45,
    height: 0.48,
    keyword: 'about',
    how: 'Nothing. The tongue rests in the middle of the mouth, the jaw is slack, the lips are neutral — it is the sound of a vowel not being aimed anywhere.',
    confusable: ['ʌ', 'ɪ', 'ɑ'],
    spellings: ['a', 'e', 'o', 'u', 'i', 'ou'],
    note: 'The commonest sound in English, and it is spelled with every vowel letter there is. Unstressed syllables collapse into it: the second syllable of *problem*, the first of *support*. Giving those syllables their full vowel is the single loudest marker of a foreign accent.',
  },
  {
    phone: 'ɝ',
    backness: 0.56,
    height: 0.48,
    keyword: 'nurse',
    how: 'A vowel and an /ɹ/ at the same time: the tongue bunches in the middle of the mouth or curls its tip back, and stays there for the whole vowel.',
    confusable: ['ɚ', 'ə', 'ɔ'],
    spellings: ['er', 'ir', 'ur', 'ear', 'or'],
    note: 'General American is rhotic, so this is one sound rather than a vowel followed by an r. Unstressed it is written /ɚ/ — the ending of *letter* and *doctor* — but the mouth does the same thing.',
  },
]

export const DIPHTHONGS: Diphthong[] = [
  {
    phone: 'eɪ',
    backness: 0.06,
    height: 0.52,
    toBackness: 0.22,
    toHeight: 0.18,
    keyword: 'face',
    how: 'Start at /ɛ/ and glide up and forward towards /ɪ/. The movement is the sound.',
    confusable: ['ɛ'],
    spellings: ['a_e', 'ai', 'ay', 'ei', 'ey', 'ea'],
    note: 'Flattening it into a plain /ɛ/ turns *late* into something close to *let*.',
  },
  {
    phone: 'aɪ',
    backness: 0.28,
    height: 0.95,
    toBackness: 0.24,
    toHeight: 0.18,
    keyword: 'price',
    how: 'Start with the jaw open and the tongue low and central, then climb to /ɪ/.',
    confusable: ['ɑ', 'ɔɪ'],
    spellings: ['i_e', 'y', 'igh', 'ie', 'ei'],
  },
  {
    phone: 'ɔɪ',
    backness: 0.95,
    height: 0.5,
    toBackness: 0.26,
    toHeight: 0.18,
    keyword: 'choice',
    how: 'Start rounded at the back on /ɔ/ and travel all the way forward to /ɪ/, unrounding as you go. The longest journey any English vowel makes.',
    confusable: ['aɪ', 'ɔ'],
    spellings: ['oi', 'oy'],
  },
  {
    phone: 'oʊ',
    backness: 0.86,
    height: 0.42,
    toBackness: 0.74,
    toHeight: 0.18,
    keyword: 'goat',
    how: 'Start mid and back with light rounding, then close the lips further towards /ʊ/.',
    confusable: ['ɔ', 'ʌ'],
    spellings: ['o', 'o_e', 'oa', 'ow', 'ough'],
    note: 'A pure /o/ with no glide — the vowel most other languages have — is one of the clearest accent markers there is.',
  },
  {
    phone: 'aʊ',
    backness: 0.42,
    height: 0.93,
    toBackness: 0.72,
    toHeight: 0.2,
    labelSide: 'right',
    keyword: 'mouth',
    how: 'Start open and central, then move back and round the lips towards /ʊ/.',
    confusable: ['ɑ', 'oʊ'],
    spellings: ['ou', 'ow'],
  },
]

/**
 * The drawing itself, kept with the positions it draws.
 *
 * The shape is a trapezium and not a rectangle because the mouth is one: as the
 * jaw drops, the range of places the tongue can reach at the front narrows, so
 * the front edge leans inwards. Which is why /i/ and /u/ sit far apart at the
 * top and /ɑ/ has almost nowhere left to go at the bottom.
 */
export const CHART = {
  width: 320,
  height: 200,
  /** How far the front edge has leaned in by the time the jaw is fully open. */
  lean: 0.3,
  pad: { left: 34, right: 86, top: 26, bottom: 24 },
}

/** Where a vowel goes. The front edge is a slope, so backness is measured from
 *  wherever that slope has got to at this height. */
export function place(backness: number, height: number): { x: number; y: number } {
  const left = CHART.lean * CHART.width * height
  return {
    x: CHART.pad.left + left + backness * (CHART.width - left),
    y: CHART.pad.top + height * CHART.height,
  }
}
