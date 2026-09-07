"""
The acoustic models, loaded once and held.

Same phoneme checkpoint the browser uses — but at fp32, in native PyTorch, on
the GPU. That difference is not incidental. In the browser the app runs int4
community ONNX conversions and carries a whole apparatus to survive them: a
precision ladder, a synthetic buzz probe, non-finite and flat-logit detection,
and a `demote()` path for weights that load, run, and return nothing. None of
those failure modes exist here, and the posteriors that GOP is computed from are
the model's real ones rather than a quantised approximation of them.
"""

from __future__ import annotations

import logging
import threading

import numpy as np
import torch

from .audio import TARGET_SAMPLE_RATE
from .phones import Inventory

log = logging.getLogger(__name__)

PHONEME_MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft"
WORD_MODEL = "openai/whisper-small.en"


def pick_device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def load_vocabulary(model: str) -> dict[str, int]:
    """phone -> id, straight from the repo's vocab.json."""
    import json

    from huggingface_hub import hf_hub_download

    path = hf_hub_download(model, "vocab.json")
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


class PhonemeRecognizer:
    """Audio -> per-frame log-probabilities over the phone vocabulary."""

    def __init__(self, device: str | None = None) -> None:
        from transformers import AutoFeatureExtractor, AutoModelForCTC

        self.device = device or pick_device()
        log.info("loading %s on %s", PHONEME_MODEL, self.device)

        # Feature extractor only, never the processor. This repo ships a slow
        # Wav2Vec2PhonemeCTCTokenizer whose constructor demands the `phonemizer`
        # package, which in turn wants a native espeak-ng library on the PATH —
        # a genuine nuisance on Windows, and for nothing: a CTC head has no use
        # for a tokenizer. Taking the arg max of every frame and reading ids out
        # of the vocabulary is the whole of the job, and the vocabulary is one
        # small JSON file. (The browser path skips it for the same reason.)
        self.features = AutoFeatureExtractor.from_pretrained(PHONEME_MODEL)
        self.model = AutoModelForCTC.from_pretrained(PHONEME_MODEL).to(self.device)
        self.model.eval()

        self.inventory = Inventory(load_vocabulary(PHONEME_MODEL))
        self.blank = self.model.config.pad_token_id or 0

    @torch.inference_mode()
    def log_probs(self, samples: np.ndarray) -> tuple[np.ndarray, float]:
        """
        Log-probabilities of shape (frames, vocabulary), plus seconds per frame.

        The frame rate is measured rather than assumed: the convolutional front
        end has one stride for any length of input, so frames divided by
        duration is exact, and nothing downstream has to hardcode 20 ms.
        """
        inputs = self.features(
            samples, sampling_rate=TARGET_SAMPLE_RATE, return_tensors="pt"
        )
        values = inputs.input_values.to(self.device)
        logits = self.model(values).logits  # (1, frames, vocabulary)
        probs = torch.log_softmax(logits.float(), dim=-1)[0]

        frames = probs.shape[0]
        seconds = samples.shape[0] / TARGET_SAMPLE_RATE
        return probs.cpu().numpy().astype(np.float64), (seconds / frames if frames else 0.0)


class WordRecognizer:
    """Audio -> words. Only free practice needs this."""

    def __init__(self, device: str | None = None) -> None:
        from transformers import pipeline

        self.device = device or pick_device()
        log.info("loading %s on %s", WORD_MODEL, self.device)
        self.pipe = pipeline(
            "automatic-speech-recognition",
            model=WORD_MODEL,
            device=0 if self.device == "cuda" else -1,
            dtype=torch.float16 if self.device == "cuda" else torch.float32,
        )

    def transcribe(self, samples: np.ndarray) -> str:
        result = self.pipe({"raw": samples, "sampling_rate": TARGET_SAMPLE_RATE})
        text = result.get("text", "") if isinstance(result, dict) else ""
        return text.strip()


class Models:
    """
    Lazy, thread-safe holders.

    Uvicorn serves requests from a thread pool, and two takes arriving together
    would otherwise each start their own copy of a 1.2 GB model.
    """

    def __init__(self) -> None:
        self._phonemes: PhonemeRecognizer | None = None
        self._words: WordRecognizer | None = None
        self._lock = threading.Lock()

    def phonemes(self) -> PhonemeRecognizer:
        if self._phonemes is None:
            with self._lock:
                if self._phonemes is None:
                    self._phonemes = PhonemeRecognizer()
        return self._phonemes

    def words(self) -> WordRecognizer:
        if self._words is None:
            with self._lock:
                if self._words is None:
                    self._words = WordRecognizer()
        return self._words

    @property
    def phonemes_ready(self) -> bool:
        return self._phonemes is not None

    @property
    def words_ready(self) -> bool:
        return self._words is not None


MODELS = Models()
