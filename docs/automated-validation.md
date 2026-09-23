# Automated validation and false-flag experiments

Implemented 2026-09-23. Validation uses recordings that dataset annotators already
labeled. Learners do not grade their speech, mark boundaries, or supply training
labels to use the app.

The first automated experiment **did not pass** its acceptance rule. The app keeps
its scores and 80-point review threshold. The boundary inference runner and candidate
comparison are implemented and tested. The obtained L2-ARCTIC v5.0 corpus now supplies
a [100-recording human boundary baseline](word-boundary-baseline.md), including
measured target clipping. No better acoustic accuracy is claimed.

## Run the score experiment

```bash
npm run benchmark:validate
```

This uses the latest completed, matching 100-recording calibration and validation
archives on disk. No microphone, human grading, downloads, backend or model inference
is needed. If archives are missing, use [evaluation foundation](evaluation-foundation.md)
to prepare and score them. `--limit` selects another already-prepared subset.

For exact reproduction, supply `--calibration-run` and `--validation-run` with the
archive directories. Initial inputs, under
`datasets/speechocean762/613968e3b0b789fc33936fb5eba1973176ba7d11/runs/`, were:

- Calibration: `2026-09-22T20-13-46-325Z`.
- Validation: `2026-09-22T20-14-13-552Z`.

Outputs use a new ignored `datasets/validation-<timestamp>/` directory:

- `candidate.json`: rule, selected cutoff, calibration sweep and input/code hashes,
  written **before** opening validation labels or responses.
- `report.json`: counts, coverage/exclusions, paired speaker-bootstrap intervals,
  calibration diagnostics, example IDs, hashes and archived inference latency.
- `report.md`: readable comparison and decision.

The frozen split plan, label hashes, complete raw IDs, matching scorer revision and
speaker separation are checked. The final reservation is untouched. Validation is
development evidence, already inspected in earlier milestones; it is not a fresh
final test. Repeated development must retain that distinction.

### Experiment and decision rule

`global-review-cutoff-v1` searches integer cutoffs 0–80 on calibration speakers only.
It minimizes false-positive rate with at most five percentage points less error
recall than cutoff 80. Ties prefer more recall, then the higher cutoff. It requires
at least 20 human errors across at least five speakers; otherwise it retains 80.

Validation compares both policies on identical mapped slots. The development gate
requires enough validation errors, a paired 95% upper bound below zero for the
false-positive-rate change, and a lower bound of at least −5 percentage points for
recall change. The bootstrap draws speakers, carrying all their observations, for
2,000 deterministic replicates. Undefined metrics stay null. These tolerances are
engineering choices, not established universal release thresholds.

This fits a **review cutoff**, not pronunciation scores or probabilities. Even a
passed development gate needs broader mapping and representative-speaker evidence
before adoption. The command never changes app settings, weights or saved recordings.

### First measured result

Calibration selected **38**. Validation used 100 recordings from 25 separate speakers:
1,261 of 1,928 eligible phones mapped (65.4%). A positive label requires at least
three of five experts to mark incorrect/missed; accent alone is not an error.

| Validation measure | Cutoff 80 | Candidate 38 |
| --- | ---: | ---: |
| Human errors detected | 33 / 38 | 28 / 38 |
| Human errors missed | 5 | 10 |
| Flags without majority-human error | 243 | 176 |
| Flags on majority-human-correct sounds | 239 | 173 |
| Flag precision | 12.0% | 13.7% |
| Error recall | 86.8% | 73.7% |

The candidate removes 67 false flags but misses five additional errors. The paired
95% interval for recall change is approximately −40.0 to −4.5 percentage points.
**Rejected; default unchanged.** This rejects this blanket cutoff under the rule,
not every potential assessment improvement.

Calibration diagnostics show human-correct flags across /ɪ/, /i/, /t/, /l/, /h/,
/ð/, /ə/ and other sounds. Word, stress, position and duration breakdowns retain
support counts; they suggest investigation targets, not causes. Next scoring work
should investigate acoustic/context features, accepted pronunciations and mapping
on development data, then freeze another candidate. Sparse per-phone error counts
do not justify independent phone thresholds here. Synthetic voices and another
model's judgments do not replace independent human labels.

## Word-boundary measurements

The local v5.0 corpus is now available and a diverse 100-recording baseline has run.
Use [the frozen selection and measured results](word-boundary-baseline.md) for the
next candidate comparison. The generic commands below also apply to other imports.

L2-ARCTIC's creators already corrected the manual subset's boundaries. The dataset
holder obtains it through the provider's registration/license process once. Access
and import instructions are in [evaluation foundation](evaluation-foundation.md#manually-corrected-boundary-adapter).
After import, with the local scorer running:

```powershell
npm run benchmark:boundaries:run -- --gold datasets/l2-boundary-validation/gold.jsonl --root "C:\Data\L2-ARCTIC"
```

The runner verifies import/audio hashes and durations, and posts original WAVs only
to literal loopback addresses with redirects refused. It reuses app pronunciations
and word aggregation. Acoustic estimates and playback availability stay separate:
shared word spans can retain estimates while isolated replay is unavailable.
Playback uses the app's inward sample rounding at the corpus rate. It simulates
intervals, not browser decoding, device playback or codec effects.

Every imported recording remains in `predictions.jsonl`, including refusals and
transcript mismatches with null spans. `raw.jsonl` retains responses and runtimes.
HTTP 400 refusals count against coverage; server, transport, malformed-response
and provenance failures abort without a completed report. Import exclusions are
reported separately. Output directories are new; source files are unchanged.

`report.json` measures mean/p95 boundary error, 20/50 ms agreement, timing/replay
coverage, neighbor speech, target clipping, failures and runtime. It never invents
pronunciation grades from timing labels. Compare normalized candidate outputs:

```powershell
npm run benchmark:boundaries:compare -- datasets/l2-boundary-validation/gold.jsonl BASELINE/predictions.jsonl CANDIDATE/predictions.jsonl datasets/boundary-comparison.json
```

Both files retain every recording and word, scorer/configuration revision, explicit
`correct: null` when unjudged, and null spans for failures. Adapters supply actual
playback intervals or null; omitted playback defaults to the acoustic span. Optional
`milliseconds` yields runtime coverage, median and p95. Reports include paired
speaker-bootstrap changes and worst cases. Lower errors at lower coverage alone
do not establish improvement. The local Qwen and MFA 2.2.4 adapters are in
`scripts/benchmark-qwen-boundaries.py` and `scripts/benchmark-mfa-boundaries.py`.
They run only against an acknowledged frozen development import, hash-check source
audio, retain null outputs and store copies/reports under ignored `datasets/`. See
the [measured candidate tradeoffs](word-boundary-baseline.md#local-aligner-candidates).
The MFA 3 Windows build was unavailable here, so the MFA result is explicitly 2.2.4.
Neither adapter changes app defaults.

## Responsibilities and verification

Development automation handles public-data comparisons. The dataset holder handles
gated access once. A later personal/native-US study can use qualified reviewers;
it is needed for claims about those populations, not to start public-data work.
Learners are not responsible for annotating benchmark recordings.

`npm run check:validation` tests calibration-only selection, speaker intervals,
rejection on lost recall, boundary conversion, refusal coverage, changed inputs,
path escapes and incomplete runs using original synthetic fixtures. `npm run check`
includes it. The Daily browser regression now separately checks immutable event
evidence and derived analysis, and passes the complete simulated flow.
