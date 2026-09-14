"""
Small command line for the Makefile: `health`, `check`, `clean`.

These live in Python rather than in the Makefile recipes so the targets work
the same whether make hands them to cmd.exe or to a POSIX shell.
"""

from __future__ import annotations

import json
import shutil
import sys
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")  # IPA through a cp1252 console otherwise dies

ROOT = Path(__file__).resolve().parent.parent

_failures = 0


def check(label: str, actual: object, expected: object) -> None:
    global _failures
    if actual == expected:
        print(f"  ok   {label}")
    else:
        _failures += 1
        print(f"  FAIL {label}\n       expected {expected!r}\n       actual   {actual!r}")


# -- health -------------------------------------------------------------------


def health() -> int:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5) as res:
            info = json.load(res)
    except urllib.error.URLError as err:
        print(f"the scoring service is not answering on :8000 ({err.reason})")
        print("start it with `make api`, or `make dev` to run it alongside the web app.")
        return 1

    print("scoring service: up")
    for key, value in info.items():
        print(f"  {key}: {value}")
    if not info.get("cuda"):
        print("\nnote: running on CPU. Analysis will work but take seconds, not tenths.")
    return 0


# -- check --------------------------------------------------------------------


def check_suite() -> int:
    from . import align, audio, phones

    print("phone mapping")
    tokens, sources, variants = phones.to_tokens(["θ", "ɪ", "ŋ", "k"])
    check("consonants and lax vowels map straight through", tokens, ["θ", "ɪ", "ŋ", "k"])
    check("each token owns one expected phone", sources, [[0], [1], [2], [3]])

    tokens, sources, _ = phones.to_tokens(["k", "ɑ", "ɹ"])
    check("a vowel before /ɹ/ becomes one espeak token", tokens, ["k", "ɑːɹ"])
    check("and that token answers for both phones", sources, [[0], [1, 2]])

    check("a phone with no accepted variant offers none", variants[0], [])

    _, _, variants = phones.to_tokens(["t", "ə", "l", "i"])
    check("a /t/ may be tapped or glottalled", variants[0], ["ɾ", "ʔ"])
    # espeak writes the reduced vowel of "about" as ɐ, not ə. Scoring against
    # the canonical token alone marks down every unstressed vowel in English.
    check("a schwa may surface as espeak's ɐ", variants[1][0], "ɐ")
    check("a coda /l/ may be dark", variants[2], ["ɫ"])
    check("and a tense vowel may lose its length mark", variants[3], ["i", "ɪ"])

    tokens, _, _ = phones.to_tokens(["i", "ɡ", "u"])
    check("espeak carries length in the symbol", tokens, ["iː", "ɡ", "uː"])

    tokens, sources, _ = phones.to_tokens(["s", "!", "t"])
    check("phones outside the inventory are dropped, not guessed", tokens, ["s", "t"])
    check("and the surviving indices still point at the right phones", sources, [[0], [2]])

    print("\nforced alignment")
    # A doubled phone is the case that a merge-by-token-value helper collapses.
    T, C = 12, 5
    lp = np.full((T, C), np.log(0.01))
    for t, c in enumerate([1, 1, 0, 1, 1, 0, 2, 2, 2, 0, 0, 0]):
        lp[t, c] = np.log(0.9)
    lp -= np.log(np.exp(lp).sum(axis=1, keepdims=True))
    spans = align.viterbi_align(lp, [1, 1, 2], blank=0)
    check("a doubled phone keeps two separate slots", len(spans), 3)
    check("which do not overlap", spans[0][1] <= spans[1][0], True)
    check("and are in order", spans[1][1] <= spans[2][0], True)

    check(
        "a line longer than the recording is refused rather than aligned",
        _raises(lambda: align.viterbi_align(lp, list(range(1, 5)) * 5, blank=0)),
        True,
    )

    print("\nverdicts")
    absent = align.PhoneScore("t", 6, 4, 4, -9.0, 0.0, None, 0.0)
    check("a phone with no frames is missing", align.verdict_for(absent), "missing")
    swapped = align.PhoneScore("θ", 52, 0, 5, -7.0, 0.001, "s", 0.9)
    check("a phone swapped for another is wrong, not missing", align.verdict_for(swapped), "wrong")
    clean = align.PhoneScore("s", 5, 0, 5, 0.0, 0.99, "z", 0.01)
    check("a phone the model agrees with is correct", align.verdict_for(clean), "correct")
    check("a perfect GOP is 100", align.to_percent(0.0), 100)
    check("and the floor is 0", align.to_percent(-99.0), 0)

    print("\naudio")
    quiet = np.concatenate([np.zeros(8000), np.ones(1600) * 0.5, np.zeros(8000)]).astype(np.float32)
    trimmed, _ = audio.trim_silence(quiet)
    check("silence is trimmed back to a tenth of a second either side", len(trimmed), 4800)
    check("a fully silent take survives trimming", len(audio.trim_silence(np.zeros(100, np.float32))[0]), 100)

    print()
    if _failures:
        print(f"{_failures} check(s) failed")
        return 1
    print("all checks passed")
    return 0


def _raises(fn) -> bool:
    try:
        fn()
    except Exception:
        return True
    return False


# -- clean --------------------------------------------------------------------


def clean() -> int:
    removed = []
    for cache in ROOT.rglob("__pycache__"):
        shutil.rmtree(cache, ignore_errors=True)
        removed.append(str(cache.relative_to(ROOT)))
    print(f"removed {len(removed)} __pycache__ director{'y' if len(removed) == 1 else 'ies'}")
    print("left alone: backend/.venv and the Hugging Face model cache (~1.2 GB to refetch).")
    print("  venv:   uv sync --directory backend --reinstall")
    print("  models: delete ~/.cache/huggingface/hub")
    return 0


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "check"
    if command == "health":
        return health()
    if command == "check":
        return check_suite()
    if command == "clean":
        return clean()
    print(f"unknown command {command!r}; expected health, check or clean")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
