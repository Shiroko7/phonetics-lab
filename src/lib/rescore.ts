/**
 * Re-score saved audio with the current local service, including a one-time
 * refresh of older revision-2 recordings and an explicit force-all action.
 *
 * The browser scorer and the service are not on the same scale. One counts
 * verdicts off a free decode, the other averages per-phone goodness-of-
 * pronunciation from a forced alignment, and the same recording can land
 * several points apart under the two. That matters more than it sounds: the
 * history panel draws trends across attempts, and a line that appears to have
 * improved from 68 to 96 may only have changed scorer halfway through.
 *
 * Audio is read from IndexedDB and decoded without re-recording. Current scores
 * replace derived analysis, while original assessments and timestamps survive.
 * The active controller backs up storage and commits each result with a
 * compare-and-swap merge against the latest history. It never replaces the list.
 *
 * The assessment-processing marker avoids repeating a successful refresh on
 * every load. Missing audio, invalid speech and unavailable services do not
 * receive that marker. The UI reports these explicitly and supports retrying.
 *
 * Unavailable recordings keep their previous scores and scorer/revision tags.
 */

import { analyze as analyzeRemote } from './backend.ts'
import { scoreAlignment } from './align.ts'
import { getClip } from './clips.ts'
import type { Dictionary } from './dict.ts'
import { decodeToMono16k } from './recorder.ts'
import { flatten, targetWords } from './report.ts'
import { isRefreshed, SCORER_REVISION, type Attempt } from './practice.ts'
import { preserveAssessment } from './assessmentHistory.ts'

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

export interface RescoreOptions {
  force?: boolean
  /** Commit each completed recording against the latest history, not a snapshot. */
  onUpdate?: (before: Attempt, updated: Attempt) => boolean
  onSkipped?: (item: Skipped) => void
  scoreAttempt?: typeof rescoreOne
  signal?: AbortSignal
}

/** How many of these are not on the current scale, audio permitting. */
export function pending(attempts: Attempt[]): number {
  return attempts.filter((attempt) => !isRefreshed(attempt)).length
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
  options: RescoreOptions = {},
): Promise<RescoreResult> {
  const todo = attempts
    .map((attempt, index) => ({ attempt, index }))
    .filter(({ attempt }) => options.force || !isRefreshed(attempt))

  const next = [...attempts]
  const skipped: Skipped[] = []
  const skip = (item: Skipped) => { skipped.push(item); options.onSkipped?.(item) }
  let rescored = 0
  let done = 0

  for (const { attempt, index } of todo) {
    if (options.signal?.aborted) break
    let updated: Attempt
    try {
      updated = await (options.scoreAttempt ?? rescoreOne)(attempt, dict)
    } catch (err) {
      skip({
        at: attempt.at,
        target: attempt.target,
        reason: (err as Error).message,
      })
      done += 1
      onProgress?.(done, todo.length)
      continue
    }
    if (options.signal?.aborted) break
    // Persistence failures abort the batch; never silently report unsaved results.
    if (!options.onUpdate || options.onUpdate(attempt, updated)) {
      next[index] = updated
      rescored += 1
    } else skip({ at: attempt.at, target: attempt.target, reason: 'Recording changed or was deleted during recalculation; newer history was kept.' })
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

  return preserveAssessment(attempt, {
    ...attempt,
    aligned: remote.aligned,
    // Verdict tallies from the shared scorer so the weak-sound report keeps
    // working; the headline from the service, which is the better number.
    score: { ...scoreAlignment(remote.aligned), overall: remote.overall },
    scorer: 'gop',
    rev: SCORER_REVISION,
  }, 'history-rescore')
}
