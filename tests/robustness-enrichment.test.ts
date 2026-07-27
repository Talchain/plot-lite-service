/**
 * Tests for robustness data enrichment functions.
 *
 * Validates:
 * - Edge ID parsing for various formats
 * - Label enrichment with valid graph
 * - Label fallback when node not found (use ID)
 * - Full robustness data building
 */

import { describe, it, expect } from 'vitest';
import {
  parseEdgeFrom,
  parseEdgeTo,
  getNodeLabel,
  getOptionLabel,
  enrichFragileEdge,
  enrichRobustEdge,
  enrichFactorSensitivity,
  buildRobustnessDataForCee,
} from '../src/integrations/isl/adapters/robustness-enrichment.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const TEST_GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'fac_price', kind: 'factor', label: 'Price' },
    { id: 'fac_market_size', kind: 'factor', label: 'Market Size' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue Goal' },
    { id: 'out_sales', kind: 'outcome', label: 'Sales Volume' },
  ],
  edges: [
    { from: 'fac_price', to: 'out_sales', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'fac_market_size', to: 'goal_revenue', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
  ],
};

const TEST_OPTIONS: OptionV3[] = [
  { id: 'opt_premium', label: 'Premium Pricing', interventions: { fac_price: { value: 99, source: 'user_specified' } } },
  { id: 'opt_economy', label: 'Economy Pricing', interventions: { fac_price: { value: 49, source: 'user_specified' } } },
];

// =============================================================================
// Edge ID Parsing Tests
// =============================================================================

describe('parseEdgeFrom', () => {
  it('parses arrow format "from->to"', () => {
    expect(parseEdgeFrom('fac_price->goal_revenue')).toBe('fac_price');
  });

  it('parses double-colon format "from::to"', () => {
    expect(parseEdgeFrom('fac_price::goal_revenue')).toBe('fac_price');
  });

  it('returns full string if no separator', () => {
    expect(parseEdgeFrom('fac_price')).toBe('fac_price');
  });

  it('handles empty string', () => {
    expect(parseEdgeFrom('')).toBe('');
  });
});

describe('parseEdgeTo', () => {
  it('parses arrow format "from->to"', () => {
    expect(parseEdgeTo('fac_price->goal_revenue')).toBe('goal_revenue');
  });

  it('parses double-colon format "from::to"', () => {
    expect(parseEdgeTo('fac_price::goal_revenue')).toBe('goal_revenue');
  });

  it('returns full string if no separator', () => {
    expect(parseEdgeTo('fac_price')).toBe('fac_price');
  });

  it('handles empty string', () => {
    expect(parseEdgeTo('')).toBe('');
  });
});

// =============================================================================
// Label Lookup Tests
// =============================================================================

describe('getNodeLabel', () => {
  it('returns label for existing node', () => {
    expect(getNodeLabel(TEST_GRAPH, 'fac_price')).toBe('Price');
    expect(getNodeLabel(TEST_GRAPH, 'goal_revenue')).toBe('Revenue Goal');
  });

  it('falls back to ID when node not found', () => {
    expect(getNodeLabel(TEST_GRAPH, 'nonexistent_node')).toBe('nonexistent_node');
  });
});

describe('getOptionLabel', () => {
  it('returns label for existing option', () => {
    expect(getOptionLabel(TEST_OPTIONS, 'opt_premium')).toBe('Premium Pricing');
    expect(getOptionLabel(TEST_OPTIONS, 'opt_economy')).toBe('Economy Pricing');
  });

  it('falls back to ID when option not found', () => {
    expect(getOptionLabel(TEST_OPTIONS, 'nonexistent_option')).toBe('nonexistent_option');
  });
});

// =============================================================================
// Enrichment Function Tests
// =============================================================================

