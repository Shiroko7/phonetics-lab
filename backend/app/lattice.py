"""CTC alignment through complete word pronunciations, preserving word ownership.

Each pronunciation is a separate path. Allophones are alternative emitting
states within a phone slot, so they influence timing as well as scoring. Shared
word boundary blanks join paths without merging phones across words. Adjacent
equal emitted labels require a blank, including at a word boundary.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import align, phones
from .models import TargetWord


@dataclass
class State:
    token_id: int
    incoming: list[int] = field(default_factory=list)
    sources: list[int] = field(default_factory=list)
    realized: list[str] = field(default_factory=list)


@dataclass
class AlignedToken:
    score: align.PhoneScore
    sources: list[int]
    realized: list[str]


def build_graph(words: list[TargetWord], inventory: phones.Inventory, blank: int) -> tuple[list[State], list[int]]:
    states = [State(blank)]
    boundary = 0
    last_tokens: list[int] = []
    offset = 0
    for word in words:
        end_boundary = len(states)
        states.append(State(blank))
        word_ends: list[int] = []
        paths = list(dict.fromkeys(tuple(p) for p in [word.phones, *word.pronunciations]))
        for path in paths:
            if len(path) != len(word.phones):
                raise ValueError("Variable-length pronunciation alternatives are not supported by this scoring revision.")
            if any(p not in phones.SINGLE for p in path):
                raise ValueError("The target includes sounds outside the scoring model's inventory.")
            tokens, sources, alternatives = phones.to_tokens(list(path), inventory.vocab)
            previous_blank, previous_tokens = boundary, last_tokens
            for i, (token, covers, variants) in enumerate(zip(tokens, sources, alternatives)):
                current_tokens = []
                for name in dict.fromkeys([token, *variants]):
                    token_id = inventory.vocab[name]
                    incoming = [previous_blank, *[s for s in previous_tokens if states[s].token_id != token_id]]
                    current_tokens.append(len(states))
                    states.append(State(token_id, incoming, [offset + j for j in covers], [path[j] for j in covers]))
                following_blank = end_boundary if i == len(tokens) - 1 else len(states)
                if following_blank == len(states):
                    states.append(State(blank))
                states[following_blank].incoming.extend(current_tokens)
                previous_blank, previous_tokens = following_blank, current_tokens
            word_ends.extend(previous_tokens)
        boundary, last_tokens = end_boundary, word_ends
        offset += len(word.phones)
    if len(states) > 10_000:
        raise ValueError("This passage has too many pronunciation alternatives. Please use a shorter sentence.")
    return states, [boundary, *last_tokens]


def align_words(log_probs: np.ndarray, words: list[TargetWord], inventory: phones.Inventory, blank: int = 0) -> list[AlignedToken]:
    align.validate_log_probs(log_probs)
    if not words or any(not w.phones for w in words):
        raise ValueError("No pronounceable words were supplied.")
    states, terminals = build_graph(words, inventory, blank)
    count, frames = len(states), log_probs.shape[0]
    # Bound traceback memory before allocating it (four bytes per entry).
    if frames * count > 40_000_000:
        raise ValueError("This recording is too long to align safely. Please practise a shorter passage.")
    token_ids = np.asarray([s.token_id for s in states])
    predecessors = np.full((count, max(len(s.incoming) for s in states) + 1), count, dtype=np.int32)
    for i, state in enumerate(states):
        predecessors[i, :len(state.incoming) + 1] = [i, *state.incoming]
    dp = np.full(count + 1, -np.inf)
    dp[0] = log_probs[0, blank]
    for i, state in enumerate(states):
        if state.sources and 0 in state.incoming:
            dp[i] = log_probs[0, state.token_id]
    back = np.zeros((frames, count), dtype=np.int32)
    rows = np.arange(count)
    for t in range(1, frames):
        candidates = dp[predecessors]
        chosen = candidates.argmax(axis=1)
        back[t] = predecessors[rows, chosen]
        dp[:count] = candidates[rows, chosen] + log_probs[t, token_ids]
    state = max(terminals, key=lambda s: dp[s])
    if not np.isfinite(dp[state]):
        raise ValueError("The recording is too short for the expected sounds. Nothing was scored.")
    path = np.empty(frames, dtype=np.int32)
    for t in range(frames - 1, -1, -1):
        path[t] = state
        state = int(back[t, state])

    runs: list[tuple[int, int, int]] = []
    start = 0
    for end in range(1, frames + 1):
        if end == frames or path[end] != path[start]:
            if states[path[start]].sources:
                runs.append((int(path[start]), start, end))
            start = end
    selected = [states[s] for s, _, _ in runs]
    scored = align.score_spans(
        log_probs, [(start, end) for _, start, end in runs],
        [s.token_id for s in selected], [inventory.id_to_token[s.token_id] for s in selected],
        inventory.english_ids, inventory.id_to_token,
    )
    return [AlignedToken(score, state.sources, state.realized) for score, state in zip(scored, selected)]
