"""
The local scoring service.

Runs on this machine only. Nothing is uploaded anywhere: the browser posts its
samples to localhost, the GPU scores them, and the JSON comes back. The app
works without it — the in-browser recogniser stays as the fallback — so this is
the high-accuracy path rather than a dependency.
"""

from __future__ import annotations

import json
import logging

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from . import align, audio, phones
from .models import (
    AnalyzeResponse,
    AudioInfo,
    Health,
    HeardPhone,
    PhoneResult,
    TranscribeResponse,
)
from .recognize import MODELS, PHONEME_MODEL, WORD_MODEL, pick_device

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("phonetics")

app = FastAPI(title="phonetics-lab scoring", version="0.1.0")

# The Vite dev server is a different origin from this one. Localhost only —
# there is no reason for anything else to reach a service holding a microphone
# feed, even one that never stores it.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health", response_model=Health)
def health() -> Health:
    device = pick_device()
    return Health(
        device=device,
        cuda=torch.cuda.is_available(),
        gpu=torch.cuda.get_device_name(0) if torch.cuda.is_available() else None,
        torch=torch.__version__,
        phoneme_model=PHONEME_MODEL,
        word_model=WORD_MODEL,
        phonemes_loaded=MODELS.phonemes_ready,
        words_loaded=MODELS.words_ready,
    )


def free_decode(
    log_probs: np.ndarray, inventory: phones.Inventory, seconds_per_frame: float, blank: int
) -> list[HeardPhone]:
    """
    Greedy CTC over the same logits: best id per frame, runs collapsed, blanks
    dropped. Only for sounds that were inserted — forced alignment cannot report
    those, because a sound nobody expected has no slot to be scored in.
    """
    best = log_probs.argmax(axis=1)
    out: list[HeardPhone] = []
    previous = -1
    for frame, token_id in enumerate(best):
        token_id = int(token_id)
        if token_id != previous and token_id != blank:
            phone = inventory.phone_for(token_id)
            if phone:
                out.append(
                    HeardPhone(
                        phone=phone,
                        start=round(frame * seconds_per_frame, 3),
                        end=round((frame + 1) * seconds_per_frame, 3),
                    )
                )
        previous = token_id
    return out


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    audio_file: UploadFile = File(..., alias="audio"),
    expected: str = Form(..., description="JSON array of General American phones."),
) -> AnalyzeResponse:
    try:
        wanted = json.loads(expected)
    except json.JSONDecodeError as err:
        raise HTTPException(400, f"`expected` is not valid JSON: {err}") from err
    if not isinstance(wanted, list) or not all(isinstance(p, str) for p in wanted):
        raise HTTPException(400, "`expected` must be a JSON array of phone strings")
    if not wanted:
        raise HTTPException(400, "`expected` is empty; there is nothing to score")

    raw = await audio_file.read()
    try:
        samples = audio.trim_silence(audio.read_wav(raw))
    except ValueError as err:
        raise HTTPException(400, str(err)) from err

    info = audio.measure(samples)
    if info["peak"] < 0.02:
        raise HTTPException(400, "that recording is silent")

    model = MODELS.phonemes()
    tokens, sources, variants = phones.to_tokens(wanted, model.inventory.vocab)
    if not tokens:
        raise HTTPException(
            400, "none of those phones are in the recogniser's inventory"
        )

    log_probs, seconds_per_frame = model.log_probs(samples)

    try:
        scored = align.score_phones(
            log_probs=log_probs,
            token_ids=[model.inventory.vocab[t] for t in tokens],
            tokens=tokens,
            english_ids=model.inventory.english_ids,
            id_to_token=model.inventory.id_to_token,
            blank=model.blank,
            variant_ids=[
                [model.inventory.vocab[t] for t in group] for group in variants
            ],
        )
    except ValueError as err:
        raise HTTPException(400, str(err)) from err

    results: list[PhoneResult] = []
    for entry, covers in zip(scored, sources):
        verdict = align.verdict_for(entry)
        percent = align.to_percent(entry.gop)
        heard = phones.REVERSE.get(entry.runner_up or "", None)

        # A merged token (ɑ + ɹ scored as ɑːɹ) reports the same result for both
        # of the phones it stands for, so the caller's indices stay intact.
        for index in covers:
            results.append(
                PhoneResult(
                    index=index,
                    expected=wanted[index],
                    verdict=verdict,
                    score=percent,
                    gop=round(entry.gop, 4),
                    posterior=round(entry.posterior, 4),
                    heard=heard if verdict in ("close", "wrong") else None,
                    heard_posterior=round(entry.runner_up_posterior, 4),
                    start=round(entry.start_frame * seconds_per_frame, 3),
                    end=round(entry.end_frame * seconds_per_frame, 3),
                )
            )

    overall = int(round(sum(r.score for r in results) / len(results))) if results else 0

    return AnalyzeResponse(
        phones=results,
        free=free_decode(log_probs, model.inventory, seconds_per_frame, model.blank),
        overall=overall,
        audio=AudioInfo(**info),
        seconds_per_frame=round(seconds_per_frame, 6),
        device=model.device,
    )


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(audio_file: UploadFile = File(..., alias="audio")) -> TranscribeResponse:
    raw = await audio_file.read()
    try:
        samples = audio.trim_silence(audio.read_wav(raw))
    except ValueError as err:
        raise HTTPException(400, str(err)) from err

    info = audio.measure(samples)
    if info["peak"] < 0.02:
        raise HTTPException(400, "that recording is silent")

    model = MODELS.words()
    return TranscribeResponse(
        text=model.transcribe(samples), audio=AudioInfo(**info), device=model.device
    )