describe('enrichFragileEdge', () => {
  it('enriches string edge ID format', () => {
    const result = enrichFragileEdge('fac_price->goal_revenue', TEST_GRAPH, TEST_OPTIONS);

    expect(result).toEqual({
      edge_id: 'fac_price->goal_revenue',
      from_id: 'fac_price',
      to_id: 'goal_revenue',
      from_label: 'Price',
      to_label: 'Revenue Goal',
    });
  });

  it('enriches structured edge format with alternative_winner', () => {
    const structuredEdge = {
      edge_id: 'fac_price->goal_revenue',
      from_id: 'fac_price',
      to_id: 'goal_revenue',
      alternative_winner_id: 'opt_economy',
      switch_probability: 0.34,
    };

    const result = enrichFragileEdge(structuredEdge, TEST_GRAPH, TEST_OPTIONS);

    expect(result).toEqual({
      edge_id: 'fac_price->goal_revenue',
      from_id: 'fac_price',
      to_id: 'goal_revenue',
      from_label: 'Price',
      to_label: 'Revenue Goal',
      alternative_winner_id: 'opt_economy',
      alternative_winner_label: 'Economy Pricing',
      switch_probability: 0.34,
    });
  });

  it('handles double-colon format', () => {
    const result = enrichFragileEdge('fac_price::goal_revenue', TEST_GRAPH, TEST_OPTIONS);

    expect(result.from_id).toBe('fac_price');
    expect(result.to_id).toBe('goal_revenue');
  });

  it('falls back to IDs when nodes not found', () => {
    const result = enrichFragileEdge('unknown_from->unknown_to', TEST_GRAPH, TEST_OPTIONS);

    expect(result.from_label).toBe('unknown_from');
    expect(result.to_label).toBe('unknown_to');
  });
});

describe('enrichRobustEdge', () => {
  it('enriches edge with labels', () => {
    const result = enrichRobustEdge('fac_market_size->goal_revenue', TEST_GRAPH);

    expect(result).toEqual({
      edge_id: 'fac_market_size->goal_revenue',
      from_label: 'Market Size',
      to_label: 'Revenue Goal',
    });
  });
});

