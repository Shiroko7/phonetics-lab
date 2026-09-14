/**
 * General American connected speech phonology and function-word reduction rules.
 *
 * In natural running speech, grammatical function words (articles, auxiliary verbs,
 * prepositions, conjunctions, pronouns) take weak/reduced forms rather than their
 * citation (isolation) dictionary forms:
 *   - "the" becomes /ði/ before vowel sounds ("the apple"), /ðə/ before consonants ("the book")
 *   - "was" becomes /wəz/ ("wuz") rather than citation /wɑz/ ("wahz")
 *   - "as" becomes /əz/ ("uhz") rather than citation /æz/
 *   - "can" becomes /kən/ ("kun") in connected speech (vital contrast with "can't" /kænt/)
 *   - "an" becomes /ən/ ("un")
 *   - "of" becomes /əv/ ("uv")
 *   - "at" becomes /ət/ ("uht")
 *   - "from" becomes /fɹəm/ ("frum")
 *   - "for" becomes /fɚ/ ("fer")
 *   - "to" becomes /tu/ before vowels, /tə/ before consonants
 */

import { NUCLEI, splitPhones } from './phonology.ts'
import type { AnalyzedToken } from './analyze.ts'

/** Check if an IPA transcription begins with a vowel sound (nucleus). */
export function isVowelOnset(ipa: string): boolean {
  if (!ipa) return false
  // Strip initial stress marks and syllable boundaries
  const stripped = ipa.replace(/^[ˈˌ.]/, '')
  const phones = splitPhones(stripped)
  if (phones.length === 0) return false
  return NUCLEI.has(phones[0])
}

export interface ConnectedSpeechAdjustment {
  ipa: string
  variants: string[]
  connectedNote: string
  spellingNote: string
}

interface RuleContext {
  nextIpa: string | null
  nextWord: string | null
  prevWord: string | null
  isFinal: boolean
}

type RuleHandler = (ctx: RuleContext) => ConnectedSpeechAdjustment | null

