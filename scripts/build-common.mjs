/** Filters the separately installed frequency list against our local dictionary. */
const SHORT_WORDS = new Set('am an as at be by do go he if in is it me my no of on or so to up us we'.split(' '))
const NOT_WORDS = new Set(
  `www http https html htm xml php asp aspx cgi jpg jpeg gif png pdf doc url uri
   faq nbsp amp quot gmt utc api sql css js rss usa uk eu ny la dc
   inc ltd llc corp etc vol pp ed eds al ie eg ing
   des dan jan ken jim tom bob joe sam max ben dave mike john mary
   ass sex porn xxx nude`.split(/\s+/),
)

export function buildCommonWords(raw, dictionary) {
  const known = new Set(dictionary.split('\n').map((line) => line.split('\t')[0]))
  const words = [...new Set(raw.split('\n').map((word) => word.trim().toLowerCase()))]
    .filter((word) => /^[a-z]{2,}$/.test(word) && known.has(word) && !NOT_WORDS.has(word)
      && (word.length > 2 || SHORT_WORDS.has(word)))
    .slice(0, 5000)
  if (!words.length) throw new Error('The common-word list contained no usable dictionary words')
  return words.join('\n') + '\n'
}
