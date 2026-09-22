import { alignPhones, expectedPhones, GAP_PENALTY, pronunciationDistance, type AlignedPhone, type Heard } from './align.ts'
import type { TargetWord } from './report.ts'

/**
 * Keep alternatives as complete ordered paths. Until the response schema can
 * represent optional/many-to-one slots, only equal-length alternatives are
 * scored. Never turn a variable-length pronunciation into a bag of phones.
 */
export function wordPronunciations(word: TargetWord): string[][] {
  const paths = [word.phones, ...(word.variants ?? []).map(expectedPhones)]
  return [...new Map(paths.filter((p) => p.length === word.phones.length && p.length > 0)
    .map((p) => [p.join(' '), p])).values()]
}

/** Global edit alignment through complete word pronunciation alternatives. */
export function alignWordVariants(words: TargetWord[], actual: Heard[]): AlignedPhone[] {
  if (!words.length) return alignPhones([], actual)
  const n = actual.length
  let previous = Float64Array.from({ length: n + 1 }, (_, j) => j * GAP_PENALTY)
  const choices: { start: Int32Array; variant: Int32Array; paths: string[][] }[] = []

  for (const word of words) {
    const paths = wordPronunciations(word)
    const best = new Float64Array(n + 1).fill(Infinity)
    const chosenStart = new Int32Array(n + 1)
    const chosenVariant = new Int32Array(n + 1)
    paths.forEach((path, variant) => {
      let row = previous.slice()
      let starts = Int32Array.from({ length: n + 1 }, (_, j) => j)
      for (const expected of path) {
        const next = new Float64Array(n + 1)
        const nextStarts = new Int32Array(n + 1)
        next[0] = row[0] + GAP_PENALTY
        nextStarts[0] = starts[0]
        for (let j = 1; j <= n; j++) {
          const diagonal = row[j - 1] + pronunciationDistance(expected, actual[j - 1].phone)
          const deletion = row[j] + GAP_PENALTY
          const insertion = next[j - 1] + GAP_PENALTY
          next[j] = Math.min(diagonal, deletion, insertion)
          nextStarts[j] = next[j] === diagonal ? starts[j - 1] : next[j] === deletion ? starts[j] : nextStarts[j - 1]
        }
        row = next
        starts = nextStarts
      }
      for (let j = 0; j <= n; j++) {
        if (row[j] < best[j]) {
          best[j] = row[j]
          chosenStart[j] = starts[j]
          chosenVariant[j] = variant
        }
      }
    })
    choices.push({ start: chosenStart, variant: chosenVariant, paths })
    previous = best
  }

  const parts: AlignedPhone[][] = []
  let end = n
  let offset = words.reduce((sum, word) => sum + word.phones.length, 0)
  for (let w = words.length - 1; w >= 0; w--) {
    offset -= words[w].phones.length
    const choice = choices[w]
    const start = choice.start[end]
    const path = choice.paths[choice.variant[end]]
    parts.unshift(alignPhones(path, actual.slice(start, end)).map((step) => ({
      ...step,
      expected: step.expectedIndex === null ? null : words[w].phones[step.expectedIndex],
      expectedIndex: step.expectedIndex === null ? null : offset + step.expectedIndex,
    })))
    end = start
  }
  return [...alignPhones([], actual.slice(0, end)), ...parts.flat()]
}
