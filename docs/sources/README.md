# Source documents

Every document referenced by [`../prd.md`](../prd.md) and [`../prd-seed.md`](../prd-seed.md) is
vendored here, so the PRD is self-contained and reviewable without access to the shared drive.

Files were renamed to ASCII, hyphenated names for git and cross-platform safety. Contents are
byte-identical to the originals.

| Repo file | Original name | Original location |
| --- | --- | --- |
| `meet-define-project.md` | `meet_define_project.md` | workspace root |
| `prd-draft-es.md` | `PRD_contador_inventario_voz.md` | workspace root |
| `anexo-prd-draft.docx` | `PRD_requerimientos_casos_uso_QA.md.docx` | workspace root and `04 Hotelería/` (identical, md5 `c121f267…`) |
| `doble-diamante-problema-solucion.docx` | `Doble Diamante — Problema y Solución.docx` | `04 Hotelería/` |
| `discovery-consolidado.xlsx` | `Discovery — Consolidado (Reto Hotelería).xlsx` | `04 Hotelería/` |
| `bodegas-y-stock.xlsx` | `BODEGAS Y STOCK.xlsx` | `04 Hotelería/` |

## Deliberately not vendored

The challenge Q&A channel transcript is **not** included here. It is a shared group with many
third-party participants, and republishing it would expose their names and phone numbers. The
answers Colsubsidio gave about the inventory process are carried forward in [`../prd.md`](../prd.md)
§11, attributed but not quoted from the channel.

## Notes on individual sources

**`meet-define-project.md`** — Gemini notes plus the full verbatim transcript of "Let's define the
flow and tech", 2026-07-23, 01:43:15. Machine-generated and contains transcription errors:
"Cloud" for Claude, "RP"/"LP" for ERP, "Jason" for JSON, "supace" for Supabase. `../prd-seed.md`
extracts it with timestamps.

**`prd-draft-es.md`** — the Spanish PRD draft that `../prd.md` was built from. Kept as the source of
record; the two share RF/RNF/CU/QA identifiers so they can be read side by side.

**`bodegas-y-stock.xlsx`** — the real dataset. The percentages quoted in the PRD (~5.6% negative
balances, ~18% of items without a unique code, ~23% with decimals) come from the Spanish draft's
analysis and **have not been recomputed in this repository** — no spreadsheet tooling was available.
See `../prd.md` §13.17.

**`discovery-consolidado.xlsx`** and **`doble-diamante-problema-solucion.docx`** — research artefacts
referenced in the meeting as the origin of the proposed flow and the double-diamond framing. Vendored
for completeness; not quoted directly in the PRD.
