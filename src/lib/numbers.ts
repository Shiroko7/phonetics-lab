/**
 * Numerals to English words, so "1,250" and "3rd" can be looked up like any
 * other word rather than showing up as gaps in the transcription.
 */

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
  'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
  'sixteen', 'seventeen', 'eighteen', 'nineteen',
]
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety',
]
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion', 'quadrillion']

const ORDINALS: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth',
  eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
}

function underThousand(n: number): string[] {
  const words: string[] = []
  if (n >= 100) {
    words.push(ONES[Math.floor(n / 100)], 'hundred')
    n %= 100
  }
  if (n >= 20) {
    words.push(TENS[Math.floor(n / 10)])
    n %= 10
    if (n) words.push(ONES[n])
  } else if (n > 0) {
    words.push(ONES[n])
  }
  return words
}

function cardinal(n: number): string[] {
  if (n === 0) return ['zero']
  const groups: number[] = []
  while (n > 0) {
    groups.push(n % 1000)
    n = Math.floor(n / 1000)
  }
  const words: string[] = []
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue
    words.push(...underThousand(groups[i]))
    if (i > 0 && SCALES[i]) words.push(SCALES[i])
  }
  return words
}

/** Turn the last word of a cardinal into its ordinal form. */
function toOrdinal(words: string[]): string[] {
  if (words.length === 0) return words
  const last = words[words.length - 1]
  const head = words.slice(0, -1)
  if (ORDINALS[last]) return [...head, ORDINALS[last]]
  if (last.endsWith('y')) return [...head, last.slice(0, -1) + 'ieth']
  return [...head, last + 'th']
}

/**
 * Expand a numeric token into the words it is read as, or null if the token is
 * not a number this handles. Digits after a decimal point are read one by one.
 */
export function numberToWords(token: string): string[] | null {
  const clean = token.replace(/,/g, '')

  const ordinal = /^(\d+)(?:st|nd|rd|th)$/i.exec(clean)
  if (ordinal) {
    const n = Number(ordinal[1])
    return Number.isSafeInteger(n) ? toOrdinal(cardinal(n)) : null
  }

  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(clean)
  if (!m) return null

  const [, negative, intPart, decimals] = m
  const n = Number(intPart)
  if (!Number.isSafeInteger(n)) return null

  const words: string[] = []
  if (negative) words.push('minus')
  words.push(...cardinal(n))
  if (decimals) {
    words.push('point')
    for (const digit of decimals) words.push(ONES[Number(digit)])
  }
  return words
}
