"""Test the verdict's central load-bearing claim: that a single ambiguity
margin threshold (top1 - top2) is portable across catalogues of very
different sizes for pg_trgm-style bounded similarity, but NOT for raw
unbounded bm25 -- and whether normalizing bm25 (min-max over the returned
candidate list, or a score RATIO instead of a raw gap) fixes that.

Primary method (robust to small per-table sample sizes, ~50-90 cases/table):
for each (catalogue table 55..344 rows, scorer), restrict to "variant" query
cases the matcher got right at top1 (clean, single-answer queries -- these
should all score as comfortably unambiguous). Compute:
  - median top1-top2 margin for that table/scorer
  - Pearson correlation between catalogue size and median margin ACROSS the
    8 tables (does the typical margin scale shift with corpus size?)
  - coefficient of variation (std/mean) of the median margin across the 8
    tables (how much does the "typical" scale drift in absolute terms?)

A secondary, more failure-prone method (kept for illustration, NOT the
headline number) computes theta* = smallest margin threshold that would
false-flag at most 5% of clean matches as ambiguous, per table. This is
included but flagged as noisy: with ~50-90 cases per table, the 5th
percentile is often a single near-tied pair, so theta* frequently floors at
0 regardless of scorer -- that is a sample-size artifact, not a portability
signal, and the report says so explicitly.
"""
from __future__ import annotations

import json
import statistics as stats
from pathlib import Path

from catalogue import STOCK_TABLES, load_catalogue
from matchers import build_all_matchers

EVAL_PATH = Path(__file__).with_name("eval_set.json")

FALSE_FLAG_BUDGET = 0.05


def pearson(xs: list[float], ys: list[float]) -> float | None:
    n = len(xs)
    if n < 3:
        return None
    mx, my = stats.mean(xs), stats.mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    denx = sum((x - mx) ** 2 for x in xs) ** 0.5
    deny = sum((y - my) ** 2 for y in ys) ** 0.5
    if denx == 0 or deny == 0:
        return None
    return num / (denx * deny)


