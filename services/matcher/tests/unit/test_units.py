"""Unit synonym and display map tests (T4).

REQ-ENG-5 (maps half): two separate maps -- a matching map (spoken Spanish ->
unit code) and a display map (unit code -> Spanish). An unrecognized or absent
spoken unit resolves to `None` so the re-rank is simply skipped; it is never an
error. A NULL `unidad` is never coerced to `UND` or any other value.

Both maps are keyed on `warehouse_products.unit_code` (`KG`/`LT`/`UND`/`POR`),
the vocabulary `Row.unidad` actually carries. The retired workbook labels
(`Kilogram`/`Liter`/`Unidad`/`Portion`) now live only in `units.source_label`
and must never key either map again -- when they did, `unidad_display` was
`None` on every response and the unit re-rank was silently inert.
"""
from __future__ import annotations

import pytest

from matcher.units import UNIT_DISPLAY, UNIT_SYNONYMS, resolve_unit

CANONICAL_UNITS = {"KG", "LT", "UND", "POR"}


# --- matching map: spoken Spanish -> canonical --------------------------------


@pytest.mark.parametrize(
    ("spoken", "canonical"),
    [
        ("litros", "LT"),
        ("litro", "LT"),
        ("lt", "LT"),
        ("kilos", "KG"),
        ("kilogramos", "KG"),
        ("kg", "KG"),
        ("unidades", "UND"),
        ("cajas", "UND"),
        ("porciones", "POR"),
        ("raciones", "POR"),
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
    assert resolve_unit("porción") == "POR"
    assert resolve_unit("porcion") == "POR"


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
        "KG": "kg",
        "LT": "litros",
        "UND": "unidades",
        "POR": "porciones",
    }


def test_unit_display_has_no_entry_for_a_null_unit() -> None:
    # A NULL `unidad` must surface as `unidad_display: None`, never coerced to
    # "unidades" (REQ-ENG-5).
    assert UNIT_DISPLAY.get(None) is None
    assert None not in UNIT_DISPLAY


def test_display_and_matching_maps_are_separate_objects_over_the_same_units() -> None:
    assert set(UNIT_DISPLAY) == set(UNIT_SYNONYMS)
    assert UNIT_DISPLAY is not UNIT_SYNONYMS


# --- vocabulary guards --------------------------------------------------------

RETIRED_WORKBOOK_LABELS = {"Kilogram", "Liter", "Unidad", "Portion"}


def test_neither_map_is_keyed_on_a_retired_workbook_label() -> None:
    """Those labels live in `units.source_label`; `unidad` never carries one."""
    assert not (set(UNIT_SYNONYMS) & RETIRED_WORKBOOK_LABELS)
    assert not (set(UNIT_DISPLAY) & RETIRED_WORKBOOK_LABELS)


@pytest.mark.parametrize("label", sorted(RETIRED_WORKBOOK_LABELS))
def test_a_retired_label_has_no_display_copy(label: str) -> None:
    assert UNIT_DISPLAY.get(label) is None


def test_a_dictated_box_still_resolves_to_the_stocked_unit() -> None:
    """Behaviour preserved verbatim across the vocabulary migration.

    Supabase carries a distinct `CAJA` unit code that the workbook never had.
    Whether a dictated box should resolve to it (RF-15) is a domain decision
    for a follow-up change; until then `caja` resolves to `UND`, exactly as it
    did before the Supabase cutover.
    """
    assert resolve_unit("caja") == "UND"
    assert resolve_unit("cajas") == "UND"
    assert "CAJA" not in UNIT_SYNONYMS
