/**
 * Best-effort grapheme-to-phoneme rules for words no dictionary entry or
 * morphological decomposition can reach — invented words, surnames, brand names.
 *
 * These are ordered context-sensitive rewrite rules in the classic letter-to-sound
 * style: the first rule whose spelling and context both match at the cursor wins.
 * Output is always marked as guessed in the UI, because it frequently is.
 */

import { NUCLEI, type Phone, rebuild } from './phonology.ts'

interface Rule {
  /** Letters consumed at the cursor. */
  focus: string
  /** Must match the text already consumed (anchored at its end). */
  left?: RegExp
  /** Must match the text after the focus (anchored at its start). */
  right?: RegExp
  /** IPA phones produced; empty for silent letters. */
  out: string[]
}

const C = '[bcdfghjklmnpqrstvwxz]'
const V = '[aeiouy]'

/** Rules are scanned in order, so longer and more specific spellings come first. */
const RULES: Rule[] = [
  // --- suffix chunks that carry their own pronunciation -------------------
  { focus: 'tion', out: ['ʃ', 'ə', 'n'] },
  { focus: 'sion', left: new RegExp(`${V}$`), out: ['ʒ', 'ə', 'n'] },
  { focus: 'sion', out: ['ʃ', 'ə', 'n'] },
  { focus: 'cious', out: ['ʃ', 'ə', 's'] },
  { focus: 'tious', out: ['ʃ', 'ə', 's'] },
  { focus: 'ture', right: /^$/, out: ['tʃ', 'ɚ'] },
  { focus: 'sure', right: /^$/, out: ['ʒ', 'ɚ'] },
  { focus: 'ough', right: /^t/, out: ['ɔ'] },
  { focus: 'ough', out: ['ʌ', 'f'] },
  { focus: 'augh', out: ['æ', 'f'] },
  { focus: 'eigh', out: ['eɪ'] },
  { focus: 'igh', out: ['aɪ'] },

  // --- consonant digraphs -------------------------------------------------
  { focus: 'tch', out: ['tʃ'] },
  { focus: 'dge', out: ['dʒ'] },
  { focus: 'sch', right: new RegExp(`^${V}`), out: ['s', 'k'] },
  { focus: 'ch', out: ['tʃ'] },
  { focus: 'sh', out: ['ʃ'] },
  { focus: 'ph', out: ['f'] },
  { focus: 'th', out: ['θ'] },
  { focus: 'wh', out: ['w'] },
  { focus: 'ck', out: ['k'] },
  { focus: 'qu', out: ['k', 'w'] },
  { focus: 'gh', left: /^$/, out: ['ɡ'] },
  { focus: 'gh', out: [] },
  { focus: 'kn', left: /^$/, out: ['n'] },
  { focus: 'wr', left: /^$/, out: ['ɹ'] },
  { focus: 'gn', left: /^$/, out: ['n'] },
  { focus: 'gn', right: /^$/, out: ['n'] },
  { focus: 'ps', left: /^$/, out: ['s'] },
  { focus: 'mb', right: /^$/, out: ['m'] },
  { focus: 'mn', right: /^$/, out: ['m'] },
  { focus: 'ng', right: /^$/, out: ['ŋ'] },
  { focus: 'nk', out: ['ŋ', 'k'] },
  { focus: 'nc', right: /^[eiy]/, out: ['n', 's'] },

  // --- r-coloured vowels (checked before the plain vowels) ----------------
  { focus: 'air', out: ['ɛ', 'ɹ'] },
  { focus: 'are', right: /^$/, out: ['ɛ', 'ɹ'] },
  { focus: 'ear', right: /^$/, out: ['ɪ', 'ɹ'] },
  { focus: 'eer', out: ['ɪ', 'ɹ'] },
  { focus: 'ore', out: ['ɔ', 'ɹ'] },
  { focus: 'oor', out: ['ʊ', 'ɹ'] },
  { focus: 'our', out: ['aʊ', 'ɹ'] },
  { focus: 'ar', out: ['ɑ', 'ɹ'] },
  { focus: 'or', out: ['ɔ', 'ɹ'] },
  { focus: 'er', right: /^$/, out: ['ɚ'] },
  { focus: 'er', out: ['ɝ'] },
  { focus: 'ir', out: ['ɝ'] },
  { focus: 'ur', out: ['ɝ'] },
  { focus: 'yr', out: ['ɝ'] },

  // --- vowel digraphs -----------------------------------------------------
  { focus: 'ee', out: ['i'] },
  { focus: 'ea', out: ['i'] },
  { focus: 'ie', right: /^$/, out: ['i'] },
  { focus: 'ie', out: ['aɪ'] },
  { focus: 'oo', out: ['u'] },
  { focus: 'oa', out: ['oʊ'] },
  { focus: 'oe', out: ['oʊ'] },
  { focus: 'ou', out: ['aʊ'] },
  { focus: 'ow', right: /^$/, out: ['oʊ'] },
  { focus: 'ow', out: ['aʊ'] },
  { focus: 'oi', out: ['ɔɪ'] },
  { focus: 'oy', out: ['ɔɪ'] },
  { focus: 'au', out: ['ɔ'] },
  { focus: 'aw', out: ['ɔ'] },
  { focus: 'ai', out: ['eɪ'] },
  { focus: 'ay', out: ['eɪ'] },
  { focus: 'ei', out: ['eɪ'] },
  { focus: 'ey', out: ['eɪ'] },
  { focus: 'ue', out: ['u'] },
  { focus: 'ui', out: ['u'] },
  { focus: 'eu', out: ['u'] },
  { focus: 'ew', out: ['u'] },

  // --- single vowels: long before a final silent e, otherwise short -------
  { focus: 'a', right: new RegExp(`^${C}e$`), out: ['eɪ'] },
  { focus: 'i', right: new RegExp(`^${C}e$`), out: ['aɪ'] },
  { focus: 'o', right: new RegExp(`^${C}e$`), out: ['oʊ'] },
  { focus: 'u', right: new RegExp(`^${C}e$`), out: ['u'] },
  { focus: 'e', right: new RegExp(`^${C}e$`), out: ['i'] },
  { focus: 'e', right: /^$/, left: new RegExp(`${C}`), out: [] },
  { focus: 'a', out: ['æ'] },
  { focus: 'e', out: ['ɛ'] },
  { focus: 'i', out: ['ɪ'] },
  { focus: 'o', out: ['ɑ'] },
  { focus: 'u', out: ['ʌ'] },
  { focus: 'y', left: /^$/, out: ['j'] },
  { focus: 'y', right: /^$/, out: ['i'] },
  { focus: 'y', out: ['ɪ'] },

  // --- single consonants, soft variants first -----------------------------
  { focus: 'c', right: /^[eiy]/, out: ['s'] },
  { focus: 'c', out: ['k'] },
  { focus: 'g', right: /^[eiy]/, out: ['dʒ'] },
  { focus: 'g', out: ['ɡ'] },
  { focus: 's', left: new RegExp(`${V}$`), right: new RegExp(`^${V}`), out: ['z'] },
  { focus: 's', out: ['s'] },
  { focus: 'x', out: ['k', 's'] },
  { focus: 'j', out: ['dʒ'] },
  { focus: 'b', out: ['b'] },
  { focus: 'd', out: ['d'] },
  { focus: 'f', out: ['f'] },
  { focus: 'h', out: ['h'] },
  { focus: 'k', out: ['k'] },
  { focus: 'l', out: ['l'] },
  { focus: 'm', out: ['m'] },
  { focus: 'n', out: ['n'] },
  { focus: 'p', out: ['p'] },
  { focus: 'r', out: ['ɹ'] },
  { focus: 't', out: ['t'] },
  { focus: 'v', out: ['v'] },
  { focus: 'w', out: ['w'] },
  { focus: 'z', out: ['z'] },
]

