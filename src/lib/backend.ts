/**
 * The local scoring service, when it is running.
 *
 * The app is complete without this. Everything still works in the browser, and
 * if nothing answers on :8000 nothing here is used. What the backend adds is a
 * better answer to the same question: instead of free-decoding the audio and
 * then string-matching the result against the target, it threads the audio
 * through the expected phones by forced alignment and reports, per phone, how
 * much the model believed in it. A fumbled sound stays in its own slot with a
 * low score rather than turning into a different symbol that has to be matched
 * up again.
 *
 * It runs on this machine. Recordings go to 127.0.0.1 and no further.
 */

import type { AlignedPhone, Heard, Verdict } from './align.ts'

const BASE = 'http://127.0.0.1:8000'
/** Long enough for a loaded service to answer, short enough not to stall a take. */
const PROBE_TIMEOUT_MS = 1500

export interface BackendInfo {
  device: string
  cuda: boolean
  gpu: string | null
  torch: string
  phonemeModel: string
}

export interface RemoteAnalysis {
  aligned: AlignedPhone[]
  overall: number
  /** The unconstrained decode over the same logits, for sounds nobody expected. */
  free: Heard[]
  device: string
}

let probed: Promise<BackendInfo | null> | null = null

/**
 * Whether the scoring service is up, asked once per page load.
 *
 * A failure here is not an error condition — running without the backend is the
 * normal case — so this resolves to null rather than throwing.
 */
export function probe(): Promise<BackendInfo | null> {
  probed ??= (async () => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
      const res = await fetch(`${BASE}/health`, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) return null
      const info = (await res.json()) as {
        device: string; cuda: boolean; gpu: string | null
        torch: string; phoneme_model: string
      }
      return {
        device: info.device,
        cuda: info.cuda,
        gpu: info.gpu,
        torch: info.torch,
        phonemeModel: info.phoneme_model,
      }
    } catch {
      return null
    }
  })()
  return probed
}

/** Forget the last probe, so a service started mid-session is picked up. */
export function reprobe(): Promise<BackendInfo | null> {
  probed = null
  return probe()
}

/**
 * Wrap 16 kHz mono samples in a WAV header, uncompressed.
 *
 * 32-bit float rather than 16-bit PCM: these are the exact samples the browser
 * already decoded, and the point of sending them at all is that nothing on the
 * way to the model throws detail away. The recorded Opus blob is kept for
 * playback, where lossy is fine — it is only the scoring path that cares.
 */
export function encodeWav(samples: Float32Array, sampleRate = 16_000): Blob {
  const bytes = samples.length * 4
  const buffer = new ArrayBuffer(44 + bytes)
  const view = new DataView(buffer)

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + bytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 3, true) // IEEE float
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 32, true)
  ascii(36, 'data')
  view.setUint32(40, bytes, true)

  new Float32Array(buffer, 44).set(samples)
  return new Blob([buffer], { type: 'audio/wav' })
}

async function fail(res: Response): Promise<never> {
  let detail = `HTTP ${res.status}`
  try {
    const body = (await res.json()) as { detail?: string }
    if (body.detail) detail = body.detail
  } catch {
    // A non-JSON error body is not worth a second failure.
  }
  throw new Error(detail)
}

/**
 * Score a take against the phones it was supposed to be made of.
 *
 * `expected` is the flat phone sequence the browser already builds for its own
 * alignment, so both paths are answering for exactly the same target.
 */
export async function analyze(
  samples: Float32Array,
  expected: string[],
): Promise<RemoteAnalysis> {
  const form = new FormData()
  form.append('audio', encodeWav(samples), 'take.wav')
  form.append('expected', JSON.stringify(expected))

  const res = await fetch(`${BASE}/analyze`, { method: 'POST', body: form })
  if (!res.ok) await fail(res)

  const body = (await res.json()) as {
    phones: {
      index: number; expected: string; verdict: Verdict; score: number
      gop: number; posterior: number; heard: string | null
      start: number; end: number
    }[]
    free: { phone: string; start: number; end: number }[]
    overall: number
    device: string
  }

  return {
    aligned: body.phones.map((phone) => ({
      expected: phone.expected,
      // A phone the model agreed with was produced as asked; one it did not
      // carries the sound it would rather have heard.
      actual: phone.verdict === 'correct' ? phone.expected : phone.heard,
      verdict: phone.verdict,
      // The rest of the app reads `distance` as 0 = perfect, 1 = unrelated,
      // which is the score turned around.
      distance: 1 - phone.score / 100,
      expectedIndex: phone.index,
      start: phone.start,
      end: phone.end,
    })),
    overall: body.overall,
    free: body.free,
    device: body.device,
  }
}

/** Words, for free practice. */
export async function transcribe(samples: Float32Array): Promise<string> {
  const form = new FormData()
  form.append('audio', encodeWav(samples), 'take.wav')

  const res = await fetch(`${BASE}/transcribe`, { method: 'POST', body: form })
  if (!res.ok) await fail(res)
  const body = (await res.json()) as { text: string }
  return body.text
}
