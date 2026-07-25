"""Matcher implementations under test.

All matchers expose the same interface:

    matcher.rank(table, query, top_k) -> list[(Row, score)]

scores are matcher-specific and NOT comparable across matchers (bm25 is
unbounded/negative-is-better internally, normalized to positive-higher-better
here; trigram similarity and rapidfuzz are already bounded).
"""
from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass

from catalogue import Row, STOCK_TABLES
from normalize import normalize_for_match, strip_accents, trgm_similarity, trgm_word_similarity
from rapidfuzz import fuzz, process
from rapidfuzz.utils import default_process


def _rf_processor(s: str) -> str:
    return default_process(strip_accents(s))


def _query_tokens(query: str) -> list[str]:
    q = strip_accents(query).lower()
    toks = re.findall(r"[a-z0-9]+", q)
    return [t for t in toks if t]


class FTS5Matcher:
    """SQLite FTS5 + bm25, parametrized by tokenizer spec string."""

    def __init__(self, tokenizer: str, name: str):
        self.tokenizer = tokenizer
        self.name = name
        self.con = sqlite3.connect(":memory:")
        self.rows_by_table: dict[str, list[Row]] = {}

    def build(self, catalogue: dict[str, list[Row]]) -> None:
        cur = self.con.cursor()
        for table, rows in catalogue.items():
            self.rows_by_table[table] = rows
            tname = f"fts_{table}"
            cur.execute(f'DROP TABLE IF EXISTS "{tname}"')
            cur.execute(
                f'CREATE VIRTUAL TABLE "{tname}" USING fts5(articulo, tokenize=\'{self.tokenizer}\')'
            )
            cur.executemany(
                f'INSERT INTO "{tname}"(rowid, articulo) VALUES (?, ?)',
                [(r.rowid, r.articulo) for r in rows],
            )
        self.con.commit()

    def rank(self, table: str, query: str, top_k: int = 10) -> list[tuple[Row, float]]:
        toks = _query_tokens(query)
        if not toks:
            return []
        match_expr = " OR ".join(f'"{t}"' for t in toks)
        tname = f"fts_{table}"
        cur = self.con.cursor()
        try:
            cur.execute(
                f'SELECT rowid, bm25("{tname}") FROM "{tname}" WHERE "{tname}" MATCH ? ORDER BY bm25("{tname}") LIMIT ?',
                (match_expr, top_k),
            )
            results = cur.fetchall()
        except sqlite3.OperationalError:
            return []
        rows_by_id = {r.rowid: r for r in self.rows_by_table[table]}
        out = []
        for rowid, bm25 in results:
            row = rows_by_id.get(rowid)
            if row is None:
                continue
            # bm25() in sqlite returns more-negative-is-better; flip sign so
            # higher is better, matching the other matchers' convention.
            out.append((row, -bm25))
        return out


class TrigramSimilarityMatcher:
    """Faithful reimplementation of pg_trgm similarity()/word_similarity()."""

    def __init__(self, use_word_similarity: bool = False):
        self.use_word_similarity = use_word_similarity
        self.name = "pg_trgm_word_similarity" if use_word_similarity else "pg_trgm_similarity"
        self.rows_by_table: dict[str, list[Row]] = {}

    def build(self, catalogue: dict[str, list[Row]]) -> None:
        self.rows_by_table = catalogue

    def rank(self, table: str, query: str, top_k: int = 10) -> list[tuple[Row, float]]:
        rows = self.rows_by_table[table]
        scored = []
        for r in rows:
            if self.use_word_similarity:
                s = trgm_word_similarity(query, r.articulo)
            else:
                s = trgm_similarity(query, r.articulo)
            scored.append((r, s))
        scored.sort(key=lambda t: t[1], reverse=True)
        return scored[:top_k]


class RapidFuzzMatcher:
    def __init__(self, scorer_name: str = "WRatio"):
        self.scorer_name = scorer_name
        self.scorer = {
            "WRatio": fuzz.WRatio,
            "token_set_ratio": fuzz.token_set_ratio,
        }[scorer_name]
        self.name = f"rapidfuzz_{scorer_name}"
        self.rows_by_table: dict[str, list[Row]] = {}

    def build(self, catalogue: dict[str, list[Row]]) -> None:
        self.rows_by_table = catalogue

    def rank(self, table: str, query: str, top_k: int = 10) -> list[tuple[Row, float]]:
        rows = self.rows_by_table[table]
        choices = [r.articulo for r in rows]
        results = process.extract(
            query, choices, scorer=self.scorer, limit=top_k, processor=_rf_processor
        )
        out = []
        for text, score, idx in results:
            out.append((rows[idx], score / 100.0))
        return out


class HybridNormalizedMatcher:
    """Hand-built normalizer + weighted token-overlap, in-process.

    Not a serious production candidate on its own -- included as the
    "optional simple hybrid" the review brief asked for, mostly to show the
    ceiling a bit of normalization work buys over raw fuzzy matching.
    """

    def __init__(self):
        self.name = "hybrid_normalizer_token_overlap"
        self.rows_by_table: dict[str, list[Row]] = {}
        self.norm_cache: dict[str, list[tuple[Row, set[str]]]] = {}

    def build(self, catalogue: dict[str, list[Row]]) -> None:
        self.rows_by_table = catalogue
        for table, rows in catalogue.items():
            entries = []
            for r in rows:
                norm = normalize_for_match(r.articulo)
                entries.append((r, set(norm.split())))
            self.norm_cache[table] = entries

    def rank(self, table: str, query: str, top_k: int = 10) -> list[tuple[Row, float]]:
        qnorm = normalize_for_match(query)
        qtoks = set(qnorm.split())
        if not qtoks:
            return []
        scored = []
        for row, toks in self.norm_cache[table]:
            if not toks:
                continue
            inter = qtoks & toks
            union = qtoks | toks
            jaccard = len(inter) / len(union) if union else 0.0
            # bonus for token containment (query fully inside doc, or vice versa)
            containment = len(inter) / min(len(qtoks), len(toks))
            score = 0.5 * jaccard + 0.5 * containment
            scored.append((row, score))
        scored.sort(key=lambda t: t[1], reverse=True)
        return scored[:top_k]


def build_all_matchers(catalogue: dict[str, list[Row]]) -> dict[str, object]:
    matchers = {
        "fts5_unicode61": FTS5Matcher("unicode61 remove_diacritics 2", "fts5_unicode61"),
        "fts5_trigram": FTS5Matcher("trigram", "fts5_trigram"),
        "pg_trgm_similarity": TrigramSimilarityMatcher(use_word_similarity=False),
        "pg_trgm_word_similarity": TrigramSimilarityMatcher(use_word_similarity=True),
        "rapidfuzz_WRatio": RapidFuzzMatcher("WRatio"),
        "rapidfuzz_token_set_ratio": RapidFuzzMatcher("token_set_ratio"),
        "hybrid_normalizer": HybridNormalizedMatcher(),
    }
    for m in matchers.values():
        m.build(catalogue)
    return matchers
