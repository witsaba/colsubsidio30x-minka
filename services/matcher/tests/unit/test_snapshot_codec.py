"""Catalogue row shape, the port protocols, and the Redis snapshot codec.

Covers the WU-1 contract of the redis-catalogue-cache change:

* `Row` is the frozen five-field catalogue row that replaces the SQLite one
  (REQ-CSS-2), and it carries no stock quantity (REQ-ENG-2, REQ-CSS-4).
* `CatalogueSource` / `SnapshotCache` are the two ports `MatcherService`
  composes (design D2).
* `encode_snapshot` / `decode_snapshot` round-trip a snapshot through the
  versioned JSON payload of design D3, treat anything unparseable or
  version-incompatible as a clean miss (REQ-RCC-1), and provably cannot carry
  stock bytes into Redis (REQ-RCC-5, RF-18).

Pure functions and dataclasses only -- no Redis client is involved here.
"""
from __future__ import annotations

import dataclasses
import json
from dataclasses import fields
from datetime import UTC, datetime, timedelta

import pytest

from matcher.cache import (
    REFRESH_LOCK_KEY,
    SNAPSHOT_KEY,
    SNAPSHOT_SCHEMA_VERSION,
    decode_snapshot,
    encode_snapshot,
)
from matcher.ports import CatalogueSource, Row, Snapshot, SnapshotCache

ROW_FIELDS = {"warehouse_code", "uid", "articulo", "unidad", "nr_articulo"}


def make_row(
    warehouse_code: str = "BOD-01",
    uid: str = "11111111-1111-4111-8111-111111111111",
    articulo: str = "AZUCAR MORENA X 500 G",
    unidad: str | None = "KG",
    nr_articulo: str | None = "SKU-0001",
) -> Row:
    return Row(
        warehouse_code=warehouse_code,
        uid=uid,
        articulo=articulo,
        unidad=unidad,
        nr_articulo=nr_articulo,
    )


class TestRowShape:
    def test_the_row_carries_exactly_the_five_catalogue_fields(self) -> None:
        assert {f.name for f in fields(Row)} == ROW_FIELDS

    def test_the_row_carries_no_stock_field(self) -> None:
        """REQ-CSS-2, REQ-ENG-2: `sd` is dropped, stock is never loaded."""
        row = make_row()

        assert not hasattr(row, "sd")
        assert not hasattr(row, "theoretical_qty")

    def test_the_row_is_frozen(self) -> None:
        row = make_row()

        with pytest.raises(dataclasses.FrozenInstanceError):
            row.articulo = "ARROZ"  # type: ignore[misc]

    def test_the_nullable_fields_are_preserved_as_none(self) -> None:
        """`unidad` and `nr_articulo` are nullable and never coerced."""
        row = make_row(unidad=None, nr_articulo=None)

        assert row.unidad is None
        assert row.nr_articulo is None
        assert row.articulo == "AZUCAR MORENA X 500 G"


class TestPortProtocols:
    """The two ports `MatcherService` composes (design D2)."""

    def test_an_object_exposing_load_satisfies_the_catalogue_source_port(
        self,
    ) -> None:
        class Source:
            def load(self) -> dict[str, list[Row]]:
                return {"BOD-01": [make_row()]}

        assert isinstance(Source(), CatalogueSource)

    def test_an_object_missing_load_does_not_satisfy_the_catalogue_source_port(
        self,
    ) -> None:
        class NotASource:
            def fetch(self) -> dict[str, list[Row]]:
                return {}

        assert not isinstance(NotASource(), CatalogueSource)

    def test_an_object_exposing_the_four_cache_methods_satisfies_the_port(
        self,
    ) -> None:
        class Cache:
            def get(self) -> Snapshot | None:
                return None

            def put(self, snapshot: Snapshot) -> None:
                return None

            def try_acquire_refresh_lock(self, ttl_seconds: int) -> bool:
                return True

            def release_refresh_lock(self) -> None:
                return None

        assert isinstance(Cache(), SnapshotCache)

    def test_a_cache_without_the_refresh_lock_does_not_satisfy_the_port(
        self,
    ) -> None:
        """Stampede control is part of the port, not an optional extra."""

        class GetPutOnly:
            def get(self) -> Snapshot | None:
                return None

            def put(self, snapshot: Snapshot) -> None:
                return None

        assert not isinstance(GetPutOnly(), SnapshotCache)


class TestSnapshotShape:
    def test_the_snapshot_carries_its_rows_and_the_load_timestamp(self) -> None:
        loaded_at = datetime(2026, 7, 25, 12, 0, tzinfo=UTC)
        snapshot = Snapshot(rows=[make_row()], loaded_at=loaded_at)

        assert snapshot.loaded_at == loaded_at
        assert [row.uid for row in snapshot.rows] == [
            "11111111-1111-4111-8111-111111111111"
        ]

    def test_the_snapshot_is_frozen(self) -> None:
        snapshot = Snapshot(rows=[make_row()], loaded_at=datetime.now(UTC))

        with pytest.raises(dataclasses.FrozenInstanceError):
            snapshot.loaded_at = datetime.now(UTC)  # type: ignore[misc]


