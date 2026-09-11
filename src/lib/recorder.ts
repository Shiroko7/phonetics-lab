/**
 * Microphone capture for pronunciation practice.
 *
 * Records to a Blob for playback, and decodes to 16 kHz mono Float32 for the
 * recogniser. Also exposes a live level so the UI can show that the mic is
 * actually hearing something — silence is the most common reason an analysis
 * comes back empty.
 */

import { TARGET_SAMPLE_RATE } from './asr.ts'

export interface Recording {
  /** Playable in an <audio> element. */
  blob: Blob
  url: string
  /** Mono, 16 kHz, what the model consumes. */
  samples: Float32Array
  durationMs: number
  /** Peak amplitude, 0-1, for a "too quiet" warning. */
  peak: number
}

export function supportsRecording(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  )
}

/** Pick a container the browser can actually produce. */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

export class Recorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []
  private analyser: AnalyserNode | null = null
  private context: AudioContext | null = null
  private levelBuffer = new Uint8Array(new ArrayBuffer(0))

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        // Keep the speaker's own voice intact; these are tuned for calls, not
        // for judging pronunciation.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })

    // A parallel analyser drives the level meter while recording.
    this.context = new AudioContext()
    const source = this.context.createMediaStreamSource(this.stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 1024
    this.levelBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize))
    source.connect(this.analyser)

    const mimeType = pickMimeType()
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder.start()
  }

  /** Current input level, 0-1. Returns 0 when not recording. */
  level(): number {
    if (!this.analyser) return 0
    this.analyser.getByteTimeDomainData(this.levelBuffer)
    let peak = 0
    for (const sample of this.levelBuffer) {
      peak = Math.max(peak, Math.abs(sample - 128) / 128)
    }
    return peak
  }

  get recording(): boolean {
    return this.recorder?.state === 'recording'
  }

  async stop(): Promise<Recording> {
    const recorder = this.recorder
    if (!recorder) throw new Error('not recording')

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType }))
      recorder.stop()
    })

    this.teardown()

    const samples = await decodeToMono16k(blob)
    let peak = 0
    for (const s of samples) peak = Math.max(peak, Math.abs(s))

    return {
      blob,
      url: URL.createObjectURL(blob),
      samples,
      durationMs: (samples.length / TARGET_SAMPLE_RATE) * 1000,
      peak,
    }
  }

  cancel(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.teardown()
  }

  private teardown(): void {
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.context?.close()
    this.stream = null
    this.recorder = null
    this.analyser = null
    this.context = null
  }
}

/**
 * Decode any recorded container down to the mono 16 kHz the model expects.
 * OfflineAudioContext does the resampling, which is both correct and fast.
 *
 * Exported because a take that has already been filed away can need decoding
 * again — re-scoring an old attempt reads its blob back out of IndexedDB and
 * has to arrive at exactly the samples the original analysis saw.
 */
export async function decodeToMono16k(blob: Blob): Promise<Float32Array> {
  const bytes = await blob.arrayBuffer()

  const decodeContext = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await decodeContext.decodeAudioData(bytes)
  } finally {
    void decodeContext.close()
  }

  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()

  const rendered = await offline.startRendering()
  return rendered.getChannelData(0).slice()
}
