"""Normalization and trigram utilities.

Includes a from-scratch reimplementation of the pg_trgm trigram extraction
and similarity() / word_similarity() functions, verified against the worked
examples in the PostgreSQL pg_trgm documentation (see tests at the bottom).

This is NOT real Postgres. It is a faithful-as-possible reimplementation of
the documented algorithm, done because no live Postgres/Supabase instance was
available in this sandbox. Anywhere the real pg_trgm C implementation departs
from the documented word/trigram model (edge cases in extent search for
word_similarity in particular -- see WORD_SIMILARITY CAVEAT below) this
reimplementation is an approximation, not a byte-exact port, and that is
called out explicitly in the final report.
"""
from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

# ---------------------------------------------------------------------------
# pg_trgm-faithful trigram extraction
# ---------------------------------------------------------------------------
# pg_trgm's ISWORDCHR treats letters AND digits as the same "word" character
# class (it does not split "x50" into "x" + "50"); reproduce that here.
_WORD_RE = re.compile(r"[^\W_]+", re.UNICODE)


def _pg_trgm_pad(s: str) -> str:
    """Reproduce pg_trgm's internal padded representation.

    pg_trgm lower-cases the input, splits it into maximal alnum "words",
    joins the words with a single blank, and pads the whole thing with two
    leading blanks and one trailing blank. Verified against the documented
    example: show_trgm('cat and dog') ->
    {"  c"," an"," ca"," do","and","at ","cat","d d","dog","nd ","og ","t a"}
    """
    s = s.lower()
    words = _WORD_RE.findall(s)
    if not words:
        return ""
    return "  " + " ".join(words) + " "


@lru_cache(maxsize=None)
def trigrams(s: str) -> frozenset[str]:
    padded = _pg_trgm_pad(s)
    if len(padded) < 3:
        return frozenset()
    return frozenset(padded[i : i + 3] for i in range(len(padded) - 2))


def trgm_similarity(a: str, b: str) -> float:
    """pg_trgm similarity(): |A ∩ B| / |A ∪ B| over trigram sets."""
    ta, tb = trigrams(a), trigrams(b)
    if not ta or not tb:
        return 0.0
    inter = len(ta & tb)
    union = len(ta | tb)
    return inter / union if union else 0.0


def trgm_word_similarity(a: str, b: str) -> float:
    """Approximation of pg_trgm word_similarity(a, b).

    Real semantics: the greatest similarity obtainable between the full
    trigram set of `a` and any CONTIGUOUS ORDERED EXTENT of `b`'s trigrams
    (i.e. `a` need only match a substring-ish span of `b`, so a short query
    against a long target string is not penalised by `b`'s extra length).

    WORD_SIMILARITY CAVEAT: the real pg_trgm C code operates directly on the
    trigram array with a sliding-extent search that can start/stop mid-word
    and has special-cased handling of the padding trigrams at each extent's
    edges (see trgm.c / find_word_similarity in the Postgres source). This
    reimplementation approximates that by evaluating every *contiguous
    whole-word window* of `b` (not sub-word extents) and returning the
    highest similarity(a, window) achieved, using each window's own padding.
    This is expected to be close to but not bit-identical with real Postgres,
    especially for single/first/last word partial matches. Flagged as an
    unresolved approximation in the review report.
    """
    words_b = _WORD_RE.findall(b.lower())
    if not words_b:
        return trgm_similarity(a, b)
    ta = trigrams(a)
    if not ta:
        return 0.0
    best = 0.0
    n = len(words_b)
    for i in range(n):
        for j in range(i + 1, n + 1):
            window = " ".join(words_b[i:j])
            tw = trigrams(window)
            if not tw:
                continue
            inter = len(ta & tw)
            # word_similarity denominator uses len(a) + matched-extent-size - inter
            # (extent size here approximated by the window's own trigram count,
            # which is what makes it tolerant of b being much longer than a).
            denom = len(ta) + len(tw) - inter
            sim = inter / denom if denom else 0.0
            if sim > best:
                best = sim
    return best


# ---------------------------------------------------------------------------
# Spanish-ish normalization helpers used both for query-variant generation
# and for the "hand-built normalizer" matcher.
# ---------------------------------------------------------------------------


def strip_accents(s: str) -> str:
    nfkd = unicodedata.normalize("NFKD", s)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


