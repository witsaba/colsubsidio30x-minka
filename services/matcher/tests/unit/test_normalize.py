"""Characterization tests for the promoted Spanish normalization pipeline (T2).

REQ-ENG-1: every normalization rule is individually unit-testable and accent
stripping uses stdlib `unicodedata` (never `unidecode`). These tests were
written before `matcher/normalize.py` existed and lock the measured spike
behavior exactly as it is -- they are the safety net for the promotion, so
they assert what the code *does*, not what a summary claims it does.

Test order follows spike 06's build order: accents -> packaging -> gender ->
plural -> abbreviation -> typo tolerance -> composite.
"""
from __future__ import annotations

import inspect

import pytest

from matcher.normalize import (
    expand_abbrev,
    flip_gender,
    normalize_for_match,
    pluralize_es,
    strip_accents,
    strip_packaging,
)


# --- Rule 1: accent stripping -------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("AZÚCAR", "AZUCAR"),
        ("PIÑA", "PINA"),
        ("JAMÓN SERRANO", "JAMON SERRANO"),
        ("crème brûlée", "creme brulee"),
        ("SIN ACENTOS", "SIN ACENTOS"),
    ],
)
def test_strip_accents_removes_combining_marks(raw: str, expected: str) -> None:
    assert strip_accents(raw) == expected


def test_strip_accents_uses_stdlib_unicodedata_not_unidecode() -> None:
    source = inspect.getsource(strip_accents)

    assert "unicodedata" in source
    assert "unidecode" not in source.lower()


# --- Rule 2: packaging / size token stripping ---------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("MANTEL 50X38CM", "MANTEL"),
        ("BOLSA X50 UN", "BOLSA"),
        ("PAN FB", "PAN"),
        ("ACEITE X 300 GR", "ACEITE"),
        ("ARROZ 500 GR", "ARROZ"),
        ("LAPIZ No. 2", "LAPIZ"),
        ("ACHIOTE MOLIDO", "ACHIOTE MOLIDO"),
    ],
)
def test_strip_packaging_removes_size_and_pack_tokens(raw: str, expected: str) -> None:
    assert strip_packaging(raw) == expected


# --- Rule 3: gender folding ---------------------------------------------------


def test_flip_gender_folds_masculine_adjectives_to_the_feminine_form() -> None:
    # Spike direction is masculine -> feminine, and the replacement keeps the
    # map's lower-case spelling. Locked as-is: the trigram scorer is
    # case-insensitive, so the case change is behaviorally inert.
    assert flip_gender("TABLA PICAR BLANCO") == "TABLA PICAR blanca"
    assert flip_gender("ACHIOTE MOLIDO") == "ACHIOTE molida"


def test_flip_gender_returns_the_input_untouched_when_no_word_is_in_the_map() -> None:
    assert flip_gender("TABLA BLANCA") == "TABLA BLANCA"


# --- Rule 4: plural folding ---------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("TABLA", "TABLAs"),
        ("CAFE", "CAFEs"),
        ("ARROZ", "ARROces"),
        ("LAPIZ", "LAPIces"),
        ("TABLAS", "TABLAS"),
    ],
)
def test_pluralize_es_pluralizes_only_the_last_content_word(
    raw: str, expected: str
) -> None:
    assert pluralize_es(raw) == expected


def test_pluralize_es_leaves_leading_words_untouched() -> None:
    assert pluralize_es("TABLA DE PICAR") == "TABLA DE PICARes"


# --- Rule 5: abbreviation expansion -------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("TABLA P/PICAR", "TABLA PARAPICAR"),
        ("ARROZ 300 GR", "ARROZ 300 GRAMOS"),
        ("LECHE ML", "LECHE MILILITROS"),
        ("QUESO KG", "QUESO KILOS"),
    ],
)
def test_expand_abbrev_expands_known_abbreviations(raw: str, expected: str) -> None:
    assert expand_abbrev(raw) == expected


def test_expand_abbrev_does_not_expand_a_spaced_slash_abbreviation() -> None:
    # Known spike limitation, locked deliberately: the `P /` key never fires
    # because the regex word boundary after the slash requires a word char.
    assert expand_abbrev("P / PICAR") == "P / PICAR"


# --- Rule 6: catalogue typo tolerance -----------------------------------------


def test_normalize_preserves_catalogue_typos_for_the_trigram_scorer() -> None:
    # `AMRILLA` is a real catalogue typo. Normalization must not "fix" or drop
    # it -- tolerance is the trigram scorer's job, and a silent rewrite here
    # would hide the typo from that scorer.
    assert normalize_for_match("TABLA PICAR AMRILLA") == "TABLA PICAR AMRILLA"


# --- Composite pipeline -------------------------------------------------------


def test_normalize_for_match_runs_accents_upper_packaging_and_punctuation() -> None:
    assert normalize_for_match("TABLA P/PICAR BLANCA X 300 GR") == "TABLA P PICAR BLANCA"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("aceite de oliva x 300 gr", "ACEITE DE OLIVA"),
        ("Azúcar   morena", "AZUCAR MORENA"),
        ("MANTEL 50X38CM", "MANTEL"),
        ("", ""),
    ],
)
def test_normalize_for_match_is_idempotent_upper_cased_and_whitespace_collapsed(
    raw: str, expected: str
) -> None:
    normalized = normalize_for_match(raw)

    assert normalized == expected
    assert normalize_for_match(normalized) == expected
