# Recalculate saved recordings and propagate current analysis

Implemented 2026-09-23. This refreshes saved audio using the existing revision-2
local scorer; it is not a new acoustic model, calibrated percentage, or voice upgrade.

## Use it

1. Keep the same browser and exact origin where you recorded, e.g.
   `http://localhost:5173/`. A different browser, host name or port has separate storage.
2. Start the local backend (`npm run dev:api`) and reload the app. Existing recordings
   without the new assessment-processing marker are recalculated once, including
   recordings already labeled scorer revision 2.
3. Watch **Current analysis: X/Y recordings** / **Recalculating history** above the
   workspace. **Recalculate all** explicitly reruns every retained recording, even
   already-current ones, and reconnects to a backend started after page load.
4. Review the completed/skipped counts and per-recording failure reasons. Missing
   audio, no pronounceable transcript, rejected audio, or a service failure keep the
   previous assessment; they do not get stamped as successfully refreshed.

Recording is disabled while a batch is running. Successful results are saved one
at a time; closing the page does not discard already saved updates. On the next load,
the automatic pass selects remaining unrefreshed recordings. A force-all pass can
always be requested again. The app cannot reconstruct audio that was previously lost.

## What updates

| Surface | Current-analysis behavior |
| --- | --- |
| History and open diagnostics | Show the newly scored phones, word boundaries and summary. Recording IDs/dates stay the same. Original assessments are expandable in History. |
| Trouble Words | Rebuild flags, per-word score histories and contexts from current compatible analyses. Manual pins remain user choices; review dismissals are tied to their original scoring evidence. |
| Stats & Progress | Rebuild recording/phone/word summaries and timelines. Prefer current local-scorer revision 2; exclude other scoring scales from numerical comparisons, without deleting recordings. |
| Daily targets | Rebuild candidates, including flagged legacy words. Targets with no current flag stop entering new queues, while cards and earned schedules remain saved. An already-started session is not erased. |
| Daily history | Show linked recordings' current assessments alongside preserved original event scores. Listening answers, first/retry status, exposure, dates and completed review intervals are not rewritten. |

Missing audio may leave a mixture of refreshed and older assessments. Coverage and
per-recording labels expose this. A retained older revision-2 assessment is still
on the same acoustic scale, but is not marked refreshed; different scorer/revision
scales are excluded from combined recording analytics. Daily displays mixed scales
without averaging them. Historical review dates/counters describe actual scheduling,
not a retroactive simulation of what the new scores would have scheduled.

Legacy takes lack trustworthy first-attempt metadata. They now contribute to word
analysis and provisional Daily suggestions, with separate legacy counts; they do
not become independent first-take or retention evidence merely by being rescored.
Retries remain excluded from the recurring-sound panel but visible in recording
analytics. Neither view is human-validated pronunciation correctness.

## Safety and provenance

- Before the first history refresh, the original serialized attempt list is saved
  once at `phonetics-lab:attempts:before-history-refresh-v1`. If backup creation fails,
  the refresh stops. This backup lives in the same browser; it is not an off-device
  backup and does not include a second copy of audio.
- Each updated attempt preserves its earliest assessment and receives a processing
  version, source and recalculation timestamp. The acoustic scorer revision stays 2.
- Each completed analysis is merged by recording timestamp only when the original
  record still matches the snapshot sent for scoring. Concurrent additions survive;
  deleted or edited recordings are not resurrected/overwritten by the batch.
- Storage failures abort the batch and are shown. The previous stored list survives
  a failed write. Saving history no longer silently truncates to the latest 500 takes.
  If saved history changes in another tab, this page stops writing and asks for a
  reload instead of overwriting that newer list. Use one tab during recalculation.
- Routine loading/refreshing no longer prunes audio. Explicit recording deletion or
  confirmed history reset still removes audio; full history reset also removes the
  history-refresh backup and original assessments.
- Audio is sent only to the local scoring service. Reference voices and their
  providers are unchanged. No user recordings, transcripts or scores are committed.

`npm run check:history` uses original synthetic fixtures to test force-all behavior,
missing audio, cancellation, storage failures, race-safe merges, original preservation,
legacy targets and propagation into Stats/Daily. These tests are not a human accuracy
benchmark and do not prove a user's browser has completed its actual refresh.