const FUNCTION_WORD_RULES: Record<string, RuleHandler> = {
  the: ({ nextIpa, nextWord }) => {
    const vowelNext = nextIpa !== null && isVowelOnset(nextIpa)
    if (vowelNext) {
      return {
        ipa: 'ði',
        variants: ['ði', 'ðə'],
        connectedNote: `Before a vowel sound ("${nextWord}"), "the" is pronounced /ði/ (sounds like "thee"). Both /ði/ and /ðə/ are accepted.`,
        spellingNote: `Spelled "the" with "e", pronounced /ði/ ("thee") before vowel sounds.`,
      }
    }
    return {
      ipa: 'ðə',
      variants: ['ðə', 'ði'],
      connectedNote: nextWord
        ? `Before a consonant sound ("${nextWord}"), "the" is pronounced /ðə/ (sounds like "thuh"). Both /ðə/ and /ði/ are accepted.`
        : `"the" is pronounced /ðə/ (sounds like "thuh").`,
      spellingNote: `Spelled "the", pronounced /ðə/ ("thuh").`,
    }
  },

  was: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'wəz',
        variants: ['wəz', 'wɑz', 'wɔz'],
        connectedNote: `In running speech, Americans reduce "was" to weak /wəz/ (sounds like "wuz") rather than citation /wɑz/ ("wahz"). Both are scored as 100% correct.`,
        spellingNote: `Spelled with "a", but the vowel reduces to schwa /ə/ ("wuz") in connected speech.`,
      }
    }
    return {
      ipa: 'wɑz',
      variants: ['wɑz', 'wəz'],
      connectedNote: `At the end of a sentence or when stressed, "was" keeps its full citation form /wɑz/ ("wahz").`,
      spellingNote: `Spelled "was", pronounced /wɑz/ ("wahz").`,
    }
  },

  as: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'əz',
        variants: ['əz', 'æz'],
        connectedNote: `In running speech, "as" reduces to /əz/ (sounds like "uhz") rather than citation /æz/. Both are accepted.`,
        spellingNote: `Spelled with "a", but sounds like schwa /ə/ ("uhz") in connected speech.`,
      }
    }
    return null
  },

  a: () => ({
    ipa: 'ə',
    variants: ['ə', 'eɪ'],
    connectedNote: `In natural speech, "a" reduces to unstressed schwa /ə/ ("uh") rather than citation /eɪ/ ("ay"). Both are accepted.`,
    spellingNote: `Spelled "a", pronounced as schwa /ə/ ("uh") in speech.`,
  }),

  an: () => ({
    ipa: 'ən',
    variants: ['ən', 'æn'],
    connectedNote: `In natural speech, "an" reduces to unstressed /ən/ ("un") rather than citation /æn/ ("ann"). Both are accepted.`,
    spellingNote: `Spelled "an", pronounced /ən/ ("un") in running speech.`,
  }),

  of: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'əv',
        variants: ['əv', 'ʌv', 'ɑv'],
        connectedNote: `In running speech, "of" reduces to /əv/ (sounds like "uv") rather than citation /ʌv/. Both are accepted.`,
        spellingNote: `Spelled "of" with "o", but pronounced /əv/ ("uv").`,
      }
    }
    return null
  },

  to: ({ nextIpa, nextWord }) => {
    const vowelNext = nextIpa !== null && isVowelOnset(nextIpa)
    if (vowelNext) {
      return {
        ipa: 'tu',
        variants: ['tu', 'tə', 'tʊ'],
        connectedNote: `Before a vowel sound ("${nextWord}"), "to" is pronounced /tu/ (sounds like "too").`,
        spellingNote: `Spelled "to", pronounced /tu/ before vowels.`,
      }
    }
    return {
      ipa: 'tə',
      variants: ['tə', 'tu', 'tʊ'],
      connectedNote: `Before a consonant sound ("${nextWord ?? ''}"), "to" reduces to /tə/ (sounds like "tuh") in natural connected speech.`,
      spellingNote: `Spelled "to" with "o", but reduces to /tə/ ("tuh") before consonants.`,
    }
  },

  at: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'ət',
        variants: ['ət', 'æt'],
        connectedNote: `In running speech, "at" reduces to /ət/ (sounds like "uht") rather than citation /æt/. Both are accepted.`,
        spellingNote: `Spelled with "a", but pronounced /ət/ in running speech.`,
      }
    }
    return null
  },

  from: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'fɹəm',
        variants: ['fɹəm', 'fɹʌm', 'fɹɑm'],
        connectedNote: `In running speech, "from" reduces to /fɹəm/ (sounds like "frum") rather than citation /fɹʌm/. Both are accepted.`,
        spellingNote: `Spelled with "o", but pronounced /fɹəm/ ("frum") in speech.`,
      }
    }
    return null
  },

  for: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'fɚ',
        variants: ['fɚ', 'fɔɹ'],
        connectedNote: `In running speech, "for" reduces to /fɚ/ (sounds like "fer") rather than citation /fɔɹ/. Both are accepted.`,
        spellingNote: `Spelled "for" with "or", but reduces to /fɚ/ ("fer") in speech.`,
      }
    }
    return null
  },

  can: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'kən',
        variants: ['kən', 'kæn'],
        connectedNote: `In American English, modal "can" reduces to /kən/ ("kun") in running speech to distinguish it from "can't" /kænt/. Both /kən/ and /kæn/ are accepted.`,
        spellingNote: `Spelled with "a", but pronounced /kən/ ("kun") in connected speech.`,
      }
    }
    return null
  },

  than: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'ðən',
        variants: ['ðən', 'ðæn'],
        connectedNote: `In running speech, "than" reduces to /ðən/ (sounds like "thun") rather than citation /ðæn/. Both are accepted.`,
        spellingNote: `Spelled with "a", but pronounced /ðən/ in speech.`,
      }
    }
    return null
  },

  that: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'ðət',
        variants: ['ðət', 'ðæt'],
        connectedNote: `When acting as a conjunction or relative pronoun ("he said that..."), "that" reduces to /ðət/ ("thut"). Both are accepted.`,
        spellingNote: `Spelled with "a", but often pronounced /ðət/ in connected speech.`,
      }
    }
    return null
  },

  them: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'ðəm',
        variants: ['ðəm', 'ðɛm'],
        connectedNote: `In running speech, "them" reduces to /ðəm/ (sounds like "thum") rather than citation /ðɛm/. Both are accepted.`,
        spellingNote: `Spelled with "e", but pronounced /ðəm/ in speech.`,
      }
    }
    return null
  },

  us: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'əs',
        variants: ['əs', 'ʌs'],
        connectedNote: `In running speech, "us" reduces to /əs/ (sounds like "uss") rather than citation /ʌs/. Both are accepted.`,
        spellingNote: `Spelled with "u", but pronounced /əs/ in speech.`,
      }
    }
    return null
  },

  and: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'ənd',
        variants: ['ənd', 'ən', 'n', 'ænd'],
        connectedNote: `In running speech, "and" reduces to /ənd/ or /ən/ ("und" / "un") rather than citation /ænd/. Both are accepted.`,
        spellingNote: `Spelled "and", often pronounced /ənd/ or /ən/ in running speech.`,
      }
    }
    return null
  },

  but: ({ isFinal }) => {
    if (!isFinal) {
      return {
        ipa: 'bət',
        variants: ['bət', 'bʌt'],
        connectedNote: `In running speech, "but" reduces to /bət/ ("buht") rather than citation /bʌt/. Both are accepted.`,
        spellingNote: `Spelled with "u", but pronounced /bət/ in speech.`,
      }
    }
    return null
  },
}

