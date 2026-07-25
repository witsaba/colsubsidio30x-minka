"""Run all matchers against eval_set.json and report accuracy/latency metrics."""
from __future__ import annotations

import json
import time
from pathlib import Path
from statistics import median

from catalogue import load_catalogue
from matchers import build_all_matchers

EVAL_PATH = Path(__file__).with_name("eval_set.json")


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p
    f = int(k)
    c = min(f + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)


def matches_gold(row_articulo: str, case: dict) -> bool:
    if case["expected"] == "single":
        return row_articulo == case["gold_articulo"]
    if case["expected"] == "set":
        return row_articulo in case["gold_candidates"]
    return False


def evaluate(matcher, cases: list[dict]) -> dict:
    n_pos = 0
    n_top1 = 0
    n_recall3 = 0
    n_recall5 = 0

    n_garbage = 0
    n_garbage_false_confident = 0  # top1 score passes a "confident" bar on NO_MATCH input

    n_ambiguous = 0
    n_ambiguous_flagged = 0  # margin between top1/top2 (normalized) is small AND both in gold set

    latencies = []

    # per-matcher-family "confident" absolute-score bar, chosen loosely per
    # matcher's own native scale; see CONFIDENCE_BAR below (used only for the
    # false-confident-match diagnostic, not for accuracy).
    for case in cases:
        t0 = time.perf_counter()
        results = matcher.rank(case["table"], case["query"], top_k=5)
        latencies.append(time.perf_counter() - t0)

        if case["type"] == "variant":
            n_pos += 1
            top_articulos = [r.articulo for r, _ in results]
            if top_articulos and top_articulos[0] == case["gold_articulo"]:
                n_top1 += 1
            if case["gold_articulo"] in top_articulos[:3]:
                n_recall3 += 1
            if case["gold_articulo"] in top_articulos[:5]:
                n_recall5 += 1

        elif case["type"] == "ambiguous":
            n_ambiguous += 1
            if len(results) >= 2:
                s1, s2 = results[0][1], results[1][1]
                margin = normalized_margin(matcher, s1, s2)
                both_in_gold = (
                    results[0][0].articulo in case["gold_candidates"]
                    and results[1][0].articulo in case["gold_candidates"]
                )
                if margin is not None and margin < 0.08 and both_in_gold:
                    n_ambiguous_flagged += 1

        elif case["type"].startswith("garbage"):
            n_garbage += 1
            if results:
                s1 = results[0][1]
                bar = CONFIDENCE_BAR.get(matcher.name)
                if bar is not None and s1 >= bar:
                    n_garbage_false_confident += 1

    out = {
        "matcher": matcher.name,
        "n_variant": n_pos,
        "top1_accuracy": n_top1 / n_pos if n_pos else None,
        "recall@3": n_recall3 / n_pos if n_pos else None,
        "recall@5": n_recall5 / n_pos if n_pos else None,
        "n_ambiguous": n_ambiguous,
        "ambiguity_flag_recall": n_ambiguous_flagged / n_ambiguous if n_ambiguous else None,
        "n_garbage": n_garbage,
        "false_confident_rate": n_garbage_false_confident / n_garbage if n_garbage else None,
        "p50_latency_ms": median(latencies) * 1000,
        "p95_latency_ms": percentile(latencies, 0.95) * 1000,
    }
    return out


def normalized_margin(matcher, s1: float, s2: float) -> float | None:
    """Best-effort normalized top1-top2 margin, per matcher's native scale."""
    if "rapidfuzz" in matcher.name or "pg_trgm" in matcher.name or "hybrid" in matcher.name:
        return s1 - s2  # already bounded [0,1]
    if "fts5" in matcher.name:
        if s1 <= 0:
            return None
        return (s1 - s2) / s1  # relative gap, since bm25 is unbounded
    return None


# Confidence bars used only for the false-confident-match diagnostic on
# garbage inputs. Chosen as "what a naive integration would plausibly set as
# an accept threshold" for each matcher's native score scale, from eyeballing
# the score distribution on clean positive matches.
CONFIDENCE_BAR = {
    "pg_trgm_similarity": 0.4,
    "pg_trgm_word_similarity": 0.5,
    "rapidfuzz_WRatio": 0.75,
    "rapidfuzz_token_set_ratio": 0.75,
    "hybrid_normalizer": 0.4,
}


def main() -> None:
    cases = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    catalogue = load_catalogue()
    matchers = build_all_matchers(catalogue)

    results = []
    for name, matcher in matchers.items():
        r = evaluate(matcher, cases)
        results.append(r)
        print(json.dumps(r, indent=2))

    out_path = Path(__file__).with_name("results_main.json")
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("wrote", out_path)


if __name__ == "__main__":
    main()
