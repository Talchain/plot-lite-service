/**
 * Confidence tier classification (B1).
 *
 * Maps M1 coaching readiness state to UI-facing confidence tier.
 * Vocabulary matches UI useResultsSectionData.ts `mapReadinessLevel()`.
 */

import type { Readiness } from '../coaching/types.js';

export type ConfidenceTier = 'strong' | 'fair' | 'needs_work';

/**
 * Derive UI confidence tier from M1 coaching readiness state.
 * - 'ready' → 'strong'
 * - 'close_call' → 'fair'
 * - 'needs_evidence' | 'needs_framing' → 'needs_work'
 */
export function deriveConfidenceTier(readiness: Readiness): ConfidenceTier {
  switch (readiness) {
    case 'ready': return 'strong';
    case 'close_call': return 'fair';
    case 'needs_evidence':
    case 'needs_framing':
      return 'needs_work';
  }
}
