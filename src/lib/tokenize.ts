/**
 * Splits pasted text into words and the whitespace/punctuation between them,
 * keeping every character so the original passage can be re-rendered exactly.
 */

export interface Token {
  text: string
  isWord: boolean
}

// Numbers come first so that "1,250" and "2.5" survive as single tokens; the
// separator must sit between digits, leaving a sentence-final "in 1990." alone.
// A word may then carry internal apostrophes or hyphens but never trailing ones:
// "don't" and "well-known" are single words, "ready—" is a word plus a dash.
const WORD = /\d+(?:[.,]\d+)*(?:st|nd|rd|th)?|[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/giu

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let cursor = 0

  for (const match of text.matchAll(WORD)) {
    const start = match.index
    if (start > cursor) tokens.push({ text: text.slice(cursor, start), isWord: false })
    tokens.push({ text: match[0], isWord: true })
    cursor = start + match[0].length
  }

  if (cursor < text.length) tokens.push({ text: text.slice(cursor), isWord: false })
  return tokens
}
