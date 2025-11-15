/**
 * Model Card v1.1 - Always present in responses
 */

import type { ModelCard } from './types.js';

export interface ModelCardOptions {
  seed: number;
  assumptions?: string[];
  k_samples?: number;
  downgraded?: boolean;
  downgrade_reason?: string;
  feature_flags?: Record<string, string | boolean>;
  backend?: 'scm_lite' | 'fallback';
}

/**
 * Build a Model Card v1.1 for transparent, auditable responses
 */
export function buildModelCard(options: ModelCardOptions): ModelCard {
  const {
    seed,
    assumptions = [],
    k_samples,
    downgraded = false,
    downgrade_reason,
    feature_flags = {},
    backend,
  } = options;

  // Extract active flags
  const flags_on: string[] = [];
  for (const [key, value] of Object.entries(feature_flags)) {
    if (value === '1' || value === true) {
      flags_on.push(key);
    }
  }
  // Stable order for snapshot/hash parity
  try { flags_on.sort(); } catch {}

  // Determinism note
  const determinism_note = seed > 0
    ? `Deterministic: Same seed (${seed}) guarantees identical output`
    : 'Non-deterministic: No seed provided';

  // Default assumptions if none provided
  const assumptions_summary = assumptions.length > 0
    ? assumptions
    : [
        'Linear response within ±20% of baseline',
        'Independent observations',
        'No external shocks during period',
      ];

  const card: ModelCard = {
    seed,
    assumptions_summary,
    compute_budget: {
      k_samples,
      downgraded,
      downgrade_reason,
    },
    flags_on,
    determinism_note,
  };

  // Add backend if provided
  if (backend) {
    (card as any).backend = backend;
  }

  return card;
}

/**
 * Extract feature flags from environment
 */
export function getActiveFeatureFlags(): Record<string, string | boolean> {
  return {
    FEATURE_STREAM: process.env.FEATURE_STREAM || '0',
    AUTH_ENABLED: process.env.AUTH_ENABLED || '0',
    RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== '0',
    TEST_ROUTES: process.env.TEST_ROUTES || '0',
    METRICS: process.env.METRICS || '0',
    IDENT_TAG_ENABLE: process.env.IDENT_TAG_ENABLE || '0',
    PROVENANCE_ENABLE: process.env.PROVENANCE_ENABLE || '0',
  };
}
