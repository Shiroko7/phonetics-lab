/** Display-time transformations, applied on top of canonical transcriptions. */

import { applyFlapping, mergeCotCaught } from './phonology.ts'

export interface DisplayOptions {
  /** Show /t/ and /d/ as a flap between vowels — water as [ˈwɑɾɚ]. */
  flapping: boolean
  /** Collapse the THOUGHT vowel into LOT, as most Americans do. */
  merged: boolean
  /** Keep the "." syllable breaks. */
  syllables: boolean
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  flapping: true,
  merged: false,
  syllables: true,
}

export function formatIPA(ipa: string, options: DisplayOptions): string {
  let out = ipa
  if (options.merged) out = mergeCotCaught(out)
  if (options.flapping) out = applyFlapping(out)
  if (!options.syllables) out = out.replace(/\./g, '')
  return out
}
