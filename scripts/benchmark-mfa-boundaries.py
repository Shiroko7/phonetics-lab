"""Prepare and run a frozen L2-ARCTIC boundary sample using MFA 2.x.

All copies, MFA models and reports must remain under ignored datasets/ because
L2-ARCTIC is CC BY-NC 4.0. This wrapper needs local MFA and micromamba paths.
"""
import argparse
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import time
import unicodedata
import wave
from datetime import datetime, timezone
from pathlib import Path


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def atomic_json(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def atomic_jsonl(path, values):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in values), encoding="utf-8")
    temp.replace(path)


def token(text):
    return "".join(char.casefold() for char in text if not unicodedata.category(char).startswith("P"))


def parse_words(textgrid):
    content = textgrid.read_text(encoding="utf-8-sig")
    tier = re.search(r'item \[\d+\]:\s*\n\s*class = "IntervalTier"\s*\n\s*name = "words"(.*?)(?=\n\s*item \[\d+\]:|\Z)', content, re.S)
    if not tier:
        return []
    words = []
    for block in re.finditer(r'intervals \[\d+\]:\s*\n(.*?)(?=\n\s*intervals \[\d+\]:|\Z)', tier.group(1), re.S):
        value = block.group(1)
        start = re.search(r'^\s*xmin = ([^\s]+)', value, re.M)
        end = re.search(r'^\s*xmax = ([^\s]+)', value, re.M)
        label = re.search(r'^\s*text = ("(?:[^"]|"")*")\s*$', value, re.M)
        if not (start and end and label):
            continue
        word = label.group(1)[1:-1].replace('""', '"')
        if word:
            words.append({"text": word, "start": float(start.group(1)), "end": float(end.group(1))})
    return words


