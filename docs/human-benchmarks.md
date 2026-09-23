# Human benchmarks and the first measured baseline

Updated 2026-09-22. Phase 1 is **in progress**, not complete. This adds evidence and
reproducible tooling; it does not change the pronunciation-scoring algorithm.

The [evaluation foundation](evaluation-foundation.md) now adds frozen speaker-disjoint
partitions, a guarded final reservation, two additional 100-recording development
baselines, separate accent/error phone rubrics, and a local manual-boundary adapter.
This page retains the original pilot results; those speakers are now explicitly
regression data, not an untouched final test. Full manual-boundary evaluation remains
pending a legally obtained local corpus.

## What is working

- An explicit downloader for [speechocean762](https://www.openslr.org/101/), rated
  independently by five experts. Its publisher lists CC BY 4.0. Attribution,
  source README, pinned revision and resource hashes are retained locally.
- A frozen, label-blind selection: deterministic speaker round-robin, without
  selecting by human or model scores. The default pilot has 100 recordings from
  100 different official test speakers. Train/test speaker overlap is rejected.
- Sentence accuracy, fluency and prosody labels, word accuracy/stress labels,
  all five raters for those dimensions, and original phone annotations. Published
  aggregates are preserved, not replaced by our own averages. The original source
  files also retain the other dataset fields.
- The real application's target-word lookup, contextual pronunciation alternatives,
  response decoding and word aggregation are reused by the baseline runner.
- Pearson/Spearman correlation, coverage, displayed-scale error/bias and descriptive
  human disagreement. Unsupported prosody/stress/fluency are explicitly unscored.
- A separate existing boundary evaluator. No estimated timestamps become human labels.

The benchmark does not enter Daily practice, first-launch downloads, `public/`, or
the production bundle. All downloaded speech, labels and per-recording predictions
live in ignored `datasets/`. Only original tooling, source descriptors, tests and
this aggregate analysis belong in Git. No paid API is required.

## Run it

Install the app's dictionary first using the first-run setup described in the README.
Then explicitly download the benchmark pilot:

```bash
npm run benchmark:prepare -- --limit 100
```

The pinned upstream metadata is about 30 MB; only the selected audio files are
downloaded, rather than the entire corpus. Metadata has pinned SHA-256 checksums.
The Git tree's canonical blob list has a pinned SHA-256 checksum; each audio file
is verified against its Git blob hash and its SHA-256 is recorded in the selection.
Subsequent preparation verifies local files, including with `--offline`.

Start/restart the current backend in a separate terminal:

```bash
npm run dev:api
```

Then run the benchmark:

```bash
npm run benchmark:run -- --limit 100
```

For an isolated service on another loopback port, add
`--endpoint http://127.0.0.1:8001`. Remote hosts and redirects are refused. Speech
goes only to that local service. Model setup may contact its provider to download
weights/configuration, but the runner does not upload speech there.

Local outputs are under:

```text
datasets/speechocean762/<pinned-revision>/
  ATTRIBUTION.txt
  upstream/                 original labels, README, metadata and verified tree
  WAVE/                     selected, unchanged recordings
  test-100.jsonl            human ratings; absent boundaries stay null
  test-100.manifest.json    selection IDs, hashes, resource terms and provenance
  runs/<timestamp>/
    run.json               configuration, environment and working-tree source hashes
    raw.jsonl              submitted targets, API responses, timing and failures
    predictions.jsonl      compatible word/sentence predictions; explicit abstentions
    report.json            created only after the selected run completes
```

Preparation is deterministic and can be repeated offline. A fresh run gets a new
directory. Interrupted runs retain partial evidence, but have no `report.json`.
HTTP 400 refusals remain in coverage; transport/server/protocol failures abort the
run rather than quietly dropping difficult examples. The runner checks gold and
audio hashes before use, and refuses source changes detected during inference.

`npm run check:benchmark` tests importer, metrics, abstentions, split protection,
selection, checksums, protocol validation and local-only endpoints using authored
synthetic fixtures. It neither downloads corpus data nor loads a speech model.

## First pilot: 2026-09-22

Run directory: `2026-09-22T18-22-12-418Z` (local, not committed).
Scorer revision 2; original corpus WAV input; CUDA on an RTX 5080 Laptop GPU.
Dataset commit: `613968e3b0b789fc33936fb5eba1973176ba7d11`.
Loaded model configuration commit: `ae45363bf3413b374fecd9dc8bc1df0e24c3b7f4`.
Selection SHA-256: `1c41bf6bcd9983cbc3267eb59e5a24a097de4c36dd8f41466b8ae3d585f2933b`.

100 recordings, 100 speakers, 632 words; 53 speakers under 18 and 47 adults.
No recording refusals or unmatched target words in this selection.
A repeat run (`2026-09-22T18-28-03-572Z`) reproduced every displayed sentence/word
score, predicted word span and aggregate metric on the same machine. This checks
local repeatability, not cross-device reproducibility or a fully pinned model bundle.

| Measure | Sentence accuracy | Word accuracy |
| --- | ---: | ---: |
| Scoring coverage | 100/100 | 632/632 |
| Pearson correlation | 0.455 | 0.336 |
| Spearman rank correlation | 0.588 | 0.305 |
| Mean absolute displayed-scale difference | 13.79 points | 18.84 points |
| Mean app score minus human score | +2.23 points | −15.51 points |

Human 0–10 ratings are linearly rescaled to 0–100 only for those display comparisons.
This is not a learned calibration. Correlation is **not a percent-correct metric**.
Word ratings in this pilot are near the ceiling (mean human score 94.45); this and
the different scoring rubrics matter when interpreting agreement and bias.

Interpretation: word-level agreement is limited, and app word scores are substantially
lower on average on this pilot. That is a reason to investigate calibration and
contextual pronunciation handling—not proof that every lower score is a false
rejection, or permission to raise all scores. No thresholds were tuned on this set.

Limitations:

- All speakers are Mandarin-L1 learners reading prompted English. This does not
  establish accuracy for Spanish speakers, native US controls or spontaneous speech.
  The corpus's accent-sensitive rubric is not a pure intelligibility measure.
- No human boundary timings: neighboring-word leakage and clipped target sounds
  remain unmeasured. The original word-cutting complaint is not declared solved.
- No predicted fluency, stress or prosody yet; their measured coverage is zero.
- The original sentence/word runner does not match phone slots. The separate
  conservative adapter below now evaluates only an exact-match phone subset.
- This uses original WAV audio, not microphone capture through the browser's codec.
  The browser fallback is also not evaluated by this runner.
- No confidence intervals or significance claims yet. Bootstrap by speaker when
  comparing candidates; words from the same sentence are not independent samples.
- Working-tree source hashes and the loaded model **configuration** commit are
  recorded. They are not complete model-weight provenance: feature extractor,
  vocabulary and converted weights still need independent pinning/hashes. Restart
  the backend on the same checkout; local file hashes cannot prove what a stale
  service already has loaded. Public-benchmark pretraining contamination is unknown.

## Remaining milestone work, in order

1. **Development/final separation is implemented.** Official training speakers are
   partitioned 75/25/25 into training/calibration/validation; the 100 exposed test
   speakers are regression data and 25 test speakers remain reserved. Normal tools
   refuse the final partition. Calibration and validation each have a measured
   100-recording baseline, but no calibration is fitted. Repeatedly inspecting test
   errors makes the old pilot unsuitable as an untouched final test.
2. **Initial boundary evidence is measured.** The obtained L2-ARCTIC v5.0 manual
   subset now supplies a [100-recording / 975-word baseline](word-boundary-baseline.md).
   Keep that selection frozen for candidate comparisons. Full-corpus and final-test
   accuracy remain unmeasured. Automatic `textgrid/` labels are not human gold.
3. **Add the personal pilot.** Collect 100–200 consented, pseudonymous recordings
   spanning connected speech, reductions, difficult boundaries, common contrasts,
   varied rates and devices, plus native-US controls. Have two raters work blind to
   app scores, retaining disagreement and adjudication. No need to annotate all English.
4. **Compare candidates.** Run the existing scorer and alternative aligners/scorers
   on the same frozen data and coverage. Add speaker-bootstrap intervals, full
   model provenance and broader validated phone-slot mappings. Only then choose replacements or fit
   calibration on the development partition—not the final test.
5. **Expand sentence practice separately.** Use a spoken-frequency inventory to
   audit original practice sentences, contextual word/phone coverage and repetition.
   [NGSL-Spoken](https://www.newgeneralservicelist.com/ngsl-spoken) is a candidate:
   its publisher lists 721 entries, up to 90% token coverage in its spoken corpus,
   and CC BY-SA 4.0. That is not 90% of meanings, accents or conversational situations.
   Audit the exact asset and ShareAlike obligations before replacing the existing
   restricted frequency list. Do not relicense downloaded data as Apache.
6. **Evaluate connected-speech coaching.** Vary phrase contexts and speakers, enforce
   recent-history nonrepetition, keep unseen transfer sentences, and assess stress,
   rhythm and intonation independently. Benchmark recordings must never become the
   practice deck; a large practice library does not need a human score for each line.

Completion requires evidence for both assessment and boundaries on relevant speakers,
not merely a functioning downloader or a large number of available recordings.

## Phone-flag pilot

Added 2026-09-22. This is an offline replay of the second archived 100-recording run
(`2026-09-22T18-28-03-572Z`), not a new acoustic model run. It uses the previously
chosen user preference of 80; neither scores nor thresholds were fitted to this set.

The [pinned corpus rubric](https://github.com/jimbozhang/speechocean762/tree/613968e3b0b789fc33936fb5eba1973176ba7d11#phoneme-level)
distinguishes correct (2), correct with heavy accent (1), and incorrect/missed (0).
For this diagnostic, a **human concern** means at least three of five experts marked
0. Heavy accent alone is not a positive error label. A model flag is strictly below
80. This binary rubric is our explicit evaluation choice, not a claim that the corpus
publisher recommends an 80-point app cutoff.

Mapping requires identical word order/text, complete identical ARPAbet→IPA canonical
sequences, explicitly matching realized phones, valid word timing and distinct phone
intervals. It never uses greedy edit-distance alignment to fabricate slot identities.
All five annotation strings must parse exactly against the reference, retaining
accent/error distinctions; bracketed insertions are counted but not evaluated.

| Measurement | Result |
| --- | --- |
| Eligible / scored phone slots | 1,883 / 1,188 |
| Mapping coverage | 63.1% |
| Canonical-sequence mismatch exclusions | 631 |
| Different/unspecified realization exclusions | 40 |
| Shared/overlapping phone-span exclusions | 24 |
| Majority-human concerns in mapped subset | 57 |
| Flagged human concerns / missed concerns | 51 / 6 |
| Flags without majority-human concern / unflagged negatives | 260 / 871 |
| Flag precision / concern recall | 16.4% / 89.5% |
| False-positive rate among human negatives | 23.0% |
| Phone Pearson / Spearman correlation | 0.437 / 0.406 |

This is not end-to-end detector accuracy: 36.9% of slots were excluded, possibly
systematically. Some flags without majority-error consensus can be accent-only
concerns or rater disagreements; they are not all necessarily meaningless. Nevertheless,
these results do not support “below 80 means definitely wrong.” Use it as a review
prompt, with listening, undo and recurring-context evidence. Per-phone support and
counts are included in the local JSON, not promoted into reliable per-sound claims
from small samples. Correlation is not a correctness probability.

The same Mandarin-L1, read-speech, child/adult, exposed-test and provenance limitations
apply. No boundary accuracy, calibrated uncertainty or confidence intervals are
established. Distinct estimated intervals do not make those intervals human truth.

To reproduce, substitute your own existing archived run directory:

```powershell
npm run benchmark:phones -- datasets/speechocean762/613968e3b0b789fc33936fb5eba1973176ba7d11/test-100.jsonl datasets/speechocean762/613968e3b0b789fc33936fb5eba1973176ba7d11/runs/2026-09-22T18-28-03-572Z/raw.jsonl datasets/speechocean762/613968e3b0b789fc33936fb5eba1973176ba7d11/runs/2026-09-22T18-28-03-572Z/phone-flags-80.json
```

Use a new output filename if it already exists; the command refuses overwrites.
It verifies the archived run's gold hash and raw ID list and records the input,
run-manifest and adapter hashes. Data, raw responses and reports stay ignored under
`datasets/`; no corpus audio or labels are committed. `npm run check` exercises the
adapter only with authored synthetic fixtures and requires no corpus download.