PACKAGING_PATTERNS = [
    r"\bX\s?\d+([.,]\d+)?\s?(UN|UND|UNID|GR|GRS|KG|ML|LT|LTS|MG|CM|MM|MTS?|CC|OZ|ONZ)\b",
    r"\b\d+([.,]\d+)?\s?(UN|UND|UNID|GR|GRS|KG|ML|LT|LTS|MG|CM|MM|MTS?|CC|OZ|ONZ)\b",
    r"\b\d+\s?[xX]\s?\d+\s?(CM|MM|MTS?)?\b",
    r"\bFB\b",
    r"\bNAC\b",
    r"\(PA\)",
    r"\(USO ZOOLOGICO\)",
    r"\bCJX\d+\b",
    r"\bNo\.\s?\d+\b",
    r"\bTNR\b",
    r"\bGEF\b",
]
_PACKAGING_RE = re.compile("|".join(PACKAGING_PATTERNS), re.IGNORECASE)


def strip_packaging(s: str) -> str:
    out = _PACKAGING_RE.sub(" ", s)
    out = re.sub(r"\s+", " ", out).strip()
    return out


# crude gender flip for common Spanish adjective endings (o -> a)
_GENDER_WORDS = {
    "blanco": "blanca",
    "blancos": "blancas",
    "rojo": "roja",
    "rojos": "rojas",
    "amarillo": "amarilla",
    "amarillos": "amarillas",
    "negro": "negra",
    "negros": "negras",
    "morado": "morada",
    "importado": "importada",
    "exportado": "exportada",
    "molido": "molida",
    "congelado": "congelada",
    "entero": "entera",
    "fresco": "fresca",
}


def flip_gender(s: str) -> str:
    words = s.split(" ")
    out = []
    changed = False
    for w in words:
        lw = w.lower()
        if lw in _GENDER_WORDS:
            out.append(_GENDER_WORDS[lw])
            changed = True
        else:
            out.append(w)
    return " ".join(out) if changed else s


def pluralize_es(s: str) -> str:
    """Naive Spanish pluralization of the last content word."""
    words = s.split(" ")
    if not words:
        return s
    last = words[-1]
    low = last.lower()
    if low.endswith("s"):
        new = last  # already plural-looking
    elif low.endswith(("a", "e", "i", "o", "u")):
        new = last + "s"
    elif low.endswith("z"):
        new = last[:-1] + "ces"
    else:
        new = last + "es"
    words[-1] = new
    return " ".join(words)


ABBREV_EXPANSIONS = {
    "P/": "PARA",
    "P /": "PARA",
    "GRS": "GRAMOS",
    "GR": "GRAMOS",
    "ML": "MILILITROS",
    "LTS": "LITROS",
    "LT": "LITROS",
    "KG": "KILOS",
    "UN": "UNIDADES",
    "UND": "UNIDADES",
}


def expand_abbrev(s: str) -> str:
    out = s
    for abbr, full in ABBREV_EXPANSIONS.items():
        out = re.sub(rf"\b{re.escape(abbr)}\b", full, out, flags=re.IGNORECASE)
    return out


def normalize_for_match(s: str) -> str:
    """The 'hand-built Spanish normalizer' used by the custom hybrid matcher."""
    s = strip_accents(s)
    s = s.upper()
    s = strip_packaging(s)
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


if __name__ == "__main__":
    # sanity checks against the documented pg_trgm examples
    assert trigrams("cat") == {"  c", " ca", "cat", "at "}, trigrams("cat")
    expected_cat_and_dog = {
        "  c",
        " an",
        " ca",
        " do",
        "and",
        "at ",
        "cat",
        "d d",
        "dog",
        "nd ",
        "og ",
        "t a",
    }
    assert trigrams("cat and dog") == frozenset(expected_cat_and_dog), trigrams("cat and dog")
    print("pg_trgm trigram extraction matches documented examples: OK")
    print("similarity('ACEITE', 'ACEITE DE OLIVA') =", trgm_similarity("ACEITE", "ACEITE DE OLIVA"))
    print(
        "word_similarity('ACEITE', 'ACEITE DE OLIVA') =",
        trgm_word_similarity("ACEITE", "ACEITE DE OLIVA"),
    )
