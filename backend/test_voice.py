"""Reference service regression checks; no network calls in this suite."""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import voice


CATALOGUE = [
    {"ShortName": "en-US-BrianMultilingualNeural", "FriendlyName": "Brian", "Locale": "en-US", "Gender": "Male"},
    {"ShortName": "en-US-EmmaMultilingualNeural", "FriendlyName": "Emma", "Locale": "en-US", "Gender": "Female"},
    {"ShortName": "es-CL-CatalinaNeural", "FriendlyName": "Catalina", "Locale": "es-CL", "Gender": "Female"},
]


class VoiceServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        voice._catalogue = []
        voice._catalogue_at = 0
        voice._catalogue_lock = asyncio.Lock()
        voice._generation_slots = asyncio.Semaphore(2)
        voice._cache.clear()
        voice._cache_bytes = 0

    async def test_catalogue_only_english_and_cached(self):
        with patch.object(voice.edge_tts, "list_voices", new=AsyncMock(return_value=CATALOGUE)) as fetch:
            self.assertEqual(len(await voice.catalogue()), 2)
            await voice.catalogue()
            fetch.assert_awaited_once()

    async def test_catalogue_failure_is_actionable(self):
        with patch.object(voice.edge_tts, "list_voices", new=AsyncMock(side_effect=OSError("offline"))):
            with self.assertRaises(voice.HTTPException) as caught:
                await voice.catalogue()
            self.assertEqual(caught.exception.status_code, 503)

    async def test_audio_cache_separates_voice_and_rate(self):
        calls = []

        class Communicate:
            def __init__(self, text, speaker, rate):
                calls.append((text, speaker, rate))

            async def stream(self):
                yield {"type": "WordBoundary", "text": "ignored"}
                yield {"type": "audio", "data": b"sample-mp3"}

        with patch.object(voice.edge_tts, "list_voices", new=AsyncMock(return_value=CATALOGUE)), patch.object(voice.edge_tts, "Communicate", Communicate):
            request = voice.SpeechRequest(text="A traveler crossed the old bridge.", voice=CATALOGUE[0]["ShortName"])
            self.assertEqual(await voice.render_speech(request), b"sample-mp3")
            await voice.render_speech(request)
            self.assertEqual(len(calls), 1, "replay should not call the online service again")
            await voice.render_speech(request.model_copy(update={"voice": CATALOGUE[1]["ShortName"]}))
            await voice.render_speech(request.model_copy(update={"rate": 0.8}))
            self.assertEqual(len(calls), 3)
            self.assertEqual(calls[-1][2], "-20%")

    async def test_unknown_voice_and_empty_audio_never_succeed(self):
        class EmptySpeech:
            def __init__(self, *args, **kwargs):
                pass

            async def stream(self):
                yield {"type": "WordBoundary"}

        with patch.object(voice.edge_tts, "list_voices", new=AsyncMock(return_value=CATALOGUE)), patch.object(voice.edge_tts, "Communicate", EmptySpeech):
            with self.assertRaises(voice.HTTPException) as unknown:
                await voice.render_speech(voice.SpeechRequest(text="Test sentence.", voice="not-a-voice"))
            self.assertEqual(unknown.exception.status_code, 400)
            with self.assertRaises(voice.HTTPException) as empty:
                await voice.render_speech(voice.SpeechRequest(text="Test sentence.", voice=CATALOGUE[0]["ShortName"]))
            self.assertEqual(empty.exception.status_code, 503)
            self.assertEqual(len(voice._cache), 0)

    async def test_request_limits(self):
        app = FastAPI()
        app.include_router(voice.router)
        with TestClient(app) as client:
            for data in [{"text": "", "voice": "Brian"}, {"text": "a" * 8001, "voice": "Brian"}, {"text": "Test", "voice": "Brian", "rate": 5}]:
                self.assertEqual(client.post("/tts/speak", json=data).status_code, 422)


if __name__ == "__main__":
    unittest.main()
