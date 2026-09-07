/**
 * Phoneme recognition in the browser.
 *
 * Runs facebook/wav2vec2-lv-60-espeak-cv-ft (ONNX build) through transformers.js.
 * The model transcribes speech straight into IPA rather than into words, which
 * is what makes phone-level feedback possible at all.
 *
 * The library and the weights are both loaded lazily. Nothing is fetched when
 * the app opens; the fetch starts the moment recording does, so the download
 * overlaps with the speaking rather than following it. Weights are cached by
 * the browser afterwards.
 */

import type { Heard } from './align.ts'

/** Transcribes speech into IPA phones. */
const PHONEME_MODEL = 'onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX'

/**
 * Transcribes speech into words. Needed only for free practice, where there is
 * no script to compare against and the words themselves must be recovered
 * before the dictionary can say how they ought to sound.
 */
const WORD_MODEL = 'onnx-community/whisper-base.en'

/** The model expects 16 kHz mono audio. */
export const TARGET_SAMPLE_RATE = 16_000

export type Device = 'webgpu' | 'wasm'
export type Quality = 'fp16' | 'q4' | 'fp32'
export type Which = 'phonemes' | 'words'

export interface LoadState {
  stage: 'idle' | 'library' | 'weights' | 'ready' | 'error'
  /** 0-1 across all files being fetched. */
  progress: number
  /** Human-readable note, e.g. which file is downloading. */
  detail?: string
  device?: Device
  quality?: Quality
  error?: string
}

/** WebGPU is required for the fp16 weights; without it we fall back to int4. */
export async function detectDevice(): Promise<Device> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  if (!gpu) return 'wasm'
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm'
  } catch {
    return 'wasm'
  }
}

/**
 * Weight formats to try, best first; a build that fails falls through to the
 * next. These are community ONNX conversions and any one precision can be
 * broken while the others are fine.
 *
 * Both models lead with int4, for different reasons.
 *
 * Whisper's fp16 export is an invalid graph: the `If` node that switches
 * between the first decode pass and the cached ones returns `logits` straight
 * out of the enclosing scope, which onnxruntime refuses to load ("Subgraph
 * output (logits) is an outer scope value being returned directly"). It fails
 * loudly, at load, on every device.
 *
 * The phoneme model's fp16 export fails quietly instead: it builds, it runs,
 * and it returns nothing whatever was said. Its int4 build is the one with
 * evidence behind it — it transcribes correctly and is a third of the download
 * — so that is what both get asked for first, on a GPU as much as without one.
 */
function ladder(which: Which, device: Device): Quality[] {
  if (device === 'wasm') return ['q4', 'fp32']
  return which === 'words' ? ['q4', 'fp32'] : ['q4', 'fp16', 'fp32']
}

/** Speech to words. */
type Transcriber = (audio: Float32Array) => Promise<string>
/** Speech to IPA phones, each with where in the take it happened. */
type PhoneRecognizer = (audio: Float32Array) => Promise<Heard[]>
type Listener = (state: LoadState) => void

interface Slot {
  model: string
  label: string
  session: Promise<Transcriber | PhoneRecognizer> | null
  state: LoadState
  /** Precisions this model has been caught misbehaving at. */
  rejected: Set<Quality>
}

const slots: Record<Which, Slot> = {
  phonemes: {
    model: PHONEME_MODEL,
    label: 'phoneme model',
    session: null,
    state: { stage: 'idle', progress: 0 },
    rejected: new Set(),
  },
  words: {
    model: WORD_MODEL,
    label: 'word model',
    session: null,
    state: { stage: 'idle', progress: 0 },
    rejected: new Set(),
  },
}

/** Whoever is currently showing progress. A load outlives the call that
 *  started it, so the listener is a moving target rather than an argument. */
let listener: Listener = () => {}

function emit(slot: Slot, state: LoadState): void {
  slot.state = state
  listener(state)
}

type Transformers = typeof import('@huggingface/transformers')

interface BuildOptions {
  device: Device
  dtype: Quality
  progress_callback: (event: unknown) => void
}

/** Speech to words. Whisper ships a fast tokenizer, so the pipeline suffices. */
async function buildWordRecognizer(
  { pipeline }: Transformers,
  model: string,
  options: BuildOptions,
): Promise<Transcriber> {
  const asr = await pipeline('automatic-speech-recognition', model, options)
  return async (audio: Float32Array) => {
    const result = (await asr(audio)) as { text?: string } | { text?: string }[]
    const text = Array.isArray(result) ? result[0]?.text : result.text
    return text ?? ''
  }
}

/**
 * Speech to IPA phones, assembled by hand rather than through a pipeline.
 *
 * The espeak wav2vec2 repo carries a slow Wav2Vec2PhonemeCTCTokenizer — a
 * `vocab.json` and nothing more — while transformers.js reads only the fast
 * `tokenizer.json` format, so asking it for a speech-recognition pipeline sends
 * it looking for a file that was never published. Nothing is lost by skipping
 * it. A CTC head has no need of a tokenizer: take the arg max of every frame,
 * collapse the runs, drop the blanks, and read the ids out of the vocabulary.
 */
