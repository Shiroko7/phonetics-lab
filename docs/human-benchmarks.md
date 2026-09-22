# Human benchmarks and the first measured baseline

Updated 2026-09-22. Phase 1 is **in progress**, not complete. This adds evidence and
reproducible tooling; it does not change the pronunciation-scoring algorithm.

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
- Phone ratings are retained for future adapters, but app and corpus phone sequences
  are not assumed to have matching slots. No phoneme-level metric is reported yet.
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

1. **Separate development from final testing.** Import the official training side
   into speaker-disjoint training/calibration/validation partitions before fitting
   thresholds. Keep this pilot as an exposed regression set; reserve additional
   test speakers for a locked final comparison. Repeatedly inspecting test errors
   makes the pilot unsuitable as an untouched final test, even without fitting.
2. **Add boundary evidence.** Obtain a legally accessible, manually timed corpus
   (e.g. registration-gated Buckeye or the annotated L2-ARCTIC subset) and adapt its
   labels. Never call automatically generated alignments ground truth. Keep uncertain
   boundaries and permitted timing ranges explicit. Evaluate both neighbor leakage
   and target-speech clipping, alongside coverage and boundary error.
3. **Add the personal pilot.** Collect 100–200 consented, pseudonymous recordings
   spanning connected speech, reductions, difficult boundaries, common contrasts,
   varied rates and devices, plus native-US controls. Have two raters work blind to
   app scores, retaining disagreement and adjudication. No need to annotate all English.
4. **Compare candidates.** Run the existing scorer and alternative aligners/scorers
   on the same frozen data and coverage. Add speaker-bootstrap intervals, full
   model provenance and phone-slot adapters. Only then choose replacements or fit
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