def cv(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    m = stats.mean(values)
    if m == 0:
        return None
    return stats.pstdev(values) / m


def minmax_norm_margin(scores: list[float]) -> float | None:
    if len(scores) < 2:
        return None
    lo, hi = min(scores), max(scores)
    if hi == lo:
        return 0.0
    norm = [(s - lo) / (hi - lo) for s in scores]
    return norm[0] - norm[1]


def find_theta_star(margins: list[float], budget: float = FALSE_FLAG_BUDGET) -> float:
    if not margins:
        return float("nan")
    s = sorted(margins)
    n = len(s)
    idx = min(int(budget * n), n - 1)
    return s[idx]


def main() -> None:
    cases = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    catalogue = load_catalogue()
    matchers = build_all_matchers(catalogue)

    variant_by_table: dict[str, list[dict]] = {t: [] for t in STOCK_TABLES}
    for c in cases:
        if c["type"] == "variant":
            variant_by_table[c["table"]].append(c)

    scorer_names = [
        "fts5_unicode61",
        "fts5_trigram",
        "pg_trgm_similarity",
        "pg_trgm_word_similarity",
        "rapidfuzz_WRatio",
        "rapidfuzz_token_set_ratio",
    ]

    sizes = [len(catalogue[t]) for t in STOCK_TABLES]

    primary: dict[str, dict] = {}
    for sname in scorer_names:
        matcher = matchers[sname]
        median_margins = []
        median_top1 = []
        per_table = {}
        for table in STOCK_TABLES:
            margins, top1s = [], []
            for c in variant_by_table[table]:
                results = matcher.rank(table, c["query"], top_k=2)
                if len(results) < 2:
                    continue
                r1, s1 = results[0]
                r2, s2 = results[1]
                if r1.articulo != c["gold_articulo"]:
                    continue  # only clean, correctly-resolved queries
                margins.append(s1 - s2)
                top1s.append(s1)
            med_m = stats.median(margins) if margins else None
            med_s = stats.median(top1s) if top1s else None
            per_table[table] = {
                "n_rows": len(catalogue[table]),
                "n_clean_cases": len(margins),
                "median_margin": med_m,
                "median_top1_score": med_s,
            }
            if med_m is not None:
                median_margins.append(med_m)
            if med_s is not None:
                median_top1.append(med_s)
        primary[sname] = {
            "per_table": per_table,
            "corr_size_vs_median_margin": pearson(sizes, [per_table[t]["median_margin"] for t in STOCK_TABLES]),
            "corr_size_vs_median_top1": pearson(sizes, [per_table[t]["median_top1_score"] for t in STOCK_TABLES]),
            "cv_median_margin_across_tables": cv(median_margins),
            "cv_median_top1_across_tables": cv(median_top1),
        }

    # normalized bm25 variants: does min-max normalization over the returned
    # candidate list rescue portability?
    normalized: dict[str, dict] = {}
    for base_name in ["fts5_unicode61", "fts5_trigram"]:
        matcher = matchers[base_name]
        per_table = {}
        median_margins = []
        for table in STOCK_TABLES:
            margins = []
            for c in variant_by_table[table]:
                results = matcher.rank(table, c["query"], top_k=5)
                if len(results) < 2 or results[0][0].articulo != c["gold_articulo"]:
                    continue
                mm = minmax_norm_margin([s for _, s in results])
                if mm is not None:
                    margins.append(mm)
            med_m = stats.median(margins) if margins else None
            per_table[table] = {"n_rows": len(catalogue[table]), "median_minmax_margin": med_m}
            if med_m is not None:
                median_margins.append(med_m)
        normalized[f"{base_name}_minmax"] = {
            "per_table": per_table,
            "corr_size_vs_median_margin": pearson(
                sizes, [per_table[t]["median_minmax_margin"] for t in STOCK_TABLES]
            ),
            "cv_median_margin_across_tables": cv(median_margins),
        }

    # secondary, noisier theta*-at-5%-budget illustration
    theta_report: dict[str, dict] = {}
    for sname in scorer_names:
        matcher = matchers[sname]
        per_table = {}
        for table in STOCK_TABLES:
            margins = []
            for c in variant_by_table[table]:
                results = matcher.rank(table, c["query"], top_k=2)
                if len(results) < 2:
                    continue
                margins.append(results[0][1] - results[1][1])
            per_table[table] = {"n_rows": len(catalogue[table]), "theta_star": find_theta_star(margins)}
        theta_report[sname] = per_table

    print("\n=== PRIMARY: median margin scale vs catalogue size (55..344 rows) ===")
    print(f"{'scorer':28s} {'corr(size,margin)':>18s} {'CV(median margin)':>18s} {'corr(size,top1)':>16s} {'CV(median top1)':>16s}")
    for sname in scorer_names:
        p = primary[sname]
        def fmt(v):
            return f"{v:.3f}" if v is not None else "n/a"
        print(
            f"{sname:28s} {fmt(p['corr_size_vs_median_margin']):>18s} {fmt(p['cv_median_margin_across_tables']):>18s} "
            f"{fmt(p['corr_size_vs_median_top1']):>16s} {fmt(p['cv_median_top1_across_tables']):>16s}"
        )
        for t in STOCK_TABLES:
            pt = p["per_table"][t]
            print(f"    {t:32s} n={pt['n_rows']:4d}  median_margin={pt['median_margin']}  median_top1={pt['median_top1_score']}")

    print("\n=== does min-max normalizing bm25's candidate list fix portability? ===")
    for name, r in normalized.items():
        print(f"{name:28s} corr(size,margin)={r['corr_size_vs_median_margin']}  CV={r['cv_median_margin_across_tables']}")
        for t in STOCK_TABLES:
            pt = r["per_table"][t]
            print(f"    {t:32s} n={pt['n_rows']:4d}  median_minmax_margin={pt['median_minmax_margin']}")

    print("\n=== secondary (noisy, small-n) theta*-at-5%-false-flag-budget ===")
    for sname in scorer_names:
        vals = [theta_report[sname][t]["theta_star"] for t in STOCK_TABLES]
        print(f"{sname:28s} theta* range: {min(vals):.4f} .. {max(vals):.4f}")

    out = {"primary": primary, "normalized": normalized, "theta_secondary": theta_report}
    out_path = Path(__file__).with_name("results_threshold.json")
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("\nwrote", out_path)


if __name__ == "__main__":
    main()
