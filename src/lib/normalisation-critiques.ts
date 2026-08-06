/**
 * ROADMAP 2.645 — the ONE place a normalisation warning becomes a critique.
 *
 * `/v2/run` used to build this object inline, and in doing so DISCARDED the
 * producing normaliser's own class (`NormalisationWarning.code`), flattening
 * every class onto the single wire code `NORMALIZATION_WARNING`. The humaniser
 * then had nothing left to discriminate on and printed the option-node
 * sentence for all of them.
 *
 * The wire `code` deliberately stays `NORMALIZATION_WARNING` — it is load-bearing
 * downstream (the UI drops critiques with that code wholesale at
 * `useUnifiedActions.ts:237`; three golden fixtures pin it) — so the producer's
 * class rides on `normalisation_code`, which `addUserMessages` strips before
 * egress. Response bytes are unchanged.
 *
 * Shared by the route and by its tests so a test cannot assert against a
 * critique shape the route does not actually build (trap 16).
 */

import type { NormalisationWarning } from '../normalisation/graph-normaliser.js';
import type { CritiqueV3 } from '../types/engine-v3.js';

/** The wire code every informational normalisation warning is emitted under. */
export const NORMALISATION_CRITIQUE_WIRE_CODE = 'NORMALIZATION_WARNING';

/**
 * Build the info critique `/v2/run` emits for one informational normalisation
 * warning.
 *
 * @param warning  A repair-less warning from `normaliseGraphWithRepairs`.
 *                 Repair-BEARING warnings never reach here — they are
 *                 partitioned into `_meta.repairs_applied` instead.
 * @param id       Critique id (the route passes `randomUUID()`; injected so
 *                 this stays pure and testable).
 */
export function normalisationWarningToCritique(
  warning: NormalisationWarning,
  id: string,
): CritiqueV3 {
  return {
    id,
    code: NORMALISATION_CRITIQUE_WIRE_CODE,
    normalisation_code: warning.code,
    severity: 'info',
    message: warning.message,
    source: 'validation',
    blocks_analysis: false,
  };
}
