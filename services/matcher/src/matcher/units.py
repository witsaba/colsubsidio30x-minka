"""Unit maps (REQ-ENG-5).

Two deliberately separate maps:

* ``UNIT_SYNONYMS`` / ``resolve_unit`` -- matching side, spoken Spanish to the
  catalogue's canonical unit. Promoted from the `extra_experiments.py`
  prototype. Resolution is best-effort: an absent or unrecognized spoken unit
  yields ``None``, which simply skips the secondary unit re-rank. It is never
  an error, and unit agreement is never a hard gate.
* ``UNIT_DISPLAY`` -- presentation side, canonical unit to Spanish copy. A NULL
  ``unidad`` has no entry and must surface as ``None``; it is never coerced to
  ``"Unidad"``/``"unidades"``.

Documented deviation from spike 02's display example (`Liter` -> "L",
`Portion` -> "porción", `Unidad` -> "unidad"): full plural Spanish words read
naturally in voice-driven UI copy, so only "kg" is kept as the conventional
abbreviation.
"""
from __future__ import annotations

from matcher.normalize import strip_accents

UNIT_SYNONYMS: dict[str, set[str]] = {
    "Liter": {"litro", "litros", "lt", "lts", "l"},
    "Kilogram": {"kilo", "kilos", "kilogramo", "kilogramos", "kg", "kgs"},
    "Unidad": {
        "unidad",
        "unidades",
        "und",
        "un",
        "paquete",
        "paquetes",
        "sobre",
        "sobres",
        "caja",
        "cajas",
    },
    "Portion": {"porcion", "porciones", "racion", "raciones"},
}

_CANONICAL_FOR_SPOKEN: dict[str, str] = {
    spoken: canonical
    for canonical, synonyms in UNIT_SYNONYMS.items()
    for spoken in synonyms
}

UNIT_DISPLAY: dict[str, str] = {
    "Kilogram": "kg",
    "Liter": "litros",
    "Unidad": "unidades",
    "Portion": "porciones",
}


def resolve_unit(spoken: str | None) -> str | None:
    """Map a spoken Spanish unit to its canonical form, or ``None``."""
    if spoken is None:
        return None
    key = strip_accents(spoken).strip().lower()
    return _CANONICAL_FOR_SPOKEN.get(key)
