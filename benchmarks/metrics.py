"""Benchmark metrics (REQ-BMK-3..11).

Two numbers carry the accuracy claim - digit accuracy and the garbage-clip
hallucination rate - and WER is a secondary sanity signal. Everything here is a
pure function so the evidence behind the pitch is reproducible and testable.

The metric contract is the ``stt-es-v1`` normaliser (one number per line):

* digit accuracy = exact-match per labelled quantity token against the
  multiset of numeric tokens in the vendor transcript;
* hallucination rate = share of ``is_garbage=True`` clips whose normalised
  transcript matches QUANTITY-NEAR-ITEM;
* WER = token-level Levenshtein, secondary only.

Scoring must NEVER branch on ``ACERTIVIDAD`` or ``DIFICULTAD``; ``condition``
defaults to ``"unknown"`` and that bucket lives in the per-condition split
without any inference from difficulty.
"""

import re
import unicodedata
from collections import Counter

CONDITIONS = ("clean", "noisy", "spontaneous")

#: Documented normalizer identifier for v2 results.json. Bumping this is a
#: deliberate, versioned change — the runner records it in
#: ``results["normalizer_version"]`` and the report renders it for the
#: reproducibility contract (REQ-BMK-11).
NORMALIZER_VERSION = "stt-es-v1"

#: Spanish number words that count as a quantity token (design Decision 11).
QUANTITY_WORDS = {
    "un", "uno", "una",
    "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
    "once", "doce", "trece", "catorce", "quince",
    "dieciseis", "diecisiete", "dieciocho", "diecinueve",
    "veinte", "veintiuno", "veintidos", "veintitres", "veinticuatro",
    "veinticinco", "veintiseis", "veintisiete", "veintiocho", "veintinueve",
    "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa",
    "cien", "ciento", "cientos", "quinientos", "mil",
    "docena", "docenas", "medio", "media",
}

#: Hesitation and discourse markers: a bare filler transcript is a correct
#: low-content transcription, not an invented inventory line.
FILLER_STOPLIST = {
    "eh", "este", "pues", "bueno", "sea", "ya", "entonces", "mmm", "ah", "listo",
}

#: How far after a quantity an item token may appear and still read as one line.
ITEM_WINDOW = 2

#: Shorter alphabetic tokens are articles and prepositions, not inventory items.
MIN_ITEM_LENGTH = 3

_PUNCTUATION = re.compile(r"[^\w\s]", flags=re.UNICODE)
_DIGITS = re.compile(r"^\d+$")