describe('enrichFactorSensitivity', () => {
  it('enriches factor sensitivity with label', () => {
    const factor = {
      node_id: 'fac_price',
      sensitivity: 0.85,
      value_of_information: 0.42,
      direction: 'negative' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result).toEqual({
      factor_id: 'fac_price',
      factor_label: 'Price',
      sensitivity: 0.85,
      value_of_information: 0.42,
      direction: 'negative',
    });
  });

  it('prefers sensitivity_score over legacy sensitivity', () => {
    const factor = {
      node_id: 'fac_price',
      sensitivity_score: 0.90,
      sensitivity: 0.85,
      direction: 'negative' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result.sensitivity).toBe(0.90);
  });

  it('uses sensitivity_score when legacy sensitivity is absent', () => {
    const factor = {
      node_id: 'fac_price',
      sensitivity_score: 0.75,
      direction: 'positive' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result.sensitivity).toBe(0.75);
  });

  // CORRECTED AT SOURCE (ROADMAP 1.240, sibling 1). This test previously read
  // `defaults to 0 when neither sensitivity_score nor sensitivity is present`
  // and asserted `result.sensitivity === 0`. It PINNED the fabrication: a
  // factor ISL said nothing about was published as a factor measured to have
  // ZERO influence on the decision. Absent is not zero, so the assertion is
  // inverted rather than deleted — deleting it would leave the behaviour
  // unpinned in the other direction.
  it('OMITS sensitivity when neither sensitivity_score nor sensitivity is present (absent ≠ 0)', () => {
    const factor = {
      node_id: 'fac_price',
      direction: 'positive' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result).not.toHaveProperty('sensitivity');
    expect(result.sensitivity).toBeUndefined();
    // ... and the rest of the entry is still built (no over-suppression).
    expect(result.factor_id).toBe('fac_price');
    expect(result.direction).toBe('positive');
  });

  it('OMITS sensitivity when ISL sends it as null (the shape a wire absence takes)', () => {
    // JSON has no `undefined`; an absent numeric field arrives as `null` or as
    // a missing key. Both must behave identically here.
    const asNull = enrichFactorSensitivity(
      { node_id: 'fac_price', sensitivity_score: null as any, sensitivity: null as any },
      TEST_GRAPH,
    );
    expect(asNull).not.toHaveProperty('sensitivity');
  });

  it('OMITS sensitivity when ISL sends a non-finite value (NaN / ±Infinity)', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = enrichFactorSensitivity(
        { node_id: 'fac_price', sensitivity_score: bad },
        TEST_GRAPH,
      );
      expect(r, `sensitivity_score=${bad} must not reach egress`).not.toHaveProperty('sensitivity');
    }
  });

  it('POSITIVE CONTROL: a genuine measured ZERO is preserved, not suppressed', () => {
    // Over-suppression is an equal failure. `0` is a real measurement meaning
    // "this factor genuinely does not move the outcome" and must survive.
    const result = enrichFactorSensitivity(
      { node_id: 'fac_price', sensitivity_score: 0 },
      TEST_GRAPH,
    );
    expect(result).toHaveProperty('sensitivity');
    expect(result.sensitivity).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // VOI sanitisation on the internal robustness-enrichment builder (Howard 1966
  // non-negative contract). Mirrors the guard already applied by the three
  // sibling surfaces (mapIslFactorEntry, adaptFactorSensitivityResponse,
  // adaptRobustnessAnalysis). Forward-safe hardening: this builder result is
  // NOT consumed by any outbound CEE request today (buildCeeReviewRequest reads
  // only fragile_edges; CeeReviewRequest has no VOI field).
  // ---------------------------------------------------------------------------

  it('preserves a positive finite VOI verbatim', () => {
    const factor = {
      node_id: 'fac_price',
      sensitivity: 0.85,
      value_of_information: 0.42,
      direction: 'negative' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result.value_of_information).toBe(0.42);
  });

  it('preserves an explicit VOI of 0 (missing-vs-zero distinction)', () => {
    // VOI = 0 is a valid ISL result ("perfect information would not change the
    // recommendation") and must be preserved, NOT coerced to undefined.
    const factor = {
      node_id: 'fac_price',
      sensitivity: 0.4,
      value_of_information: 0,
      direction: 'positive' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result.value_of_information).toBe(0);
  });

  it('sanitises a negative VOI to undefined (Monte Carlo artefact)', () => {
    const factor = {
      node_id: 'fac_price',
      sensitivity: 0.4,
      value_of_information: -0.07,
      direction: 'negative' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result.value_of_information).toBeUndefined();
  });

  it('sanitises NaN, Infinity and -Infinity VOI to undefined', () => {
    for (const voi of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const factor = {
        node_id: 'fac_price',
        sensitivity: 0.4,
        value_of_information: voi,
        direction: 'positive' as const,
      };

      const result = enrichFactorSensitivity(factor, TEST_GRAPH);

      expect(result.value_of_information).toBeUndefined();
    }
  });

  it('leaves an absent VOI absent', () => {
    const factor = {
      node_id: 'fac_price',
      sensitivity: 0.4,
      direction: 'positive' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result.value_of_information).toBeUndefined();
  });
});

// =============================================================================
// Full Build Function Tests
// =============================================================================

