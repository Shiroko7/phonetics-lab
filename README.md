# Phonetics Lab

Paste English text, hover any word, get its General American pronunciation in IPA —
with syllable breaks, stress marks, a plain-English respelling, and audio.

Then record yourself and have every sound checked against it, and drill the ones that keep
going wrong. **Vowels** is the reference behind all of it: the vowel chart, clickable, with
what each vowel is and every way English writes it.

Everything runs in the browser. The dictionary is bundled, so there is no API key,
no rate limit, and no network round-trip per word.

## Running it

```bash
make install
make dev
```

That starts two things: the web app on :5173, and a local scoring service on :8000 that
grades recordings by forced alignment on the GPU. `make web` runs the app alone — it is
complete without the service and falls back to the in-browser recogniser, just less
precisely. `make help` lists the rest.

Without `make`, the same targets are `npm install && npm run dev`.

The dictionary at `public/dict/cmudict-ipa.txt` is already built and checked in, so this
works straight away. `npm run dict` regenerates it — it downloads CMUdict (3.6 MB, cached
in `scripts/.cache`) and rewrites the table, which you only need after changing anything
in `phonology.ts`.

`make check` runs both regression suites, `make build` produces a static `dist/` you can
host anywhere.

### The scoring service

Optional, local, and off by default until you start it. It needs [uv](https://astral.sh/uv);
`make install` does the rest, fetching PyTorch and about 1.2 GB of model weights on first
run. Recordings are posted to 127.0.0.1 and go no further.

It exists because the browser and the GPU can afford different answers to the same
question — see [How the comparison works](#how-the-comparison-works). If it is not running
the app never mentions it beyond a one-line hint.

The first time it is available, attempts scored without it are quietly re-measured from
their stored recordings, one at a time, and the history panel says so while it happens. A
score is derived from a recording and the recordings are untouched, so improving the
derivation is a migration rather than a question to put to anybody. `SCORER_REVISION` in
`practice.ts` drives it: raise it whenever the service starts producing different numbers
for the same audio — recalibrated thresholds, a new model — and the history re-measures
itself on the next load. An attempt whose audio no longer exists keeps its old score and
stays marked as being on the older scale.

| | in the browser | with the service |
|---|---|---|
| decoding | greedy CTC, then string-match | forced alignment against the expected phones |
| weights | int4 ONNX | fp32 PyTorch on CUDA |
| per phone | one of four verdicts | a goodness-of-pronunciation score |
| a bad phone | becomes a different symbol | stays in its slot, scored low |
| diagnosis | nearest neighbour by feature distance | the model's own runner-up |

## How a word is transcribed

The dictionary is CMUdict — 126,052 headwords, hand-curated at Carnegie Mellon —
converted at build time from ARPAbet to syllabified IPA. Words it does not list are
resolved by a cascade, and every result is labelled in the UI so you can tell curated
data from inference:

| Stage | Example | Badge |
| --- | --- | --- |
| Dictionary entry | `through` → /θɹu/ | **dictionary** |
| Numerals read as words | `1,250` → /wʌn ˈθaʊ.zənd .../ | derived |
| Initialisms read as letters | `API` → /ˌeɪˌpiˈaɪ/ | letters |
| Possessives, with the right allomorph | `Kubernetes's` → /-tɛ.sɪz/ | derived |
| British spellings mapped to American | `organised` → `organized` | derived |
| Hyphenated compounds, transcribed in parts | `well-known` | derived |
| Regular affixation on a known stem | `debuggable` → `debug` + `-able` | derived |
| Letter-to-sound rules | `Zylphrax` → /ˈzɪl.fɹæks/ | **guess** |

The affix stage undoes English orthography to find the stem — doubled consonants
(`stopped` → `stop`), dropped *e* (`hoping` → `hope`), *y* → *ie* (`cities` → `city`) —
then attaches the affix with the correct allomorph: `-s` is /s/, /z/ or /ɪz/ and `-ed`
is /t/, /d/ or /ɪd/ depending on the final phone of the stem.

## Phonological detail

- **Syllabification** follows the maximal onset principle, with the refinement that a
  stressed lax vowel must close its syllable — so `happy` is /ˈhæp.i/, not /ˈhæ.pi/.
- **Prefixes hold their boundary**, so `misconfigured` is /ˌmɪs.kənˈfɪɡ.jɚd/ rather than
  the /ˌmɪ.skən-/ that maximal onset alone would give.
- **Flapping** is on by default and correctly blocked by stress on either side. The
  minimal pair works: `atom` /ˈæɾ.əm/ against `atomic` /əˈtɑ.mɪk/.
- **The cot–caught merger** is a toggle rather than baked in, because CMUdict keeps
  /ɔ/ and /ɑ/ distinct and a merger can be applied but not undone.

Transcriptions are stored canonically — unflapped, unmerged — and the display options
are applied on the fly.

## Audio

Clicking a word speaks it through the browser's speech synthesiser. This is the primary
path because it is instant, works offline and can say anything — invented words and
surnames included. Measured click-to-speech is well under a millisecond, with no network
call on the click path.

Pick a voice in the sidebar. The list is split by what actually determines responsiveness:

- **Installed — instant.** Local SAPI voices. They start speaking immediately.
- **Online — slower, needs network.** Windows "Online (Natural)" voices. They sound
  better but synthesise in Microsoft's cloud, so every word costs a round-trip. That is
  very noticeable when clicking word by word, and the first press is slowest of all.

Local voices sort first and are chosen by default. If the machine has no offline English
voice installed — which is common, and was the case on the machine this was built on —
the panel says so and gives the Windows path to install one. Voices also carry a ♂/♀ hint
guessed from the name, and the choice is remembered in `localStorage`. ▶ previews it.

The engine is primed with a silent utterance on first interaction so the first word
clicked does not pay engine start-up cost.

Human recordings from [dictionaryapi.dev](https://dictionaryapi.dev) are available behind
the **Use human recordings** toggle, off by default. When on, a recording is fetched in
the background while a word's card is open and only used once it has already arrived, so
a slow or unreachable API can never delay playback — it just falls back to synthesis.
That API was unreachable during development, which is exactly why nothing awaits it.

## Practice mode

Switch to **Practise** in the header to record yourself and get phone-level feedback.
There are two modes, and both give identical analysis.

**Read a script** — you choose the words first.

1. Pick a sentence from your pasted text, or type any phrase.
2. **Listen** speaks it with your chosen voice.
3. **Record**, say it, then **Stop & analyse**. The take gets a small player — play, scrub,
   stop — and it shares one channel with **Listen**, so the two never talk over each other.
4. Every attempt is kept. **History** lists them by day, newest first. Click one and it comes
   back in full: its words return to the editable box, its score and word breakdown to the
   panel, its recording to the player. From there you can listen to it, correct its words, or
   say it again — it is not a read-only view of the past.

Pressing record does not clear any of that. The previous take's words, score and audio stay
put until the new one has something to replace them with, so a mistimed click costs nothing.
Each entry has its own **×** to delete that attempt and its recording, and **reset** clears
the lot; both ask first.

### Saying it again

Under every result is **● Say it again**, which re-records the line you just said, as many
times as you care to. Beside it is how that line has gone: `4 goes at this line · best 78 ·
up 22 from your first`. Lines are matched however they were capitalised, spaced or
punctuated, so the count follows the words rather than the typing.

In free practice, saying it again pins the transcript first and switches to a script. The
point of another go is to be measured against the same words; leaving it free would have the
recogniser transcribe afresh each time and the target drift out from under you.

Once there is something to compare against, the result is marked up with what moved. The
score carries `+14 on your last go`; each word chip carries `▲7` or `▼12`; each sound that
changed verdict is outlined and flagged, green for better and red for worse. **Compare with
· last go · your best** switches the baseline, because "better than the try before" and
"better than I have ever managed" are different questions and both get asked.

Sounds are matched between attempts by the index of the *expected* phone, which is the one
thing two goes at the same words are guaranteed to share. What was produced differs, and so
does the alignment; matching on anything else would compare a sound against its neighbour
and report progress that never happened. Words are matched by position, and a word that was
edited in or out reports no change rather than a made-up one.

**Speak freely** — you just talk.

1. **Record** and say whatever you like; no target needed.
2. The words are recovered from the audio by a local Whisper model, and become the target.
3. The transcript is shown and is **editable**. If it misheard you — or you meant a
   different word — correct it and the score updates **instantly**, with no re-recording,
   because the sounds you produced are already known and only the target changed.

That last point matters: say "think" with a /s/ and the recogniser will faithfully hear
"sink", which your sounds match perfectly and would score 100. Correcting the transcript to
"think" immediately re-scores the same audio and exposes the /θ/ → /s/ substitution. Free
mode tells you what a listener heard; the correction tells you what you got wrong.

Your recording is transcribed straight into IPA by
[wav2vec2-lv-60-espeak-cv-ft](https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX)
running locally through transformers.js, and that IPA is aligned against the transcription
the dictionary already computed for the phrase. Nothing is uploaded — audio never leaves
the browser.

The phoneme model is fetched the moment you press record, so the download runs while you
speak rather than after you stop, and is cached by the browser afterwards (~240 MB). Free
mode also pulls [whisper-base.en](https://huggingface.co/onnx-community/whisper-base.en)
(~145 MB) for the words. Both run on WebGPU where available, and on wasm otherwise.

Both are loaded at **int4**, on a GPU as much as without one, because the fp16 export of
each is broken in a different way.

The phoneme model is driven directly rather than through a speech-recognition pipeline. Its
repo carries a slow `Wav2Vec2PhonemeCTCTokenizer` — a `vocab.json` and nothing else — and
transformers.js reads only the fast `tokenizer.json` format, so a pipeline goes looking for a
file that was never published. A CTC head needs no tokenizer anyway: the arg max of each
frame, with runs collapsed and blanks dropped, is the phone sequence, and `vocab.json` names
the ids.

Whisper's fp16 merged decoder is an invalid ONNX graph — the `If` node that switches between
the first decode pass and the cached ones returns `logits` straight out of the enclosing
scope, and onnxruntime refuses to load it. That one fails loudly, at load.

The phoneme model's fp16 build fails quietly instead: it loads, it runs, and it returns
nothing whatever was said — which downstream is indistinguishable from a speaker who never
opened their mouth, and scores as a confident zero. Its int4 build transcribes correctly and
is a third of the size.

So each model has a short ladder of precisions. A build the runtime rejects falls through to
the next rung; so does one that fails a probe at load — half a second of synthetic audio,
checked for non-finite and for flat logits, the two shapes the quiet failure takes — and so
does one that survives all that and still returns nothing for real speech, which is retried
a rung lower before the take gets the blame.

### How the comparison works

Alignment is Needleman-Wunsch over phones, scored by **articulatory distance** rather than
exact match, so the feedback can distinguish a near miss from a gross error:

- **correct** — the right phone, or a genuine allophone of it. Tapping *water* as [ˈwɑɾɚ],
  reducing to schwa, or merging *cot*/*caught* are not mistakes.
- **close** — a different phoneme, articulated nearby. /θ/ said as /s/ lands here: the
  tongue is almost right, but *think* and *sink* are different words, so it is still flagged.
- **wrong** — a different phoneme, clearly elsewhere in the mouth.
- **missing** / **extra** — a sound dropped, or one inserted.

Articulatory closeness never excuses a phoneme swap; it only grades severity. Each pair
carries a plain-language note — "moved from dental to alveolar", "lost the r-colouring",
"tongue too high" — derived from the feature table in `phonefeatures.ts`.

### With the scoring service: forced alignment and GOP

The above is what the browser can afford. It has a structural weakness: the recogniser is
asked what was said, with no knowledge of what *should* have been said, and the answer is
reduced to one symbol per sound before anything compares it. The model's confidence — the
thing that actually distinguishes a fumbled /θ/ from a clean one — is discarded at the
first step, and every later stage is repair work on a hard decision it can no longer see
inside.

The service inverts it. The target is known, so the audio is threaded through *that*
sequence by CTC forced alignment and nothing else. What comes back is where each expected
phone was and how strongly the model believed in it:

    GOP(p) = mean over the phone's frames of [ log P(p | frame) − max_q log P(q | frame) ]

Zero when the model's own first choice was the phone we asked for, increasingly negative
as the audio pulls away. A sound the speaker fumbled never becomes a different symbol that
then has to be matched up again — it stays in its slot with a low score, and the phone the
model would rather have heard is the diagnosis, with a probability behind it.

Measured on a clean take of *think*, scored against the wrong word: the /s/ slot of *sink*
comes back at 24% with the runner-up named as /θ/, and the other three sounds stay at
100%. Scoring the same audio as *think* gives four hundreds.

Two details carry more weight than they look like they should.

**The phone inventories do not match.** The recogniser is trained on espeak output for
every language it covers, so its English is espeak's English: length lives in the symbol
(`iː`, not `i`), NURSE is `ɜː`, and a vowel before /ɹ/ is a *single* token — `ɑːɹ` where
CMUdict has two phones. Asking for [ɑː, ɹ] when the model only emits [ɑːɹ] still produces
an alignment, just one where neither slot is what the model was trying to say. Every
r-coloured syllable in the language would read as a fault in the speaker.

**Each phone is scored against a small set, not one symbol.** espeak drops the length mark
when a vowel is unstressed, writes the reduced vowel of *about* as `ɐ` rather than `ə`, and
writes every syllable-final English /l/ as the dark `ɫ`. Scoring against the canonical
token alone marks down every unstressed vowel and every coda /l/ in the language. On
*think about this*, `ɐ` takes p=0.66 of the schwa's frames while `ə` gets 0.20 — so the
schwa scored 52% until `ɐ` was admitted as a correct production of it, and 100% after.
The accepted allophones the browser already honours — tapped /t/, cot-caught — are in the
same table, so the two scorers never disagree about whether *about* is a mistake.

This is a pronunciation lattice one phone wide. Connected speech wants the same treatment
a level up, where the target sequence is built: linking, elision, the palatalised
*did you*. That is the next thing worth doing, and the thresholds below are the one after.

**What is still provisional.** The GOP cutoffs between correct, close and wrong are
hand-set and deliberately lenient. Honest ones are per-phone and fitted to human judgement
— /ð/ and /ə/ sit low even when perfectly produced, because the model spreads probability
over neighbours that sound the same, while /s/ sits near zero. speechocean762 is the corpus
for fitting them; until that is done the numbers rank attempts against each other well and
should not be read as absolute marks. They live in one place, `backend/app/align.py`.

**What it cannot see.** Forced alignment answers how well each *expected* phone was
produced, and by construction has no opinion about sounds nobody expected — an inserted
vowel, the *espeak* for *speak* that Spanish speakers produce. The free decode rides along
on the same logits for exactly that reason, and the client receives both.

### Reading the result

The alignment runs over a flat phone sequence, which is right for the algorithm and useless
to read: forty symbols in a row say nothing about which word went wrong. Every aligned step
carries the index of the phone it was matched against, so the strip is cut back up along
word boundaries and each word scored on its own.

Opening a word gives you both sides of the comparison to listen to: **♪ correct** speaks it
with the chosen voice, **▶ yours** plays that word alone, cut out of your own recording.

The cut comes free with the recogniser. A CTC model reads the audio as a fixed grid of
frames, so the frame a phone was emitted on, over the frame count, times the duration, is
where in the take that sound happened. Those timings ride along through the folding and the
alignment, so each word knows the stretch of recording it occupies. A phone runs until the
next one starts — contiguous through connected speech — but stops growing after 0.3 s, or a
word before a pause would come back with the pause welded on. The slice is played through
Web Audio rather than by seeking the `<audio>` element, because what `MediaRecorder` writes
carries no seek index and lands only approximately, which on a 300 ms word is the word next
door.

Words are then coloured **green** when every sound landed, **amber** when one drifted,
**red** when one is wrong or missing. That is deliberately structural rather than a score
threshold: *think* said as *sink* is one close miss in four sounds, which scores 88 — and a
green chip on a word the listener just heard as a different word would be worse than no
chip at all. Clicking a word opens its own sounds and its own notes.

Editing the transcript re-runs all of it — alignment, per-word colours, notes and the weak
sound tally — against the same recording, with nothing re-recorded and no model re-run.

### Weak sounds

Attempts live in `localStorage`; the recordings themselves go to IndexedDB, keyed by the
attempt's timestamp, which is what makes a history entry something you can play rather than
only read. Storage is best-effort throughout — a private window or a blocked store costs the
entry its player and nothing else.

Correcting the words of a reopened attempt rewrites *that* attempt, not the newest one, and
keeps its original timestamp so its recording stays attached to it.

Every attempt is rolled up per expected phone, ranked by error
rate weighted by how often you have attempted it, so an eight-of-ten habit outranks a
one-off fluke — the answer to "where am I weak" rather than "how did this one attempt go".

Naming the fault is only half of it, so each weak sound also carries the substitution you
actually make (when there is a dominant one — an even split between two is not a habit) and
words to fix it in. Those are **minimal pairs** wherever English offers them: *path*/*pass*,
*they*/*day*, *fit*/*feet*, *thing*/*thin*, *she*/*see*. One phone apart and nothing else,
so the mistake stops being abstract and becomes a different word. Clicking a pair loads it
as the next thing to say.

Candidates come from `public/dict/common-words.txt`, a frequency-ordered list intersected
with CMUdict, because the dictionary at large offers *thole* as readily as *think* and a
drill on a word nobody says is no drill at all. `npm run common` regenerates it.

### Drills

A word on its own is a poor drill. *Thought* said in isolation is a performance: the mouth
has time to set itself, nothing runs into anything else, and the sound comes out better than
it ever does in speech. So under the pairs, each weak sound also offers **short phrases** —
five or six words, one breath — where the same sound has to survive an ordinary rhythm.

`src/data/phrases.ts` is a hand-written bank of them, covering every sound that can be
expected. Dictionary transcriptions are canonical — no flapping, no glottalling — so /ɾ/ and
/ʔ/ never appear in a target and need no drills; every other phone in the inventory has at
least two lines written for it, plus lines built around the contrasts learners actually
merge: *the cop cut the copper cup*, *please sit in this seat*, *I think this sink is
thick*, *Larry rarely reads long letters*.

Each entry declares what it was written for. What it *contains* is measured against the
dictionary when the bank is indexed, so a phrase cannot quietly stop carrying the sound it
advertises — the regression suite checks every claim in the bank against CMUdict, along with
the length of every line and the coverage of the whole inventory.

**Build a drill** takes the sounds you tick — your weak ones by default, or anything at all
from the full inventory — and assembles a session out of the bank: a handful of lines that
between them cover every sound asked for, each in a couple of different contexts. It is a
greedy set cover with one correction. Some sounds, /ə/ above all, turn up everywhere, so
covering by presence alone marks them done from the leftovers of other people's lines and
never gives them one of their own; a schwa problem is not addressed by a phrase about dogs
that happens to contain three of them. Every sound asked for is therefore owed a line
*written* for it as well as its two contexts.

The session is only a queue of things to say. The line goes in the same box as anything else,
so listening, recording, scoring, retrying, per-word playback and the comparison against
earlier goes all work exactly as they do elsewhere. The list shows what each line drills
(`ɑ×4 ə×3`) and your best score on it so far; **next line →** appears beside *Say it again*.

Because a drill line is not really being marked out of a hundred — the other sounds in it are
only there to carry the one that matters — the result also reports the sounds the line was
chosen for on their own: `ɑ 4/5`, `ə 2/6`. That is the answer to what was asked; the overall
score is context.

When you already know what gives you trouble, none of this needs a history first: **+ any
other sound** opens the whole inventory, grouped by kind, and any phone in it will build a
drill.

## The vowel chart

**Vowels** in the header is the reference: the vowel quadrilateral, drawn rather than pictured,
because the positions are data. The same two numbers that place a dot say what the tongue is
doing — left to right is how far forward it sits, top to bottom is how far the jaw has
dropped — and the shape is a trapezium rather than a rectangle because the mouth is one: as
the jaw opens, the range of places the tongue can reach at the front narrows, so the front
edge leans in. That is why /i/ and /u/ sit far apart at the top and /ɑ/ has almost nowhere
left to go at the bottom.

Click any vowel to hear it. What is spoken is the lexical-set keyword — *fleece*, *kit*,
*thought* — rather than a bare vowel, because a bare vowel is not something a
speech synthesiser can be trusted to produce, and a vowel in a word is the thing being
learned anyway.

**Gliding** switches to the diphthongs, drawn on the same chart as arrows: tail where the
vowel starts, head where it lands. Stopping short of the head is what flattens *late* into
something close to *let*, and seeing the journey says that better than a paragraph.

Every vowel the app can score is on the chart. /ɚ/ is the one exception, and not an omission:
it is /ɝ/ unstressed, the same mouth in the same place, so it shares the dot. /ɾ/ and /ʔ/ are
absent from the whole reference because dictionary transcriptions are canonical and neither is
ever *expected*.

Below the chart, each vowel gets:

- **what the mouth does** — where the tongue goes, what the lips do, whether it is tense or lax;
- **what it gets mistaken for**, with the reason spelled out by the same articulatory
  comparison the practice feedback uses: /ɑ/ heard as /ʌ/ is *tongue too high*. Each of those
  is itself a link to that vowel, so a confusion can be walked in both directions;
- **your own record with it**, once there is practice history — how often it has come up, how
  often it went wrong, and what it usually turns into;
- **how it is written**, which is the part that is genuinely hard. /u/ is *oo*, *u*, *ew*,
  *ue*, *ou*, *ui* and a bare *o*; each pattern comes with real words, and the letters doing
  the work are picked out in each.

Those example words are not curated. They are drawn from the frequency list, so they are words
worth knowing, and each is confirmed against the dictionary. Crediting the right *letters*
takes more than checking that the sound is in there somewhere: *people* contains an /i/ and
contains an `e`, but the `e` that makes the sound is the one inside `eo`, and offering
*people* as an example of a bare `e` would teach something false. So a word is used only when
its vowel spellings and its vowel sounds line up one for one — vowel-letter runs counted with
silent final `e` dropped, `y` a vowel everywhere but the first letter, `w` never one — and the
run the pattern matched is the one that answers for the sound. Words where that cannot be
established are skipped rather than guessed at.

**practise this sound** hands the vowel to Practise, which opens a drill on it from the phrase
bank.

## Layout of the code

```
scripts/build-dict.mjs   CMUdict -> syllabified IPA, run once
scripts/build-common.mjs frequency list -> practice-word candidates, run once
scripts/check.mjs        regression suite for the pipeline
src/lib/phonology.ts     ARPAbet -> IPA, syllabification, stress, flapping, respelling
src/lib/morphology.ts    affix rules and allomorphs
src/lib/g2p.ts           letter-to-sound fallback
src/lib/spelling.ts      British -> American spelling
src/lib/lookup.ts        the cascade above
src/lib/analyze.ts       passage -> per-token pronunciations + coverage stats

src/lib/asr.ts           lazy-loaded phoneme recogniser (transformers.js)
src/lib/recorder.ts      microphone capture -> 16 kHz mono for the model
src/lib/clips.ts         recorded takes in IndexedDB, so an attempt can be replayed
src/lib/phonefeatures.ts articulatory features + how-wrong-is-this distance
src/lib/align.ts         recogniser IPA -> our inventory, then phone alignment
src/lib/report.ts        alignment -> per-word scores and colours
src/lib/drills.ts        minimal pairs and practice words for a weak sound
src/lib/phrasebank.ts    picking drill phrases, and covering several sounds at once
src/data/phrases.ts      the curated phrases themselves
src/data/vowels.ts       vowel positions on the chart, and what each one is
src/lib/vowelref.ts      example words per spelling, credited to the right letters
src/lib/practice.ts      attempt history, per-line progress, weak-sound aggregation
src/lib/backend.ts       talks to the scoring service, and decides whether it is there

backend/app/main.py      the service: /health, /analyze, /transcribe
backend/app/align.py     CTC forced alignment (Viterbi) and GOP scoring
backend/app/phones.py    General American <-> espeak inventory, and accepted variants
backend/app/recognize.py the models, fp32 on CUDA
backend/app/audio.py     WAV in, 16 kHz mono float32 out, silence trimmed
backend/app/cli.py       `make health`, `make check-api`, `make clean-api`
```

`phonology.ts` is shared by the build script and the runtime, so the offline dictionary
and the live fallbacks can never drift apart. `phones.py` plays the same role across the
language boundary: it is the inverse of `FOLD` in `align.ts`, and the two have to agree
about what counts as a correct production or the browser and the service will grade the
same recording differently.

## Known limits

- General American only. CMUdict is an American source; a British transcription would
  need a non-rhotic transform that this deliberately does not fake.
- Homographs are not disambiguated by context. `read` shows its commonest pronunciation
  and lists the alternate under *also*, since choosing between them needs a parser.
- `1990s` tokenises as `1990` + `s`.
- Practice feedback is only as good as the recogniser. It is trained on many languages and
  can misread a heavy accent, so a flagged phone is evidence rather than proof — treat a
  repeated pattern across attempts as the real signal, not one bad slot.
- Stress and rhythm are not scored yet, only the segments. The scoring service has the
  exact phone boundaries needed for it — duration, energy and F0 per segment — and
  `parselmouth` is already a dependency; nothing reads them yet.
- GOP thresholds are hand-set rather than fitted to human scores, so the numbers compare
  attempts well and are not absolute marks. See *How the comparison works*.
- Insertions are invisible to forced alignment. The free decode is returned alongside so
  the client can spot them, but nothing in the UI uses it yet.
- The browser recorder still encodes to Opus before decoding back to samples, which costs
  detail in the 4-8 kHz band where /s ʃ f θ/ differ. The scoring service is sent
  uncompressed float32, so that loss only affects the in-browser path; capturing raw PCM
  through an AudioWorklet would remove it there too.
- In free mode the transcript is what a listener would hear, not what you intended. A badly
  mispronounced word may be transcribed as the word you actually said, scoring well; edit
  the transcript to compare against what you meant.
