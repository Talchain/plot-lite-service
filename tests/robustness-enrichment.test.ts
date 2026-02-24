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

  it('defaults to 0 when neither sensitivity_score nor sensitivity is present', () => {
    const factor = {
      node_id: 'fac_price',
      direction: 'positive' as const,
    };

    const result = enrichFactorSensitivity(factor, TEST_GRAPH);

    expect(result.sensitivity).toBe(0);
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
    expect(result!.recommendation_stability).toBe(0.87);
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
});
