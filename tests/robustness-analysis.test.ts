/**
 * Tests for robustness analysis adapter functions.
 *
 * Validates:
 * - Edge normalization from ISL mixed formats
 * - Fragile edges (objects) to NormalizedEdgeInfo
 * - Robust edges (strings) to NormalizedEdgeInfo
 * - Defensive handling of unexpected formats
 */

import { describe, it, expect } from 'vitest';
import {
  adaptRobustnessAnalysisResponse,
  createFallbackRobustnessAnalysis,
  createLocalHeuristicResult,
} from '../src/integrations/isl/adapters/robustness-analysis.js';
import type { ISLRobustnessAnalyzeV2Response } from '../src/integrations/isl/types/isl-types.js';
import type { EdgeSensitivityEntry } from '../src/integrations/isl/types/plot-types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

const MOCK_ISL_RESPONSE: ISLRobustnessAnalyzeV2Response = {
  request_id: 'test-123',
  robustness: {
    score: 0.7,
    label: 'moderate',
    fragile_edges: [
      {
        edge_id: 'fac_price->goal_revenue',
        from_id: 'fac_price',
        to_id: 'goal_revenue',
        switch_probability: 0.3,
        marginal_switch_probability: 0.15,
      },
    ],
    robust_edges: ['fac_quality->goal_revenue', 'fac_market::goal_revenue'],
  },
  sensitivity: [],
  factor_sensitivity: [],
};

// =============================================================================
// Edge Normalization Tests
// =============================================================================

