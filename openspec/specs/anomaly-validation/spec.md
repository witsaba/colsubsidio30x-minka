# Anomaly Validation Specification

## Purpose

Server-side validation of confirmed counts against real reference data, persisting anomalies while preserving RF-18 blind counting.

## Requirements

### Requirement: REQ-AV-1 — Real reference validation

Each confirmed count MUST be validated server-side against `product_count_ranges` (atypical quantity) and `warehouse_stock_balances` (e.g. negative resulting balance) instead of hardcoded rules. (RF-25/26/27)

#### Scenario: Out-of-range count flags

- GIVEN a product whose `product_count_ranges` max is 50
- WHEN a count of 500 is confirmed
- THEN the validation verdict is anomalous with an atypical-quantity type

#### Scenario: In-range count passes

- GIVEN a count within range and balance limits
- WHEN it is validated
- THEN the verdict is clean AND no anomaly row is created

### Requirement: REQ-AV-2 — Anomaly persistence

Every anomalous verdict MUST insert a `record_anomalies` row linked to the `count_records` row, carrying the anomaly type. Resolution ("es correcto · dejar nota" or delete-and-redo) MUST be reflected on the anomaly row, not by deleting history. (RF-28)

#### Scenario: Anomaly survives reload

- GIVEN a flagged record
- WHEN the app reloads
- THEN the `record_anomalies` row still exists and links to its record

### Requirement: REQ-AV-3 — Verdict only, never the balance (RF-18)

The validation response consumed by the operator UI MUST contain only the verdict and anomaly type. It MUST NOT contain the theoretical balance, system stock, expected range bounds, or any value derived from them that reveals the system quantity. This is non-negotiable blind counting.

#### Scenario: Response payload is blind

- GIVEN a count that triggers a negative-balance anomaly
- WHEN the operator-facing validation response is inspected
- THEN it contains no `warehouse_stock_balances` value, no range bounds, and no field from which the theoretical balance can be read
