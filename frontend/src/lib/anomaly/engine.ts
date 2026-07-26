/**
 * The Module 4 seam (REQ-OCF-5, D11).
 *
 * FROZEN by T3. Tonight `FixtureAnomalyEngine` implements this with exactly two
 * deterministic rules (mass<->volume mismatch, learned quantity ranges). A real
 * anomaly service later ships as `HttpAnomalyEngine implements AnomalyEngine`
 * with zero call-site changes, because the engine is constructor-injected via
 * `PipelineDeps`.
 */
import type { ConfirmableItem } from '../pipeline';

export interface Anomaly {
  kind: 'unidad' | 'cantidad';
  /** Verbatim Colombian Spanish from the design contract. */
  title: string;
  reason: string;
  hint: string;
}

export interface AnomalyEngine {
  /**
   * `null` means "nothing suspicious" — the common case, and the only result
   * the three script-1 items may produce (no false positives).
   *
   * WIDENED (design D4) so `HttpAnomalyEngine` can answer from the server-side
   * validation route. The result is AWAITABLE rather than strictly a `Promise`:
   * `FixtureAnomalyEngine` is a synchronous pure function and stays one, and
   * `runPipeline` awaits either shape. Forcing the fixture engine to return a
   * promise would buy nothing and would break its (still valuable) synchronous
   * rule tests.
   */
  check(item: ConfirmableItem): Anomaly | null | Promise<Anomaly | null>;
}
