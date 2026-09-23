# Evaluation foundation and speaker-disjoint baseline

Updated 2026-09-22. This milestone adds evaluation infrastructure and measured
development baselines. It does **not** change the acoustic scorer, fit calibration,
or demonstrate better word cuts. Roadmap phase 1 remains in progress.

Follow-up, 2026-09-23: [automated validation](automated-validation.md) adds a
calibration-selected review-cutoff experiment, speaker-bootstrap comparisons,
diagnostics and boundary inference. The cutoff failed validation and was not
adopted. A [real L2-ARCTIC boundary pilot](word-boundary-baseline.md) has also run:
100 recordings, 24 speakers and 975 words. The historical assessment baseline tables
below remain unchanged.

## Frozen speaker partitions

The pinned speechocean762 revision has 125 speakers on each official side, with
20 recordings per speaker. The original pilot exposed 100 official test speakers.
The protocol reserves the remaining 25 and assigns official training speakers as
follows:

| Partition | Official side | Speakers | Available recordings | Purpose |
| --- | --- | ---: | ---: | --- |
| training | train | 75 | 1,500 | Model/feature development; no training performed yet |
| calibration | train | 25 | 500 | Future threshold/calibration fitting |
| validation | train | 25 | 500 | Development candidate comparisons |
| regression | test | 100 | 2,000 | Already exposed speakers; not an untouched final test |
| final | test | 25 | 500 | Reserved; normal preparation and inference refuse this set |

Assignment uses a fixed SHA-256 ranking of speaker IDs, not human labels or model
results. IDs and speakers cannot cross partitions. Selection within a partition
uses deterministic speaker round-robin. The plan is written once, not silently
repartitioned on later runs. Selection manifests bind the plan and gold files by
hash. Preparation audits legacy selection manifests and run manifests, including
incomplete runs, conservatively treating their selected test speakers as exposed.
Legacy pilot commands also check the frozen reservation before downloading audio
or running inference.

This is a **project-held-out** set, not proof of absence from upstream model
training. Public label files are already locally available: the guard prevents
accidental workflow leakage, not deliberate label access. Prompts may overlap
across speakers; this protocol does not test unseen-text generalization.

### Prepare and run

The existing pilot must have been prepared first; without an exposure history the
protocol refuses to invent which test speakers are still untouched.

```bash
npm run benchmark:splits
npm run benchmark:splits -- --partition calibration --limit 100
npm run benchmark:splits -- --partition validation --limit 100
```

The first command freezes metadata only. Explicit partition preparation downloads
only its selected audio. Add `--offline` to require already verified local files.
Start the current backend in another terminal with `npm run dev:api`, then:

```bash
npm run benchmark:run -- --partition calibration --limit 100
npm run benchmark:run -- --partition validation --limit 100
```

All data and outputs stay in ignored
`datasets/speechocean762/<pinned-revision>/`; plans and prepared labels are under
`speaker-disjoint-v1/`, and run outputs remain under `runs/<timestamp>/`.
There is deliberately no final-test unlock command. Release it only after candidate
versions, thresholds and comparison rules are frozen, with an explicit decision.

## Measured development baseline

Both runs use the unchanged local revision-2 scorer, original corpus WAV files and
the previously chosen 80-point practice threshold. Each contains 100 recordings
from 25 speakers, four recordings each; 40 recordings from children and 60 from
adults. The two speaker groups are disjoint. No calibration was fitted.

| Measure | Calibration subset | Validation subset |
| --- | ---: | ---: |
| Scored recordings | 100 / 100 | 100 / 100 |
| Scored words | 653 / 653 | 655 / 655 |
| Sentence Pearson correlation | 0.600 | 0.542 |
| Word Pearson correlation | 0.420 | 0.337 |
| Mean app word score minus human score | -13.85 points | -14.00 points |
| Mapped / eligible phone slots | 1,217 / 1,981 | 1,261 / 1,928 |
| Phone mapping coverage | 61.4% | 65.4% |
| Below-80 flags | 311 | 276 |
| Majority-human incorrect/missed phones | 59 | 38 |
| Flagged incorrect/missed phones | 48 | 33 |
| Flags without majority incorrect/missed | 263 | 243 |
| Flag precision / error recall | 15.4% / 81.4% | 12.0% / 86.8% |
| Flags on majority-fully-correct phones | 257 | 239 |

