# Pronunciation accuracy roadmap

Research reviewed 2026-09-21; implementation updated 2026-09-22.
Goal: trustworthy feedback on American English pronunciation,
with word replay that does not deliberately include neighboring speech.

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
| 1 — Human evaluation set | Collect representative recordings; annotate boundaries and pronunciation independently | Frozen pilot set, consent/provenance, adjudicated labels, held-out test split and baseline report |
| 2 — Better word alignment | Compare current revision with MFA 3 US English and Qwen3-ForcedAligner; add alignment provenance/confidence to the API | Lower boundary error and neighboring-word leakage without hiding difficult cases or increasing clipped target sounds |
| 3 — Pronunciation validity | Optional/deleted/inserted phones, contextual pronunciation paths, trained assessment and per-phone calibration | Better false-rejection/acceptance tradeoff on held-out human labels; explicit abstention and coverage; no regression on valid US variants |
| 4 — Natural American speech | Stress, rhythm, intonation, sentence-matched reference excerpts and multiple US speakers | Separate human-rated prosody evaluation; repeatable coaching; no penalty for unrelated voice/pitch differences |
| 5 — Deployment and monitoring | Provider/version provenance, calibration migration, latency/cost/privacy measurements, robust raw PCM capture | Same evidence across supported devices; revision-separated analytics; reproducible rollback and benchmark reports |

Work that can run alongside phase 1: raw PCM capture experiments, data export tools,
and local aligner adapters. Do not replace the scorer based on prettier demos or higher
average scores. Raising every score can reduce false rejections while accepting errors.

## Phase 1: collect evidence before selecting a winner

Start with 100–200 short recordings as a pilot, including the user's problem cases and
native American English controls. This is a starting regression corpus, not enough to
establish universal state-of-the-art performance.

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
When testing actual replay, supply the playback intervals, including any applied padding.

```json
{"id":"fixture-1","scorer":"candidate-name","revision":"checkpoint-and-config","words":[{"text":"one","start":0.1,"end":0.31,"correct":true},{"text":"two","start":null,"end":null,"correct":null}]}
```

The evaluator reports boundary mean and p95 error, boundaries within 20/50 ms,
clips intersecting other annotated words, false acceptance/rejection and coverage.
Zero evaluated samples yield null error rates, not perfect results. Mixed engines,
mixed human/synthetic labels, duplicate IDs and mismatched words are refused. The
initial format requires adjudicated non-overlapping boundaries; exclude ambiguous
items explicitly and report their count separately. Later extend it to boundary
intervals, rater disagreement, phoneme-level error diagnosis and score correlation.

Report both speech mistakenly included and target speech mistakenly cut off. Inspect
the worst cases, not only the mean. Count unscored/uncertain results and compare engines
at comparable coverage. Bootstrap by speaker/session for confidence intervals once
there is sufficient data. Choose numerical release thresholds after measuring the
baseline and rater disagreement; do not invent a validated target from synthetic tests.

## Phase 2: alignment candidates

- **MFA 3 US English**: first local baseline for word and phone alignment. Its authors'
  [2026 evaluation](https://arxiv.org/html/2606.18466v1) compares multiple aligners on
  TIMIT/Buckeye and other languages. Those results are not a benchmark of this user's
  recordings. Deployment uses an additional [Conda/container environment](https://montreal-forced-aligner.readthedocs.io/en/latest/installation.html).
- **[Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B)**:
  local neural word-timestamp candidate with a Python interface. Run in an isolated
  environment first; assess latency/memory on the supported hardware. It does not
  provide a validated pronunciation grade merely by aligning text.

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