class TestSnapshotKeys:
    """The Redis keys are an operational contract (`redis-cli GET ...`)."""

    def test_the_snapshot_and_lock_keys_are_pinned(self) -> None:
        assert SNAPSHOT_KEY == "matcher:catalogue:snapshot:v1"
        assert REFRESH_LOCK_KEY == "matcher:catalogue:refresh-lock:v1"

    def test_the_key_suffix_tracks_the_schema_version(self) -> None:
        """D3: an incompatible payload must land on a different key.

        If the version constant is ever bumped without renaming the key, an
        old-format value would still be read from the same slot.
        """
        assert SNAPSHOT_KEY.endswith(f":v{SNAPSHOT_SCHEMA_VERSION}")
        assert REFRESH_LOCK_KEY.endswith(f":v{SNAPSHOT_SCHEMA_VERSION}")


class TestCodecRoundTrip:
    def test_encode_then_decode_returns_the_same_rows_and_loaded_at(self) -> None:
        loaded_at = datetime(2026, 7, 25, 9, 30, 15, tzinfo=UTC)
        snapshot = Snapshot(
            rows=[
                make_row(warehouse_code="BOD-01", uid="uid-a", articulo="ARROZ"),
                make_row(
                    warehouse_code="BOD-02",
                    uid="uid-b",
                    articulo="PANELA",
                    unidad=None,
                    nr_articulo=None,
                ),
            ],
            loaded_at=loaded_at,
        )

        decoded = decode_snapshot(encode_snapshot(snapshot))

        assert decoded is not None
        assert decoded.loaded_at == loaded_at
        assert decoded.rows == snapshot.rows

    def test_a_naive_loaded_at_round_trips_as_utc(self) -> None:
        """Timestamps are compared against `now(UTC)` for staleness."""
        snapshot = Snapshot(
            rows=[make_row()], loaded_at=datetime(2026, 7, 25, 9, 30, 15)
        )

        decoded = decode_snapshot(encode_snapshot(snapshot))

        assert decoded is not None
        assert decoded.loaded_at == datetime(2026, 7, 25, 9, 30, 15, tzinfo=UTC)

    def test_a_different_schema_version_decodes_to_none(self) -> None:
        """REQ-RCC-1: a version-incompatible payload is a clean miss."""
        payload = json.loads(encode_snapshot(Snapshot([make_row()], datetime.now(UTC))))
        payload["schema_version"] = SNAPSHOT_SCHEMA_VERSION + 1

        assert decode_snapshot(json.dumps(payload).encode("utf-8")) is None

    def test_malformed_json_decodes_to_none(self) -> None:
        assert decode_snapshot(b"{not json at all") is None
        assert decode_snapshot(b"") is None

    def test_a_missing_required_field_decodes_to_none(self) -> None:
        payload = json.loads(encode_snapshot(Snapshot([make_row()], datetime.now(UTC))))
        del payload["rows"][0]["articulo"]

        assert decode_snapshot(json.dumps(payload).encode("utf-8")) is None

    def test_a_payload_of_the_wrong_shape_decodes_to_none(self) -> None:
        assert decode_snapshot(b'{"schema_version": 1, "rows": []}') is None
        assert (
            decode_snapshot(
                json.dumps(
                    {
                        "schema_version": SNAPSHOT_SCHEMA_VERSION,
                        "loaded_at": "not-a-timestamp",
                        "rows": [],
                    }
                ).encode("utf-8")
            )
            is None
        )

    def test_an_empty_catalogue_still_round_trips(self) -> None:
        """The codec never invents a miss; emptiness is judged upstream."""
        loaded_at = datetime.now(UTC) - timedelta(hours=1)

        decoded = decode_snapshot(encode_snapshot(Snapshot([], loaded_at)))

        assert decoded is not None
        assert decoded.rows == []
        assert decoded.loaded_at == loaded_at


class TestSnapshotContentSafety:
    def test_the_encoded_bytes_name_no_stock_field(self) -> None:
        """REQ-RCC-5, RF-18: stock data cannot enter Redis via the snapshot.

        The row text deliberately contains neither substring, so a hit could
        only come from the codec emitting a stock field of its own.
        """
        snapshot = Snapshot(
            rows=[
                make_row(articulo="ARROZ BLANCO X 500 G", nr_articulo="SKU-1"),
                make_row(articulo="PANELA CUADRADA", unidad="UND", nr_articulo=None),
            ],
            loaded_at=datetime.now(UTC),
        )

        payload = encode_snapshot(snapshot)

        assert b'"sd"' not in payload
        assert b"theoretical_qty" not in payload

    def test_the_encoded_row_names_exactly_the_five_catalogue_fields(self) -> None:
        payload = json.loads(encode_snapshot(Snapshot([make_row()], datetime.now(UTC))))

        assert set(payload["rows"][0]) == ROW_FIELDS
