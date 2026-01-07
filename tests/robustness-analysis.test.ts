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
      'available'
    );

    expect(result.fragile_edges).toHaveLength(1);
    const fragile = result.fragile_edges[0];
    expect(fragile.edge_id).toBe('fac_price->goal_revenue');
    expect(fragile.from_id).toBe('fac_price');
    expect(fragile.to_id).toBe('goal_revenue');
    expect(fragile.switch_probability).toBe(0.3);
  });

  it('normalizes robust_edges from strings to NormalizedEdgeInfo', () => {
    const result = adaptRobustnessAnalysisResponse(
      MOCK_ISL_RESPONSE,
      100,
      'available',
      'available'
    );

    expect(result.robust_edges).toHaveLength(2);

    // Arrow format
    const robust1 = result.robust_edges[0];
    expect(robust1.edge_id).toBe('fac_quality->goal_revenue');
    expect(robust1.from_id).toBe('fac_quality');
    expect(robust1.to_id).toBe('goal_revenue');
    expect(robust1.switch_probability).toBe(1); // Robust = full stability

    // Double-colon format
    const robust2 = result.robust_edges[1];
    expect(robust2.edge_id).toBe('fac_market::goal_revenue');
    expect(robust2.from_id).toBe('fac_market');
    expect(robust2.to_id).toBe('goal_revenue');
    expect(robust2.switch_probability).toBe(1);
  });

  it('handles missing robustness data gracefully', () => {
    const emptyResponse: ISLRobustnessAnalyzeV2Response = {
      request_id: 'test-empty',
    };

    const result = adaptRobustnessAnalysisResponse(
      emptyResponse,
      100,
      'available',
      'available'
    );

    expect(result.fragile_edges).toEqual([]);
    expect(result.robust_edges).toEqual([]);
    expect(result.overall_robustness).toBe('moderate');
    expect(result.robustness_score).toBe(0.5);
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
      'available'
    );

    expect(result.fragile_edges).toHaveLength(1);
    expect(result.fragile_edges[0].from_id).toBe('nodeA');
    expect(result.fragile_edges[0].to_id).toBe('nodeB');
    expect(result.fragile_edges[0].switch_probability).toBe(0); // Default for fragile
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
    expect(result.overall_robustness).toBe('moderate');
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
    expect(result.fragile_edges[0].switch_probability).toBeCloseTo(0.2, 5); // 1 - 0.8

    // Low elasticity (0.1 <= 0.2) → robust
    expect(result.robust_edges).toHaveLength(1);
    expect(result.robust_edges[0].edge_id).toBe('fac_stable::goal');
    expect(result.robust_edges[0].switch_probability).toBe(1);
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
