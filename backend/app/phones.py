"""
Translation between the app's General American inventory and the phone
vocabulary the recogniser was actually trained on.

The two do not line up, and the mismatch is not cosmetic. `facebook/wav2vec2-
lv-60-espeak-cv-ft` is trained on espeak output for every language it covers,
so its English is espeak's English: length marks are part of the symbol (`iː`,
not `i`), NURSE is `ɜː` rather than `ɝ`, and — the one that matters most — a
vowel before /ɹ/ is a *single* token (`ɑːɹ`, `ɔːɹ`, `ɛɹ`, `ɪɹ`, `ʊɹ`, `oːɹ`)
where CMUdict gives two phones.

Getting that last part wrong is quietly expensive. Forced alignment threads the
audio through whatever target sequence it is handed, so asking for [ɑː, ɹ] when
the model only ever emits [ɑːɹ] still produces an alignment — just one where
neither slot is what the model was trying to say, and both score badly. Every
r-coloured syllable in the language would read as a fault in the speaker.

So the mapping is sequence-aware: it folds the pairs the model treats as units
into single tokens, and remembers which expected phones each token came from so
the score can be handed back to the right slots.
"""

from __future__ import annotations

# General American phone -> espeak token. Every value is verified present in the
# model's vocabulary at load time; see `build_index`.
SINGLE: dict[str, str] = {
    # Consonants map one to one.
    "p": "p", "b": "b", "t": "t", "d": "d", "k": "k", "ɡ": "ɡ",
    "tʃ": "tʃ", "dʒ": "dʒ",
    "f": "f", "v": "v", "θ": "θ", "ð": "ð", "s": "s", "z": "z",
    "ʃ": "ʃ", "ʒ": "ʒ", "h": "h",
    "m": "m", "n": "n", "ŋ": "ŋ", "l": "l", "ɹ": "ɹ", "j": "j", "w": "w",
    # Allophones the app can expect when it models connected speech.
    "ɾ": "ɾ", "ʔ": "ʔ",
    # Vowels. espeak carries length in the symbol.
    "i": "iː", "ɪ": "ɪ", "ɛ": "ɛ", "æ": "æ",
    "ə": "ə", "ʌ": "ʌ", "ɑ": "ɑː", "ɔ": "ɔː",
    "ʊ": "ʊ", "u": "uː",
    # NURSE has no ɝ in this vocabulary; ɜː is the same vowel.
    "ɝ": "ɜː", "ɚ": "ɚ",
    # Diphthongs are single tokens already.
    "eɪ": "eɪ", "aɪ": "aɪ", "ɔɪ": "ɔɪ", "oʊ": "oʊ", "aʊ": "aʊ",
}

# Expected-phone sequences the model emits as one token. Longest first: `oʊ ɹ`
# has to be tried before `oʊ` alone or it will never match.
MERGES: list[tuple[tuple[str, ...], str]] = [
    (("ɑ", "ɹ"), "ɑːɹ"),
    (("ɔ", "ɹ"), "ɔːɹ"),
    (("oʊ", "ɹ"), "oːɹ"),
    (("ɛ", "ɹ"), "ɛɹ"),
    (("ɪ", "ɹ"), "ɪɹ"),
    (("i", "ɹ"), "ɪɹ"),
    (("ʊ", "ɹ"), "ʊɹ"),
    (("u", "ɹ"), "ʊɹ"),
    # fire, hour: the app spells these vowel + NURSE.
    (("aɪ", "ɝ"), "aɪɚ"),
    (("aɪ", "ɚ"), "aɪɚ"),
]

_MERGE_WIDTH = max(len(seq) for seq, _ in MERGES)

# espeak token -> the General American phone to report it as, so a diagnosis
# always names a sound the rest of the app knows about. A canonical mapping wins
# over a variant one: `ɐ` reports as /ə/ because /ə/ lists it first, and no
# reading of the vocabulary should make the app say the speaker produced an /ɐ/.
def _build_reverse() -> dict[str, str]:
    out: dict[str, str] = {token: phone for phone, token in SINGLE.items()}
    out.update({
        "ɑːɹ": "ɑ", "ɔːɹ": "ɔ", "oːɹ": "oʊ", "ɛɹ": "ɛ",
        "ɪɹ": "ɪ", "ʊɹ": "ʊ", "aɪɚ": "aɪ",
    })
    for phone, tokens in VARIANTS.items():
        for token in tokens:
            out.setdefault(token, phone)
    return out


REVERSE: dict[str, str] = {}  # populated below, once VARIANTS is defined


class Inventory:
    """The model vocabulary, indexed for the English subset we score against."""

    def __init__(self, vocab: dict[str, int]) -> None:
        self.vocab = vocab
        missing = sorted(
            {t for t in SINGLE.values() if t not in vocab}
            | {t for _, t in MERGES if t not in vocab}
        )
        if missing:
            raise RuntimeError(
                "the recogniser's vocabulary is missing phones the mapping needs: "
                + " ".join(missing)
            )
        # Restricting the runner-up search to English keeps a diagnosis useful.
        # Unrestricted, the second-best phone for a fumbled English vowel is
        # routinely some Mandarin tone-marked token the speaker cannot act on.
        # The variants belong in here too: `ɐ` is what the model actually calls
        # a reduced vowel, and a diagnosis that cannot name it would report the
        # next candidate down as though it were what the speaker said.
        self.english_ids: list[int] = sorted(
            {vocab[t] for t in SINGLE.values()}
            | {vocab[t] for _, t in MERGES}
            | {vocab[t] for tokens in VARIANTS.values() for t in tokens if t in vocab}
        )
        self.id_to_token: dict[int, str] = {i: t for t, i in vocab.items()}

    def phone_for(self, token_id: int) -> str | None:
        """The General American phone a model token stands for, if any."""
        return REVERSE.get(self.id_to_token.get(token_id, ""))