These are diagnostic results on the conservatively mapped subset, not end-to-end
accuracy, correctness probabilities or confidence intervals. Sentence/word
correlations are not percentages. Mapping still requires exact canonical phone
sequences and distinct realized spans; excluded slots must not disappear from
coverage reporting.

The phone report now separates three interpretations of the five-rater rubric:

- **Incorrect/missed:** at least three raters assigned 0. This preserves the
  original binary diagnostic; accent alone is not an error label.
- **Accent-or-error:** at least three assigned either 0 or 1. This separate,
  accent-sensitive diagnostic must not be presented as an intelligibility test.
- **Category breakdown:** majority incorrect/missed (0), heavy accent (1), fully
  correct (2), or no category majority. Disagreement is not silently relabeled.

Accent-or-error flag precision is still only 17.4% on calibration and 13.4% on
validation. The fully-correct flags above show that rubric differences do not
explain away the disagreement. Below 80 remains a **review prompt**, not proof of
a pronunciation error. Investigate the false flags and valid pronunciations before
fitting a score mapping; merely raising all scores could also hide real errors.

Local provenance (raw data and labels are not committed):

- Calibration run: `2026-09-22T20-13-46-325Z`; gold SHA-256
  `00ee3b27300b680838fd57e46923d2a0562241f3d72ae6b5b34eb658fcb8053f`.
- Validation run: `2026-09-22T20-14-13-552Z`; gold SHA-256
  `45358f9ff029c8116caf47cd08be865d240d8ca2f75ea23d61b3ad8178b7234a`.
- Both have `phone-flags-80.json`, sentence/word reports, raw responses, input
  hashes and run manifests. See [the existing runner guide](human-benchmarks.md)
  for model-provenance limitations and the phone-report command.

The reserved 25-speaker final set was not scored or downloaded by this milestone.
The training partition was assigned, not used to train a model. These subsets are
still Mandarin-L1 read speech, not representative personal or native-US controls.

## Manually corrected boundary adapter