describe('Edge Normalization in adaptRobustnessAnalysisResponse', () => {
  it('normalizes fragile_edges from objects to NormalizedEdgeInfo', () => {
    const result = adaptRobustnessAnalysisResponse(
      MOCK_ISL_RESPONSE,
      100,
      'available',
      'available',
      'test-request-123'
    );

    expect(result.fragile_edges).toHaveLength(1);
    const fragile = result.fragile_edges[0];
    expect(fragile.edge_id).toBe('fac_price->goal_revenue');
    expect(fragile.from_id).toBe('fac_price');
    expect(fragile.to_id).toBe('goal_revenue');
    expect(fragile.switch_probability).toBe(0.3);
    expect(fragile.marginal_switch_probability).toBe(0.15);
  });

  it('normalizes robust_edges from strings to NormalizedEdgeInfo', () => {
    const result = adaptRobustnessAnalysisResponse(
      MOCK_ISL_RESPONSE,
      100,
      'available',
      'available',
      'test-request-123'
    );

    expect(result.robust_edges).toHaveLength(2);

    // Arrow format
    const robust1 = result.robust_edges[0];
    expect(robust1.edge_id).toBe('fac_quality->goal_revenue');
    expect(robust1.from_id).toBe('fac_quality');
    expect(robust1.to_id).toBe('goal_revenue');
    // ROADMAP 2.160: switch_probability is OMITTED for string-format edges.
    // This used to assert `1` with the comment "Robust = full stability" — which
    // read the scale BACKWARDS. Higher switch_probability means MORE fragile, so
    // `1` labelled these robust edges maximally fragile. A bare "from->to"
    // string carries no measurement, and absent is the honest representation.
    expect(robust1.switch_probability).toBeUndefined();

    // Double-colon format
    const robust2 = result.robust_edges[1];
    expect(robust2.edge_id).toBe('fac_market::goal_revenue');
    expect(robust2.from_id).toBe('fac_market');
    expect(robust2.to_id).toBe('goal_revenue');
    expect(robust2.switch_probability).toBeUndefined();
  });

  it('handles missing robustness data gracefully', () => {
    const emptyResponse: ISLRobustnessAnalyzeV2Response = {
      request_id: 'test-empty',
    };

    const result = adaptRobustnessAnalysisResponse(
      emptyResponse,
      100,
      'available',
      'available',
      'test-request-123'
    );

    expect(result.fragile_edges).toEqual([]);
    expect(result.robust_edges).toEqual([]);
    // CORRECTED AT SOURCE (ROADMAP 1.240, sibling 2). This asserted
    // `overall_robustness === 'moderate'` and `robustness_score === 0.5` for an
    // ISL response that carried NO robustness object at all — i.e. it pinned a
    // robustness VERDICT about the user's graph manufactured from silence, and
    // a score indistinguishable from a measured midpoint. "Handles missing data
    // gracefully" turned out to mean "invents an answer". Absence is now
    // absence; the assertions are inverted rather than deleted.
    expect(result).not.toHaveProperty('overall_robustness');
    expect(result).not.toHaveProperty('robustness_score');
    // The rest of the adaptation still happens — no over-suppression.
    expect(result.edges_provenance).toBe('isl:/api/v1/robustness/analyze/v2');
    expect(result.source).toBe('isl');
  });

  it('handles fragile edges with missing from_id/to_id by parsing edge_id', () => {
    const response: ISLRobustnessAnalyzeV2Response = {
      robustness: {
        fragile_edges: [
          { edge_id: 'nodeA->nodeB' }, // No from_id/to_id
        ],
      },
    };

    const result = adaptRobustnessAnalysisResponse(
      response,
      100,
      'available',
      'available',
      'test-request-123'
    );

    expect(result.fragile_edges).toHaveLength(1);
    expect(result.fragile_edges[0].from_id).toBe('nodeA');
    expect(result.fragile_edges[0].to_id).toBe('nodeB');
    // sp-less ISL fragile edge: switch_probability is OMITTED, not fabricated 0
    // (absent ≠ 0 — a fabricated 0 fabricates severity + doctrine-013 visible).
    expect(result.fragile_edges[0].switch_probability).toBeUndefined();
  });

  it('a NULL marginal_switch_probability is omitted, not forwarded to egress', () => {
    // `normalizeFragileEdge` used to spread this field on `!== undefined`, so a
    // null passed straight through to egress, where @talchain/schemas types it
    // `z.number().optional()` and a null FAILS validation. Its immediate
    // neighbour switch_probability already guarded with `isFiniteNumber`; this
    // pins the asymmetry closed.
    //
    // Not reachable on the pinned V2 path (ISL's V2 handler serialises with a
    // recursive `exclude_none=True`, and PLoT pins `?response_version=2` on
    // every call — client.ts:98/:180), so this is defence-in-depth against the
    // day that pin changes. A null is what the LEGACY v1 format sends.
    const response = {
      robustness: {
        fragile_edges: [
          {
            edge_id: 'nodeA->nodeB',
            switch_probability: 0.3,
            marginal_switch_probability: null,
          },
        ],
      },
    } as unknown as ISLRobustnessAnalyzeV2Response;

    const result = adaptRobustnessAnalysisResponse(
      response,
      100,
      'available',
      'available',
      'test-request-msp-null'
    );

    expect(result.fragile_edges).toHaveLength(1);
    // The finite neighbour still survives — this is an omission, not a wipe.
    expect(result.fragile_edges[0].switch_probability).toBe(0.3);
    expect(result.fragile_edges[0].marginal_switch_probability).toBeUndefined();
    expect('marginal_switch_probability' in result.fragile_edges[0]).toBe(false);
  });

  it('tracks normalization errors for malformed edges', () => {
    const response: ISLRobustnessAnalyzeV2Response = {
      robustness: {
        fragile_edges: [
          { edge_id: 'valid->edge' },
          123 as unknown as any, // Invalid: number instead of object/string
        ],
        robust_edges: [
          'valid->edge',
          { not_edge_id: 'missing edge_id' } as unknown as any, // Invalid: missing edge_id
        ],
      },
    };

    const result = adaptRobustnessAnalysisResponse(
      response,
      100,
      'available',
      'available',
      'test-request-456'
    );

    // Should have normalized valid edges
    expect(result.fragile_edges).toHaveLength(1);
    expect(result.robust_edges).toHaveLength(1);

    // Should have tracked errors
    expect(result.normalization_errors).toBeDefined();
    expect(result.normalization_errors).toHaveLength(2);
    expect(result.normalization_errors![0].edge_type).toBe('fragile');
    expect(result.normalization_errors![1].edge_type).toBe('robust');
  });

  it('omits normalization_errors when all edges are valid', () => {
    const result = adaptRobustnessAnalysisResponse(
      MOCK_ISL_RESPONSE,
      100,
      'available',
      'available',
      'test-request-123'
    );

    expect(result.normalization_errors).toBeUndefined();
  });
});

// =============================================================================
// Fallback Function Tests
// =============================================================================

