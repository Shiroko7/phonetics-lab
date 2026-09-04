/** Reference data for every IPA symbol the app can produce. */

export type PhoneKind = 'vowel' | 'diphthong' | 'r-coloured' | 'consonant'

export interface PhoneInfo {
  /** Articulatory description. */
  name: string
  /** A common word containing the sound, with the relevant letters marked. */
  example: string
  kind: PhoneKind
}

export const PHONES: Record<string, PhoneInfo> = {
  // Monophthongs
  'i': { name: 'close front unrounded', example: 'fleece', kind: 'vowel' },
  'ɪ': { name: 'near-close front', example: 'kit', kind: 'vowel' },
  'ɛ': { name: 'open-mid front', example: 'dress', kind: 'vowel' },
  'æ': { name: 'near-open front', example: 'trap', kind: 'vowel' },
  'ɑ': { name: 'open back unrounded', example: 'lot, father', kind: 'vowel' },
  'ɔ': { name: 'open-mid back rounded', example: 'thought', kind: 'vowel' },
  'ʊ': { name: 'near-close back rounded', example: 'foot', kind: 'vowel' },
  'u': { name: 'close back rounded', example: 'goose', kind: 'vowel' },
  'ʌ': { name: 'open-mid back, stressed', example: 'strut', kind: 'vowel' },
  'ə': { name: 'schwa, unstressed', example: 'about, sofa', kind: 'vowel' },

  // Diphthongs
  'eɪ': { name: 'diphthong', example: 'face', kind: 'diphthong' },
  'aɪ': { name: 'diphthong', example: 'price', kind: 'diphthong' },
  'ɔɪ': { name: 'diphthong', example: 'choice', kind: 'diphthong' },
  'oʊ': { name: 'diphthong', example: 'goat', kind: 'diphthong' },
  'aʊ': { name: 'diphthong', example: 'mouth', kind: 'diphthong' },

  // R-coloured
  'ɝ': { name: 'r-coloured, stressed', example: 'nurse, bird', kind: 'r-coloured' },
  'ɚ': { name: 'r-coloured schwa', example: 'letter, doctor', kind: 'r-coloured' },

  // Consonants
  'p': { name: 'voiceless bilabial stop', example: 'pen', kind: 'consonant' },
  'b': { name: 'voiced bilabial stop', example: 'bed', kind: 'consonant' },
  't': { name: 'voiceless alveolar stop', example: 'ten', kind: 'consonant' },
  'd': { name: 'voiced alveolar stop', example: 'day', kind: 'consonant' },
  'k': { name: 'voiceless velar stop', example: 'cat', kind: 'consonant' },
  'ɡ': { name: 'voiced velar stop', example: 'go', kind: 'consonant' },
  'tʃ': { name: 'voiceless affricate', example: 'church', kind: 'consonant' },
  'dʒ': { name: 'voiced affricate', example: 'judge', kind: 'consonant' },
  'f': { name: 'voiceless labiodental fricative', example: 'five', kind: 'consonant' },
  'v': { name: 'voiced labiodental fricative', example: 'voice', kind: 'consonant' },
  'θ': { name: 'voiceless dental fricative', example: 'think', kind: 'consonant' },
  'ð': { name: 'voiced dental fricative', example: 'this', kind: 'consonant' },
  's': { name: 'voiceless alveolar fricative', example: 'see', kind: 'consonant' },
  'z': { name: 'voiced alveolar fricative', example: 'zoo', kind: 'consonant' },
  'ʃ': { name: 'voiceless postalveolar fricative', example: 'she', kind: 'consonant' },
  'ʒ': { name: 'voiced postalveolar fricative', example: 'vision', kind: 'consonant' },
  'h': { name: 'voiceless glottal fricative', example: 'how', kind: 'consonant' },
  'm': { name: 'bilabial nasal', example: 'man', kind: 'consonant' },
  'n': { name: 'alveolar nasal', example: 'no', kind: 'consonant' },
  'ŋ': { name: 'velar nasal', example: 'sing', kind: 'consonant' },
  'l': { name: 'alveolar lateral', example: 'leg', kind: 'consonant' },
  'ɹ': { name: 'alveolar approximant', example: 'red', kind: 'consonant' },
  'w': { name: 'labial-velar approximant', example: 'wet', kind: 'consonant' },
  'j': { name: 'palatal approximant', example: 'yes', kind: 'consonant' },
  'ɾ': { name: 'alveolar tap (flapped t/d)', example: 'water, ladder', kind: 'consonant' },
  'ʔ': { name: 'glottal stop', example: 'uh-oh', kind: 'consonant' },
}

export const MARK_INFO: Record<string, string> = {
  'ˈ': 'primary stress — the loudest syllable',
  'ˌ': 'secondary stress',
  '.': 'syllable break',
}
