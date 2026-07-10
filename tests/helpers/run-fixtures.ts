/**
 * Shared /v2/run test fixtures (review [16]: previously duplicated
 * near-identically in v2-typed-failure-envelope.test.ts and
 * v2-evidence-provenance.test.ts — a request-contract change had to be
 * edited in both copies or one suite silently exercised a stale body).
 *
 * NOTE: files that build their ISL mock inside vi.hoisted() cannot import
 * this module there (hoisted blocks run before imports resolve) — those
 * keep a local response builder and reference this file in a comment.
 */

/** Minimal valid /v2/run request body (2 options — schema minimum). */
export function makeValidRunBody(extra: Record<string, unknown> = {}) {
  return {
    graph: {
      nodes: [
        { id: 'factor-0', kind: 'factor', label: 'Factor 0', observed_state: { value: 0.5 } },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-0', to: 'goal', exists_probability: 0.8, strength: { mean: 0.3, std: 0.05 } },
      ],
    },
    options: [
      { id: 'opt-a', label: 'Option A', interventions: { 'factor-0': { value: 0.8, source: 'user_specified' } } },
      { id: 'opt-b', label: 'Option B', interventions: { 'factor-0': { value: 0.2, source: 'user_specified' } } },
    ],
    goal_node_id: 'goal',
    seed: '42',
    ...extra,
  };
}

/** Deterministic computed ISL response; `meanA` varies semantic content. */
export function makeComputedIslResponse(meanA = 0.7) {
  return {
    analysis_status: 'computed',
    seed_used: 42,
    options: [
      {
        option_id: 'opt-a',
        outcome: { mean: meanA, std: 0.05, p10: meanA - 0.1, p50: meanA, p90: meanA + 0.1, n_samples: 100, n_valid_samples: 100, validity_ratio: 1.0 },
        win_probability: 0.7,
        status: 'computed',
      },
      {
        option_id: 'opt-b',
        outcome: { mean: 0.4, std: 0.05, p10: 0.3, p50: 0.4, p90: 0.5, n_samples: 100, n_valid_samples: 100, validity_ratio: 1.0 },
        win_probability: 0.3,
        status: 'computed',
      },
    ],
    factor_sensitivity: [],
    robustness: { confidence: 0.8, level: 'high', is_robust: true, fragile_edges: [], robust_edges: [] },
    inference_warnings: [],
  };
}
