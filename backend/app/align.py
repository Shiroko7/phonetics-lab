"""
CTC forced alignment and Goodness of Pronunciation.

This is the whole reason the backend exists. The browser path free-decodes the
audio — argmax per frame, collapse, drop blanks — and then tries to work out
what went wrong by string-matching the result against the target. That throws
the model's confidence away at the first step and leaves every downstream stage
repairing a hard decision it can no longer see inside.

Forced alignment does the opposite. The target is known, so the audio is
threaded through *that* sequence and nothing else, and what comes back is where
each expected phone was and how strongly the model believed in it. A phone the
speaker fumbled does not become a different symbol that then has to be matched
up again; it stays in its slot with a low score.

GOP (Witt & Young, 1997) is the number that falls out of it: for each phone,
how much log-probability the canonical phone gave up against the best phone
available over the same frames.

    GOP(p) = mean over the phone's frames of [ log P(p | frame) - max_q log P(q | frame) ]

It is zero when the model's own first choice was the phone we asked for, and
increasingly negative as the audio pulls away from it.

The Viterbi pass is written out here rather than delegated to
`torchaudio.functional.forced_align` + `merge_tokens`. Not for want of trusting
it, but because `merge_tokens` groups frames by token *value*: a target with two
adjacent identical phones — "black cat", "this sound" — comes back with one span
where there should be two, and every index after it refers to the wrong phone.
Doing the backtrack here keeps target *positions*, which is what the scores have
to be reported against.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

NEG_INF = -1e30


@dataclass
class PhoneScore:
    """How one expected phone fared."""

    token: str
    token_id: int
    start_frame: int
    end_frame: int
    gop: float
    posterior: float
    runner_up: str | None
    runner_up_posterior: float
    # The accepted variant that scored better than the canonical phone, if any.
    variant: str | None = None


def viterbi_align(
    log_probs: np.ndarray, token_ids: list[int], blank: int = 0
) -> list[tuple[int, int]]:
    """
    Best monotone path of `log_probs` (T, C) through `token_ids`, exactly.

    Standard CTC alignment over the blank-extended label sequence
    [blank, y1, blank, y2, ... yL, blank]: a frame may hold the current symbol,
    step to the next, or skip a blank to the symbol after it — that last move
    only when it does not merge two identical labels, which is the rule that
    keeps a doubled phone from collapsing into one.

    Returns one (start, end) frame span per entry of `token_ids`.
    """
    T, _ = log_probs.shape
    L = len(token_ids)
    if L == 0:
        raise ValueError("nothing to align against")
    S = 2 * L + 1
    if T < L:
        raise ValueError(
            f"the recording is too short for this line: {T} frames for {L} phones"
        )

    # ext[s] is the symbol at extended position s; even positions are blanks.
    ext = np.full(S, blank, dtype=np.int64)
    ext[1::2] = token_ids

    # A skip into s is legal only from a real symbol that differs from ext[s].
    skip_ok = np.zeros(S, dtype=bool)
    skip_ok[3::2] = ext[3::2] != ext[1:-2:2]

    emit = log_probs[:, ext]  # (T, S) — cost of being at each position per frame

    dp = np.full(S, NEG_INF, dtype=np.float64)
    dp[0] = emit[0, 0]
    dp[1] = emit[0, 1]
    back = np.zeros((T, S), dtype=np.int8)

    for t in range(1, T):
        stay = dp
        step = np.concatenate(([NEG_INF], dp[:-1]))
        skip = np.concatenate(([NEG_INF, NEG_INF], dp[:-2]))
        skip = np.where(skip_ok, skip, NEG_INF)

        options = np.stack((stay, step, skip))
        choice = np.argmax(options, axis=0)
        back[t] = choice
        dp = options[choice, np.arange(S)] + emit[t]

    # A valid path ends on the last symbol or the blank after it.
    s = S - 1 if dp[S - 1] >= dp[S - 2] else S - 2
    path = np.empty(T, dtype=np.int64)
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= int(back[t, s])

    spans: list[tuple[int, int]] = []
    for index in range(L):
        frames = np.flatnonzero(path == 2 * index + 1)
        # A phone the path gave no frames of its own is pinned to the boundary
        # rather than dropped, so the returned list still lines up one-for-one
        # with the phones that were asked about.
        if frames.size == 0:
            edge = spans[-1][1] if spans else 0
            spans.append((edge, edge))
        else:
            spans.append((int(frames[0]), int(frames[-1]) + 1))
    return spans


def score_phones(
    log_probs: np.ndarray,
    token_ids: list[int],
    tokens: list[str],
    english_ids: list[int],
    id_to_token: dict[int, str],
    blank: int = 0,
    variant_ids: list[list[int]] | None = None,
) -> list[PhoneScore]:
    """
    Force-align, then read a GOP and a diagnosis off each phone's frames.

    Where a phone has accepted variants, it is scored against the best of
    itself and them. A speaker who taps the /t/ in "water", or reduces the
    vowel in "about", has produced the word correctly and should see a full
    score for it — not a canonical phone marked down for a pronunciation the
    app's own README calls right.
    """
    spans = viterbi_align(log_probs, token_ids, blank=blank)
    best_per_frame = log_probs.max(axis=1)
    english = np.asarray(english_ids, dtype=np.int64)
    variants = variant_ids or [[] for _ in token_ids]

    out: list[PhoneScore] = []
    for (start, end), token_id, token, alternates in zip(spans, token_ids, tokens, variants):
        if end <= start:
            # No frames at all: the model never found room for this phone, which
            # is the alignment's way of saying it was not produced.
            out.append(
                PhoneScore(token, token_id, start, end, float(NEG_INF), 0.0, None, 0.0)
            )
            continue

        window = log_probs[start:end]
        headroom = best_per_frame[start:end]

        gop = float(np.mean(window[:, token_id] - headroom))
        posterior = float(np.mean(np.exp(window[:, token_id])))
        variant: str | None = None

        # An accepted variant that fits the audio better takes over the score.
        for alternate in alternates:
            other = float(np.mean(window[:, alternate] - headroom))
            if other > gop:
                gop = other
                posterior = float(np.mean(np.exp(window[:, alternate])))
                variant = id_to_token.get(alternate)

        # What the model would rather have heard, restricted to English so the
        # answer is a sound the speaker can actually be told about.
        mean_by_phone = window[:, english].mean(axis=0)
        order = np.argsort(mean_by_phone)[::-1]
        runner_up: str | None = None
        runner_up_posterior = 0.0
        for position in order:
            candidate = int(english[position])
            if candidate != token_id:
                runner_up = id_to_token.get(candidate)
                runner_up_posterior = float(np.exp(mean_by_phone[position]))
                break

        out.append(
            PhoneScore(
                token=token,
                token_id=token_id,
                start_frame=start,
                end_frame=end,
                gop=gop,
                posterior=posterior,
                runner_up=runner_up,
                runner_up_posterior=runner_up_posterior,
                variant=variant,
            )
        )
    return out


# GOP is unbounded below and not comparable across phones without calibration:
# /ð/ and /ə/ sit low even when perfectly produced, because the model spreads
# its probability over neighbours that sound the same, while /s/ sits near zero.
# The honest version of these thresholds is a per-phone table fitted to human
# scores — speechocean762 is the corpus for it. Until that is fitted these are
# provisional, deliberately lenient, and the one place to change.
GOOD_ABOVE = -0.60
CLOSE_ABOVE = -1.80
# Below this the model found effectively none of the phone in those frames.
ABSENT_BELOW = -6.00


def verdict_for(score: PhoneScore) -> str:
    """
    The app's existing vocabulary, so the front end needs no new cases.

    "missing" is reserved for a phone the alignment could find no frames for at
    all. A very low GOP is *not* the same thing: a speaker who says /s/ where
    /θ/ belonged has not dropped a sound, they have swapped one, and the runner-
    up says which. Calling that "missing" would coach the wrong correction —
    "you left it out" instead of "you said /s/".
    """
    if score.end_frame <= score.start_frame:
        return "missing"
    if score.gop >= GOOD_ABOVE:
        return "correct"
    if score.gop >= CLOSE_ABOVE:
        return "close"
    return "wrong"


def to_percent(gop: float) -> int:
    """
    A 0-100 reading of a GOP, for the score line.

    Exponential rather than linear: the interesting range is the shoulder near
    zero, where a phone goes from confident to doubtful, and a linear map spends
    most of its resolution on gross errors that are already obvious.
    """
    if gop <= ABSENT_BELOW:
        return 0
    return int(round(100 * float(np.exp(gop / 1.8))))
