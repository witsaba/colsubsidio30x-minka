#!/usr/bin/env python3
"""Parse the bodegas workbook into deterministic, typed data frames."""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
import unicodedata
from pathlib import Path
from typing import Any

import openpyxl
import pandas as pd

SCHEMA_VERSION = "1"
SCRIPT_VERSION = "1.0.0"
EXIT_OK = 0
EXIT_CHECK_DRIFT = 1
EXIT_CHECK_NO_META = 2
EXIT_BAD_SOURCE = 3
EXIT_SQLITE_ERROR = 4

STOCK_RENAME = {
    "CANTIDAD": "cantidad",
    "Nr.Artículo": "nr_articulo",
    "Artículo": "articulo",
    "Unidad": "unidad",
    "SD": "sd",
}
STOCK_DTYPES = {
    "CANTIDAD": "int",
    "Nr.Artículo": "text",
    "Artículo": "str",
    "Unidad": "str",
    "SD": "float4",
}

SHEET_CONFIG: dict[str, dict[str, Any]] = {
    "BODEGAS DISPONIBLES": {
        "header_offset": 1,
        "skipfooter": 0,
        "header_rename": {"CANTIDAD": "cantidad", "BODEGAS": "bodegas"},
        "dtype_map": {"CANTIDAD": "int", "BODEGAS": "str"},
        "raw_header": "CANTIDAD",
    },
    "STOCK ALMACEN  SUMINISTROS": {
        "header_offset": 0, "skipfooter": 1,
        "header_rename": STOCK_RENAME, "dtype_map": STOCK_DTYPES,
        "raw_header": "CANTIDAD",
    },
    "STOCK ALMACEN AYB ": {
        "header_offset": 0, "skipfooter": 1,
        "header_rename": STOCK_RENAME, "dtype_map": STOCK_DTYPES,
        "raw_header": "CANTIDAD",
    },
    "STOCK RESTAURANTE FUENTES AYB": {
        "header_offset": 0, "skipfooter": 1,
        "header_rename": STOCK_RENAME, "dtype_map": STOCK_DTYPES,
        "raw_header": "CANTIDAD",
    },
    "STOCK RESTAURANTE FUENTES SUMIN": {
        "header_offset": 0, "skipfooter": 1,
        "header_rename": STOCK_RENAME, "dtype_map": STOCK_DTYPES,
        "raw_header": "CANTIDAD", "drop_empty_trailing": True,
    },
    "STOCK KIOSCO TAQUILLA AYB": {
        "header_offset": 0, "skipfooter": 1,
        "header_rename": STOCK_RENAME, "dtype_map": STOCK_DTYPES,
        "raw_header": "CANTIDAD",
    },
    "STOCK KIOSCO PISCIGIROS AYB": {
        "header_offset": 0, "skipfooter": 1,
        "header_rename": {**STOCK_RENAME, "CANTIDA": "cantidad"},
        "dtype_map": {**{key: value for key, value in STOCK_DTYPES.items() if key != "CANTIDAD"}, "CANTIDA": "int"},
        "raw_header": "CANTIDA",
    },
    "ZOOLOGICO": {
        "header_offset": 0, "skipfooter": 1,
        "header_rename": STOCK_RENAME, "dtype_map": STOCK_DTYPES,
        "raw_header": "CANTIDAD",
    },
    "ZOOLOGICO SUMINISTROS": {
        "header_offset": 0, "skipfooter": 1,
        "header_rename": STOCK_RENAME, "dtype_map": STOCK_DTYPES,
        "raw_header": "CANTIDAD",
    },
}

PII_PATTERN = re.compile(
    r"RODRIGUEZ|ROJAS|bibiroba|absPath|Company|creator|lastModifiedBy",
    re.IGNORECASE,
)


class SheetNameMismatch(ValueError):
    """Raised when workbook sheets differ from the declared configuration."""


