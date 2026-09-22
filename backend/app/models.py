"""Wire types. These mirror the TypeScript interfaces in src/lib/."""

from __future__ import annotations

from pydantic import BaseModel, Field

SCORER_REVISION = 2


class TargetWord(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    phones: list[str] = Field(min_length=1, max_length=64)
    pronunciations: list[list[str]] = Field(default_factory=list, max_length=32)


class PhoneResult(BaseModel):
    """One expected phone, as the model heard it."""

    index: int = Field(description="Index into the expected phone sequence that was sent.")
    expected: str
    verdict: str = Field(description="correct | close | wrong | missing")
    score: int = Field(description="0-100, derived from the GOP.")
    gop: float = Field(description="Raw goodness of pronunciation; 0 is best, negative is worse.")
    posterior: float = Field(description="Mean P(expected phone) over the phone's frames, 0-1.")
    heard: str | None = Field(
        default=None,
        description="The phone the model would rather have heard, in General American.",
    )
    heard_posterior: float = 0.0
    realized: str | None = None
    start: float
    end: float


class HeardPhone(BaseModel):
    """A phone from the unconstrained decode, for spotting inserted sounds."""

    phone: str
    start: float
    end: float


class AudioInfo(BaseModel):
    peak: float
    rms: float
    seconds: float


class AnalyzeResponse(BaseModel):
    revision: int = SCORER_REVISION
    phones: list[PhoneResult]
    # Forced alignment answers "how well was each expected phone produced" and
    # by construction has no opinion about sounds that were not expected. The
    # free decode does, and shares the same logits, so it rides along and lets
    # the client show an inserted vowel that GOP alone would never reveal.
    free: list[HeardPhone]
    overall: int
    audio: AudioInfo
    seconds_per_frame: float
    device: str


class TranscribeResponse(BaseModel):
    text: str
    audio: AudioInfo
    device: str


class Health(BaseModel):
    ok: bool = True
    scorer_revision: int = SCORER_REVISION
    phoneme_model_revision: str | None = None
    device: str
    cuda: bool
    gpu: str | None = None
    torch: str
    phoneme_model: str
    word_model: str
    phonemes_loaded: bool
    words_loaded: bool
