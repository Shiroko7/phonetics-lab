"""
Audio in, model-ready samples out.

The browser already holds exactly what the model wants — `recorder.ts` decodes
every take to mono 16 kHz float32 before it does anything else — so the client
sends that, wrapped in a WAV header, and this module mostly just unwraps it.

That is a deliberate choice over posting the recorded WebM/Opus and decoding it
here. Opus is a perceptual codec: it spends its bits where the ear notices and
discards detail where it does not, and a good deal of what it discards lives in
the 4-8 kHz band that separates /s/ from /ʃ/ from /f/ from /θ/ — among the most
commonly confused phones in the language, and the ones a learner most needs
judged fairly. Sending uncompressed samples keeps that evidence, and as a side
effect keeps ffmpeg off the dependency list entirely.
"""

from __future__ import annotations

import io

import numpy as np
import soundfile as sf

TARGET_SAMPLE_RATE = 16_000


def read_wav(data: bytes) -> np.ndarray:
    """WAV bytes -> mono float32 at 16 kHz."""
    try:
        samples, rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
    except Exception as err:  # noqa: BLE001 - surfaced to the client as a 400
        raise ValueError(f"could not read that audio: {err}") from err

    if samples.size == 0:
        raise ValueError("the recording is empty")

    mono = samples.mean(axis=1)

    if rate != TARGET_SAMPLE_RATE:
        mono = resample(mono, rate, TARGET_SAMPLE_RATE)

    return np.ascontiguousarray(mono, dtype=np.float32)


def resample(samples: np.ndarray, source: int, target: int) -> np.ndarray:
    """Linear resampling, used only if a client sends something off-rate."""
    duration = samples.shape[0] / source
    count = int(round(duration * target))
    if count <= 1:
        return samples
    positions = np.linspace(0.0, samples.shape[0] - 1, count)
    return np.interp(positions, np.arange(samples.shape[0]), samples).astype(np.float32)


def trim_silence(samples: np.ndarray, floor: float = 0.01, pad: int = 1600) -> np.ndarray:
    """
    Drop leading and trailing near-silence, keeping a tenth of a second either
    side.

    Silence at the edges is not harmless. Forced alignment has to account for
    every frame it is given, so a long lead-in gets absorbed into the first
    phone, dragging its GOP down and reporting a fault on a sound the speaker
    made correctly a moment later.
    """
    loud = np.flatnonzero(np.abs(samples) >= floor)
    if loud.size == 0:
        return samples
    start = max(0, int(loud[0]) - pad)
    # loud[-1] is the last loud sample, so the slice end is one past it.
    end = min(samples.shape[0], int(loud[-1]) + 1 + pad)
    return samples[start:end]


def measure(samples: np.ndarray) -> dict[str, float]:
    """Peak and RMS, so the client can explain a bad take rather than score it."""
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    rms = float(np.sqrt(np.mean(np.square(samples)))) if samples.size else 0.0
    return {"peak": peak, "rms": rms, "seconds": samples.shape[0] / TARGET_SAMPLE_RATE}
