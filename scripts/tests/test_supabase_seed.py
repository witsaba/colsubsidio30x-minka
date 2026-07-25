"""Behaviour of the workbook -> Supabase derivation.

Every test here is about a decision the derivation makes, not about SQL syntax.
The SQL emitter is covered only where a mistake would corrupt data (quoting).
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import supabase_seed as seed  # noqa: E402


# --------------------------------------------------------------------------
# Name normalisation
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Artículo", "ARTICULO"),
        ("  lechuga   batavia ", "LECHUGA BATAVIA"),
        ("ACEITE\xa0OLIVA", "ACEITE OLIVA"),
        ("Porción", "PORCION"),
        ("ÑAME", "NAME"),
    ],
)
def test_normalize_folds_accents_case_and_whitespace(raw, expected):
    assert seed.normalize_name(raw) == expected


def test_normalize_returns_none_for_blank():
    assert seed.normalize_name("   ") is None
    assert seed.normalize_name(None) is None


# --------------------------------------------------------------------------
# Warehouse codes
# --------------------------------------------------------------------------

def test_warehouse_code_is_an_uppercase_slug():
    assert seed.warehouse_code("cocina principal suministros") == "COCINA_PRINCIPAL_SUMINISTROS"


def test_warehouse_code_drops_accents_and_punctuation():
    assert seed.warehouse_code("caf. Velas suministros") == "CAF_VELAS_SUMINISTROS"
    assert seed.warehouse_code("rest. Nutrias suministros") == "REST_NUTRIAS_SUMINISTROS"


def test_warehouse_codes_are_deduplicated_with_a_suffix():
    """The workbook lists 'cafeteria acuario suministros' twice; both rows survive."""
    codes = seed.assign_unique_codes(
        ["cafeteria acuario suministros", "cafeteria acuario suministros", "panaderia"]
    )
    assert codes[0] == "CAFETERIA_ACUARIO_SUMINISTROS"
    assert codes[1] == "CAFETERIA_ACUARIO_SUMINISTROS_2"
    assert codes[2] == "PANADERIA"
    assert len(set(codes)) == 3


# --------------------------------------------------------------------------
# Units
# --------------------------------------------------------------------------

@pytest.mark.parametrize(
    ("source_label", "expected"),
    [("Unidad", "UND"), ("Kilogram", "KG"), ("Liter", "LT"), ("Portion", "POR")],
)
def test_workbook_units_map_to_codes(source_label, expected):
    assert seed.unit_code(source_label) == expected


def test_missing_unit_falls_back_to_und():
    """8 stock rows carry no unit. They are still countable items, so they default
    to the unit that assumes nothing about mass or volume."""
    assert seed.unit_code(None) == "UND"


def test_unknown_unit_is_rejected_rather_than_guessed():
    with pytest.raises(seed.DerivationError, match="unknown unit"):
        seed.unit_code("Gallon")


# --------------------------------------------------------------------------
# Products
# --------------------------------------------------------------------------

def _row(sheet="ZOOLOGICO", ordinal=1, code=None, name="TOMATE", unit="Unidad", sd=1.0):
    return seed.StockRow(
        sheet_name=sheet, row_ordinal=ordinal, nr_articulo=code,
        articulo=name, unidad=unit, sd=sd,
    )


def test_products_are_deduplicated_across_sheets_by_normalized_name():
    rows = [
        _row(sheet="ZOOLOGICO", name="Lechuga Batavia", code="MP-1"),
        _row(sheet="PANADERIA", name="LECHUGA  BATAVIA", code="MP-1"),
    ]
    products = seed.build_products(rows)
    assert len(products) == 1
    assert products[0].name_normalized == "LECHUGA BATAVIA"


def test_product_keeps_the_first_verbatim_name_it_saw():
    rows = [_row(name="Lechuga Batavia"), _row(sheet="X", name="LECHUGA BATAVIA")]
    assert seed.build_products(rows)[0].name == "Lechuga Batavia"


def test_rows_without_a_name_are_skipped_not_invented():
    rows = [_row(name=None), _row(name="  "), _row(name="TOMATE")]
    assert [p.name_normalized for p in seed.build_products(rows)] == ["TOMATE"]


def test_conflicting_sku_for_one_name_is_a_hard_error():
    """The workbook is clean today. If a future upload is not, the load must stop
    rather than silently pick a code."""
    rows = [_row(name="TOMATE", code="MP-1"), _row(sheet="X", name="TOMATE", code="MP-2")]
    with pytest.raises(seed.DerivationError, match="conflicting sku"):
        seed.build_products(rows)


def test_conflicting_unit_for_one_name_is_a_hard_error():
    rows = [
        _row(name="ACEITE", unit="Liter"),
        _row(sheet="X", name="ACEITE", unit="Kilogram"),
    ]
    with pytest.raises(seed.DerivationError, match="conflicting unit"):
        seed.build_products(rows)


def test_a_name_seen_with_and_without_a_code_keeps_the_code():
    rows = [_row(name="TOMATE", code=None), _row(sheet="X", name="TOMATE", code="MP-9")]
    assert seed.build_products(rows)[0].sku == "MP-9"


# --------------------------------------------------------------------------
# Balances
# --------------------------------------------------------------------------

def test_negative_balances_are_preserved_not_clamped():
    """RF-26(d) treats a negative theoretical balance as a finding. Clamping it
    would erase the very defect the tool is meant to surface."""
    balances = seed.build_balances([_row(sd=-2.5)])
    assert balances[0].theoretical_qty == pytest.approx(-2.5)


def test_missing_balance_becomes_zero_with_a_flag():
    balances = seed.build_balances([_row(sd=None)])
    assert balances[0].theoretical_qty == 0
    assert balances[0].is_imputed is True


def test_balance_is_keyed_by_sheet_and_product():
    rows = [_row(sheet="A", name="TOMATE", sd=3), _row(sheet="B", name="TOMATE", sd=7)]
    balances = seed.build_balances(rows)
    assert {(b.sheet_name, float(b.theoretical_qty)) for b in balances} == {("A", 3.0), ("B", 7.0)}


# --------------------------------------------------------------------------
# Bootstrap ranges (RF-03)
# --------------------------------------------------------------------------

def test_bootstrap_range_brackets_the_snapshot_value():
    lo, hi = seed.bootstrap_range(32)
    assert lo < 32 < hi


def test_bootstrap_range_never_goes_below_zero():
    lo, hi = seed.bootstrap_range(-2)
    assert lo == 0
    assert hi > 0


def test_bootstrap_range_of_zero_is_a_usable_band():
    lo, hi = seed.bootstrap_range(0)
    assert lo == 0
    assert hi > 0


# --------------------------------------------------------------------------
# SQL emission
# --------------------------------------------------------------------------

def test_sql_literal_escapes_single_quotes():
    assert seed.sql_literal("Café d'Or") == "'Café d''Or'"


def test_sql_literal_renders_none_as_null():
    assert seed.sql_literal(None) == "null"


def test_sql_literal_never_quotes_numbers():
    assert seed.sql_literal(3.5) == "3.5"
    assert seed.sql_literal(-2) == "-2"
