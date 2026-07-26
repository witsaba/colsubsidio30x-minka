/**
 * Oracle "Import Count Sequences" formatting (REQ-OE-1, RF-30, design D8).
 *
 * Pure functions only: eligibility, numbering and CSV rendering are decided
 * here, without a database, so the rules that determine what Oracle receives
 * are testable in isolation from the plumbing that persists them.
 *
 * NOTE (task 1.1 / design open question): the column layout below is the one
 * documented for `export_lines` and the `v_oracle_export_preview` view
 * (`subinventory, item, count_qty, uom, counter`). It could NOT be re-verified
 * against the live view in this apply session — the Supabase MCP tools were
 * unavailable to the executor — so it remains the documented layout, not a
 * confirmed one.
 */

export const EXPORT_COLUMNS = ['subinventory', 'item', 'count_qty', 'uom', 'counter'] as const;

/** One count, flattened out of the joins the route performs. */
export interface ExportableRecord {
  id: string;
  /** The Oracle subinventory — the warehouse code. */
  subinventory: string;
  /** The Oracle item — the product SKU. */
  item: string;
  quantity: number;
  unitCode: string | null;
  /** The operator's Oracle counter code (`profiles.counter_code`). */
  counter: string | null;
  isDeleted: boolean;
  hasOpenAnomaly: boolean;
}

export interface ExportLine {
  lineNumber: number;
  /** Kept for `export_lines.record_id`; NOT an Oracle column. */
  recordId: string;
  subinventory: string;
  item: string;
  countQty: number;
  uom: string | null;
  counter: string | null;
}

/**
 * Eligibility (RF-30): a soft-deleted record never reaches Oracle, and neither
 * does one whose anomaly the auditor has not resolved — exporting a disputed
 * figure would push an unreconciled number into the ERP.
 */
function isEligible(record: ExportableRecord): boolean {
  return !record.isDeleted && !record.hasOpenAnomaly;
}

/**
 * Numbering is applied AFTER filtering, so the sequence is contiguous: Oracle
 * rejects a count sequence with gaps, and a line number that mirrored the
 * pre-filter position would leave one behind every exclusion.
 */
export function buildExportLines(records: readonly ExportableRecord[]): ExportLine[] {
  return records.filter(isEligible).map((record, index) => ({
    lineNumber: index + 1,
    recordId: record.id,
    subinventory: record.subinventory,
    item: record.item,
    countQty: record.quantity,
    uom: record.unitCode,
    counter: record.counter,
  }));
}

/** Minimal RFC 4180 quoting: only what can break the column count. */
function csvField(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(lines: readonly ExportLine[]): string {
  const rows = lines.map((line) =>
    [line.subinventory, line.item, line.countQty, line.uom, line.counter].map(csvField).join(','),
  );
  return [EXPORT_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
