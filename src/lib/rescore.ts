/**
 * Re-scoring attempts that were graded before the scoring service existed.
 *
 * The browser scorer and the service are not on the same scale. One counts
 * verdicts off a free decode, the other averages per-phone goodness-of-
 * pronunciation from a forced alignment, and the same recording can land
 * several points apart under the two. That matters more than it sounds: the
 * history panel draws trends across attempts, and a line that appears to have
 * improved from 68 to 96 may only have changed scorer halfway through.
 *
 * So old attempts are brought forward rather than left to be averaged in. The
 * audio is still there — `pruneClips` only drops a clip when its attempt is
 * gone — so this reads each take back out of IndexedDB, decodes it to the same
 * samples the original analysis saw, and asks the service the better question.
 * Nothing is re-recorded.
 *
 * This runs itself, once, when the app opens with the service available. A
 * score is derived from a recording and the recordings are untouched, so
 * improving the derivation is a migration rather than a decision to put to
 * anyone. `SCORER_REVISION` is what drives it: raise that and every attempt
 * below it comes back through here on the next load. `rescoreOne` is exported
 * for the narrower case of redoing a single attempt on demand.
 *
 * An attempt whose audio did not survive keeps its old score and stays tagged
 * as the browser's, which is the honest outcome: it cannot be brought onto the
 * new scale, and pretending otherwise would put a number next to it that no
 * scorer ever produced.
 */

import { analyze as analyzeRemote } from './backend.ts'
import { scoreAlignment } from './align.ts'
import { getClip } from './clips.ts'
import type { Dictionary } from './dict.ts'
import { decodeToMono16k } from './recorder.ts'
import { flatten, targetWords } from './report.ts'
import { isCurrent, SCORER_REVISION, type Attempt } from './practice.ts'

/** Why one attempt could not be brought onto the new scale. */
export interface Skipped {
  at: number
  target: string
  reason: string
}

export interface RescoreResult {
  /** Every attempt, in the original order; the ones that could be are updated. */
  attempts: Attempt[]
  rescored: number
  skipped: Skipped[]
}

/** How many of these are not on the current scale, audio permitting. */
export function pending(attempts: Attempt[]): number {
  return attempts.filter((attempt) => !isCurrent(attempt)).length
}

/**
 * Re-score every attempt that is not already on the new scale.
 *
 * Sequential on purpose. There is one GPU behind the service, so overlapping
 * requests would queue there instead of here, and going one at a time is what
 * lets the count on screen mean something.
 */
export async function rescoreAll(
  attempts: Attempt[],
  dict: Dictionary,
  onProgress?: (done: number, total: number) => void,
): Promise<RescoreResult> {
  const todo = attempts
    .map((attempt, index) => ({ attempt, index }))
    .filter(({ attempt }) => !isCurrent(attempt))

  const next = [...attempts]
  const skipped: Skipped[] = []
  let rescored = 0
  let done = 0

  for (const { attempt, index } of todo) {
    try {
      const updated = await rescoreOne(attempt, dict)
      next[index] = updated
      rescored += 1
    } catch (err) {
      skipped.push({
        at: attempt.at,
        target: attempt.target,
        reason: (err as Error).message,
      })
    }
    done += 1
    onProgress?.(done, todo.length)
  }

  return { attempts: next, rescored, skipped }
}

/** One attempt, re-scored from its stored audio. Throws if it cannot be. */
export async function rescoreOne(attempt: Attempt, dict: Dictionary): Promise<Attempt> {
  const clip = await getClip(attempt.at)
  if (!clip) throw new Error('the recording is no longer stored')

  const words = targetWords(attempt.target, dict)
  const expected = flatten(words)
  if (expected.length === 0) throw new Error('no pronounceable words in the line')

  const samples = await decodeToMono16k(clip.blob)
  const remote = await analyzeRemote(samples, expected, words)

  return {
    ...attempt,
    aligned: remote.aligned,
    // Verdict tallies from the shared scorer so the weak-sound report keeps
    // working; the headline from the service, which is the better number.
    score: { ...scoreAlignment(remote.aligned), overall: remote.overall },
    scorer: 'gop',
    rev: SCORER_REVISION,
  }
}
