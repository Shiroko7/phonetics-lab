# Sound-focused practice feedback

This is a practice workflow, not a new acoustic model or fitted calibration.
Scorer revision 2 and all saved numerical scores remain unchanged.

## How to use it

1. Record a full sentence. The large number and word numbers are averages.
2. Open a word to see each vowel/consonant's model score out of 100. A word with
   a high average can still contain a sound below the practice threshold.
3. The default threshold is **80/100**, adjustable in Settings → Practice feedback.
   Exactly 80 meets the default threshold; scores below it suggest listening and
   practice. This is not an 80% probability of correctness.
4. Listen to your word, then **In context** and the **Reference sentence**. The
   reference is a listening aid; the scorer does not directly compare those waveforms.
5. Use **Sounds acceptable to me**, **Practise later**, or **Bad word cut**, with undo.
   Choices are local to that word occurrence and take. They never modify the score,
   recording, original Daily event, or human benchmark annotations.

“Sounds acceptable” excludes that observation from practice priorities. “Practise
later” retains it in the queue but removes its immediate-retry suggestion. “Bad word
cut” excludes it from priorities, labels the word unassessed and disables isolated
replay; context replay remains available. A new recording can be flagged again.
Changes to the target text or scoring evidence invalidate the old choice.

Ambiguous/unavailable word timing and missing/untimed sound evidence are unassessed,
not diagnosed as pronunciation mistakes. These safeguards do not detect all bad
alignments or recording conditions. A low score alone does not identify the sound
you actually produced or prove that a phone was omitted.

## Can I still get 100?

Yes. This workflow does not lower, cap, normalize or otherwise transform your scores.
The threshold only changes practice suggestions. A numerical phone score of 100 stays
100, and if every scored phone is 100, the average can be 100 too.

The earlier reliability fix stopped converting coarse “correct” verdicts into 100s:
for example, a backend score of 73 labeled “correct” now remains 73. Consequently,
some scores may be lower than the old inflated display. A 100 still means the model
gave its maximum score, not that human listeners would unanimously call it perfect.

## Recurring sounds and the word queue

The **Sounds to check over time** panel appears in Trouble Words and Stats. It uses
the latest take's scorer/revision only, across retained local history. It counts each
sound and each word at most once per first take, even if repeated in the sentence.
A “recurring flag” means at least two flagged first takes across different sentence
contexts or sessions. This is a transparent practice heuristic, not a validated
statistical diagnosis; persistent model errors can recur too.

Studio treats the first recording of a sentence since page load as a first take.
Daily records first-take metadata with its saved session and exercise. Duplicate
sentence/session combinations are counted once. Immediate retries are excluded from
the recurring-sound tally, but their latest assessed result can clear a word from the
review queue. Reopening a recording does not create a new observation.

Older takes without this metadata are explicitly excluded from first-take statistics;
we cannot reconstruct their independence. Their audio, scores and legacy trouble-bank
storage remain intact. The active word queue is derived from latest compatible takes
and manual pins, so it may differ from the old accumulated list. Its word score and
context describe the latest flagged occurrence, not a reconstructed lifetime history.
Removing a queue item hides earlier flags until a new take; removing a pin or clearing
the queue is still an explicit user action.

Daily uses the same threshold for assessed sounds; a high sentence average cannot
override a below-threshold sound. Manual review can allow proceeding conservatively
without counting as an objectively successful review. A choice for one word cannot
hide an unresolved flag in another word. Historical events keep the threshold and
practice-policy revision used when recorded. Changing Settings does not rewrite them.

Historical Stats charts still summarize original model verdicts and may include
retries; they are labeled separately from the new first-take review panel. The latter
is all retained history, independent of the historical chart's date filter.

## Evidence and limits

The initial exact-match phone benchmark covers 1,188 of 1,883 corpus phone slots
(63.1%). At 80, 51/57 majority-human incorrect/missed slots were flagged, but 260 other
slots were flagged too. Thus a below-80 score is a useful candidate for listening,
**not proof you said it wrong**. This operational rubric does not label accent-only
concerns as incorrect. See [the benchmark report](human-benchmarks.md#phone-flag-pilot)
for mapping exclusions, counts and population limitations.

Next accuracy work remains human-marked word boundaries, representative recordings,
development/calibration splits and candidate scorer comparisons. Stress, rhythm and
intonation are not assessed yet. No dataset, recording or licensed content is added
to Git by this workflow.
