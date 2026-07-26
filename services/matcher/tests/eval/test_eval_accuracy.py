"""624-case accuracy acceptance gate (REQ-ENG-6, design D4).

The spike measured `pg_trgm_similarity` at 98.6% top-1 and 100% recall@3 over
`spikes/matching/eval_set.json`. This suite re-measures the same set against
the promoted engine as the service actually calls it -- through
`MatcherService.match()`, i.e. including the decision layer and the unit
re-rank -- so a regression in promotion, ranking depth, or re-rank ordering
fails the build rather than quietly degrading matching quality in production.

Accuracy is measured over the 'variant' cases (the ones carrying a single gold
row), exactly as `spikes/matching/run_eval.py` does. Garbage cases are scored
separately: what matters there is that the service does not claim `matched`,
because a confident wrong match is worse than `no_match`.

**Offline by contract.** The catalogue under measurement is
`tests/data/catalogue_snapshot.json`, a checked-in snapshot-v1 export of the
Supabase catalogue replayed through `FakeCatalogueSource`; nothing here reaches
Supabase, Redis, or any other network peer.

The eval set is no longer a byte copy of the spike file: it was remapped once,
offline, from the retired SQLite identities (`table`, `gold_rowid`) to the
warehouse identities the service now speaks (`catalogue_id`, `gold_uid`) by
`scripts/remap_eval_set.py`. The spike-copy hash test retired with them; the
provenance authority is now `EVAL_SET_SHA256` over the remapped file plus the
resolvability of every `gold_uid` in the snapshot (design D7).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import pytest

EVAL_PATH = Path(__file__).resolve().parents[1] / "data" / "eval_set.json"
FIXTURE_PATH = Path(__file__).resolve().parents[1] / "data" / "catalogue_snapshot.json"

EVAL_SET_SHA256 = "a8aa3d8061bceead77ce4de942827b1fd07ebe0fc9e3dcb520f208a2218903e6"
"""Provenance guard on the remapped eval set; re-pin only with a recorded remap."""


def fixture_catalogue() -> dict:
    """The checked-in Supabase snapshot, grouped by warehouse code.

    The eval suite is offline by contract (WU-6): the catalogue it measures
    against is a file in the repository, never a live Supabase read.
    """
    from matcher.cache import decode_snapshot
    from matcher.catalogue import group_rows

    snapshot = decode_snapshot(FIXTURE_PATH.read_bytes())
    assert snapshot is not None, f"{FIXTURE_PATH} is not a v1 snapshot"
    return group_rows(snapshot.rows)


WAREHOUSE_CODES = frozenset(fixture_catalogue())

# --- Thresholds from REQ-ENG-6 -------------------------------------------
TOP1_FLOOR = 0.983
"""Measured top-1 accuracy for pg_trgm_similarity; the floor, not a goal."""

RECALL3_FLOOR = 1.00
"""Every gold row is still found within the top 3; regressions are failures."""

FALSE_CONFIDENCE_CEILING = 0.022
"""Share of garbage inputs that may still be reported `matched`."""

EXPECTED_CASE_COUNT = 624
"""All 624 legacy cases survived the WU-6 remap; zero were dropped.