def compute_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def snake_case(name: str) -> str:
    normalised = unicodedata.normalize("NFKD", name)
    ascii_name = "".join(char for char in normalised if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "_", ascii_name.lower()).strip("_")


def is_blank(value: Any) -> bool:
    return value is None or pd.isna(value) or (isinstance(value, str) and not value.strip())


def normalise_text(value: Any) -> str | None:
    if is_blank(value):
        return None
    text = str(value).replace("\xa0", " ").strip()
    return text or None


def coerce_value(value: Any, kind: str) -> Any:
    if is_blank(value):
        return None
    if kind == "int":
        return int(float(value))
    if kind == "float4":
        return round(float(value or 0.0), 4)
    return normalise_text(value)


def load_xlsx(xlsx_path: Path) -> dict[str, pd.DataFrame]:
    if not xlsx_path.is_file():
        raise FileNotFoundError(xlsx_path)
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    configured = set(SHEET_CONFIG)
    actual = set(wb.sheetnames)
    if configured != actual:
        raise SheetNameMismatch(
            f"missing={sorted(configured - actual)} extra={sorted(actual - configured)}"
        )

    frames: dict[str, pd.DataFrame] = {}
    for sheet_name in sorted(SHEET_CONFIG, key=snake_case):
        cfg = SHEET_CONFIG[sheet_name]
        frame = pd.read_excel(
            xlsx_path,
            sheet_name=sheet_name,
            header=cfg["header_offset"],
            skipfooter=cfg["skipfooter"],
            dtype=object,
            engine="openpyxl",
        )
        if cfg.get("drop_empty_trailing"):
            frame = frame.dropna(axis="columns", how="all")
        expected = list(cfg["dtype_map"])
        missing = [column for column in expected if column not in frame.columns]
        if missing:
            raise SheetNameMismatch(f"sheet={sheet_name!r} missing columns={missing}")
        frame = frame.loc[:, expected]
        for raw_column, kind in cfg["dtype_map"].items():
            frame[raw_column] = frame[raw_column].map(lambda value, k=kind: coerce_value(value, k))
        frame = frame.rename(columns=cfg["header_rename"])
        frame["raw_header"] = cfg["raw_header"]
        frames[snake_case(sheet_name)] = frame
    return frames


def find_pii_sheet(frames: dict[str, pd.DataFrame]) -> str | None:
    for table_name, frame in frames.items():
        for value in frame.to_numpy().flat:
            if isinstance(value, str) and PII_PATTERN.search(value):
                return table_name
    return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="build_bodegas_sqlite")
    parser.add_argument("--xlsx", type=Path, default=Path("docs/sources/bodegas-y-stock.xlsx"))
    parser.add_argument("--out", type=Path, default=Path("data/bodegas-y-stock.sqlite"))
    parser.add_argument("--dry-run", action="store_true", help="parse and count without writing")
    parser.add_argument("--check", action="store_true", help="reserved for T4")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.check:
        print("ERROR: --check is not implemented yet", file=sys.stderr)
        return EXIT_BAD_SOURCE
    try:
        frames = load_xlsx(args.xlsx)
    except FileNotFoundError:
        print(f"ERROR: xlsx not found: {args.xlsx}", file=sys.stderr)
        return EXIT_BAD_SOURCE
    except (SheetNameMismatch, OSError, ValueError) as exc:
        print(f"ERROR: cannot parse xlsx: {type(exc).__name__}", file=sys.stderr)
        return EXIT_BAD_SOURCE

    pii_sheet = find_pii_sheet(frames)
    if pii_sheet:
        print(f"ERROR: sensitive metadata detected in sheet {pii_sheet}", file=sys.stderr)
        return EXIT_BAD_SOURCE
    for table_name in sorted(frames):
        print(f"{table_name}={len(frames[table_name])}")
    print(f"Σ={sum(len(frame) for frame in frames.values())}")
    if args.dry_run:
        return EXIT_OK
    print("ERROR: database writing is not implemented yet", file=sys.stderr)
    return EXIT_SQLITE_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