def playback_slice(start, end, duration, sample_rate):
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
    parser.add_argument("--mfa-env", type=Path, required=True)
    parser.add_argument("--micromamba", type=Path, required=True)
    parser.add_argument("--mfa-root", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[1]
    datasets = (repo / "datasets").resolve()
    gold_path, corpus_root = args.gold.resolve(), args.root.resolve()
    mfa_env, micromamba, mfa_root = args.mfa_env.resolve(), args.micromamba.resolve(), args.mfa_root
    if not gold_path.is_relative_to(datasets):
        raise SystemExit("Gold must be under ignored datasets/")
    gold_bytes, manifest_bytes = gold_path.read_bytes(), (gold_path.parent / "manifest.json").read_bytes()
    gold, manifest = [json.loads(line) for line in gold_bytes.splitlines() if line.strip()], json.loads(manifest_bytes)
    if (manifest.get("dataset"), manifest.get("annotationSource"), manifest.get("split")) != ("l2-arctic", "human", "validation"):
        raise SystemExit("Only frozen human-annotated development data is permitted")
    if manifest.get("termsAcknowledgedLocally") is not True or sha256(gold_bytes) != manifest.get("goldSha256"):
        raise SystemExit("Local terms acknowledgement or gold checksum is missing/changed")
    if len(gold) != 100 or len(gold) != manifest.get("imported"):
        raise SystemExit("Expected the unchanged 100-recording pilot")
    if not micromamba.is_file() or not (mfa_env / "Scripts" / "mfa.exe").is_file():
        raise SystemExit("MFA environment or micromamba executable not found")
    acoustic_bytes = (mfa_root / "pretrained_models" / "acoustic" / "english_us_arpa.zip").read_bytes()
    dictionary_bytes = (mfa_root / "pretrained_models" / "dictionary" / "english_us_arpa.dict").read_bytes()
    target = args.output.resolve() if args.output else gold_path.parent / f"mfa-run-{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H-%M-%S-%fZ')}"
    if not target.is_relative_to(datasets) or corpus_root in target.parents:
        raise SystemExit("Output must be a new directory under datasets/, outside source corpus")
    target.mkdir(parents=True, exist_ok=False)
    mfa_corpus, aligned = target / "corpus", target / "aligned"
    mfa_corpus.mkdir()
    run = {
        "schemaVersion": 1, "startedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": manifest["dataset"], "datasetRevision": manifest["datasetRevision"], "split": manifest["split"],
        "recordings": len(gold), "speakers": len(manifest["speakers"]), "goldSha256": sha256(gold_bytes),
        "manifestSha256": sha256(manifest_bytes), "aligner": "Montreal Forced Aligner",
        "alignerVersion": "2.2.4", "dictionary": "english_us_arpa", "acousticModel": "english_us_arpa",
        "acousticModelSha256": sha256(acoustic_bytes), "dictionarySha256": sha256(dictionary_bytes),
        "playback": "Predicted word intervals rounded inward at source sample rate, matching app playbackSlice.",
        "limitations": ["Windows conda-forge provides MFA 2.2.4; roadmap target MFA 3 is not available for this platform.",
                        "Validation recordings are development data, not a speaker-disjoint final test.",
                        "Manual corpus is local CC BY-NC 4.0 data; do not distribute corpus or generated outputs."],
    }
    atomic_json(target / "run.json", run)
    for row in gold:
        source = (corpus_root / row["audio"]).resolve()
        if corpus_root not in source.parents:
            raise SystemExit(f"Audio path escapes corpus root: {row['id']}")
        audio = source.read_bytes()
        if sha256(audio) != row["audioSha256"]:
            raise SystemExit(f"Changed audio checksum: {row['id']}")
        speaker, filename = row["id"].split("/", 1)
        folder = mfa_corpus / speaker
        folder.mkdir(exist_ok=True)
        destination = folder / f"{filename}.wav"
        shutil.copyfile(source, destination)
        destination.with_suffix(".lab").write_text(row["text"] + "\n", encoding="utf-8")

    env = os.environ.copy()
    env["MFA_ROOT_DIR"] = str(mfa_root)
    env["OMP_NUM_THREADS"] = "1"
    command = [str(micromamba), "run", "-p", str(mfa_env), "mfa", "align", str(mfa_corpus),
               "english_us_arpa", "english_us_arpa", str(aligned), "--clean", "--num_jobs", "4"]
    atomic_json(target / "command.json", {"argv": command, "mfaRoot": str(mfa_root)})
    print("Running MFA 2.2.4 on the 100 frozen recordings…", flush=True)
    start = time.perf_counter()
    completed = subprocess.run(command, env=env, cwd=target, text=True, encoding="utf-8", errors="replace",
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (target / "mfa.log").write_text(completed.stdout, encoding="utf-8")
    run["alignmentWallSeconds"] = time.perf_counter() - start
    if completed.returncode:
        run["failedAt"] = datetime.now(timezone.utc).isoformat()
        run["commandReturnCode"] = completed.returncode
        atomic_json(target / "run.json", run)
        raise SystemExit(f"MFA failed (exit {completed.returncode}); see {target / 'mfa.log'}")

    predictions = []
    for row in gold:
        speaker, filename = row["id"].split("/", 1)
        textgrid = aligned / speaker / f"{filename}.TextGrid"
        items = parse_words(textgrid) if textgrid.is_file() else []
        expected, actual = row["words"], [token(item["text"]) for item in items]
        error = None
        if len(items) != len(expected) or actual != [token(word["text"]) for word in expected]:
            error = "aligned-word-identity-mismatch-or-output-missing"
        with wave.open(str(corpus_root / row["audio"]), "rb") as wav:
            sample_rate = wav.getframerate()
        words, word_errors = [], []
        for i, reference in enumerate(expected):
            item = items[i] if error is None else None
            if item and not (0 <= item["start"] < item["end"] <= row["duration"] + 0.001):
                word_errors.append({"index": i, "text": reference["text"], "error": "empty-or-out-of-recording-timestamp"})
                item = None
            words.append({"text": reference["text"], "start": item["start"] if item else None,
                          "end": item["end"] if item else None, "correct": None,
                          "playback": playback_slice(item["start"], item["end"], row["duration"], sample_rate) if item else None})
        prediction = {"id": row["id"], "speaker": row["speaker"], "datasetRevision": row["datasetRevision"],
                      "scorer": "MFA-2.2.4/english_us_arpa", "revision": "mfa-2.2.4:english_us_arpa",
                      "words": words}
        if error:
            prediction["error"] = error
        if word_errors:
            prediction["wordErrors"] = word_errors
        predictions.append(prediction)
        atomic_jsonl(target / "predictions.jsonl", predictions)
    if sha256(gold_path.read_bytes()) != manifest["goldSha256"]:
        raise SystemExit("Gold changed while MFA was running")
    run["completedAt"] = datetime.now(timezone.utc).isoformat()
    run["failures"] = [{"id": p["id"], "error": p["error"]} for p in predictions if p.get("error")]
    run["zeroOrInvalidWordTimings"] = sum(len(p.get("wordErrors", [])) for p in predictions)
    atomic_json(target / "run.json", run)
    print(json.dumps({"output": str(target), "failures": len(run["failures"]),
                      "invalidWords": run["zeroOrInvalidWordTimings"], "alignmentWallSeconds": run["alignmentWallSeconds"]}, indent=2))


if __name__ == "__main__":
    main()
