"""Unit maps (REQ-ENG-5).

Both maps are keyed on the catalogue's own unit vocabulary, which is
``warehouse_products.unit_code`` -- the codes ``KG``, ``LT``, ``UND``, ``POR``
and ``CAJA``. This is what ``Row.unidad`` carries and therefore the only
vocabulary ``_unit_rerank`` and the display lookup can ever compare against.

The retired SQLite catalogue stored the *workbook labels* instead
(``Kilogram``/``Liter``/``Unidad``/``Portion``). Supabase keeps those in
``units.source_label``; they are provenance, not identity, and they must never
appear in these maps again. Re-keying here is a pure restoration of the
behaviour the labels used to give: every spoken synonym resolves to the same
physical unit it always did, and every display string is unchanged.

Two deliberately separate maps:

* ``UNIT_SYNONYMS`` / ``resolve_unit`` -- matching side, spoken Spanish to the
  catalogue's unit code. Resolution is best-effort: an absent or unrecognized
  spoken unit yields ``None``, which simply skips the secondary unit re-rank.
  It is never an error, and unit agreement is never a hard gate.
* ``UNIT_DISPLAY`` -- presentation side, unit code to Spanish copy. A NULL
  ``unidad`` has no entry and must surface as ``None``; it is never coerced to
  ``"unidades"``.

Documented deviation from spike 02's display example (``LT`` -> "L", ``POR``
-> "porción", ``UND`` -> "unidad"): full plural Spanish words read naturally in
voice-driven UI copy, so only "kg" is kept as the conventional abbreviation.

OUT OF SCOPE -- deliberate, needs a domain decision. Supabase carries a
distinct ``CAJA`` unit code that the workbook never had, because operators
dictate boxes and RF-15 has to resolve a dictated box to a stocked unit.
``caja``/``cajas`` therefore still resolve to ``UND`` here, exactly as they did
before the Supabase cutover. Whether they should instead resolve to ``CAJA``,
and how RF-15 converts a box into a stocked unit, is a follow-up change; do not
decide it by quietly editing this map.
"""
from __future__ import annotations

from matcher.normalize import strip_accents

UNIT_SYNONYMS: dict[str, set[str]] = {
    "LT": {"litro", "litros", "lt", "lts", "l"},
    "KG": {"kilo", "kilos", "kilogramo", "kilogramos", "kg", "kgs"},
    "UND": {
        "unidad",
        "unidades",
        "und",
        "un",
        "paquete",
        "paquetes",
        "sobre",
        "sobres",
        # See the CAJA note in the module docstring: still UND, on purpose.
        "caja",
        "cajas",
    },
    "POR": {"porcion", "porciones", "racion", "raciones"},
}

_CANONICAL_FOR_SPOKEN: dict[str, str] = {
    spoken: canonical
    for canonical, synonyms in UNIT_SYNONYMS.items()
    for spoken in synonyms
}

UNIT_DISPLAY: dict[str, str] = {
    "KG": "kg",
    "LT": "litros",
    "UND": "unidades",
    "POR": "porciones",
}


def resolve_unit(spoken: str | None) -> str | None:
    """Map a spoken Spanish unit to its catalogue unit code, or ``None``."""
    if spoken is None:
        return None
    key = strip_accents(spoken).strip().lower()
    return _CANONICAL_FOR_SPOKEN.get(key)
