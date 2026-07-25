"""Unit synonym and display map tests (T4).

REQ-ENG-5 (maps half): two separate maps -- a matching map (spoken Spanish ->
canonical) and a display map (canonical -> Spanish). An unrecognized or absent
spoken unit resolves to `None` so the re-rank is simply skipped; it is never an
error. A NULL `unidad` is never coerced to `Unidad` or any other value.
"""
from __future__ import annotations

import pytest

from matcher.units import UNIT_DISPLAY, UNIT_SYNONYMS, resolve_unit

CANONICAL_UNITS = {"Kilogram", "Liter", "Unidad", "Portion"}


# --- matching map: spoken Spanish -> canonical --------------------------------


@pytest.mark.parametrize(
    ("spoken", "canonical"),
    [
        ("litros", "Liter"),
        ("litro", "Liter"),
        ("lt", "Liter"),
        ("kilos", "Kilogram"),
        ("kilogramos", "Kilogram"),
        ("kg", "Kilogram"),
        ("unidades", "Unidad"),
        ("cajas", "Unidad"),
        ("porciones", "Portion"),
        ("raciones", "Portion"),
    ],
)
def test_resolve_unit_maps_spoken_spanish_to_the_canonical_unit(
    spoken: str, canonical: str
) -> None:
    assert resolve_unit(spoken) == canonical


@pytest.mark.parametrize("spoken", ["LITROS", "Litros", "  litros  ", "porción"])
def test_resolve_unit_tolerates_case_padding_and_accents(spoken: str) -> None:
    assert resolve_unit(spoken) in CANONICAL_UNITS


def test_resolve_unit_is_accent_insensitive_for_porcion() -> None:
    assert resolve_unit("porción") == "Portion"
    assert resolve_unit("porcion") == "Portion"


def test_resolve_unit_returns_none_when_no_unit_was_spoken() -> None:
    assert resolve_unit(None) is None


@pytest.mark.parametrize("spoken", ["", "   ", "galones", "pizcas", "42"])
def test_resolve_unit_returns_none_for_an_unrecognized_unit_never_an_error(
    spoken: str,
) -> None:
    # Contract: unknown units downgrade to "no re-rank", they do not raise.
    assert resolve_unit(spoken) is None


def test_unit_synonyms_covers_exactly_the_four_canonical_units() -> None:
    assert set(UNIT_SYNONYMS) == CANONICAL_UNITS
    assert all(UNIT_SYNONYMS[unit] for unit in CANONICAL_UNITS)


def test_unit_synonyms_are_disjoint_so_resolution_is_unambiguous() -> None:
    seen: set[str] = set()
    for synonyms in UNIT_SYNONYMS.values():
        assert not (seen & synonyms)
        seen |= synonyms
    assert "litros" in seen


# --- display map: canonical -> Spanish ----------------------------------------


def test_unit_display_maps_the_four_canonical_units_to_spanish_copy() -> None:
    assert UNIT_DISPLAY == {
        "Kilogram": "kg",
        "Liter": "litros",
        "Unidad": "unidades",
        "Portion": "porciones",
    }


def test_unit_display_has_no_entry_for_a_null_unit() -> None:
    # A NULL `unidad` must surface as `unidad_display: None`, never coerced to
    # "unidades" (REQ-ENG-5).
    assert UNIT_DISPLAY.get(None) is None
    assert None not in UNIT_DISPLAY


def test_display_and_matching_maps_are_separate_objects_over_the_same_units() -> None:
    assert set(UNIT_DISPLAY) == set(UNIT_SYNONYMS)
    assert UNIT_DISPLAY is not UNIT_SYNONYMS
