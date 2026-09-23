"""Run the local Qwen forced aligner on a frozen manual boundary development set.

Run with backend/.venv/Scripts/python.exe after installing qwen-asr there. The
corpus and all generated artifacts stay under ignored datasets/.
"""
import argparse
import hashlib
import json
import math
import re
import time
import unicodedata
import wave
from datetime import datetime, timezone
from pathlib import Path

MODEL = "Qwen/Qwen3-ForcedAligner-0.6B"
PACKAGE_VERSION = "0.0.6"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def atomic_jsonl(path: Path, rows: list[dict]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")
    temporary.replace(path)


def normalized_token(text: str) -> str:
    return "".join(char.casefold() for char in text if not unicodedata.category(char).startswith("P"))


def playback_slice(start: float, end: float, duration: float, sample_rate: int):
    lower, upper = max(0.0, start), min(duration, end)
    first, last = math.ceil(lower * sample_rate), math.floor(upper * sample_rate)
    if first / sample_rate < lower:
        first += 1
    if last / sample_rate > upper:
        last -= 1
    return {"start": first / sample_rate, "end": last / sample_rate} if last > first else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", type=Path, required=True)
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    datasets = (repo / "datasets").resolve()
    gold_path, corpus_root = args.gold.resolve(), args.root.resolve()
    if not gold_path.is_relative_to(datasets):
        raise SystemExit("Gold must be under the local ignored datasets/ folder")
    gold_bytes = gold_path.read_bytes()
    gold = [json.loads(line) for line in gold_bytes.splitlines() if line.strip()]
    manifest_path = gold_path.parent / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest = json.loads(manifest_bytes)
    if (manifest.get("dataset"), manifest.get("annotationSource"), manifest.get("split")) != ("l2-arctic", "human", "validation"):
        raise SystemExit("Only the frozen human-annotated development subset is allowed")
    if manifest.get("termsAcknowledgedLocally") is not True or sha256(gold_bytes) != manifest.get("goldSha256"):
        raise SystemExit("Local license acknowledgement or gold checksum is missing/changed")
    if len(gold) != manifest.get("imported") or len(gold) != 100:
        raise SystemExit("This comparison requires the unchanged 100-recording pilot")
    if [({"id": row["id"], "audio": row["audio"], "audioSha256": row["audioSha256"]}) for row in gold] != [
        {key: entry[key] for key in ("id", "audio", "audioSha256")} for entry in manifest["sourceFiles"]
    ]:
        raise SystemExit("Gold audio identities differ from the frozen import manifest")

    target = args.output.resolve() if args.output else gold_path.parent / f"qwen3-run-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ')}"
    if not target.is_relative_to(datasets) or target == corpus_root or corpus_root in target.parents:
        raise SystemExit("Output must be a new directory under datasets/, outside the source corpus")
    target.mkdir(parents=True, exist_ok=False)

    import importlib.metadata
    import torch
    from qwen_asr import Qwen3ForcedAligner

    if importlib.metadata.version("qwen-asr") != PACKAGE_VERSION:
        raise SystemExit(f"Expected qwen-asr=={PACKAGE_VERSION}")
    if not torch.cuda.is_available():
        raise SystemExit("CUDA is required; refusing an accidental CPU run")
    if not torch.cuda.is_bf16_supported():
        raise SystemExit("This runner is configured for BF16; GPU does not support it")

    run = {
        "schemaVersion": 1,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": manifest["dataset"], "datasetRevision": manifest["datasetRevision"],
        "split": manifest["split"], "recordings": len(gold), "speakers": len(manifest["speakers"]),
        "goldSha256": sha256(gold_bytes), "manifestSha256": sha256(manifest_bytes),
        "model": MODEL, "modelRevision": None, "package": f"qwen-asr=={PACKAGE_VERSION}",
        "torch": torch.__version__, "cuda": torch.version.cuda, "gpu": torch.cuda.get_device_name(0),
        "playback": "Predicted acoustic intervals rounded inward to the original audio sample rate, matching app playbackSlice.",
        "limitations": ["Validation recordings are development data, not a speaker-disjoint final test.",
                        "Manual corpus is local CC BY-NC 4.0 data; do not distribute corpus or generated outputs."],
    }
    atomic_json(target / "run.json", run)
    print(f"Loading {MODEL} on {run['gpu']} ({run['torch']}, CUDA {run['cuda']})", flush=True)
    model = Qwen3ForcedAligner.from_pretrained(MODEL, dtype=torch.bfloat16, device_map="cuda:0")
    run["modelRevision"] = model.model.config._commit_hash
    atomic_json(target / "run.json", run)

    predictions, raw = [], []
    for index, row in enumerate(gold, 1):
        audio_path = (corpus_root / row["audio"]).resolve()
        if corpus_root not in audio_path.parents:
            raise SystemExit(f"Audio path escapes corpus root: {row['id']}")
        audio_bytes = audio_path.read_bytes()
        if sha256(audio_bytes) != row["audioSha256"]:
            raise SystemExit(f"Audio checksum changed: {row['id']}")
        with wave.open(str(audio_path), "rb") as wav:
            sample_rate, frames = wav.getframerate(), wav.getnframes()
            if abs(frames / sample_rate - row["duration"]) > 0.05:
                raise SystemExit(f"Audio duration changed: {row['id']}")

        start_time = time.perf_counter()
        result = model.align(str(audio_path), row["text"], language="English")[0]
        elapsed_ms = (time.perf_counter() - start_time) * 1000
        items = [{"text": item.text, "start": float(item.start_time), "end": float(item.end_time)} for item in result]
        gold_words = row["words"]
        item_tokens = [normalized_token(item["text"]) for item in items]
        gold_tokens = [normalized_token(word["text"]) for word in gold_words]
        error = None
        if len(items) != len(gold_words) or item_tokens != gold_tokens:
            error = "aligned-word-identity-mismatch"

        pred_words, word_errors = [], []
        for i, expected in enumerate(gold_words):
            item = items[i] if error is None else None
            if item and not (0 <= item["start"] < item["end"] <= row["duration"] + 0.001):
                word_errors.append({"index": i, "text": expected["text"], "error": "empty-or-out-of-recording-timestamp"})
                item = None
            pred_words.append({
                "text": expected["text"], "start": item["start"] if item else None,
                "end": item["end"] if item else None, "correct": None,
                "playback": playback_slice(item["start"], item["end"], row["duration"], sample_rate) if item else None,
            })
        prediction = {
            "id": row["id"], "speaker": row["speaker"], "datasetRevision": row["datasetRevision"],
            "scorer": MODEL, "revision": f"{run['modelRevision']}:qwen-asr-{PACKAGE_VERSION}:bf16-cuda",
            "milliseconds": elapsed_ms, "words": pred_words,
        }
        if error:
            prediction["error"] = error
        if word_errors:
            prediction["wordErrors"] = word_errors
        predictions.append(prediction)
        raw.append({"id": row["id"], "text": row["text"], "items": items, "milliseconds": elapsed_ms,
                    "error": error, "wordErrors": word_errors})
        atomic_jsonl(target / "predictions.jsonl", predictions)
        atomic_jsonl(target / "raw.jsonl", raw)
        if index % 10 == 0 or index == len(gold):
            print(f"Aligned {index}/{len(gold)} recordings", flush=True)

    if sha256(gold_path.read_bytes()) != manifest["goldSha256"]:
        raise SystemExit("Gold changed while the benchmark was running")
    run["completedAt"] = datetime.now(timezone.utc).isoformat()
    run["failures"] = [{"id": row["id"], "error": row["error"]} for row in predictions if row.get("error")]
    atomic_json(target / "run.json", run)
    print(json.dumps({"output": str(target), "failures": len(run["failures"]), "modelRevision": run["modelRevision"]}, indent=2))


if __name__ == "__main__":
    main()
