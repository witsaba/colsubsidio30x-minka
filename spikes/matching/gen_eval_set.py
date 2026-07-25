"""Generate a labelled evaluation set of colloquial-Spanish STT-style queries
against the real Minka catalogue.

Writes spikes/matching/eval_set.json
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from catalogue import STOCK_TABLES, load_catalogue
from normalize import expand_abbrev, flip_gender, pluralize_es, strip_accents, strip_packaging

random.seed(42)

OUT_PATH = Path(__file__).with_name("eval_set.json")

GARBAGE_UNRELATED = [
    "bicicleta de montaña",
    "paraguas azul",
    "telescopio",
    "saxofon tenor",
    "helicoptero teledirigido",
    "diccionario de ingles",
    "raqueta de tenis",
    "impresora laser",
    "guitarra electrica",
    "reloj despertador",
    "pintura al oleo",
    "sombrero de paja",
    "maleta de viaje",
    "cortadora de cesped",
    "tazon para perro",
    "libro de recetas",
    "silla de oficina",
    "cargador de celular",
    "lampara de escritorio",
    "cuaderno cuadriculado",
]

GARBAGE_EMPTY = ["", " ", "  ", ".", "-", "x", "a", "??", "..."]


def make_typo(word: str, rng: random.Random) -> str:
    if len(word) < 3:
        return word
    alphabet = "abcdefghijklmnopqrstuvwxyz"
    idx = rng.randrange(1, len(word) - 1)
    c = rng.choice(alphabet)
    return word[:idx] + c + word[idx + 1 :]


def reorder_tokens(s: str, rng: random.Random) -> str:
    words = s.split(" ")
    if len(words) < 3:
        return s
    # swap first two content words (skip pure-numeric tokens)
    idxs = [i for i, w in enumerate(words) if not any(ch.isdigit() for ch in w)]
    if len(idxs) >= 2:
        i, j = idxs[0], idxs[1]
        words[i], words[j] = words[j], words[i]
    return " ".join(words)


def build_variants(articulo: str, rng: random.Random) -> list[tuple[str, str]]:
    """Return list of (variant_text, transform_description)."""
    variants: list[tuple[str, str]] = []

    stripped = strip_packaging(articulo)
    if stripped and stripped != articulo:
        variants.append((stripped.lower(), "drop_packaging"))

    no_accent = strip_accents(articulo).lower()
    variants.append((no_accent, "strip_accents+lower"))

    gendered = flip_gender(strip_packaging(articulo))
    if gendered.lower() != strip_packaging(articulo).lower():
        variants.append((strip_accents(gendered).lower(), "gender_flip"))

    plural = pluralize_es(strip_packaging(articulo))
    variants.append((strip_accents(plural).lower(), "pluralize"))

    expanded = expand_abbrev(articulo)
    if expanded != articulo:
        variants.append((strip_accents(expanded).lower(), "expand_abbrev"))

    reordered = reorder_tokens(strip_accents(strip_packaging(articulo)).lower(), rng)
    if reordered != strip_accents(strip_packaging(articulo)).lower():
        variants.append((reordered, "reorder_tokens"))

    # typo injection on a random word of the (accent-stripped, packaging-stripped) base
    base = strip_accents(strip_packaging(articulo)).lower()
    words = base.split(" ")
    if words:
        w_idx = rng.randrange(len(words))
        words2 = list(words)
        words2[w_idx] = make_typo(words2[w_idx], rng)
        variants.append((" ".join(words2), "typo_inject"))

    # combo: drop packaging + strip accents + gender flip + typo
    combo = strip_accents(flip_gender(strip_packaging(articulo))).lower()
    words = combo.split(" ")
    if len(words) >= 2:
        w_idx = rng.randrange(len(words))
        words2 = list(words)
        words2[w_idx] = make_typo(words2[w_idx], rng)
        combo2 = reorder_tokens(" ".join(words2), rng)
        variants.append((combo2, "combo:drop_packaging+accents+gender+typo+reorder"))

    # dedup, drop empties / no-ops equal to raw lowercase articulo with nothing changed
    seen = set()
    out = []
    for text, tag in variants:
        text = text.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append((text, tag))
    return out


AMBIGUOUS_QUERIES = [
    # (query, table, expected_articulo_substrings_or_prefix)
    ("aceite", "stock_almacen_ayb", ["ACEITE", "ACEITE DE AJONJOLI", "ACEITE DE OLIVA", "ACEITE DE OLIVA 10ML /BOLSA SOBRE X50 UN"]),
    ("aceite", "stock_restaurante_fuentes_ayb", ["ACEITE", "ACEITE DE AJONJOLI", "ACEITE DE OLIVA", "ACEITE DE OLIVA 10ML /BOLSA SOBRE X50 UN"]),
    ("tabla para picar", "stock_almacen_suministros", [
        "TABLA ACRILICA P/PICAR AMARILLA 50X38CM",
        "TABLA ACRILICA P/PICAR AZUL 50X38CM",
        "TABLA ACRILICA P/PICAR BLANCO 50X38CM",
        "TABLA ACRILICA P/PICAR ROJA 50X38CM",
        "TABLA ACRILICA P/PICAR ROJO 50X38CM FB",
        "TABLA ACRILICA PICAR 30X45 AZUL",
        "TABLA ACRILICA PICAR BLANCO 50X38CM FB",
        "TABLA ACRILICA PICAR VERDE  50X38CM FB",
        "TABLA PICAR AMRILLA",
    ]),
    ("tabla acrilica para picar", "stock_restaurante_fuentes_sumin", [
        "TABLA ACRILICA P/PICAR ROJO 50X38CM FB",
        "TABLA ACRILICA PICAR BLANCO 50X38CM FB",
        "TABLA ACRILICA PICAR VERDE  50X38CM FB",
    ]),
    ("achiote", "stock_restaurante_fuentes_ayb", ["ACHIOTE", "ACHIOTE MOLIDO"]),
    ("porcion de cadera", "stock_almacen_ayb", [
        "PORCION CADERA X 180 GR (PA)",
        "PORCION DE CADERA X 100 GRS (PA)",
        "PORCION DE CADERA X 130 GRS (PA)",
    ]),
    ("porcion de cadera", "stock_restaurante_fuentes_ayb", [
        "PORCION DE CADERA X 100 GRS (PA)",
        "PORCION DE CADERA X 130 GRS (PA)",
        "PORCION DE CADERA X100 GRS",
    ]),
    ("cebolla cabezona", "stock_almacen_ayb", ["CEBOLLA CABEZONA BLANCA", "CEBOLLA CABEZONA ROJA"]),
    ("cebolla cabezona", "stock_restaurante_fuentes_ayb", ["CEBOLLA CABEZONA BLANCA", "CEBOLLA CABEZONA ROJA"]),
    ("acido poliglicolico", "zoologico_suministros", [
        "ACIDO POLIGLICOLICO 0-0 (USO ZOOLOGICO)",
        "ACIDO POLIGLICOLICO 2-0 (USO ZOOLOGICO)",
        "ACIDO POLIGLICOLICO 3-0 (USO ZOOLOGICO)",
        "ACIDO POLIGLICOLICO 4-0 (USO ZOOLOGICO)",
    ]),
]


def main() -> None:
    rng = random.Random(42)
    catalogue = load_catalogue()
    cases = []
    cid = 0

    # 1) variant cases (positive, single-answer)
    # Sample a subset of rows per table (rather than all ~1400 rows) so the
    # eval set stays in the "several hundred" range the review asked for,
    # while still covering every table and every transform type.
    ROWS_PER_TABLE = 12
    for table in STOCK_TABLES:
        rows = catalogue[table]
        sampled_rows = rng.sample(rows, min(ROWS_PER_TABLE, len(rows)))
        for row in sampled_rows:
            for text, tag in build_variants(row.articulo, rng):
                cid += 1
                cases.append(
                    {
                        "id": f"var-{cid}",
                        "query": text,
                        "table": table,
                        "type": "variant",
                        "expected": "single",
                        "gold_articulo": row.articulo,
                        "gold_rowid": row.rowid,
                        "gold_unit": row.unidad,
                        "transform": tag,
                    }
                )

    # 2) hand-picked ambiguous clusters
    for query, table, expected_list in AMBIGUOUS_QUERIES:
        cid += 1
        cases.append(
            {
                "id": f"amb-{cid}",
                "query": query,
                "table": table,
                "type": "ambiguous",
                "expected": "set",
                "gold_candidates": expected_list,
                "transform": "hand_picked_ambiguous_cluster",
            }
        )

    # 3) garbage: unrelated Spanish words
    for table in STOCK_TABLES:
        for word in rng.sample(GARBAGE_UNRELATED, 6):
            cid += 1
            cases.append(
                {
                    "id": f"garb-unrel-{cid}",
                    "query": word,
                    "table": table,
                    "type": "garbage_unrelated",
                    "expected": "none",
                    "transform": "unrelated_word",
                }
            )

    # 4) garbage: cross-catalogue leakage (article exists in table B, query against table A)
    for table in STOCK_TABLES:
        other_tables = [t for t in STOCK_TABLES if t != table]
        # articles unique to another table (not present, even fuzzily-by-name, in `table`)
        local_names = {r.articulo.upper() for r in catalogue[table]}
        candidates = []
        for ot in other_tables:
            for r in catalogue[ot]:
                if r.articulo.upper() not in local_names:
                    candidates.append((r, ot))
        sample = rng.sample(candidates, min(8, len(candidates)))
        for row, source_table in sample:
            cid += 1
            cases.append(
                {
                    "id": f"garb-cross-{cid}",
                    "query": strip_accents(row.articulo).lower(),
                    "table": table,
                    "type": "garbage_cross_catalogue",
                    "expected": "none",
                    "source_table": source_table,
                    "source_articulo": row.articulo,
                    "source_unit": row.unidad,
                    "transform": "cross_catalogue_item",
                }
            )

    # 5) garbage: empty / near-empty
    for table in STOCK_TABLES:
        for text in GARBAGE_EMPTY:
            cid += 1
            cases.append(
                {
                    "id": f"garb-empty-{cid}",
                    "query": text,
                    "table": table,
                    "type": "garbage_empty",
                    "expected": "none",
                    "transform": "empty_or_near_empty",
                }
            )

    OUT_PATH.write_text(json.dumps(cases, ensure_ascii=False, indent=2), encoding="utf-8")

    by_type: dict[str, int] = {}
    for c in cases:
        by_type[c["type"]] = by_type.get(c["type"], 0) + 1
    print(f"wrote {len(cases)} cases to {OUT_PATH}")
    for t, n in sorted(by_type.items()):
        print(f"  {t}: {n}")


if __name__ == "__main__":
    main()
