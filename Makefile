PY   ?= uv run python
XLSX ?= docs/sources/bodegas-y-stock.xlsx
OUT  ?= data/bodegas-y-stock.sqlite

.PHONY: build-sqlite

build-sqlite:
	uv sync
	@echo "SQLite builder will be added in T2."
