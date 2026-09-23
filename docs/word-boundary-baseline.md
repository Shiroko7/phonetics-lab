# First measured word-boundary baseline

Measured 2026-09-23 with the unchanged revision-2 local scorer. The registered
dataset holder supplied the provider's v5.0 download link. The complete archive
was downloaded locally; all 3,599 manual annotations and their matching original
WAV/transcript files were extracted, with original license/readme files retained.
Downloaded resources and detailed results remain in ignored `datasets/`.

## Frozen development selection

The current selection contains **100 recordings, 24 speakers, 81 distinct prompt
IDs, 82 distinct annotated sentence texts and 975 words**. Every selected recording
imported and scored successfully; there were no import exclusions, refusals or
unavailable timing/replay results. Four or five recordings come from each speaker.

Selection `l2-boundary-pilot-v2` uses speaker round-robin and hashes of each
speaker/filename combination, before reading annotations or predictions. The
initial v1 sampler hashed filenames without speaker identity, resulting in just
six distinct sentence texts across 100 recordings. That run remains archived;
v2 improves sentence diversity without selecting by model performance. It is now
the importer default; `--selection v1` reproduces the old selection. Future
candidate comparisons must use the **same frozen v2 rows**, not resample.

This is a development sample of prompted learner speech, including Spanish-L1
speakers. It is not a held-out final test, native-US control set, spontaneous speech
study or full-corpus evaluation. The separate speechocean final reservation remains
untouched. No scoring or playback defaults were changed.

## Results

| Measure | Revision-2 baseline |
| --- | ---: |
| Timing / isolated-replay coverage | 975 / 975 words |
| Mean absolute boundary error | 59.6 ms |
| 95th-percentile absolute boundary error | 160.0 ms |
| Boundaries within 20 ms | 18.3% |
| Boundaries within 50 ms | 52.9% |
| Mean annotated target duration clipped per replay | 115.2 ms |
| Total annotated target duration clipped | 33.5% |
| Clips intersecting an annotated neighboring word | 128 / 975 (13.1%) |
| Mean neighboring-word duration included per replay | 1.9 ms |
| Median / p95 local request time, warm model | 30.0 / 38.0 ms |

Word starts are late on 943/975 words; ends are early on 839/975. Mean signed
onset and offset errors are +54.6 and −57.5 ms respectively. This pattern indicates
intervals that are generally too short, rather than one shared timestamp shift.
It is consistent with deriving word spans from short CTC token-emission runs;
that mechanism is a hypothesis for investigation, not an independently established
cause for every recording.

Strict any-clipping occurs on 972/975 words, but even a tiny boundary discrepancy
counts. The 115.2 ms average and 33.5% duration loss communicate severity better.
These are overlaps with annotated word intervals, not measurements of lost audible
phonation or intelligibility. Provider boundaries have no independent-rater ranges.

A 2,000-replicate speaker bootstrap gives 95% intervals of **55.5–63.8 ms** for mean
boundary error, **107.7–122.9 ms** for mean target clipping, and **10.7–15.6%** for
neighbor leakage. These describe sampling across the observed speakers and do not
account for systematic annotation bias, new populations or model-training overlap.

The worst-recording and worst-word IDs/spans are retained in local `diagnostics.json`.
The three largest recording-level mean errors were 109.1, 102.3 and 101.5 ms; two
of those recordings lost about half of their annotated target-word duration.
No pronunciation-correctness grades were inferred from the word-boundary labels.

## Reproduce and compare

Current workspace paths:

- Source: `datasets/l2-arctic-v5.0/manual/`.
- Frozen import: `datasets/l2-boundary-validation-v5-100-v2/`.
- Baseline run: `run-2026-09-23T18-34-02-151Z/` within that import.
- Reports: `report.json`, `report.md`, `diagnostics.json`, `predictions.jsonl`,
  `raw.jsonl` and `run.json` within the run directory.

With the local service running:

```powershell
npm run benchmark:boundaries:run -- --gold datasets/l2-boundary-validation-v5-100-v2/gold.jsonl --root datasets/l2-arctic-v5.0/manual
```

This creates a new run directory without overwriting the baseline. To reproduce
the selection elsewhere, obtain the corpus and import into a new output directory:

```powershell
npm run benchmark:boundaries:import -- --root YOUR_CORPUS --output datasets/NEW_IMPORT --revision v5.0 --acknowledge-terms --limit 100 --selection v2
```

