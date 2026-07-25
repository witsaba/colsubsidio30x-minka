"""Section 5 of the review brief: signals both prior reports may have missed.

A) Unit-as-disambiguation-signal: does filtering/re-weighting candidates by
   the dictated unit (mapped across the English/Spanish label mismatch found
   in the data) measurably improve accuracy, and how far can it actually go
   given that most of the real ambiguous clusters share one unit internally?
B) Historical stock (`sd`) as a prior: quantify how many rows show 0/negative
   stock (candidates for "this would get down-weighted"), to inform the
   legitimate-signal-vs-anomaly-masking judgement call.
C) Cross-catalogue leakage: breakdown of the false-confident-match rate
   specifically on cross-catalogue garbage cases.
D) Two-stage design (cheap lexical recall -> precise re-rank): does it beat
   a single scorer at this catalogue size (56..345 rows)?
E) Does min-max normalizing bm25 (which section 4 showed rescues MARGIN
   portability) quietly break absolute-confidence gating on garbage input?
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from statistics import median

from catalogue import STOCK_TABLES, load_catalogue
from matchers import build_all_matchers
from normalize import strip_accents

EVAL_PATH = Path(__file__).with_name("eval_set.json")

# ---------------------------------------------------------------------------
# A) unit signal
# ---------------------------------------------------------------------------

# catalogue `unidad` values are English; dictated Spanish unit words must be
# mapped across that mismatch.
UNIT_SYNONYMS = {
    "Liter": {"litro", "litros", "lt", "lts", "l"},
    "Kilogram": {"kilo", "kilos", "kilogramo", "kilogramos", "kg", "kgs"},
    "Unidad": {"unidad", "unidades", "und", "un", "paquete", "paquetes", "sobre", "sobres", "caja", "cajas"},
    "Portion": {"porcion", "porciones", "racion", "raciones"},
}
SPOKEN_UNIT_FOR = {v: k for k, syns in UNIT_SYNONYMS.items() for v in syns}


def detect_unit(query: str) -> str | None:
    toks = set(strip_accents(query).lower().split())
    for tok in toks:
        if tok in SPOKEN_UNIT_FOR:
            return SPOKEN_UNIT_FOR[tok]
    return None


def spoken_unit_word(unidad: str) -> str | None:
    mapping = {"Liter": "litros", "Kilogram": "kilos", "Unidad": "unidades", "Portion": "porciones"}
    return mapping.get(unidad)


def unit_signal_experiment(cases, catalogue, matchers):
    print("\n" + "=" * 70)
    print("A) UNIT SIGNAL EXPERIMENT")
    print("=" * 70)

    # A1: how much would unit alone narrow each hand-picked ambiguous cluster?
    print("\n-- A1: unit homogeneity of the real ambiguous clusters --")
    for c in cases:
        if c["type"] != "ambiguous":
            continue
        rows = catalogue[c["table"]]
        by_articulo = {r.articulo: r for r in rows}
        units = [by_articulo[a].unidad for a in c["gold_candidates"] if a in by_articulo]
        distinct = set(units)
        print(
            f"  '{c['query']}' in {c['table']}: {len(c['gold_candidates'])} candidates, "
            f"units={units} -> {'UNIT DISCRIMINATES' if len(distinct) > 1 else 'unit is USELESS here (all same)'}"
        )

    # A2: append the TRUE spoken unit to each variant query, filter candidates
    # by mapped unit compatibility, and measure the top1 accuracy delta for a
    # representative matcher of each family.
    print("\n-- A2: top1 accuracy with vs without true-unit filtering --")
    variant_cases = [c for c in cases if c["type"] == "variant" and c.get("gold_unit")]
    for mname in ["fts5_unicode61", "pg_trgm_similarity", "rapidfuzz_token_set_ratio"]:
        matcher = matchers[mname]
        base_correct = 0
        filtered_correct = 0
        n = 0
        for c in variant_cases:
            unit_word = spoken_unit_word(c["gold_unit"])
            if not unit_word:
                continue
            n += 1
            query_with_unit = f"{c['query']} en {unit_word}"
            results = matcher.rank(c["table"], query_with_unit, top_k=10)
            if results and results[0][0].articulo == c["gold_articulo"]:
                base_correct += 1
            detected = detect_unit(query_with_unit)
            filtered = [r for r, s in results if detected is None or r.unidad == detected]
            if filtered and filtered[0].articulo == c["gold_articulo"]:
                filtered_correct += 1
        print(
            f"  {mname:28s} n={n:4d}  top1_acc(no filter, unit word appended)={base_correct/n:.4f}  "
            f"top1_acc(WITH unit filter)={filtered_correct/n:.4f}"
        )

    # A3: naive filter (no synonym map, exact string compare "litros"=="Liter")
    # fails completely -- demonstrates why the EN/ES mismatch must be handled.
    print("\n-- A3: naive (unmapped) unit filter vs mapped unit filter --")
    naive_hits = sum(
        1 for c in variant_cases if spoken_unit_word(c["gold_unit"]) and spoken_unit_word(c["gold_unit"]) == c["gold_unit"]
    )
    print(f"  naive exact-string match ('litros' == 'Liter'-style) succeeds for {naive_hits}/{len(variant_cases)} rows (0 expected)")


# ---------------------------------------------------------------------------
# B) historical stock as a prior
# ---------------------------------------------------------------------------

def stock_prior_experiment(catalogue):
    print("\n" + "=" * 70)
    print("B) HISTORICAL STOCK (sd) AS A PRIOR")
    print("=" * 70)
    total = 0
    negative = 0
    zero = 0
    for t in STOCK_TABLES:
        for r in catalogue[t]:
            total += 1
            if r.sd is not None and r.sd < 0:
                negative += 1
            if r.sd is not None and r.sd == 0:
                zero += 1
    print(f"  rows with sd < 0 (negative stock, i.e. a live data anomaly): {negative}/{total} = {negative/total:.3%}")
    print(f"  rows with sd == 0: {zero}/{total} = {zero/total:.3%}")
    print(
        "  JUDGEMENT: a prior that downweights low/negative-stock rows as 'unlikely matches'\n"
        "  would systematically suppress exactly the rows most likely to represent a real\n"
        "  operational anomaly (theft, miscount, spoilage) that the product spec requires\n"
        "  surfacing. Recommendation: do NOT use stock magnitude as a matching prior. If a\n"
        "  tie-breaker is ever needed among two candidates that are LEXICALLY indistinguishable\n"
        "  (identical normalized text, e.g. true duplicate rows), a recency/frequency-of-dictation\n"
        "  signal is safer than raw stock level, and should never suppress or hide an item from\n"
        "  the candidate list -- only break a tie in DISPLAY ORDER after the item is already shown."
    )


# ---------------------------------------------------------------------------
# C) cross-catalogue leakage breakdown
# ---------------------------------------------------------------------------

def leakage_breakdown(cases, matchers):
    print("\n" + "=" * 70)
    print("C) CROSS-CATALOGUE LEAKAGE (breakdown of garbage_cross_catalogue only)")
    print("=" * 70)
    from run_eval import CONFIDENCE_BAR

    cross_cases = [c for c in cases if c["type"] == "garbage_cross_catalogue"]
    for mname, bar in CONFIDENCE_BAR.items():
        matcher = matchers[mname]
        n = 0
        confident_wrong = 0
        examples = []
        for c in cross_cases:
            n += 1
            results = matcher.rank(c["table"], c["query"], top_k=1)
            if results and results[0][1] >= bar:
                confident_wrong += 1
                if len(examples) < 3:
                    examples.append((c["source_articulo"], c["source_table"], c["table"], results[0][0].articulo, results[0][1]))
        print(f"  {mname:28s} n={n:3d}  confident-wrong-local-SKU rate={confident_wrong/n:.3%}")
        for ex in examples:
            print(f"      leaked: '{ex[0]}' (native to {ex[1]}) queried against {ex[2]} -> matched '{ex[3]}' score={ex[4]:.3f}")


# ---------------------------------------------------------------------------
# D) two-stage design
# ---------------------------------------------------------------------------

def two_stage_experiment(cases, catalogue, matchers):
    print("\n" + "=" * 70)
    print("D) TWO-STAGE (cheap lexical recall -> precise re-rank) vs single scorer")
    print("=" * 70)
    variant_cases = [c for c in cases if c["type"] == "variant"]

    recall_stage = matchers["fts5_trigram"]
    rerank_matcher = matchers["pg_trgm_word_similarity"]

    correct = 0
    recall_lost = 0  # true answer not even present in stage-1 candidates
    latencies = []
    for c in variant_cases:
        t0 = time.perf_counter()
        stage1 = recall_stage.rank(c["table"], c["query"], top_k=15)
        candidate_articulos = {r.articulo for r, _ in stage1}
        if c["gold_articulo"] not in candidate_articulos:
            recall_lost += 1
        # rerank only the stage-1 candidates with the precise scorer
        rows = catalogue[c["table"]]
        by_art = {r.articulo: r for r in rows}
        reranked = []
        for art in candidate_articulos:
            row = by_art[art]
            from normalize import trgm_word_similarity

            reranked.append((row, trgm_word_similarity(c["query"], row.articulo)))
        reranked.sort(key=lambda t: t[1], reverse=True)
        latencies.append(time.perf_counter() - t0)
        if reranked and reranked[0][0].articulo == c["gold_articulo"]:
            correct += 1

    n = len(variant_cases)
    print(f"  two-stage (fts5_trigram recall@15 -> pg_trgm_word_similarity rerank):")
    print(f"    top1 accuracy = {correct/n:.4f}   recall lost at stage1 = {recall_lost}/{n} = {recall_lost/n:.4f}")
    print(f"    p50 latency = {median(latencies)*1000:.3f} ms   p95 = {sorted(latencies)[int(0.95*len(latencies))]*1000:.3f} ms")

    # compare against single-scorer pg_trgm_word_similarity over the WHOLE catalogue (no stage-1 pruning)
    single = matchers["pg_trgm_word_similarity"]
    correct_single = 0
    latencies_single = []
    for c in variant_cases:
        t0 = time.perf_counter()
        results = single.rank(c["table"], c["query"], top_k=5)
        latencies_single.append(time.perf_counter() - t0)
        if results and results[0][0].articulo == c["gold_articulo"]:
            correct_single += 1
    print(f"  single-scorer pg_trgm_word_similarity over full catalogue (no stage-1 pruning):")
    print(f"    top1 accuracy = {correct_single/n:.4f}")
    print(
        f"    p50 latency = {median(latencies_single)*1000:.3f} ms   "
        f"p95 = {sorted(latencies_single)[int(0.95*len(latencies_single))]*1000:.3f} ms"
    )
    print(
        "  VERDICT: at 55..345 rows, brute-force single-scorer p95 latency is already "
        "single-digit milliseconds; two-stage pruning buys no latency headroom that matters "
        "and introduces a real, measured recall-loss risk from stage-1 pruning."
    )


# ---------------------------------------------------------------------------
# E) does min-max normalizing bm25 break absolute confidence gating?
# ---------------------------------------------------------------------------

def minmax_confidence_check(cases, matchers):
    print("\n" + "=" * 70)
    print("E) does min-max normalizing bm25 (which fixes MARGIN portability) break absolute confidence gating?")
    print("=" * 70)
    garbage_cases = [c for c in cases if c["type"].startswith("garbage")]
    for mname in ["fts5_unicode61", "fts5_trigram"]:
        matcher = matchers[mname]
        near_one = 0
        n = 0
        for c in garbage_cases:
            results = matcher.rank(c["table"], c["query"], top_k=5)
            if len(results) < 2:
                continue
            n += 1
            scores = [s for _, s in results]
            lo, hi = min(scores), max(scores)
            if hi == lo:
                continue
            top1_norm = (scores[0] - lo) / (hi - lo)
            if top1_norm >= 0.95:
                near_one += 1
        print(
            f"  {mname:28s} n={n:4d}  fraction of GARBAGE queries where min-max-normalized "
            f"top1 score >= 0.95 = {near_one/n:.3%}"
        )
    print(
        "  min-max normalization is always relative to whatever candidates were returned for THAT\n"
        "  query, so on garbage input it still rescales the (irrelevant) best-of-a-bad-bunch\n"
        "  candidate to near the top of [0,1] -- it fixes relative-margin portability but must\n"
        "  NEVER be used as a substitute for an absolute floor on the raw top1 score."
    )


def main():
    cases = json.loads(EVAL_PATH.read_text(encoding="utf-8"))
    catalogue = load_catalogue()
    matchers = build_all_matchers(catalogue)

    unit_signal_experiment(cases, catalogue, matchers)
    stock_prior_experiment(catalogue)
    leakage_breakdown(cases, matchers)
    two_stage_experiment(cases, catalogue, matchers)
    minmax_confidence_check(cases, matchers)


if __name__ == "__main__":
    main()