The remap (`scripts/remap_eval_set.py`) resolves each gold row by `nr_articulo`
first and exact `articulo` second: 345 cases resolved by SKU, 85 by name, 0
unmappable. That is not luck -- the Supabase catalogue turned out to hold
exactly the same 1,405 rows the retired SQLite file did (the 8 extra SQLite
`rowid`s are spreadsheet header rows the loader always discarded, never gold).
"""

# --- Cohort baselines, re-measured after the deterministic tie-break -------
# Provenance: measured 2026-07-25 on this branch, AFTER `rank()` gained its
# `(-score, uid)` tie-break (WU-11), by running this very suite against
# `data/catalogue_snapshot.json` (1,405 rows across 8 warehouse codes, exported
# from Supabase) through `MatcherService.match()` with default settings.
# `has_code` = the gold catalogue row carries a `nr_articulo`; `no_code` = it is
# NULL. REQ-ENG-6 requires both cohorts to be REPORTED; these floors
# additionally turn a silent cohort-specific regression into a failure. They are
# observed baselines, not independently derived targets -- re-pin them
# deliberately (with a new dated note) if the catalogue or engine changes.
#
#                    2026-07-24        2026-07-25        2026-07-25
#                    SQLite            Supabase, no      Supabase +
#                                      tie-break         tie-break (NOW)
#   overall   n=430  424/430 0.98605   423/430 0.98372   423/430 0.98372
#   has_code  n=345  340/345 0.98551   344/345 0.99710   344/345 0.99710
#   no_code   n= 85   84/ 85 0.98824    79/ 85 0.92941    79/ 85 0.92941
#   recall@3         1.0000 everywhere 1.0000 everywhere 1.0000 everywhere
#   garbage   n=184  1/184   0.00543   1/184   0.00543   1/184   0.00543
#
# READ THIS BEFORE TOUCHING A NUMBER BELOW.
#
# The two catalogues are the SAME 1,405 rows, and the engine never changed:
# replaying this suite against rows read straight out of the retired SQLite file
# reproduces 424/430 = 0.98605 exactly. What moved between column 1 and column 2
# was ROW ORDER (`rowid` -> `warehouse_products.id`, a UUID). Six of the seven
# top-1 misses are candidates whose trigram scores are EXACTLY EQUAL, so rank 1
# was decided by catalogue order and nothing else: the losing tie-cluster moved
# out of `has_code` (the 5 "vaso poliboard paq*" 7 OZ / 12 OZ variants) and into
# `no_code` (the 5 "porcion filete pechuga" X 100 GRS / X 230 GRS variants, plus
# a four-way "kyocera toner tk 538ic" colour tie).
#
# WU-11 removed that order dependence: `rank()` now sorts by `(-score, uid)`, so
# a tie is settled by a stable row identity instead of by whatever order the
# source happened to return. `test_the_measurement_is_independent_of_row_order`
# below proves it against a shuffled catalogue.
#
# It did NOT recover the `no_code` cohort, and that is reported rather than
# tuned away. Column 3 is byte-identical to column 2 because the snapshot
# already arrives sorted by `warehouse_products.id`, so an ascending-`uid`
# tie-break re-elects exactly the same winners the UUID order elected. A
# tie-break buys DETERMINISM, not correctness: it picks a stable winner among
# equals, never a better one. Choosing the *right* member of a tie cluster is a
# scoring problem (these names differ only in a gram weight the trigram metric
# cannot see) and is out of scope here.
#
# In every one of those misses the gold row is still rank 2, which is why
# recall@3 stays at a flat 1.0000 -- the metric that actually expresses "the
# engine found it". `cola cola` -> `COLA Y POLA` is the one genuine,
# score-driven miss, and it misses identically on all three columns. No engine,
# ranking or decision behaviour regressed in any of them.
HAS_CODE_TOP1_BASELINE = 344 / 345
NO_CODE_TOP1_BASELINE = 79 / 85
COHORT_RECALL3_BASELINE = 1.00


def load_cases() -> list[dict]:
    return json.loads(EVAL_PATH.read_text(encoding="utf-8"))


def gold_has_code(case: dict, catalogue: dict) -> bool:
    """True when the gold catalogue row carries a `nr_articulo` (SKU)."""
    for row in catalogue[case["catalogue_id"]]:
        if row.uid == case["gold_uid"]:
            return row.nr_articulo is not None
    raise AssertionError(
        f"gold row {case['gold_uid']} missing from {case['catalogue_id']}"
    )


def evaluate(service, cases: list[dict]) -> dict:
    """Drive `MatcherService.match()` over every case and tally the metrics."""
    catalogue = fixture_catalogue()

    tally = {
        cohort: {"n": 0, "top1": 0, "recall3": 0}
        for cohort in ("overall", "has_code", "no_code")
    }
    garbage = {"n": 0, "false_confident": 0}
    ambiguous = {"n": 0, "flagged": 0}

    for case in cases:
        decision = service.match(
            case["catalogue_id"], case["query"], case.get("gold_unit")
        )
        articulos = [c.articulo for c in decision.candidates]

        if case["type"] == "variant":
            cohorts = ("overall", "has_code" if gold_has_code(case, catalogue) else "no_code")
            gold = case["gold_articulo"]
            for cohort in cohorts:
                tally[cohort]["n"] += 1
                tally[cohort]["top1"] += bool(articulos and articulos[0] == gold)
                tally[cohort]["recall3"] += gold in articulos[:3]

        elif case["type"] == "ambiguous":
            ambiguous["n"] += 1
            ambiguous["flagged"] += decision.status == "ambiguous"

        elif case["type"].startswith("garbage"):
            garbage["n"] += 1
            garbage["false_confident"] += decision.status == "matched"

    def rates(counts: dict) -> dict:
        n = counts["n"]
        return {
            "n": n,
            "top1": counts["top1"] / n if n else None,
            "recall3": counts["recall3"] / n if n else None,
        }

    return {
        "overall": rates(tally["overall"]),
        "has_code": rates(tally["has_code"]),
        "no_code": rates(tally["no_code"]),
        "garbage_n": garbage["n"],
        "false_confidence": (
            garbage["false_confident"] / garbage["n"] if garbage["n"] else 0.0
        ),
        "ambiguous_n": ambiguous["n"],
        "ambiguity_flag_recall": (
            ambiguous["flagged"] / ambiguous["n"] if ambiguous["n"] else None
        ),
    }


@pytest.fixture(scope="session")
def eval_service():
    """A `MatcherService` over the checked-in snapshot -- no network, no Redis.

    The suite's own service, not `conftest.service`: that fixture carries the
    nine-row fixture catalogue, while REQ-ENG-6 has to be measured against the
    real 1,405-row catalogue the snapshot preserves. The source is a
    `FakeCatalogueSource` replaying the snapshot rows and the cache is the real
    `RedisSnapshotCache` over a private `fakeredis`, exactly as everywhere else
    in the suite (design D2/D7).
    """
    from conftest import REDIS_URL, SUPABASE_KEY, SUPABASE_URL, FakeCatalogueSource, make_cache

    from matcher.config import Settings
    from matcher.service import MatcherService

    settings = Settings(
        supabase_url=SUPABASE_URL, supabase_key=SUPABASE_KEY, redis_url=REDIS_URL
    )
    return MatcherService(
        settings, FakeCatalogueSource(fixture_catalogue()), make_cache()
    )


@pytest.fixture(scope="session")
def metrics(eval_service) -> dict:
    return evaluate(eval_service, load_cases())


def skip_marker_names(module) -> set[str]:
    """Names of the skip-shaped markers applied to a whole test module."""
    markers = getattr(module, "pytestmark", [])
    if not isinstance(markers, list):
        markers = [markers]
    return {marker.name for marker in markers} & {"skip", "skipif", "xfail"}


class TestEvalSetProvenance:
    def test_eval_set_is_present(self) -> None:
        assert EVAL_PATH.exists()

    def test_the_case_count_is_pinned(self) -> None:
        assert len(load_cases()) == EXPECTED_CASE_COUNT

    def test_every_case_carries_a_catalogue_id_and_gold_uid(self) -> None:
        for case in load_cases():
            assert case["catalogue_id"] in WAREHOUSE_CODES
            assert "table" not in case
            if case["type"] == "variant":
                assert case["gold_uid"]
                assert "gold_rowid" not in case

    def test_every_gold_uid_resolves_in_the_fixture_snapshot(self) -> None:
        catalogue = fixture_catalogue()
        for case in load_cases():
            if case["type"] != "variant":
                continue
            uids = {row.uid for row in catalogue[case["catalogue_id"]]}
            assert case["gold_uid"] in uids

    def test_the_remapped_set_hash_is_pinned(self) -> None:
        assert hashlib.sha256(EVAL_PATH.read_bytes()).hexdigest() == EVAL_SET_SHA256

    def test_every_case_type_is_represented(self) -> None:
        types = {case["type"].split("_")[0] for case in load_cases()}
        assert {"variant", "ambiguous", "garbage"} <= types

    def test_the_eval_suite_is_not_skipped(self) -> None:
        assert skip_marker_names(sys.modules[__name__]) == set()

    def test_the_skip_guard_would_notice_a_returning_marker(self) -> None:
        """The guard above is only worth having if it actually detects one."""

        class _Module:
            pytestmark = pytest.mark.skip(reason="a marker sneaking back in")

        assert skip_marker_names(_Module) == {"skip"}


class TestOverallAccuracy:
    def test_variant_population_is_non_trivial(self, metrics: dict) -> None:
        assert metrics["overall"]["n"] >= 300

    def test_top1_reproduces_the_spike(self, metrics: dict) -> None:
        assert metrics["overall"]["top1"] >= TOP1_FLOOR

    def test_recall_at_3_is_total(self, metrics: dict) -> None:
        assert metrics["overall"]["recall3"] >= RECALL3_FLOOR

    def test_garbage_false_confidence_stays_bounded(self, metrics: dict) -> None:
        assert metrics["false_confidence"] <= FALSE_CONFIDENCE_CEILING


class TestMeasurementIsOrderIndependent:
    """WU-11: the whole eval verdict must be a property of the DATA.

    Before the `(-score, uid)` tie-break, replaying this same set over the same
    rows in a different order produced a different top-1 figure, because rank 1
    inside a tie cluster was decided by catalogue order. That is exactly how the
    cohort swing at the Supabase cutover happened, and it is what this pins shut.
    """

    def _metrics_over(self, rows: list) -> dict:
        from conftest import (
            REDIS_URL,
            SUPABASE_KEY,
            SUPABASE_URL,
            FakeCatalogueSource,
            make_cache,
        )

        from matcher.config import Settings
        from matcher.service import MatcherService

        settings = Settings(
            supabase_url=SUPABASE_URL, supabase_key=SUPABASE_KEY, redis_url=REDIS_URL
        )
        service = MatcherService(settings, FakeCatalogueSource(rows), make_cache())
        return evaluate(service, load_cases())

    def test_a_shuffled_catalogue_reports_the_same_accuracy(
        self, metrics: dict
    ) -> None:
        import random

        rows = [row for group in fixture_catalogue().values() for row in group]
        random.Random(20260725).shuffle(rows)

        shuffled = self._metrics_over(rows)

        assert shuffled["overall"]["top1"] == metrics["overall"]["top1"]
        assert shuffled["has_code"]["top1"] == metrics["has_code"]["top1"]
        assert shuffled["no_code"]["top1"] == metrics["no_code"]["top1"]
        assert shuffled["false_confidence"] == metrics["false_confidence"]
        assert shuffled["overall"]["top1"] == pytest.approx(423 / 430)


class TestCohortSplit:
    def test_both_cohorts_are_populated(self, metrics: dict) -> None:
        assert metrics["has_code"]["n"] > 0
        assert metrics["no_code"]["n"] > 0

    def test_cohorts_partition_the_variant_population(self, metrics: dict) -> None:
        assert (
            metrics["has_code"]["n"] + metrics["no_code"]["n"]
            == metrics["overall"]["n"]
        )

    def test_both_cohorts_report_top1_and_recall3(self, metrics: dict) -> None:
        for cohort in ("has_code", "no_code"):
            assert metrics[cohort]["top1"] is not None
            assert metrics[cohort]["recall3"] is not None

    def test_has_code_cohort_holds_its_pinned_baseline(self, metrics: dict) -> None:
        assert metrics["has_code"]["top1"] >= HAS_CODE_TOP1_BASELINE

    def test_no_code_cohort_holds_its_pinned_baseline(self, metrics: dict) -> None:
        assert metrics["no_code"]["top1"] >= NO_CODE_TOP1_BASELINE

    def test_both_cohorts_hold_total_recall_at_3(self, metrics: dict) -> None:
        for cohort in ("has_code", "no_code"):
            assert metrics[cohort]["recall3"] >= COHORT_RECALL3_BASELINE

    def test_report_is_emitted(self, metrics: dict, capsys) -> None:
        with capsys.disabled():
            print("\n--- eval report (REQ-ENG-6) ---")
            for cohort in ("overall", "has_code", "no_code"):
                m = metrics[cohort]
                print(
                    f"{cohort:9s} n={m['n']:3d} "
                    f"top1={m['top1']:.4f} recall@3={m['recall3']:.4f}"
                )
            print(
                f"garbage   n={metrics['garbage_n']:3d} "
                f"false_confidence={metrics['false_confidence']:.4f}"
            )
            print(
                f"ambiguous n={metrics['ambiguous_n']:3d} "
                f"flag_recall={metrics['ambiguity_flag_recall']}"
            )