/** Suffixes that pull primary stress onto the syllable immediately before them. */
const PRE_STRESSED = ['tion', 'sion', 'ical', 'ity', 'ify', 'ular', 'ial', 'ious', 'ic']

function letterToPhones(word: string): string[] {
  const phones: string[] = []
  let i = 0

  while (i < word.length) {
    const before = word.slice(0, i)
    let matched = false

    for (const rule of RULES) {
      if (!word.startsWith(rule.focus, i)) continue
      const after = word.slice(i + rule.focus.length)
      if (rule.left && !rule.left.test(before)) continue
      if (rule.right && !rule.right.test(after)) continue

      phones.push(...rule.out)
      i += rule.focus.length
      matched = true
      break
    }

    // Apostrophes, digits and anything else the rules do not cover.
    if (!matched) i += 1
  }

  return phones
}

/**
 * Place primary stress. English default is the first syllable, but a handful of
 * suffixes reliably drag it onto the syllable before them (photo -> photoGRAPHic).
 */
function stressIndex(word: string, nucleiCount: number): number {
  if (nucleiCount <= 1) return 0
  for (const suffix of PRE_STRESSED) {
    if (!word.endsWith(suffix)) continue
    // Count how many syllables the suffix itself contributes, then step back one.
    const suffixNuclei = letterToPhones(suffix).filter((p) => NUCLEI.has(p)).length
    const index = nucleiCount - suffixNuclei - 1
    if (index >= 0) return index
  }
  return 0
}

/** Guess a pronunciation from spelling alone. */
export function guess(word: string): string | null {
  const letters = word.toLowerCase().replace(/[^a-z']/g, '')
  if (!letters) return null

  const raw = letterToPhones(letters)
  if (raw.length === 0) return null

  const nucleiCount = raw.filter((p) => NUCLEI.has(p)).length
  const target = stressIndex(letters, nucleiCount)

  let seen = -1
  const phones: Phone[] = raw.map((ipa) => {
    if (!NUCLEI.has(ipa)) return { ipa, stress: null }
    seen += 1
    if (seen === target) return { ipa, stress: 1 }
    // Unstressed /ʌ/ is realised as schwa; other qualities are left alone so
    // that guessed names do not collapse into a row of identical vowels.
    return { ipa: ipa === 'ʌ' ? 'ə' : ipa, stress: 0 }
  })

  // A word with no vowel at all cannot be syllabified into anything sensible.
  if (nucleiCount === 0) return null

  return rebuild(phones)
}