async function buildPhonemeRecognizer(
  { AutoModelForCTC, AutoProcessor }: Transformers,
  model: string,
  options: BuildOptions,
): Promise<PhoneRecognizer> {
  const [processor, ctc, vocabulary] = await Promise.all([
    AutoProcessor.from_pretrained(model, { progress_callback: options.progress_callback }),
    AutoModelForCTC.from_pretrained(model, options),
    loadVocabulary(model),
  ])

  const infer = async (audio: Float32Array): Promise<Tensorish> => {
    const inputs = await processor(audio)
    const { logits } = (await ctc(inputs)) as { logits: Tensorish }
    // fp16 weights emit fp16 logits, whose raw halves do not compare as numbers.
    return logits.to('float32')
  }

  // A build can succeed and still compute nothing. fp16 weights that overflow
  // emit NaN logits, and NaN loses every comparison, so the arg max quietly
  // picks the blank symbol on every frame and the transcript comes back empty —
  // which reads downstream as a speaker who pronounced nothing at all. Half a
  // second of a synthetic buzz is enough to catch it while there is still
  // another precision to fall back to.
  const probe = new Float32Array(TARGET_SAMPLE_RATE / 2)
  for (let i = 0; i < probe.length; i++) {
    probe[i] = 0.2 * Math.sin((2 * Math.PI * 130 * i) / TARGET_SAMPLE_RATE)
  }
  const { data } = await infer(probe)
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < data.length; i++) {
    const value = data[i]
    if (!Number.isFinite(value)) throw new Error('the weights produce non-finite logits')
    if (value < low) low = value
    if (value > high) high = value
  }
  // Flat logits are the other shape of the same failure: every symbol ties, the
  // arg max takes the blank on every frame, and the transcript comes back empty
  // however clearly the speaker spoke.
  if (high - low < 1e-3) throw new Error('the weights produce flat logits')

  return async (audio: Float32Array) =>
    decodeCTC(await infer(audio), vocabulary, audio.length / TARGET_SAMPLE_RATE)
}

/** Just enough of a transformers.js Tensor to read logits out of one. */
interface Tensorish {
  dims: readonly number[]
  data: ArrayLike<number>
  to(type: string): Tensorish
}

/** id -> phone. Four kilobytes, fetched directly: it is the one file the
 *  library has no loader for once the tokenizer is out of the picture. */
async function loadVocabulary(model: string): Promise<string[]> {
  const res = await fetch(`https://huggingface.co/${model}/resolve/main/vocab.json`)
  if (!res.ok) throw new Error(`could not fetch the phone vocabulary (HTTP ${res.status})`)
  const vocab = (await res.json()) as Record<string, number>
  const tokens: string[] = []
  for (const [token, id] of Object.entries(vocab)) tokens[id] = token
  return tokens
}

/** Ids 0-3 are <pad>, <s>, </s> and <unk>; 0 doubles as the CTC blank. */
const FIRST_PHONE_ID = 4

/** Seconds. Caps how far a phone's span may stretch into the silence after it. */
const LONGEST_PHONE = 0.3

/**
 * Greedy CTC: the best id per frame, repeats collapsed, blanks dropped.
 *
 * The frame each phone was emitted on is kept, not just the phone. A frame is a
 * fixed slice of the input — the model's convolutional front end has one stride
 * for any length of audio — so the frame index divided by the frame count, times
 * the duration, is where in the recording that sound happened. That is what lets
 * a single word be cut back out of the take and played on its own.
 */
function decodeCTC(logits: Tensorish, tokens: string[], seconds: number): Heard[] {
  const [, frames, size] = logits.dims
  const data = logits.data
  const emitted: { phone: string; frame: number }[] = []
  let previous = -1
  for (let frame = 0; frame < frames; frame++) {
    const row = frame * size
    let best = 0
    for (let id = 1; id < size; id++) if (data[row + id] > data[row + best]) best = id
    // NaN loses every comparison, so a frame of them arrives here looking like a
    // confident blank. Say so rather than reporting silence.
    if (!Number.isFinite(data[row + best])) throw new Error('the model produced non-finite logits')
    // The same id on the next frame is one phone held, not a second one.
    if (best !== previous && best >= FIRST_PHONE_ID) {
      emitted.push({ phone: tokens[best] ?? '', frame })
    }
    previous = best
  }

  const perFrame = frames > 0 ? seconds / frames : 0
  const at = (frame: number) => Math.round(frame * perFrame * 1000) / 1000

  // A phone runs until the next one starts, which keeps the spans contiguous
  // through connected speech — but a phone followed by a pause would otherwise
  // swallow the whole pause, and a word cut on that boundary comes back with a
  // second of silence stuck to it. No English phone runs to a third of a second,
  // so that is where a span stops growing.
  const longest = perFrame > 0 ? Math.ceil(LONGEST_PHONE / perFrame) : frames
  return emitted.map((one, i) => {
    const next = i + 1 < emitted.length ? emitted[i + 1].frame : frames
    return {
      phone: one.phone,
      start: at(one.frame),
      end: at(Math.min(next, one.frame + longest)),
    }
  })
}