The optional importer reads an existing local copy of
[L2-ARCTIC](https://psi.engr.tamu.edu/l2-arctic-corpus/). The provider requires
registration and acceptance of CC BY-NC 4.0 terms. Obtain it and review those terms
yourself; the command does not register, download or accept terms on your behalf.
Noncommercial data remains separately licensed even when installed outside Git.

```powershell
npm run benchmark:boundaries:import -- --root "C:\Data\L2-ARCTIC" --output datasets/l2-boundary-validation --revision v5.0 --acknowledge-terms --limit 100
```

Use the actual local release identifier. Output must be a **new** directory below
the project's ignored `datasets/`, with an existing parent, outside the source
corpus. Existing imports are never overwritten. The importer:

- Selects files from each speaker's `annotation/` directory only, which the
  [provider documents](https://psi.engr.tamu.edu/l2-arctic-corpus-docs/) as manually
  corrected; never treats the automatic `textgrid/` directory as human gold.
- Selects by fixed speaker/filename hash ranking and speaker round-robin before examining labels.
  Selection v2 varies prompts across speakers; `--selection v1` reproduces the
  original filename-only ranking. Manifests record prompt/text diversity.
  Failed selected imports are recorded as exclusions, not replaced with easier ones.
- Parses long-text Praat intervals strictly, checks word/transcript identity,
  corresponding WAV/transcript basenames, and WAV/TextGrid duration agreement
  within 50 ms. No offset, word identity or missing pronunciation grade is guessed.
- Resolves source paths to reject escapes through symlinks; records annotation,
  transcript, audio and license hashes. Source files are unchanged; audio is not
  copied. JSON audio paths are relative to the original corpus root.
- Retains raw phone-error annotations and other tiers, without turning phonetic
  tags into unreviewed binary word grades. Word `correct` stays `null`.
- Writes `gold.jsonl`, `manifest.json`, `LICENSE.upstream` and attribution locally.
  Hashes identify the imported files; they do not authenticate a publisher archive
  or independently verify the user-supplied release identifier.

Supported scope is the prompted, manually corrected subset. Short/binary TextGrid,
point tiers and the separate spontaneous suitcase recordings are not imported.
Provider point boundaries do not supply independent-rater uncertainty ranges. This
is development evidence, not a newly locked speaker-disjoint final corpus.

Initial adapter verification used synthetic fixtures and the provider's public
TextGrid example. The user has now supplied access to v5.0; all 3,599 manual
annotations and matching audio/text are locally available. A frozen 100-recording
pilot has been evaluated, with zero import exclusions. See the
[human boundary results and limits](word-boundary-baseline.md). Full-corpus timing
accuracy and improvements over the current scorer are not claimed.

### Boundary and playback metrics

```bash
npm run benchmark:boundaries:evaluate -- GOLD.jsonl PREDICTIONS.jsonl validation
```

This evaluates existing prediction files. `npm run benchmark:boundaries:run`
produces current-app predictions; the local Qwen and MFA adapters produce candidate
outputs; and `npm run benchmark:boundaries:compare` compares them with paired
speaker-bootstrap intervals. See [commands and results](word-boundary-baseline.md#local-aligner-candidates).
These adapters are research tooling; neither changes the app scorer automatically.

The evaluator retains pronunciation and timing as independent labels:

- Gold words have text, start/end and `correct: null` if not judged. Optional
  `boundaryStatus` is `human-corrected`, `uncertain` or `unavailable`.
- Optional human `startRange` / `endRange` bounds express permitted times and must
  include nominal timestamps while retaining a nonempty definite word core.
  Unresolved uncertain boundaries are excluded explicitly, not scored as exact.
- Predictions keep every word in order, with nulls for unavailable estimates.
  Start/end describe acoustic estimates; a separate `playback: {start, end}`
  describes the actual replay interval. `playback: null` means replay unavailable;
  omitted playback defaults to the acoustic span.
- Reports distinguish acoustic boundary error from replay leakage and target
  clipping, with timing/replay/annotation coverage, mean/p95 error, 20/50 ms rates,
  included-neighbor milliseconds, clipped-target milliseconds and duration fractions.
- Human ranges yield definite/possible leakage and clipping bounds. Unknown
  neighboring boundaries prevent a no-leakage claim. No samples yield null rates,
  not perfect results. Interval overlap measures annotated time, not actual phonation
  or intelligibility; this cannot promise clean cuts for every coarticulated word.

## Next gates

1. **Initial boundary baseline complete.** Preserve the frozen v2 pilot (100
   recordings / 24 speakers / 975 words) and its original-WAV predictions.
2. Initial Qwen and Windows MFA 2.2.4 candidate comparisons are complete. Neither
   is adopted because both materially increase neighboring speech in replay. Run MFA 3
   on a supported platform, investigate boundary ownership/replay tradeoffs and inspect
   worst cases before proposing a scorer or playback-policy change.
3. Inspect calibration-side false flags and contextual American variants. Fit or
   change scoring only on development data, then compare on validation speakers.
4. For later claims about personal/native-US performance, commission independent
   labels for consented recordings and controls. This is reviewer work, not learner
   homework or a prerequisite for automated public-corpus development.
5. Freeze candidate/configuration choices before explicitly releasing the final
   holdout. Prosody, variable-length pronunciation paths, reference excerpts and
   raw microphone capture remain separate roadmap work.