The archive's locally computed SHA-256 is
`490d5a43e48b0af84f6bce8e766ad453e8cd670521d5876bb4d0741cca304fda`.
This checks local integrity; it is not a publisher-authenticated checksum.
The imported gold hash, per-file hashes and scoring source fingerprint are in the
manifests. The loaded model configuration commit is
`ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4`; complete model-weight provenance remains
a separate limitation. Runtime uses CUDA on the local RTX 5080 Laptop GPU.

Original corpus WAVs are sent only to the local scorer. Replay intervals are
simulated using the app's sample rounding at the corpus's 44.1 kHz rate. Browser
capture/codec/device playback are not measured. The source license is CC BY-NC 4.0;
these resources do not enter the app build or practice deck.

## Local aligner candidates

Both local candidates ran on the exact 100 frozen recordings. Neither was adopted;
each trades shorter target clipping for more neighboring speech in app-style replay.
Reports compare candidate-minus-current with paired bootstrap resampling across the
24 speakers (2,000 replicates). Timings are provider word intervals, rounded inward
at the corpus sample rate for replay. Pronunciation remains unjudged.

| Measure | Revision-2 app | Qwen3-ForcedAligner-0.6B | MFA 2.2.4 / english_us_arpa |
| --- | ---: | ---: | ---: |
| Timed / replayable words | 975 / 975 | 902 / 975 (92.5%) | 975 / 975 |
| Mean / p95 boundary error | 59.6 / 160.0 ms | 43.3 / 120.0 ms | 41.3 / 156.8 ms |
| Within 50 ms | 52.9% | 68.7% | 87.2% |
| Mean target duration clipped per replay | 115.2 ms | 60.9 ms | 22.8 ms |
| Total annotated target duration clipped | 33.5% | 16.9% | 6.6% |
| Clips intersecting neighbor speech | 13.1% | 53.0% | 53.6% |
| Mean neighbor speech included per replay | 1.9 ms | 22.8 ms | 17.4 ms |
| Warm alignment time | 30 / 38 ms median / p95 | 47.9 / 56.9 ms per file | 82.0 s for 100 files |

Qwen leaves 73 words untimed because it assigns zero-width timestamps; these remain
null in the output. Among the timed words, its mean boundary-error change was
−16.3 ms (95% speaker-bootstrap interval −20.2 to −12.6), and target clipping fell
54.3 ms (−60.6 to −48.0). Neighbor speech rose 20.8 ms (19.0 to 22.6) and replay
coverage fell 7.5 percentage points (−9.0 to −5.9). Times are emitted on a coarse
80 ms grid. Its checkpoint revision is `c7cbfc2048c462b0d63a45797104fc9db3ad62b7`.

MFA 2.2.4 kept full timing coverage. Its mean-error change was −18.2 ms, with a
speaker-bootstrap interval from −31.4 to +2.3 ms, so a mean-accuracy gain is not
established on this sample. Target clipping fell 92.3 ms (−101.3 to −82.2), while
neighbor speech rose 15.4 ms (11.1 to 22.7). Its p95 error remains 156.8 ms. MFA
3 could not be run here: the Windows conda-forge package is 2.2.4; the current 3.x
package has no Windows build. This result is explicitly the older MFA baseline.

Worst-case inspection found one MFA 2.2.4 recording (`MBMPS/arctic_a0212`) with
about 815 ms mean boundary error: after a pause, the alignment jumps roughly 1.2 s
early and stays offset, even though all transcript words match and nominal coverage
is 100%. This is why token identity and aggregate coverage cannot serve as an
alignment-confidence check by themselves. In the manual-boundary comparison, the
candidate is already about 0.7 s early at “walk” and about 1.1 s early from “they”
onward. Qwen on the same recording leaves the short article “the” untimed; on another
high-error recording (`HQTV/arctic_a0127`), it times only 6 of 8 words. This is a
comparison against expert-corrected timestamps, not a new
independent listening adjudication of those specific clips.

**Decision:** neither candidate is a safe default change. Both improve target
coverage, but their replay clips pull in substantially more adjacent words. Qwen
also abstains on 7.5% of words. Keep the current scorer while the next alignment
work tests boundary ownership/context and replay policy together, investigates MFA 3
on a supported platform, and checks the worst cases. Do not infer pronunciation
correctness from any of these time-alignment measurements.

The follow-up failure inspection supports two explicit checks for future candidates:
detect persistent timing offsets after pauses, and retain word-level abstention in
coverage rather than hiding it behind recording-level success. MFA 3 still needs a
supported Linux environment; this Windows host has no WSL or Docker installation.

