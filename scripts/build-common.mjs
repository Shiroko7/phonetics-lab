/**
 * Builds the common-word list used to suggest practice words.
 *
 * The pronunciation dictionary is CMUdict, which is alphabetical and full of
 * names, abbreviations and archaisms — "thole" is as available as "think". A
 * drill is only useful if the word is one the learner will actually meet, so
 * the suggestions are drawn from a frequency-ordered list instead, intersected
 * with the words we can transcribe.
 *
 * Source: google-10000-english (word frequencies from the Google Trillion Word
 * Corpus), US spellings.
 *
 * Output: one word per line, most frequent first.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_URL =
  'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa.txt'
const DICT = join(ROOT, 'public', 'dict', 'cmudict-ipa.txt')
const OUT = join(ROOT, 'public', 'dict', 'common-words.txt')

/** Enough to find a minimal pair for almost any contrast, small enough to fetch. */
const KEEP = 5000

const dictWords = new Set(
  (await readFile(DICT, 'utf8')).split('\n').map((line) => line.slice(0, line.indexOf('\t'))),
)
console.log(`dictionary: ${dictWords.size} words`)

const res = await fetch(SOURCE_URL)
if (!res.ok) throw new Error(`could not fetch the frequency list (${res.status})`)

/**
 * The frequency list is scraped from the open web, so alongside real words it
 * carries file extensions, markup entities, abbreviations and given names. All
 * of them are pronounceable and all of them make poor drills: nobody needs to
 * practise the vowel in "jpg". Two-letter entries are the worst offenders, so
 * those are admitted only from a list of the ones that are genuinely words.
 */
const SHORT_WORDS = new Set(
  'am an as at be by do go he if in is it me my no of on or so to up us we'.split(' '),
)
const NOT_WORDS = new Set(
  `www http https html htm xml php asp aspx cgi jpg jpeg gif png pdf doc url uri
   faq nbsp amp quot gmt utc api sql css js rss usa uk eu ny la dc
   inc ltd llc corp etc vol pp ed eds al ie eg ing
   des dan jan ken jim tom bob joe sam max ben dave mike john mary
   ass sex porn xxx nude`.split(/\s+/),
)

const words = (await res.text())
  .split('\n')
  .map((w) => w.trim().toLowerCase())
  .filter(
    (w) =>
      /^[a-z]{2,}$/.test(w) &&
      dictWords.has(w) &&
      !NOT_WORDS.has(w) &&
      (w.length > 2 || SHORT_WORDS.has(w)),
  )
  .slice(0, KEEP)

await writeFile(OUT, words.join('\n') + '\n', 'utf8')
console.log(`wrote ${words.length} words to ${OUT}`)