async function build(which: Which): Promise<Transcriber | PhoneRecognizer> {
  const slot = slots[which]
  emit(slot, { stage: 'library', progress: 0, detail: 'loading runtime' })

  // Dynamic import keeps transformers.js out of the initial bundle.
  const transformers = await import('@huggingface/transformers')
  transformers.env.allowLocalModels = false

  const device = await detectDevice()

  /** One build at one precision. Throws if the runtime rejects the weights. */
  const attempt = async (quality: Quality): Promise<Transcriber | PhoneRecognizer> => {
    emit(slot, { stage: 'weights', progress: 0, detail: `fetching ${slot.label}`, device, quality })

    // Several files download in parallel; track them by name for a real total.
    const sizes = new Map<string, { loaded: number; total: number }>()
    const report = (detail: string) => {
      let loaded = 0
      let total = 0
      for (const f of sizes.values()) {
        loaded += f.loaded
        total += f.total
      }
      emit(slot, {
        stage: 'weights',
        progress: total > 0 ? loaded / total : 0,
        detail,
        device,
        quality,
      })
    }

    const options: BuildOptions = {
      device,
      dtype: quality,
      progress_callback: (event: unknown) => {
        const e = event as { status?: string; file?: string; loaded?: number; total?: number }
        if (e.status === 'progress' && e.file && e.total) {
          sizes.set(e.file, { loaded: e.loaded ?? 0, total: e.total })
          report(`${slot.label}: ${e.file.split('/').pop()}`)
        } else if (e.status === 'ready') {
          report('preparing')
        }
      },
    }

    const recognize =
      which === 'words'
        ? await buildWordRecognizer(transformers, slot.model, options)
        : await buildPhonemeRecognizer(transformers, slot.model, options)

    emit(slot, { stage: 'ready', progress: 1, device, quality })
    return recognize
  }

  let failure: Error | null = null
  for (const quality of ladder(which, device)) {
    if (slot.rejected.has(quality)) continue
    try {
      return await attempt(quality)
    } catch (err) {
      // A precision the runtime refuses is worth retrying at another one. A
      // network failure is not, but it fails the same way on the next rung and
      // the ladder is short.
      failure = err as Error
    }
  }
  throw failure ?? new Error('no weights could be loaded')
}

function load(which: Which, onState: Listener): Promise<Transcriber | PhoneRecognizer> {
  const slot = slots[which]
  listener = onState
  // A load already in flight replays where it has got to, so a caller that
  // attaches to it late still sees the bar in the right place.
  if (slot.session) onState(slot.state)

  slot.session ??= build(which).catch((err: Error) => {
    slot.session = null
    emit(slot, { stage: 'error', progress: 0, error: err.message })
    throw err
  })
  return slot.session
}

/** Speech to IPA phones. Loaded once, then reused. */
export function loadRecognizer(onState: Listener): Promise<PhoneRecognizer> {
  return load('phonemes', onState) as Promise<PhoneRecognizer>
}

/** Speech to words, for free practice where there is no script. */
export function loadTranscriber(onState: Listener): Promise<Transcriber> {
  return load('words', onState) as Promise<Transcriber>
}

/**
 * Start fetching what a mode will need, without waiting for it. Called when
 * recording starts, so the download runs while the user is still talking and
 * is often finished by the time they press stop. Free practice needs its words
 * first, so it queues that model ahead of the phoneme one and the two do not
 * compete for bandwidth or for the progress bar.
 */
export function prewarm(mode: 'scripted' | 'free', onState: Listener): void {
  const queued =
    mode === 'free'
      ? loadTranscriber(onState).then(() => loadRecognizer(onState))
      : loadRecognizer(onState)
  // A failure here is not reported: the analysis asks for the same model a
  // moment later and surfaces it there, where the user is waiting on it.
  void queued.catch(() => {})
}

/**
 * Reject the precision the current build used, and drop the build, so the next
 * load takes the following rung.
 *
 * Some weights load cleanly, run without complaint and return nothing at all,
 * which from the outside is indistinguishable from a speaker who said nothing.
 * The probe at build time catches the two ways that happens synthetically, but
 * the only certain answer to real audio coming back empty is to try another
 * build. Returns false when the ladder has nothing left.
 */
export function demote(which: Which): boolean {
  const slot = slots[which]
  const { device, quality } = slot.state
  if (quality) slot.rejected.add(quality)
  slot.session = null
  slot.state = { stage: 'idle', progress: 0 }
  return device ? ladder(which, device).some((q) => !slot.rejected.has(q)) : false
}

/** How a model was actually built, for diagnostics. */
export function buildInfo(which: Which): { device?: Device; quality?: Quality } {
  const { device, quality } = slots[which].state
  return { device, quality }
}

/** True once the given model is built and ready to run. */
export function isLoaded(which: Which = 'phonemes'): boolean {
  return slots[which].state.stage === 'ready'
}
