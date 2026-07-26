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
   * ASYNC (design D4) so `HttpAnomalyEngine` can answer from the server-side
   * validation route. The contract is UNIFORMLY `Promise<Anomaly | null>`, not
   * a union with the synchronous shape: a union forces every call site to prove
   * which implementation it is holding, which is exactly the coupling this seam
   * exists to remove. `FixtureAnomalyEngine`'s rules stay synchronous pure
   * functions internally; only the seam is awaited.
   */
  check(item: ConfirmableItem): Promise<Anomaly | null>;
}
