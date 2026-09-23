# Pronunciation accuracy roadmap

Research reviewed 2026-09-21; implementation updated 2026-09-23.
Goal: trustworthy feedback on American English pronunciation,
with word replay that does not deliberately include neighboring speech.

Resource policy: original project code is Apache-2.0; third-party data retains its
own terms. Dictionary tables are now installed locally from pinned, checksummed
sources, with an explicit personal-use acknowledgment for the legacy word list.
An opt-in, local-only speechocean762 pilot is now available and has been evaluated.
See [the resource/license inventory](../THIRD_PARTY.md)
for usage constraints, model provenance gaps, and the distinction between keeping
data out of Git and redistributing it in a build. A commercially cleared, spoken-
language frequency source is still needed before claiming a commercial-ready data
configuration.

## What is implemented

Revision 2 is a reliability baseline, not a validated accuracy improvement on human speech.

- Word replay uses hard sample boundaries, no automatic padding or minimum duration,
  and short fades inside the interval. “In context” intentionally includes neighbors.
  Shared/overlapping estimated word intervals disable isolated replay.
- Phone, word and sentence displays preserve the numerical GOP scores. Older GOP
  records recover their original phone numbers from stored distances. They retain
  their old revision until the recording is actually re-scored.
- The frontend sends words and complete pronunciation paths. A CTC graph chooses
  whole paths and allophones during alignment. Tokens cannot merge across words;
  repeated identical sounds still need a CTC blank between occurrences.
- The browser fallback also aligns complete ordered word paths, rather than allowing
  every sound in every position. Both scorers currently support equal-length word
  alternatives; different-length alternatives are explicitly outside this contract.
- Uniform, non-finite, blank-only and structurally impossible acoustic results are
  refused. This is basic validity checking, not calibrated uncertainty detection.
- Raw GOP and posterior values survive the API. The free decode preserves complete
  emission runs. The UI labels the displayed sounds as estimates and explains that
  stress and rhythm are not assessed.
- Revision-aware comparison prevents direct last/best comparisons across scoring
  scales in the active Studio/Daily controller. A stale service cannot silently answer
  the new structured request as though it supported it.
- Sound-focused practice policy: configurable 80/100 threshold, individual phone
  scores, explicit unassessed timing, reversible word-review choices, and recurring
  flags from first takes separated by scorer revision. Daily uses the same threshold;
  review choices cannot rewrite original evidence. This is a coaching improvement,
  not new acoustic accuracy. [Workflow and score interpretation](practice-feedback.md).
