"""Free Edge reference voices. Only reference text goes to the remote service.

This is a community connector, not a paid Azure API. Keep the voice catalogue
and a bounded audio cache in memory; neither text nor audio is written to disk.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
import time

import edge_tts
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

router = APIRouter(prefix="/tts", tags=["reference voices"])
CATALOGUE_TTL = 3600
MAX_CACHE_BYTES = 16 * 1024 * 1024
MAX_CACHE_ITEMS = 64
_catalogue: list[dict] = []
_catalogue_at = 0.0
_catalogue_lock = asyncio.Lock()
_cache: OrderedDict[tuple[str, str, int], bytes] = OrderedDict()
_cache_bytes = 0
_generation_slots = asyncio.Semaphore(2)


class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=8000)
    voice: str = Field(min_length=1, max_length=100)
    rate: float = Field(default=1.0, ge=0.5, le=1.5)


async def catalogue() -> list[dict]:
    global _catalogue, _catalogue_at
    if _catalogue and time.monotonic() - _catalogue_at < CATALOGUE_TTL:
        return _catalogue
    async with _catalogue_lock:
        if _catalogue and time.monotonic() - _catalogue_at < CATALOGUE_TTL:
            return _catalogue
        try:
            available = await asyncio.wait_for(edge_tts.list_voices(), timeout=8)
        except Exception as error:
            if _catalogue:
                return _catalogue
            raise HTTPException(503, "Free online voices are temporarily unavailable. Try again or select a browser voice.") from error
        _catalogue = [{
            "id": voice["ShortName"], "name": voice["FriendlyName"],
            "lang": voice["Locale"], "gender": voice["Gender"].lower(),
        } for voice in available if voice["Locale"].startswith("en-")]
        _catalogue_at = time.monotonic()
        return _catalogue


@router.get("/voices")
async def voices() -> dict:
    return {"provider": "edge", "voices": await catalogue()}


async def render_speech(request: SpeechRequest) -> bytes:
    global _cache_bytes
    text = request.text.strip()
    if not text:
        raise HTTPException(422, "Enter some text to speak.")
    available = await catalogue()
    if request.voice not in {voice["id"] for voice in available}:
        raise HTTPException(400, "That English voice is not currently available. Refresh the voice list.")
    rate = round((request.rate - 1) * 100)
    cache_key = (request.voice, text, rate)
    if cache_key in _cache:
        _cache.move_to_end(cache_key)
        return _cache[cache_key]

    async def generate() -> bytes:
        async with _generation_slots:
            # Another request may have completed while this one waited.
            if cache_key in _cache:
                return _cache[cache_key]
            stream = edge_tts.Communicate(text, request.voice, rate=f"{rate:+d}%")
            chunks = bytearray()
            async for chunk in stream.stream():
                if chunk["type"] == "audio":
                    chunks.extend(chunk["data"])
                    if len(chunks) > MAX_CACHE_BYTES:
                        raise ValueError("Reference audio exceeded the size limit")
            if not chunks:
                raise ValueError("No reference audio was returned")
            return bytes(chunks)

    try:
        audio = await asyncio.wait_for(generate(), timeout=30)
    except Exception as error:
        raise HTTPException(503, "The free voice service could not generate this reference. Try again or select another voice.") from error
    if cache_key not in _cache:
        while _cache and (len(_cache) >= MAX_CACHE_ITEMS or _cache_bytes + len(audio) > MAX_CACHE_BYTES):
            _, evicted = _cache.popitem(last=False)
            _cache_bytes -= len(evicted)
        _cache[cache_key] = audio
        _cache_bytes += len(audio)
    return audio


@router.post("/speak")
async def speak(request: SpeechRequest) -> Response:
    return Response(await render_speech(request), media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