describe('buildRobustnessDataForCee', () => {
  it('returns null when no robustness data', () => {
    const result = buildRobustnessDataForCee(undefined, undefined, undefined, TEST_GRAPH, TEST_OPTIONS);
    expect(result).toBeNull();
  });

  it('returns null when robustness is empty object', () => {
    const result = buildRobustnessDataForCee({}, [], undefined, TEST_GRAPH, TEST_OPTIONS);
    expect(result).toBeNull();
  });

  it('returns null when ONLY recommendation_stability is present (item B: no longer meaningful data)', () => {
    // recommendation_stability is the leader's win_probability relabelled —
    // it neither counts as meaningful robustness data nor gets forwarded.
    const result = buildRobustnessDataForCee(
      { recommendation_stability: 0.87 },
      [],
      undefined,
      TEST_GRAPH,
      TEST_OPTIONS
    );
    expect(result).toBeNull();
  });

  it('builds complete robustness data with all fields', () => {
    const islRobustness = {
      recommendation_stability: 0.87,
      fragile_edges: [
        {
          edge_id: 'fac_price->goal_revenue',
          from_id: 'fac_price',
          to_id: 'goal_revenue',
          alternative_winner_id: 'opt_economy',
          switch_probability: 0.34,
          marginal_switch_probability: 0.18,
        },
      ],
      robust_edges: ['fac_market_size->goal_revenue'],
    };

    const islFactorSensitivity = [
      {
        node_id: 'fac_price',
        sensitivity: 0.85,
        value_of_information: 0.42,
        direction: 'negative' as const,
      },
    ];

    const result = buildRobustnessDataForCee(
      islRobustness,
      islFactorSensitivity,
      'opt_premium',
      TEST_GRAPH,
      TEST_OPTIONS
    );

    expect(result).not.toBeNull();
    // Item B (producer honesty): recommendation_stability is NO LONGER
    // forwarded — ISL derives it as option_wins[winner]/n_samples (the
    // leader's win_probability relabelled), zero independent information.
    expect(result!.recommendation_stability).toBeUndefined();
    expect(result!.recommended_option).toEqual({
      id: 'opt_premium',
      label: 'Premium Pricing',
    });
    expect(result!.fragile_edges).toHaveLength(1);
    expect(result!.fragile_edges[0].alternative_winner_label).toBe('Economy Pricing');
    expect(result!.fragile_edges[0].marginal_switch_probability).toBe(0.18);
    expect(result!.robust_edges).toHaveLength(1);
    expect(result!.robust_edges[0].from_label).toBe('Market Size');
    expect(result!.factor_sensitivity).toHaveLength(1);
    expect(result!.factor_sensitivity![0].factor_label).toBe('Price');
  });

  it('handles string fragile_edges format', () => {
    const islRobustness = {
      fragile_edges: ['fac_price->goal_revenue'],
      robust_edges: [],
    };

    const result = buildRobustnessDataForCee(
      islRobustness,
      undefined,
      undefined,
      TEST_GRAPH,
      TEST_OPTIONS
    );

    expect(result).not.toBeNull();
    expect(result!.fragile_edges[0].from_label).toBe('Price');
    expect(result!.fragile_edges[0].to_label).toBe('Revenue Goal');
  });

  it('includes data even when recommended_option_id is missing', () => {
    const islRobustness = {
      fragile_edges: ['fac_price->goal_revenue'],
      robust_edges: [],
    };

    const result = buildRobustnessDataForCee(
      islRobustness,
      undefined,
      undefined,
      TEST_GRAPH,
      TEST_OPTIONS
    );

    expect(result).not.toBeNull();
    expect(result!.recommended_option).toBeUndefined();
    expect(result!.fragile_edges).toHaveLength(1);
  });

  it('sanitises a negative VOI while preserving a positive sibling in the builder result', () => {
    // End-to-end through the buildRobustnessDataForCee builder (an internal
    // enrichment result; not consumed by the outbound CEE request today): a
    // negative MC artefact must become undefined, while a valid positive VOI on
    // a sibling factor is preserved verbatim.
    const islRobustness = {
      recommendation_stability: 0.87,
      fragile_edges: ['fac_price->goal_revenue'],
      robust_edges: [],
    };

    const islFactorSensitivity = [
      {
        node_id: 'fac_price',
        sensitivity: 0.85,
        value_of_information: -0.07, // MC sampling artefact → must sanitise to undefined
        direction: 'negative' as const,
      },
      {
        node_id: 'fac_market_size',
        sensitivity: 0.6,
        value_of_information: 0.42, // valid → preserved
        direction: 'positive' as const,
      },
    ];

    const result = buildRobustnessDataForCee(
      islRobustness,
      islFactorSensitivity,
      'opt_premium',
      TEST_GRAPH,
      TEST_OPTIONS
    );

    expect(result).not.toBeNull();
    const byId = new Map(result!.factor_sensitivity!.map((f) => [f.factor_id, f]));
    expect(byId.get('fac_price')!.value_of_information).toBeUndefined();
    expect(byId.get('fac_market_size')!.value_of_information).toBe(0.42);
  });
});
