PY       ?= uv run python
XLSX     ?= docs/sources/bodegas-y-stock.xlsx
OUT      ?= data/bodegas-y-stock.sqlite
SEED_DIR ?= supabase/seed

.PHONY: build-sqlite check-sqlite clean-sqlite supabase-seed supabase-test

build-sqlite:
	uv sync
	$(PY) scripts/build_bodegas_sqlite.py --xlsx $(XLSX) --out $(OUT)

check-sqlite:
	uv sync
	$(PY) scripts/build_bodegas_sqlite.py --check --xlsx $(XLSX) --out $(OUT)

clean-sqlite:
	rm -f $(OUT)

# Regenerate the Supabase load statements from the workbook. Apply the numbered
# files in $(SEED_DIR) in order; each is idempotent. See supabase/README.md.
supabase-seed:
	uv sync
	$(PY) scripts/supabase_seed.py --xlsx $(XLSX) --out-dir $(SEED_DIR)

supabase-test:
	uv run pytest scripts/tests -q
