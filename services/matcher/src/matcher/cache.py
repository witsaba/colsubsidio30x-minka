"""Redis snapshot cache: keys and the versioned JSON codec (design D3).

The catalogue is cached as one JSON value under a versioned key:

    {"schema_version": 1,
     "loaded_at": "<iso8601 utc>",
     "rows": [{"warehouse_code", "uid", "articulo", "unidad", "nr_articulo"}]}

JSON, not pickle: a shared cache must never be a deserialization-to-code path,
and the value stays readable with `redis-cli GET`. The version lives both in
the payload and in the key suffix, so an incompatible format is a clean miss
rather than a parse error on live data. It is a code constant on purpose --
an env-tunable schema version could desync from the parser that reads it.

`decode_snapshot` is total: every malformed, truncated, or version-mismatched
value returns `None`, which the caller treats exactly like a cache miss
(REQ-RCC-1).

The codec serializes exactly the five `Row` fields and nothing else, so no
stock quantity can enter Redis (REQ-RCC-5, RF-18).
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime

from matcher.ports import Row, Snapshot

SNAPSHOT_SCHEMA_VERSION = 1
SNAPSHOT_KEY = f"matcher:catalogue:snapshot:v{SNAPSHOT_SCHEMA_VERSION}"
REFRESH_LOCK_KEY = f"matcher:catalogue:refresh-lock:v{SNAPSHOT_SCHEMA_VERSION}"


def _as_utc(moment: datetime) -> datetime:
    """Naive timestamps are read as UTC; staleness is judged against UTC now."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)


def encode_snapshot(snapshot: Snapshot) -> bytes:
    """Serialize a snapshot to the versioned payload stored in Redis."""
    payload = {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "loaded_at": _as_utc(snapshot.loaded_at).isoformat(),
        "rows": [asdict(row) for row in snapshot.rows],
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def decode_snapshot(raw: bytes | str | None) -> Snapshot | None:
    """Parse a stored payload, or return `None` for anything unusable."""
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        if payload["schema_version"] != SNAPSHOT_SCHEMA_VERSION:
            return None
        loaded_at = _as_utc(datetime.fromisoformat(payload["loaded_at"]))
        rows = [
            Row(
                warehouse_code=row["warehouse_code"],
                uid=row["uid"],
                articulo=row["articulo"],
                unidad=row["unidad"],
                nr_articulo=row["nr_articulo"],
            )
            for row in payload["rows"]
        ]
    except (ValueError, TypeError, KeyError, AttributeError):
        return None
    return Snapshot(rows=rows, loaded_at=loaded_at)