# Tokens that are also a correct production of a phone. A phone is scored
# against the best of its canonical token and these, so saying an accepted
# variant costs nothing — which is the whole point of listing them.
#
# Two different things are collected here, and both matter.
#
# The first is allophony the app already recognises, mirroring ALLOPHONES in
# src/lib/align.ts: tapped t/d, glottalled t, the schwa/wedge reduction, the
# cot-caught merger. The two scorers disagreeing about whether "about" is a
# mistake would be worse than either being wrong alone.
#
# The second is espeak's own habits, and it is the one that bites. espeak marks
# vowel length in the symbol and drops the mark when a vowel is unstressed, so
# `iː` and `i` are separate tokens for the same English vowel; it writes the
# reduced vowel of "about" as `ɐ`, not `ə`; and it writes every syllable-final
# English /l/ as the dark `ɫ`. Scoring against the canonical token alone
# therefore marks down every unstressed vowel and every coda /l/ in the
# language — sounds the speaker produced correctly. Measured on "think about
# this", `ɐ` takes p=0.66 of the schwa's frames while `ə` gets 0.20.
#
# The browser path folds these the other way, in FOLD in src/lib/align.ts. Same
# knowledge, opposite direction: it maps what was heard onto the inventory,
# this maps the inventory onto what might be heard.
#
# This is a pronunciation lattice one phone wide. Connected-speech variants that
# span phones — linking, elision, the palatalised "did you" — want the same
# treatment a level up, where the target sequence is built.
VARIANTS: dict[str, tuple[str, ...]] = {
    # Allophones the app calls correct.
    "t": ("ɾ", "ʔ"),
    "d": ("ɾ",),
    # Reduced vowels. espeak's `ɐ` is the workhorse of unstressed English.
    "ə": ("ɐ", "ʌ", "ɘ", "ɵ"),
    "ʌ": ("ɐ", "ə"),
    # Length marks come and go with stress.
    "i": ("i", "ɪ"),
    "u": ("u", "ʉ"),
    "ɑ": ("ɑ", "ɒ", "ɔː", "ɔ"),
    "ɔ": ("ɔ", "ɑː", "ɑ"),
    "ɪ": ("ᵻ", "ɨ", "i"),
    "ɛ": ("e",),
    "æ": ("a",),
    # NURSE and its unstressed twin.
    "ɝ": ("ɜ", "ɚ"),
    "ɚ": ("ɜː", "ɜ", "ə"),
    # Diphthongs espeak may write with a different first target.
    "eɪ": ("ɛɪ", "e"),
    "oʊ": ("o", "oː", "əʊ"),
    "aɪ": ("ɑɪ",),
    # Dark l: English coda /l/ is velarised, and espeak writes it that way.
    "l": ("ɫ",),
    "ɹ": ("ɻ", "r"),
}

REVERSE.update(_build_reverse())


def variants_for(phone: str, vocab: dict[str, int] | None = None) -> list[str]:
    """
    Model tokens that are an acceptable production of `phone`.

    These are espeak tokens already, not General American phones — `ɐ` and `ɫ`
    have no place in the app's own inventory. Filtered against the vocabulary
    when one is supplied, so a symbol this checkpoint does not carry is simply
    not offered rather than raising at load.
    """
    candidates = VARIANTS.get(phone, ())
    canonical = SINGLE.get(phone)
    return [
        token
        for token in candidates
        if token != canonical and (vocab is None or token in vocab)
    ]


def to_tokens(
    phones: list[str], vocab: dict[str, int] | None = None
) -> tuple[list[str], list[list[int]], list[list[str]]]:
    """
    Expected phones -> the token sequence to force-align against.

    Returns the tokens; for each one, which indices of `phones` it accounts for
    (a merged token owns two, so a single score lands on both slots and the
    front end can still colour them independently); and for each one, the
    alternative tokens that would also be right.

    Phones with no token — anything outside the inventory — are dropped rather
    than guessed at, exactly as the browser path drops them.
    """
    tokens: list[str] = []
    sources: list[list[int]] = []
    alternatives: list[list[str]] = []

    i = 0
    while i < len(phones):
        merged = False
        for width in range(_MERGE_WIDTH, 1, -1):
            window = tuple(phones[i : i + width])
            if len(window) < width:
                continue
            for sequence, token in MERGES:
                if sequence == window:
                    tokens.append(token)
                    sources.append(list(range(i, i + width)))
                    # A merged r-coloured token is already the variant; nothing
                    # else stands in for it.
                    alternatives.append([])
                    i += width
                    merged = True
                    break
            if merged:
                break
        if merged:
            continue

        token = SINGLE.get(phones[i])
        if token is not None:
            tokens.append(token)
            sources.append([i])
            alternatives.append(variants_for(phones[i], vocab))
        i += 1

    return tokens, sources, alternatives
