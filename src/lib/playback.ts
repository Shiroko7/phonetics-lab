/** A replay range is a hard limit, even for very short words. */
export interface AudioSpan { start: number; end: number }

export function playbackSlice(span: AudioSpan, seconds: number, sampleRate: number): AudioSpan | null {
  if (![span.start, span.end, seconds, sampleRate].every(Number.isFinite) || seconds <= 0 || sampleRate <= 0) return null
  // Round inward so replay never crosses a supplied boundary by even a sample.
  const lower = Math.max(0, span.start)
  const upper = Math.min(seconds, span.end)
  let first = Math.ceil(lower * sampleRate)
  let last = Math.floor(upper * sampleRate)
  // Floating-point multiplication/division can land just outside a boundary.
  if (first / sampleRate < lower) first++
  if (last / sampleRate > upper) last--
  const start = first / sampleRate
  const end = last / sampleRate
  return end > start ? { start, end } : null
}