## Replay trim sweep

An offline sweep applies symmetric inward trims of 0, 20, 40, 60 and 80 ms to the
candidate playback intervals, then uses the app's sample-rounded playback function.
It never changes candidate acoustic timestamps or boundary-error scores. Results
below are pooled across the same 975 annotated words; paired intervals resample the
24 speakers. Reports and input hashes are kept locally in the ignored candidate run
directories as `trim-sweep.json`.

| Candidate / trim | Mean neighbor included | Clips with neighbor speech | Mean target clipped | Replay coverage |
| --- | ---: | ---: | ---: | ---: |
| Qwen / 0 ms | 22.8 ms | 53.0% | 60.9 ms | 92.5% |
| Qwen / 20 ms | 12.1 ms | 34.4% | 88.6 ms | 92.5% |
| Qwen / 40 ms | 6.4 ms | 20.9% | 118.3 ms | 82.8% |
| Qwen / 60 ms | 2.8 ms | 9.7% | 154.5 ms | 82.8% |
| Qwen / 80 ms | 1.6 ms | 4.3% | 192.8 ms | 64.8% |
| MFA 2.2.4 / 0 ms | 17.4 ms | 53.6% | 22.8 ms | 100.0% |
| MFA 2.2.4 / 20 ms | 7.9 ms | 16.3% | 50.8 ms | 99.7% |
| MFA 2.2.4 / 40 ms | 5.2 ms | 7.1% | 84.5 ms | 96.0% |
| MFA 2.2.4 / 60 ms | 4.3 ms | 3.8% | 119.0 ms | 88.2% |
| MFA 2.2.4 / 80 ms | 3.8 ms | 2.8% | 154.7 ms | 80.7% |

At 20 ms, the paired speaker-bootstrap change in mean neighbor speech was
−10.7 ms for Qwen (95% interval −11.3 to −10.1) and −9.5 ms for MFA (−10.3 to
−8.8). Mean target clipping rose by 27.7 ms (27.1 to 28.3) and 28.0 ms (27.0 to
28.8), respectively. Qwen's replay coverage did not change at 20 ms; MFA's fell by
0.3 percentage points. Mean boundary error and timing coverage are unchanged at
every trim, by design. These are interval-overlap metrics, not judgments of audible
intelligibility. The sweep quantifies a tradeoff on this development sample; it does
not establish a universally suitable trim or justify changing the app default.

Reproduce the analysis with `npm run benchmark:boundaries:trim -- GOLD.jsonl
PREDICTIONS.jsonl NEW_REPORT.json`. The output must be a new file under local
`datasets/`; final/test splits are refused. The synthetic policy check is part of
`npm run check:benchmark`.

All downloaded model/data files, copied benchmark audio, partial logs and prediction
outputs remain under ignored `datasets/`. The downloaded model versions, checksums,
and candidate report paths are in their respective local `run.json` and comparison
files. MFA's generated folders and Qwen's raw outputs contain noncommercial corpus
material and must not be distributed.

The completed local runs are `qwen3-run-2026-09-23T19-03-34-069695Z/` and
`mfa-run-2026-09-23T18-57-22-142455Z/`, beside the frozen `gold.jsonl`. Their
`compare-vs-current.json` files are the paired reports. With the corresponding local
environments created, the candidate adapters can be rerun without network audio:

```powershell
datasets/l2-boundary-validation-v5-100-v2/qwen-env/Scripts/python.exe scripts/benchmark-qwen-boundaries.py --gold datasets/l2-boundary-validation-v5-100-v2/gold.jsonl --root datasets/l2-arctic-v5.0/manual

$pilot = (Resolve-Path 'datasets/l2-boundary-validation-v5-100-v2').Path
subst X: $pilot
$env:MFA_ROOT_DIR = 'X:\mfa-short'
X:\mfa-tools\Library\bin\micromamba.exe run -p X:\mfa-env mfa server start
backend/.venv/Scripts/python.exe scripts/benchmark-mfa-boundaries.py --gold datasets/l2-boundary-validation-v5-100-v2/gold.jsonl --root datasets/l2-arctic-v5.0/manual --mfa-env "$pilot\mfa-env" --micromamba "$pilot\mfa-tools\Library\bin\micromamba.exe" --mfa-root 'X:\mfa-short'
X:\mfa-tools\Library\bin\micromamba.exe run -p X:\mfa-env mfa server stop
subst X: /d
```