/**
 * Applies American English connected-speech adjustments to analyzed tokens.
 * Modifies tokens in-place to carry context-sensitive pronunciations, accepted variants,
 * and connected speech explanations.
 */
export function applyConnectedSpeech(tokens: AnalyzedToken[]): void {
  // Collect indices of word tokens
  const wordIndices: number[] = []
  tokens.forEach((t, i) => {
    if (t.isWord && t.pron) wordIndices.push(i)
  })

  for (let k = 0; k < wordIndices.length; k++) {
    const idx = wordIndices[k]
    const token = tokens[idx]
    if (!token.pron) continue

    const wordLower = token.text.toLowerCase()
    const rule = FUNCTION_WORD_RULES[wordLower]
    if (!rule) continue

    // Find next word token
    const nextIdx = k + 1 < wordIndices.length ? wordIndices[k + 1] : null
    const nextToken = nextIdx !== null ? tokens[nextIdx] : null

    // Check if followed by sentence-ending punctuation or end of clause
    let isFinal = nextToken === null
    if (!isFinal && nextIdx !== null) {
      // Check intermediate tokens for punctuation marks like . ? ! , : ;
      for (let p = idx + 1; p < nextIdx; p++) {
        if (/[.?!,:;—\n]/.test(tokens[p].text)) {
          isFinal = true
          break
        }
      }
    }

    const prevIdx = k > 0 ? wordIndices[k - 1] : null
    const prevToken = prevIdx !== null ? tokens[prevIdx] : null

    const adjustment = rule({
      nextIpa: nextToken?.pron?.ipa ?? null,
      nextWord: nextToken?.text ?? null,
      prevWord: prevToken?.text ?? null,
      isFinal,
    })

    if (adjustment) {
      token.pron = {
        ...token.pron,
        ipa: adjustment.ipa,
        variants: [...new Set([...adjustment.variants, ...token.pron.variants])],
        connectedNote: adjustment.connectedNote,
        spellingNote: adjustment.spellingNote,
      }
    }
  }
}
