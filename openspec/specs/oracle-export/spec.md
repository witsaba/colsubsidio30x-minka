# Oracle Export Specification

## Purpose

Real Oracle export: persisted export batches and lines plus a downloadable file, replacing the no-op export modal.

## Requirements

### Requirement: REQ-OE-1 — Export batch persisted

Triggering export MUST create one `export_batches` row and one `export_lines` row per eligible record. Eligible records are non-deleted (`is_deleted = false`) records with no open anomaly. (RF-30)

#### Scenario: Batch and lines created

- GIVEN 5 eligible records and 1 soft-deleted record
- WHEN "Generar y descargar" is confirmed
- THEN one `export_batches` row exists with exactly 5 `export_lines` AND the deleted record is excluded

### Requirement: REQ-OE-2 — Downloadable file matches export_lines

The export MUST produce a downloadable file whose line content matches the persisted `export_lines` of that batch. The modal MUST NOT report success without a real batch and file. (RF-31)

#### Scenario: File content equals persisted lines

- GIVEN a generated batch
- WHEN the file is downloaded
- THEN each file line corresponds one-to-one with an `export_lines` row of that batch

#### Scenario: Failure is honest

- GIVEN the batch insert fails
- WHEN export is attempted
- THEN an error state is shown AND no download is offered AND no success copy renders