describe('createFallbackRobustnessAnalysis', () => {
  it('returns empty normalized edge arrays', () => {
    const result = createFallbackRobustnessAnalysis('ISL unavailable');

    expect(result.fragile_edges).toEqual([]);
    expect(result.robust_edges).toEqual([]);
    // CORRECTED AT SOURCE (ROADMAP 1.240): the ISL-UNAVAILABLE fallback used to
    // return `overall_robustness: 'moderate'`, indistinguishable from a genuine
    // ISL 'moderate'. Nothing was computed, so no verdict is stated; `source`
    // carries the refusal machine-readably.
    expect(result).not.toHaveProperty('overall_robustness');
    expect(result.source).toBe('unavailable');
  });
});

describe('createLocalHeuristicResult', () => {
  it('converts edge sensitivity to NormalizedEdgeInfo format', () => {
    const localEdges: EdgeSensitivityEntry[] = [
      {
        edge_id: 'fac_price::goal',
        from: 'fac_price',
        to: 'goal',
        elasticity: 0.8, // High = fragile
        interpretation: 'High sensitivity',
      },
      {
        edge_id: 'fac_stable::goal',
        from: 'fac_stable',
        to: 'goal',
        elasticity: 0.1, // Low = robust
        interpretation: 'Low sensitivity',
      },
    ];

    const result = createLocalHeuristicResult(localEdges, 50);

    // High elasticity (0.8 > 0.5) → fragile
    expect(result.fragile_edges).toHaveLength(1);
    expect(result.fragile_edges[0].edge_id).toBe('fac_price::goal');
    expect(result.fragile_edges[0].from_id).toBe('fac_price');
    expect(result.fragile_edges[0].to_id).toBe('goal');
    // switch_probability is OMITTED (ROADMAP 2.165a). This assertion previously
    // read `.toBeCloseTo(0.2, 5) // 1 - 0.8` — it PINNED an inverted scale: the
    // edge is here *because* |elasticity| > 0.5 makes it fragile, and higher
    // switch_probability means MORE fragile, so 0.2 was the fragile edge being
    // described as nearly stable. An elasticity heuristic is not a switch
    // probability; absent means NOT COMPUTED. See numeric-safety-deep-scan §D4.
    expect(result.fragile_edges[0]).not.toHaveProperty('switch_probability');

    // Low elasticity (0.1 <= 0.2) → robust
    expect(result.robust_edges).toHaveLength(1);
    expect(result.robust_edges[0].edge_id).toBe('fac_stable::goal');
    // Was `.toBe(1)` — the maximum of the FRAGILITY scale, asserted on the arm
    // selected for being robust. Same fabrication #290 removed from
    // normalizeRobustEdge, in a second location.
    expect(result.robust_edges[0]).not.toHaveProperty('switch_probability');
  });
});

// =============================================================================
// V2 Format (Option C) Tests
// =============================================================================

describe('V2/Option C format handling', () => {
  it('maps level to label correctly', () => {
    const highResponse: ISLRobustnessAnalyzeV2Response = {
      robustness: { level: 'high', confidence: 0.9 },
    };
    const result = adaptRobustnessAnalysisResponse(highResponse, 100, 'available', 'available');
    expect(result.overall_robustness).toBe('robust');
    expect(result.robustness_score).toBe(0.9);
  });

  it('maps medium level to moderate', () => {
    const mediumResponse: ISLRobustnessAnalyzeV2Response = {
      robustness: { level: 'medium', confidence: 0.6 },
    };
    const result = adaptRobustnessAnalysisResponse(mediumResponse, 100, 'available', 'available');
    expect(result.overall_robustness).toBe('moderate');
  });

  it('maps low/very_low level to fragile', () => {
    const lowResponse: ISLRobustnessAnalyzeV2Response = {
      robustness: { level: 'low', confidence: 0.3 },
    };
    const result = adaptRobustnessAnalysisResponse(lowResponse, 100, 'available', 'available');
    expect(result.overall_robustness).toBe('fragile');

    const veryLowResponse: ISLRobustnessAnalyzeV2Response = {
      robustness: { level: 'very_low', confidence: 0.1 },
    };
    const result2 = adaptRobustnessAnalysisResponse(veryLowResponse, 100, 'available', 'available');
    expect(result2.overall_robustness).toBe('fragile');
  });
});