- An exact-canonical, distinct-span adapter now checks phone flags against existing
  five-rater annotations. The 80-point pilot has 63.1% mapping coverage and substantial
  disagreement with majority-human incorrect/missed labels; details and exclusions
  are in the [phone benchmark](human-benchmarks.md#phone-flag-pilot).
- Frozen speaker-disjoint training/calibration/validation partitions, an exposed
  regression set and a guarded final reservation. New 100-recording calibration and
  validation baselines separate incorrect/missed labels, accent-sensitive labels and
  fully-correct flags. Numerical scores remain uncalibrated; the final holdout is unscored.
- A local-only L2-ARCTIC manual-boundary importer and an evaluator that separates
  acoustic estimates from playback, measures target clipping as well as neighbor
  leakage, and retains human timing uncertainty. The first real v5.0 pilot covers
  100 recordings / 24 speakers / 975 words: mean boundary error 59.6 ms, mean target
  clipping 115.2 ms. See the [boundary baseline](word-boundary-baseline.md).
- Full saved-history recalculation, with visible progress/failures, a pre-refresh
  backup, preserved original assessments and per-recording conflict-safe merges.
  Latest analyses propagate into diagnostics, word histories, compatible-scale Stats
  and Daily assessment views/targets. Legacy takes can suggest practice without being
  relabeled as independent first takes; completed Daily events/schedules remain saved.
  See [history recalculation](history-recalculation.md). This improves consistency,
  not acoustic accuracy; successful refresh still requires each recording's audio.
- Automated offline false-flag diagnosis and calibration-only cutoff selection,
  followed by a separate validation comparison with paired speaker-bootstrap intervals.
  The first candidate reduced false flags but lost too much error recall, so it was
  rejected and the default remains 80. The boundary inference runner and normalized
  candidate comparison are ready; the human boundary baseline is now measured.
  See [automated validation and measured results](automated-validation.md).

Regression checks: `npm run check`, `make check-api`, and
`node scripts/check-daily-browser.mjs` with the web server running. They use synthetic
emissions/audio and test implementation behavior. They do not measure human agreement.

## Remaining limitations

Word timing still comes from a phoneme recognizer, not an independently validated
word aligner. Removing playback padding cannot correct an incorrect timestamp, and
some tightly connected words cannot be cleanly isolated. Never promise perfect cuts
for arbitrary speech. Offer context when uncertainty prevents a useful isolated clip.

The graph still requires its expected sounds to occur. It does not reliably diagnose
omissions or insertions. Weak forms such as “and” /ən/ or /n/, and changes such as
“for” /fɔɹ/ versus /fɚ/, need paths with different numbers of phones and explicit
alignment provenance. No-frame output is not reliable evidence of a linguistic omission.

GOP thresholds remain hand-set. A high numerical score is neither a probability of
correct pronunciation nor a percentage of intelligibility. Most uncertainty, difficult
recording conditions and systematic model errors are not detected by the validity checks.
Some broad allophone/token-normalization rules remain; these need context-sensitive
validation, especially flaps, glottal stops, rhotics, reduced vowels and accent differences.

Reference audio is not the scoring target: the scorer receives a pronunciation
sequence. Word references are synthesized in isolation; the full reference-sentence
button supplies connected-speech context, but matched reference excerpts are future work.

Microphone samples are decoded from MediaRecorder audio before either scorer sees them.
Wrapping those samples in float WAV prevents further loss but does not restore the
original microphone signal. This limitation affects both backend and browser scoring.

## Delivery phases and gates

| Phase | Work | Evidence required to finish |
| --- | --- | --- |
| 0 — Reliability baseline | Changes listed above | Deterministic regressions, build and browser flow pass; limitations remain visible |
| 1 — Human evaluation set (in progress) | Speaker-disjoint assessment baselines, automated cutoff experiment, 100-recording boundary baseline and first local aligner screen completed | Broader population evidence and final held-out comparison still required |
| 2 — Better word alignment | Resolve boundary ownership/replay tradeoffs, run MFA 3 on a supported platform, then add candidate provenance/confidence only when validated | Lower boundary error and neighboring-word leakage without hiding difficult cases or increasing clipped target sounds |
| 3 — Pronunciation validity | Optional/deleted/inserted phones, contextual pronunciation paths, trained assessment and per-phone calibration | Better false-rejection/acceptance tradeoff on held-out human labels; explicit abstention and coverage; no regression on valid US variants |
| 4 — Natural American speech | Stress, rhythm, intonation, sentence-matched reference excerpts and multiple US speakers | Separate human-rated prosody evaluation; repeatable coaching; no penalty for unrelated voice/pitch differences |
| 5 — Deployment and monitoring | Provider/version provenance, calibration migration, latency/cost/privacy measurements, robust raw PCM capture | Same evidence across supported devices; revision-separated analytics; reproducible rollback and benchmark reports |

Work that can run alongside phase 1: raw PCM capture experiments, data export tools,
and local aligner adapters. Do not replace the scorer based on prettier demos or higher
average scores. Raising every score can reduce false rejections while accepting errors.

## Phase 1: collect evidence before selecting a winner

**Status: in progress.** The [human-benchmark guide](human-benchmarks.md) records the
implemented public-corpus importer, five-rater label preservation, reproducible local
runner and the first real-data baseline: 100 speakers / 632 words, with Pearson
correlations of 0.455 for sentence accuracy and 0.336 for word accuracy. These are
not accuracy percentages. Prosody/fluency/stress predictions are still absent.
Human word-boundary measurements now come from the separate L2-ARCTIC pilot.
No scoring thresholds were tuned on this original assessment pilot.
Phone-level evaluation is now partial rather than absent; the new practice workflow
is implemented, but phase 1's evidence gates and phase 3's validity gate remain open.

The [evaluation foundation](evaluation-foundation.md) now provides development/
calibration/validation splits and a locked final reservation. Additional 100-recording
calibration and validation runs cover separate 25-speaker groups; validation word
Pearson correlation is 0.337, with substantial below-80 flags on human-correct sounds.
This is a measured baseline, not improved scoring. The L2-ARCTIC v2 selection now
provides real timing/clipping measurements and speaker-bootstrap intervals, with
100 recordings spanning 81 prompt IDs. It is development evidence, not full-corpus
or final-test accuracy. Remaining phase-1 work includes representative personal/native-US
evidence, independent adjudication and frozen candidate/final comparisons. The human-benchmark guide also
documents the parallel spoken-frequency, sentence-coverage and nonrepetition track.

Use existing expert-labeled public corpora for automated development evaluation first.
Learners do not grade recordings or mark boundaries. Gated corpus registration is a
one-time access task, separate from annotation. A later targeted study can collect
100–200 consented recordings, including personal problem cases and native American
English controls, with qualified independent reviewers. That study supports claims
about those populations; it does not block public-data improvements or app use.

Include natural speeds and reductions, short articles, vowel-to-vowel boundaries,
same-consonant boundaries (“black cat”), rhotic boundaries (“saw red”), pauses,
repetitions, omitted/inserted words and sounds, clipped/quiet/noisy takes, and common
contrasts such as /i–ɪ/, /θ–s/, /v–b/ and rhotic vowels. Do not special-case “become a.”

Retain the original recording, expected text, speaker/session/device identifiers,
sample rate/codec, intended dialect, model versions and consent. Use pseudonymous IDs.
Keep raw recordings local and outside git; obtain specific authorization before sending
personal recordings to a new cloud provider. Synthetic references are not human labels.

Have two competent raters mark boundaries and judge pronunciation independently,
without seeing app scores, then adjudicate disagreements. Record acceptable American
variants, ambiguous boundaries and rater disagreement. Distinguish intelligibility from
similarity to a particular accent. Use separate training/calibration, validation and test
sets. Hold out speakers for generalization and sessions for personal progress. Never tune
thresholds on the test set or use model-produced alignment as human ground truth.

Useful external corpora:

- [L2-ARCTIC](https://psi.engr.tamu.edu/l2-arctic-corpus/): learner speech and phonetic
  error annotations, including Spanish speakers. Check access terms and annotated coverage.
- [speechocean762](https://www.openslr.org/101/): 5,000 utterances rated by five experts;
  speakers are Mandarin speakers and half are children. Useful for calibration research,
  insufficient as the sole population for this app.

### Run the initial evaluator

`node scripts/evaluate-pronunciation.mjs GOLD.jsonl PREDICTIONS.jsonl`

Each file has one JSON object per recording. IDs and ordered expected words must match.
Gold files contain held-out, human-annotated test examples; the illustration below is
explicitly synthetic and must not be reported as a human benchmark.

```json
{"id":"fixture-1","source":"synthetic","split":"test","words":[{"text":"one","start":0.1,"end":0.3,"correct":true},{"text":"two","start":0.3,"end":0.5,"correct":false}]}
```

Predictions retain the same words even for omissions or unscored results. Use null
timings for unavailable boundaries, and `correct: null` for an abstained judgment.
Human gold also uses `correct: null` when pronunciation was not judged: boundary
annotations do not imply a pronunciation grade. When testing actual replay, supply
separate `playback: {start, end}` intervals, including any applied padding; omitted
playback defaults to the acoustic estimate, and `playback: null` marks replay unavailable.

```json
{"id":"fixture-1","scorer":"candidate-name","revision":"checkpoint-and-config","words":[{"text":"one","start":0.1,"end":0.31,"correct":true},{"text":"two","start":null,"end":null,"correct":null}]}
```

The evaluator reports boundary mean and p95 error, boundaries within 20/50 ms,
clips intersecting other annotated words, clipped target duration, separate timing/
replay coverage, and false acceptance/rejection when human correctness was judged.
Zero evaluated samples yield null error rates, not perfect results. Mixed engines,
mixed human/synthetic labels, duplicate IDs and mismatched words are refused.
Optional human `startRange` / `endRange` bounds now preserve boundary uncertainty;
unresolved/unavailable boundaries stay outside timing metrics with explicit coverage.
Definite word cores must not overlap. See the foundation guide for bounds and schema.
Pass an explicit third argument such as `validation` for development-corpus evaluation.

Report both speech mistakenly included and target speech mistakenly cut off. Inspect
the worst cases, not only the mean. Count unscored/uncertain results and compare engines
at comparable coverage. Bootstrap by speaker/session for confidence intervals once
there is sufficient data. Choose numerical release thresholds after measuring the
baseline and rater disagreement; do not invent a validated target from synthetic tests.

## Phase 2: alignment candidates

- **Initial screen complete; integration remains open.** Both candidates were run
  locally on the frozen 100-recording / 24-speaker L2-ARCTIC set. They reduced target
  clipping but raised neighboring-speech leakage from 1.9 ms/replay to 17.4–22.8 ms.
  Qwen left 73 of 975 words without a positive-width interval. Neither candidate is
  selected. See [paired results and limitations](word-boundary-baseline.md#local-aligner-candidates).
- **Replay trim sweep complete; no default selected.** A 20 ms inward trim reduced
  neighbor leakage for both candidates, but clipped about 28 ms more target speech;
  larger trims sharply reduced leakage while clipping more target sounds and making
  some clips unavailable. Acoustic timestamps and error did not change. See the
  [full sweep](word-boundary-baseline.md#replay-trim-sweep).
- **Worst-case inspection complete.** MFA 2.2.4 can drift by more than a second after
  a pause while retaining 100% timing coverage; Qwen can leave short words unaligned.
  Candidate evaluation must check persistent offsets and report word-level abstention.
  See the concrete example in the [boundary baseline](word-boundary-baseline.md#local-aligner-candidates).
- **MFA 3 US English** remains the intended comparison, but Windows conda-forge
  supplied MFA 2.2.4 only. The measured MFA result is labeled 2.2.4, not 3; the
  3.x run requires a supported platform. Its authors'
  [2026 evaluation](https://arxiv.org/html/2606.18466v1) compares multiple aligners on
  TIMIT/Buckeye and other languages. Those results are not a benchmark of this user's
  recordings. Deployment uses an additional [Conda/container environment](https://montreal-forced-aligner.readthedocs.io/en/latest/installation.html).
- **[Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B)**:
  local neural word-timestamp candidate. Its frozen pilot run is recorded with exact
  checkpoint revision, GPU, timing coverage and latency. It does not provide a
  validated pronunciation grade merely by aligning text.

Next, test drift detection and phone/word ownership on development data, then run MFA 3
on a supported Linux platform. Keep acoustic boundaries separate from playable
intervals; do not choose a trim from this development sweep alone or choose wider
spans solely for lower mean error. Only then propose API provenance/confidence changes.

The response should distinguish word acoustic spans, playback spans, token spans,
ownership and alignment reliability. Preserve word boundaries without forcing a shared
coarticulated segment into two confident isolated clips. Use model stride/receptive-field
timing and explicit trim offsets rather than assuming duration/frame-count is exact.

## Phase 3: scoring candidates and structural changes

- **[Azure Pronunciation Assessment, en-US](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)**:
  first commercial comparison if cloud processing is selected. Evaluate phoneme detail,
  miscue detection and prosody separately. It requires credentials/cost and transmitting
  recordings; this repository has not integrated it or sent recordings there.
- **[Speechace](https://www.speechace.com/api-plans/)**: second commercial comparison for
  pronunciation/fluency, with US English support. Compare actual error cases, not vendor
  claims or aggregate scores on unrelated private datasets.
- **[HMamba](https://aclanthology.org/2025.naacl-long.98/)**: assessment and error-detection
  research baseline with [code](https://github.com/Fuann/hmamba). Its Kaldi/feature/CUDA
  setup needs an isolated proof of concept, not a direct dependency upgrade.
- **[CROTTC-IF, 2026](https://arxiv.org/abs/2604.22133)**: research addressing sparse
  acoustic evidence and bias toward expected text. The reported 71.77% L2-ARCTIC F1 is
  a detection metric, not a pronunciation-accuracy percentage. Its [repository](https://github.com/Secondtonumb/IF-MDD)
  distinguishes the older downloadable CTC checkpoint from newer training recipes.
- **Calibrated local GOP**: preserve this inexpensive baseline for comparison. Consider
  raw/logit, posterior, duration, context and uncertainty features. The [2025 GOP study](https://www.isca-archive.org/interspeech_2025/parikh25b_interspeech.pdf)
  finds dataset-dependent benefits; changing an equation does not establish better coaching.

Extend the alignment contract for variable-length paths before accepting deletions:
canonical slot IDs, selected pronunciation IDs, optional phones, inserted sounds and
actual acoustic spans must be separate. Accepted reductions must not create phantom
“correct” sounds or count as learner omissions. Integrate independent acoustic evidence
without assuming every greedy-decoder disagreement is a real error. Add an explicit
unscored/uncertain state throughout UI, analytics and scheduling before using confidence
thresholds to abstain. Calibrate per sound/context using human labels.

## Phases 4–5: prosody, reference audio and capture

Assess stress, pauses, rhythm and intonation separately. Normalize speaker pitch/range
and rate where appropriate; copying a reference speaker's vocal identity is not the goal.
Synthesize/cache whole reference sentences and align them to offer matching-context
excerpts. Label isolated dictionary playback separately and retain multiple US voices.

For raw PCM, capture through an [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process),
use a single recording time origin, resample with antialiasing, persist the analysis
signal alongside playback audio, and test original-versus-rescored identity. Measure
dropouts, clipping, noise and cross-device behavior before switching capture defaults.

Store separate model, aligner, lexicon, scoring/calibration, capture and display revisions.
Historical recordings are immutable evidence. Re-derived scores should have provenance;
revision-separated reporting must extend to every aggregate and comparison, not only
the active screen. Daily first-take/listening/transfer evidence must remain intact.