def unaccent(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def normalise_tokens(text: str) -> list[str]:
    """Lowercase, unaccent, strip punctuation, split on whitespace."""
    if not text:
        return []
    cleaned = _PUNCTUATION.sub(" ", unaccent(text.lower()))
    return cleaned.split()


def is_quantity_token(token: str) -> bool:
    return bool(_DIGITS.match(token)) or token in QUANTITY_WORDS


def is_item_token(token: str) -> bool:
    return (
        token.isalpha()
        and len(token) >= MIN_ITEM_LENGTH
        and token not in FILLER_STOPLIST
        and token not in QUANTITY_WORDS
    )


def is_hallucinated(transcript: str) -> bool:
    """QUANTITY-NEAR-ITEM: did a garbage clip produce an inventory line?

    True iff a quantity token is followed, within `ITEM_WINDOW` tokens, by an
    item-shaped word. Accepted false negative: an item invented without any
    quantity is not counted (recorded in the report caveat).
    """
    tokens = normalise_tokens(transcript)
    for index, token in enumerate(tokens):
        if not is_quantity_token(token):
            continue
        window = tokens[index + 1 : index + 1 + ITEM_WINDOW + 1]
        if any(is_item_token(candidate) for candidate in window):
            return True
    return False


def quantity_tokens(text: str) -> list[str]:
    """Numeric tokens found in a transcript, in order."""
    return [token for token in normalise_tokens(text) if _DIGITS.match(token)]


def score_digit_tokens(expected: list[str], hypothesis: str) -> tuple[int, int]:
    """Exact match per labelled quantity token (REQ-BMK-3).

    Matching is multiset-based, so "2 cajas y 2 bultos" needs both 2s. A
    near-miss (90 vs 900) simply fails to match: no partial credit.
    """
    expected_tokens = [str(token) for token in expected]
    available = Counter(quantity_tokens(hypothesis))
    correct = 0
    for token in expected_tokens:
        if available[token] > 0:
            available[token] -= 1
            correct += 1
    return correct, len(expected_tokens)


def _levenshtein(reference: list[str], hypothesis: list[str]) -> int:
    previous = list(range(len(hypothesis) + 1))
    for i, ref_token in enumerate(reference, start=1):
        current = [i]
        for j, hyp_token in enumerate(hypothesis, start=1):
            current.append(
                min(
                    previous[j] + 1,  # deletion
                    current[j - 1] + 1,  # insertion
                    previous[j - 1] + (ref_token != hyp_token),  # substitution
                )
            )
        previous = current
    return previous[-1]


def word_error_rate(reference: str, hypothesis: str) -> float | None:
    """Token-level Levenshtein WER. None when the reference is empty."""
    reference_tokens = normalise_tokens(reference)
    if not reference_tokens:
        return None
    return _levenshtein(reference_tokens, normalise_tokens(hypothesis)) / len(
        reference_tokens
    )


def _empty_bucket() -> dict:
    return {
        "clips": 0,
        "failed_clips": 0,
        "digit_correct": 0,
        "digit_total": 0,
        "garbage_clips": 0,
        "hallucinated": 0,
        "wer_sum": 0.0,
        "wer_clips": 0,
    }


def _accumulate(bucket: dict, clip: dict) -> None:
    bucket["clips"] += 1

    response = clip.get("response") or {}
    transcribed = response.get("raw_transcript")
    if clip.get("status") != 200 or transcribed is None:
        bucket["failed_clips"] += 1
        return

    if clip.get("is_garbage"):
        bucket["garbage_clips"] += 1
        if is_hallucinated(transcribed):
            bucket["hallucinated"] += 1
        return

    correct, total = score_digit_tokens(clip.get("items") or [], transcribed)
    bucket["digit_correct"] += correct
    bucket["digit_total"] += total

    wer = word_error_rate(clip.get("transcript") or "", transcribed)
    if wer is not None:
        bucket["wer_sum"] += wer
        bucket["wer_clips"] += 1


def _finalise(bucket: dict) -> dict:
    finalised = {key: value for key, value in bucket.items() if not key.startswith("wer_")}
    finalised["digit_accuracy"] = (
        bucket["digit_correct"] / bucket["digit_total"] if bucket["digit_total"] else None
    )
    finalised["hallucination_rate"] = (
        bucket["hallucinated"] / bucket["garbage_clips"]
        if bucket["garbage_clips"]
        else None
    )
    finalised["wer"] = (
        bucket["wer_sum"] / bucket["wer_clips"] if bucket["wer_clips"] else None
    )
    return finalised


def summarise(clips: list[dict]) -> dict:
    """Aggregate results.json clips overall and split by condition (REQ-BMK-6)."""
    overall = _empty_bucket()
    by_condition: dict[str, dict] = {}

    for clip in clips:
        condition = clip.get("condition") or "unknown"
        bucket = by_condition.setdefault(condition, _empty_bucket())
        _accumulate(bucket, clip)
        _accumulate(overall, clip)

    return {
        "overall": _finalise(overall),
        "by_condition": {
            condition: _finalise(bucket) for condition, bucket in by_condition.items()
        },
    }


def summarise_results(results: dict) -> dict:
    """Aggregate a v2 ``results.json`` payload.

    Convenience wrapper over :func:`summarise` that pulls ``clips`` out of the
    v2 envelope. The two callers (``report.py`` and tests) prefer this shape so
    the report pipeline can pass the full stored payload without unpacking it
    first. Scoring never branches on ``ACERTIVIDAD``; ``condition`` defaults to
    ``"unknown"`` and ``DIFICULTAD`` is recorded only inside the per-clip rows.
    """

    if not isinstance(results, dict):
        raise TypeError("summarise_results expects a v2 results.json envelope")
    clips = results.get("clips", [])
    return summarise(clips)
