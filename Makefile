PY   ?= uv run python
XLSX ?= docs/sources/bodegas-y-stock.xlsx
OUT  ?= data/bodegas-y-stock.sqlite

.PHONY: build-sqlite check-sqlite clean-sqlite

build-sqlite:
	uv sync
	$(PY) scripts/build_bodegas_sqlite.py --xlsx $(XLSX) --out $(OUT)

check-sqlite:
	uv sync
	$(PY) scripts/build_bodegas_sqlite.py --check --xlsx $(XLSX) --out $(OUT)

clean-sqlite:
	rm -f $(OUT)
