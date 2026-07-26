#!/usr/bin/env python3
"""Regenerate the checked-in catalogue snapshot fixture from live Supabase.

**One-shot, human-run, network-required data-export utility.** It is never
executed by CI and has no automated tests: every meaningful line of it is a
live PostgREST read against the production project, so a test could only
exercise a mock of code that already has its own suite. The logic worth
testing -- the query, the row flattening, the pagination -- lives in
`matcher.supabase_source.SupabaseCatalogueSource`, and the serialization
lives in `matcher.cache.encode_snapshot`; this script only wires the two
together. It is run by hand when the catalogue drifts far enough that the
fixture stops representing real data.

Produced artifact: `services/matcher/tests/data/catalogue_snapshot.json`, the
snapshot-v1 fixture created for task 6.1 of
`openspec/changes/redis-catalogue-cache/tasks.md`.

Usage (from the repository root, so the `matcher` workspace member resolves)::

    export SUPABASE_URL=https://<project>.supabase.co
    export SUPABASE_KEY=<service_role key>
    uv run python scripts/export_catalogue_snapshot.py

**`SUPABASE_KEY` must be the `service_role` key, not the `anon`/publishable
one.** Every catalogue table answers the publishable key with HTTP 401 and
PostgREST code `42501` ("GRANT SELECT ON public.<table>"): all RLS read
policies target the `authenticated` role, and `warehouse_products_read`
additionally requires `private.is_staff()`. A `service_role` key bypasses RLS
and is the only credential that can perform this export. It is a
break-glass-grade secret: pass it through the environment, never through a
flag, never into a file, and note that this script never prints or logs it --
not even in an error message.

The output is deterministic. `loaded_at` is the fixed literal
`2026-07-25T00:00:00+00:00` rather than "now", so re-running the export
against an unchanged catalogue produces no diff at all and a real diff is
always real catalogue drift. Serialization goes through the production
`encode_snapshot`, which emits `ensure_ascii=False` and therefore keeps the
Spanish product names readable and reviewable in the fixture.

No stock quantity can leak into the fixture: `warehouse_stock_balances` is
never queried, and `encode_snapshot` serializes exactly the five `Row` fields
(REQ-CSS-4, REQ-RCC-5, RF-18).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import httpx

from matcher.cache import encode_snapshot
from matcher.catalogue import CatalogueUnavailableError
from matcher.ports import Row, Snapshot
from matcher.supabase_source import SupabaseCatalogueSource

DEFAULT_OUT = Path("services/matcher/tests/data/catalogue_snapshot.json")

# Fixed so the fixture is reproducible; see the module docstring.
FIXTURE_LOADED_AT = datetime.fromisoformat("2026-07-25T00:00:00+00:00")

REQUEST_TIMEOUT_SECONDS = 60.0

EXIT_OK = 0
EXIT_MISSING_CREDENTIALS = 1
EXIT_CATALOGUE_UNAVAILABLE = 2
EXIT_WRITE_ERROR = 3


def read_credentials() -> tuple[str, str]:
    """Return `(base_url, key)` from the environment, or raise `KeyError`."""
    missing = [name for name in ("SUPABASE_URL", "SUPABASE_KEY") if not os.environ.get(name)]
    if missing:
        raise KeyError(", ".join(missing))
    return os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]


def flatten(catalogue: dict[str, list[Row]]) -> list[Row]:
    """Flatten the grouped catalogue into one list ordered by warehouse, uid.

    `SupabaseCatalogueSource` already reads with `order=id`, but the sort is
    repeated here so the fixture's row order is a property of this script
    rather than an inherited implementation detail of the source.
    """
    return [row for code in sorted(catalogue) for row in sorted(catalogue[code], key=lambda r: r.uid)]


def previous_row_count(out_path: Path) -> int | None:
    """Row count of the fixture already on disk, or `None` if unreadable."""
    try:
        payload = json.loads(out_path.read_text(encoding="utf-8"))
        return len(payload["rows"])
    except (OSError, ValueError, KeyError, TypeError):
        return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="export_catalogue_snapshot")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--dry-run", action="store_true", help="read and count without writing")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        base_url, key = read_credentials()
    except KeyError as exc:
        print(
            f"ERROR: missing environment variable(s): {exc.args[0]}. "
            "SUPABASE_KEY must be the service_role key; the anon/publishable "
            "key is refused by RLS on every catalogue table.",
            file=sys.stderr,
        )
        return EXIT_MISSING_CREDENTIALS

    with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        source = SupabaseCatalogueSource(client, base_url, key)
        try:
            catalogue = source.load()
        except CatalogueUnavailableError as exc:
            print(f"ERROR: cannot read the Supabase catalogue: {exc}", file=sys.stderr)
            return EXIT_CATALOGUE_UNAVAILABLE

    for code in sorted(catalogue):
        print(f"{code}={len(catalogue[code])}")
    rows = flatten(catalogue)
    print(f"Σ={len(rows)}")
    if args.dry_run:
        return EXIT_OK

    previous = previous_row_count(args.out)
    if previous is not None and previous != len(rows):
        print(f"warning: catalogue drifted from {previous} to {len(rows)} rows", file=sys.stderr)

    payload = encode_snapshot(Snapshot(rows=rows, loaded_at=FIXTURE_LOADED_AT))
    try:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_bytes(payload)
    except OSError as exc:
        print(f"ERROR: cannot write {args.out}: {exc}", file=sys.stderr)
        return EXIT_WRITE_ERROR
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
