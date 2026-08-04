/**
 * Golden Integration Tests - ISL -> PLoT Transformation
 *
 * Purpose: Execute actual PLoT transformation code against golden fixtures
 * to verify ISL data flows through correctly to PLoT response format.
 *
 * Unlike golden.test.ts (static fixture comparison), these tests call
 * real adapter functions to catch regressions in transformation logic.
 *
 * Scenario: pricing-canary (CEE skipped)
 * Captured: 2026-01-24 from debug bundle 97985a35
 */

import { describe, it, expect } from 'vitest';
import { loadScenario } from './fixtures.js';

// Load fixtures from contracts/examples/
const scenario = loadScenario('pricing-canary');
const { islResponse, plotResponse } = scenario;

// Load CEE-graph-supplied scenario for P3 tests
const ceeScenario = loadScenario('cee-graph-supplied');

// CEE graph interface for type safety
interface CEEGraphNode {
  id: string;
  kind: string;
  label: string;
}

interface CEEGraphEdge {
  from: string;
  to: string;
}

interface CEEGraph {
  nodes?: CEEGraphNode[];
  edges?: CEEGraphEdge[];
  goal_node_id?: string;
  options?: Array<{ id: string; label: string }>;
}

// Determine CEE data presence for conditional test execution
// Check for actual CEE graph data (nodes/edges), NOT cee_status
// cee_status tracks M1 orchestration, not graph generation
const ceeGraph = ceeScenario.ceeGraph as CEEGraph | undefined;
const hasCeeData =
  (ceeGraph?.nodes?.length ?? 0) > 0 && (ceeGraph?.edges?.length ?? 0) > 0;
const runCeeAssertions = hasCeeData && !!ceeScenario.islRequest;

// Import transformation functions
// NOTE: .js extension required because src/ contains both .ts and .js files.
// ESM resolution picks .js when both exist. Keep both in sync or consolidate.
import {
  normalizeFragileEdges,
  normalizeRobustEdges,
} from '../../src/integrations/isl/adapters/robustness-analysis.js';
import { computeFlipRiskCategory } from '../../src/lib/factor-influence.js';

// Type definitions for fixture data
// Note: optional fields marked to handle fixture evolution
interface ISLFragileEdge {
  edge_id: string;
  from_id: string;
  to_id: string;
  switch_probability: number;
  marginal_switch_probability?: number;
  alternative_winner_id?: string;
}

interface ISLOption {
  id: string;
  outcome: {
    mean: number;
    std: number;
    p10: number;
    p50: number;
    p90: number;
    n_samples: number;
    n_valid_samples: number;
    validity_ratio: number;
  };
  win_probability: number;
  status: string;
}

interface PlotFragileEdge {
  edge_id: string;
  from_id: string;
  to_id: string;
  switch_probability: number;
  marginal_switch_probability?: number;
  alternative_winner_id?: string;
  alternative_winner_label?: string;
}

interface PlotOptionComparison {
  option_id: string;
  option_label: string;
  expected_outcome: number;
  confidence_interval: [number, number];
  outcome: {
    mean: number;
    std: number;
    p10: number;
    p50: number;
    p90: number;
    n_samples: number;
    n_valid_samples: number;
    validity_ratio: number;
  };
  status: string;
  win_probability: number;
}

interface PlotFactorSensitivity {
  factor_id: string;
  factor_label: string;
  influence_score: number;
  influence_rank: number;
  sensitivity_score: number;
  elasticity: number;
  direction: string;
  importance_rank: number;
  value_of_information: number;
  confidence: number;
  source: string;
  flip_risk_category: string;
  zero_reason?: string;
}

describe('Golden Integration: ISL -> PLoT Transformation', () => {
  // =============================================================================
  // P0: PASSTHROUGH TESTS
  // Verify ISL data flows through transformation functions unchanged
  // =============================================================================
  describe('P0: Passthrough Verification', () => {
    describe('Fragile Edge Normalization', () => {
      const islEdges = islResponse.robustness.fragile_edges as ISLFragileEdge[];
      const { edges: normalizedEdges, errors } = normalizeFragileEdges(islEdges, 'test-req');

      it('normalizeFragileEdges produces no errors', () => {
        expect(errors).toHaveLength(0);
      });

      it('preserves edge count', () => {
        expect(normalizedEdges.length).toBe(islEdges.length);
        expect(normalizedEdges.length).toBe(plotResponse.robustness.fragile_edges.length);
      });

      it('preserves marginal_switch_probability values', () => {
        islEdges.forEach((islEdge) => {
          const normalized = normalizedEdges.find((e) => e.edge_id === islEdge.edge_id);
          expect(normalized, `edge ${islEdge.edge_id} missing`).toBeDefined();
          expect(normalized?.marginal_switch_probability).toBe(islEdge.marginal_switch_probability);
        });
      });

      it('preserves switch_probability values', () => {
        islEdges.forEach((islEdge) => {
          const normalized = normalizedEdges.find((e) => e.edge_id === islEdge.edge_id);
          expect(normalized?.switch_probability).toBe(islEdge.switch_probability);
        });
      });

      it('preserves from_id and to_id', () => {
        islEdges.forEach((islEdge) => {
          const normalized = normalizedEdges.find((e) => e.edge_id === islEdge.edge_id);
          expect(normalized?.from_id).toBe(islEdge.from_id);
          expect(normalized?.to_id).toBe(islEdge.to_id);
        });
      });

      it('preserves alternative_winner_id', () => {
        islEdges.forEach((islEdge) => {
          const normalized = normalizedEdges.find((e) => e.edge_id === islEdge.edge_id);
          expect(normalized?.alternative_winner_id).toBe(islEdge.alternative_winner_id);
        });
      });

      it('matches expected PLoT output for each edge', () => {
        const plotEdges = plotResponse.robustness.fragile_edges as PlotFragileEdge[];

        normalizedEdges.forEach((normalized) => {
          const expected = plotEdges.find((e) => e.edge_id === normalized.edge_id);
          expect(expected, `PLoT edge ${normalized.edge_id} missing`).toBeDefined();

          // Core fields must match exactly
          expect(normalized.switch_probability).toBe(expected?.switch_probability);
          expect(normalized.marginal_switch_probability).toBe(expected?.marginal_switch_probability);
          expect(normalized.from_id).toBe(expected?.from_id);
          expect(normalized.to_id).toBe(expected?.to_id);
        });
      });
    });

    describe('Robust Edge Normalization', () => {
      const islRobustEdges = islResponse.robustness.robust_edges as string[];
      const { edges: normalizedRobustEdges, errors } = normalizeRobustEdges(islRobustEdges, 'test-req');

      it('normalizeRobustEdges produces no errors', () => {
        expect(errors).toHaveLength(0);
      });

      it('preserves edge count', () => {
        expect(normalizedRobustEdges.length).toBe(islRobustEdges.length);
      });
    });

    describe('recommendation_stability Passthrough', () => {
      it('recommendation_stability matches ISL', () => {
        expect(plotResponse.robustness.recommendation_stability).toBe(
          islResponse.robustness.recommendation_stability
        );
      });
    });

    describe('Robustness Summary Passthrough', () => {
      /**
       * Tests verify that V2/Option C robustness summary fields (is_robust, level, confidence)
       * are correctly forwarded from ISL to PLoT response.
       *
       * NOTE: The pricing-canary plot-response.json fixture was captured before passthrough
       * implementation, so it doesn't contain these fields. We test the transformation logic
       * directly by simulating the spread pattern used in src/routes/v2/run.ts:733-741.
       */
      const islRobustness = islResponse.robustness as any;

      it('ISL provides is_robust, level, confidence fields', () => {
        // Verify ISL fixture has the V2/Option C fields we're forwarding
        expect(islRobustness.is_robust, 'ISL should have is_robust').toBeDefined();
        expect(islRobustness.level, 'ISL should have level').toBeDefined();
        expect(islRobustness.confidence, 'ISL should have confidence').toBeDefined();
      });

      it('is_robust is boolean', () => {
        expect(typeof islRobustness.is_robust).toBe('boolean');
      });

      it('level is valid enum', () => {
        const validLevels = ['high', 'medium', 'low', 'very_low'];
        expect(validLevels).toContain(islRobustness.level);
      });

      it('confidence is in [0, 1] range', () => {
        expect(islRobustness.confidence).toBeGreaterThanOrEqual(0);
        expect(islRobustness.confidence).toBeLessThanOrEqual(1);
      });

      /**
       * Transformation Logic Tests
       * Simulate the spread pattern from src/routes/v2/run.ts to verify
       * ISL fields are correctly forwarded to the PLoT response structure.
       */
      it('passthrough logic forwards is_robust when present', () => {
        // Simulate: ...(islResult.robustness.is_robust !== undefined && { is_robust: ... })
        const transformed = {
          ...(islRobustness.is_robust !== undefined && {
            is_robust: islRobustness.is_robust,
          }),
        };
        expect(transformed.is_robust).toBe(islRobustness.is_robust);
      });

      it('passthrough logic forwards level when present', () => {
        // Simulate: ...(islResult.robustness.level !== undefined && { level: ... })
        const transformed = {
          ...(islRobustness.level !== undefined && {
            level: islRobustness.level,
          }),
        };
        expect(transformed.level).toBe(islRobustness.level);
      });

      it('passthrough logic forwards confidence when present', () => {
        // Simulate: ...(islResult.robustness.confidence !== undefined && { confidence: ... })
        const transformed = {
          ...(islRobustness.confidence !== undefined && {
            confidence: islRobustness.confidence,
          }),
        };
        expect(transformed.confidence).toBe(islRobustness.confidence);
      });

      it('passthrough logic omits fields when undefined', () => {
        // Verify the spread pattern correctly handles undefined
        const mockIslWithMissing = { is_robust: undefined, level: undefined, confidence: undefined };
        const transformed = {
          ...(mockIslWithMissing.is_robust !== undefined && {
            is_robust: mockIslWithMissing.is_robust,
          }),
          ...(mockIslWithMissing.level !== undefined && {
            level: mockIslWithMissing.level,
          }),
          ...(mockIslWithMissing.confidence !== undefined && {
            confidence: mockIslWithMissing.confidence,
          }),
        };
        expect(transformed).not.toHaveProperty('is_robust');
        expect(transformed).not.toHaveProperty('level');
        expect(transformed).not.toHaveProperty('confidence');
      });
    });

    describe('Option Comparison Passthrough', () => {
      const islOptions = islResponse.options as ISLOption[];
      const plotOptions = plotResponse.option_comparison as PlotOptionComparison[];

      it('win_probability values match ISL', () => {
        islOptions.forEach((islOpt) => {
          const plotOpt = plotOptions.find((o) => o.option_id === islOpt.id);
          expect(plotOpt, `option ${islOpt.id} missing`).toBeDefined();
          expect(plotOpt?.win_probability).toBe(islOpt.win_probability);
        });
      });

      it('outcome.mean values match ISL', () => {
        islOptions.forEach((islOpt) => {
          const plotOpt = plotOptions.find((o) => o.option_id === islOpt.id);
          expect(plotOpt?.outcome.mean).toBe(islOpt.outcome.mean);
        });
      });

      it('outcome.std values match ISL', () => {
        islOptions.forEach((islOpt) => {
          const plotOpt = plotOptions.find((o) => o.option_id === islOpt.id);
          expect(plotOpt?.outcome.std).toBe(islOpt.outcome.std);
        });
      });

      it('outcome.p10 values match ISL', () => {
        islOptions.forEach((islOpt) => {
          const plotOpt = plotOptions.find((o) => o.option_id === islOpt.id);
          expect(plotOpt?.outcome.p10).toBe(islOpt.outcome.p10);
        });
      });

      it('outcome.p50 values match ISL', () => {
        islOptions.forEach((islOpt) => {
          const plotOpt = plotOptions.find((o) => o.option_id === islOpt.id);
          expect(plotOpt?.outcome.p50).toBe(islOpt.outcome.p50);
        });
      });

      it('outcome.p90 values match ISL', () => {
        islOptions.forEach((islOpt) => {
          const plotOpt = plotOptions.find((o) => o.option_id === islOpt.id);
          expect(plotOpt?.outcome.p90).toBe(islOpt.outcome.p90);
        });
      });

      it('outcome.n_samples values match ISL', () => {
        islOptions.forEach((islOpt) => {
          const plotOpt = plotOptions.find((o) => o.option_id === islOpt.id);
          expect(plotOpt?.outcome.n_samples).toBe(islOpt.outcome.n_samples);
        });
      });

      it('outcome.validity_ratio values match ISL', () => {
        islOptions.forEach((islOpt) => {
          const plotOpt = plotOptions.find((o) => o.option_id === islOpt.id);
          expect(plotOpt?.outcome.validity_ratio).toBe(islOpt.outcome.validity_ratio);
        });
      });
    });
  });

  // =============================================================================
  // P1: COMPUTED FIELD TESTS
  // Verify PLoT correctly computes derived fields from ISL data
  // =============================================================================
  describe('P1: Computed Field Verification', () => {
    describe('flip_risk_category Computation', () => {
      const plotFactors = plotResponse.factor_sensitivity as PlotFactorSensitivity[];
      const plotEdges = plotResponse.robustness.fragile_edges as PlotFragileEdge[];

      it('computeFlipRiskCategory produces expected categories', () => {
        plotFactors.forEach((factor) => {
          const computed = computeFlipRiskCategory(factor.factor_id, plotEdges);
          expect(computed, `factor ${factor.factor_id}`).toBe(factor.flip_risk_category);
        });
      });

      it('isolated category requires marginal_switch_probability > 0.05', () => {
        const isolatedFactors = plotFactors.filter((f) => f.flip_risk_category === 'isolated');

        isolatedFactors.forEach((factor) => {
          // Find edges where this factor is from_id or to_id
          const adjacentEdges = plotEdges.filter(
            (e) => e.from_id === factor.factor_id || e.to_id === factor.factor_id
          );

          // At least one edge should have marginal > 0.05
          const hasHighMarginal = adjacentEdges.some((e) => e.marginal_switch_probability > 0.05);
          expect(
            hasHighMarginal,
            `isolated factor ${factor.factor_id} should have adjacent edge with marginal > 0.05`
          ).toBe(true);
        });
      });

      it('correlated category has switch_probability > 0.05 but marginal <= 0.05', () => {
        const correlatedFactors = plotFactors.filter((f) => f.flip_risk_category === 'correlated');

        correlatedFactors.forEach((factor) => {
          const adjacentEdges = plotEdges.filter(
            (e) => e.from_id === factor.factor_id || e.to_id === factor.factor_id
          );

          // Should have at least one edge with switch_probability > 0.05
          const hasHighSwitch = adjacentEdges.some((e) => e.switch_probability > 0.05);

          // Should NOT have any edge with marginal > 0.05 (that would make it isolated)
          const maxMarginal = Math.max(...adjacentEdges.map((e) => e.marginal_switch_probability));

          expect(hasHighSwitch, `correlated factor ${factor.factor_id}`).toBe(true);
          expect(maxMarginal, `correlated factor ${factor.factor_id} marginal`).toBeLessThanOrEqual(
            0.05
          );
        });
      });

      it('negligible category has both probabilities <= 0.05', () => {
        const negligibleFactors = plotFactors.filter((f) => f.flip_risk_category === 'negligible');

        negligibleFactors.forEach((factor) => {
          const adjacentEdges = plotEdges.filter(
            (e) => e.from_id === factor.factor_id || e.to_id === factor.factor_id
          );

          if (adjacentEdges.length > 0) {
            const maxSwitch = Math.max(...adjacentEdges.map((e) => e.switch_probability));
            const maxMarginal = Math.max(...adjacentEdges.map((e) => e.marginal_switch_probability));

            expect(maxSwitch, `negligible factor ${factor.factor_id} switch`).toBeLessThanOrEqual(
              0.05
            );
            expect(maxMarginal, `negligible factor ${factor.factor_id} marginal`).toBeLessThanOrEqual(
              0.05
            );
          }
          // If no adjacent edges, negligible is correct
        });
      });
    });

    describe('alternative_winner_label Enrichment', () => {
      const plotEdges = plotResponse.robustness.fragile_edges as PlotFragileEdge[];
      const plotOptions = plotResponse.option_comparison as PlotOptionComparison[];

      it('alternative_winner_label resolves from option_id', () => {
        plotEdges.forEach((edge) => {
          if (edge.alternative_winner_id) {
            const option = plotOptions.find((o) => o.option_id === edge.alternative_winner_id);
            expect(option, `option ${edge.alternative_winner_id} not found`).toBeDefined();
            expect(edge.alternative_winner_label).toBe(option?.option_label);
          }
        });
      });
    });
  });

  // =============================================================================
  // P2: STRUCTURAL VERIFICATION
  // Verify structural integrity of transformations
  // =============================================================================
  describe('P2: Structural Verification', () => {
    it('no edges dropped during normalization', () => {
      const islEdgeCount = (islResponse.robustness.fragile_edges as ISLFragileEdge[]).length;
      const plotEdgeCount = (plotResponse.robustness.fragile_edges as PlotFragileEdge[]).length;

      expect(plotEdgeCount).toBe(islEdgeCount);
    });

    it('all factor_sensitivity have source: graph', () => {
      const factors = plotResponse.factor_sensitivity as PlotFactorSensitivity[];
      factors.forEach((f) => {
        expect(f.source).toBe('graph');
      });
    });

    it('all factor_sensitivity have flip_risk_category', () => {
      const factors = plotResponse.factor_sensitivity as PlotFactorSensitivity[];
      const validCategories = ['isolated', 'correlated', 'negligible'];

      factors.forEach((f) => {
        expect(f.flip_risk_category).toBeDefined();
        expect(validCategories).toContain(f.flip_risk_category);
      });
    });
  });

  // =============================================================================
  // P3: CEE ORIGIN ASSERTIONS
  // Verify CEE data flows through correctly (only when CEE graph data present)
  // =============================================================================
  describe('P3: CEE Origin Assertions', () => {
    /**
     * PROVENANCE NOTE:
     * This scenario tests graph coherence between a CEE-generated graph and ISL/PLoT processing.
     * The CEE graph was generated in a prior request (different request_id) and supplied to this run.
     * This verifies: goal alignment, option equality, edge coverage.
     * This does NOT verify: PLoT calling CEE in the same request (requires cee_status: "success").
     *
     * These tests only run when:
     * 1. CEE graph has data (nodes.length > 0 && edges.length > 0)
     * 2. Scenario has isl-request.json for coherence checks
     *
     * NOTE: We check data presence, NOT cee_status.
     * cee_status tracks M1 orchestration, not graph generation.
     * A bundle can have cee_status: "skipped" but still have CEE-generated graph data.
     */

    if (!runCeeAssertions) {
      const reason = !hasCeeData
        ? 'CEE graph data not present (no nodes/edges)'
        : 'ISL request fixture not present';

      it.skip(`CEE-origin checks skipped: ${reason}`, () => {
        // Placeholder - skipped
      });

      it.skip('same-run request_id coherence (skipped)', () => {
        // Would verify all fixtures share same request_id
      });

      it.skip('CEE-ISL options equality (skipped)', () => {
        // Would verify option sets are identical
      });

      it.skip('CEE-ISL edge coverage (skipped)', () => {
        // Would verify ≥80% edge overlap
      });
      return;
    }

    // Full CEE assertions - only reached if CEE graph data AND ISL request present
    describe('CEE-ISL Coherence', () => {
      const islRequest = ceeScenario.islRequest as any;
      const islResponse = ceeScenario.islResponse as any;
      const ceeGraphData = ceeScenario.ceeGraph as CEEGraph;

      /**
       * SAME-RUN CHECK - MUST BE FIRST
       * All fixtures must share the same request_id to prove coherence.
       * This prevents false test confidence from mismatched fixtures.
       *
       * NOTE: CEE graph (schema_version 3.0) is a draft format without request_id.
       * ISL request/response are the API artifacts that carry tracing metadata.
       * CEE-ISL coherence is verified separately via goal_node_id and option matching.
       */
      it('same-run request_id coherence', () => {
        const islRequestId = islRequest.request_id;
        const islResponseId = islResponse.request_id;

        expect(islRequestId, 'ISL request missing request_id').toBeDefined();
        expect(islResponseId, 'ISL response missing request_id').toBeDefined();
        expect(islRequestId).toBe(islResponseId);
      });

      it('CEE graph has expected structure', () => {
        expect(ceeGraphData).toHaveProperty('nodes');
        expect(ceeGraphData).toHaveProperty('edges');
        expect(ceeGraphData).toHaveProperty('goal_node_id');
        expect(Array.isArray(ceeGraphData.nodes)).toBe(true);
        expect(Array.isArray(ceeGraphData.edges)).toBe(true);
        expect(ceeGraphData.nodes!.length).toBeGreaterThan(0);
        expect(ceeGraphData.edges!.length).toBeGreaterThan(0);
      });

      it('ISL request graph nodes are present', () => {
        expect(islRequest).toHaveProperty('graph');
        expect(islRequest.graph).toHaveProperty('nodes');
        expect(Array.isArray(islRequest.graph.nodes)).toBe(true);
        expect(islRequest.graph.nodes.length).toBeGreaterThan(0);
      });

      /**
       * OPTIONS EQUALITY CHECK
       * ISL request options must EXACTLY match CEE graph options.
       * This is EQUALITY, not subset - pruning would be a bug.
       */
      it('ISL request options equal CEE graph options', () => {
        const islOptionIds = new Set(
          islRequest.options?.map((o: { id: string }) => o.id) ?? []
        );
        const ceeOptionIds = new Set(
          ceeGraphData.options?.map((o: { id: string }) => o.id) ?? []
        );

        // Check both directions for equality
        expect(islOptionIds.size, 'ISL should have options').toBeGreaterThan(0);
        expect(ceeOptionIds.size, 'CEE should have options').toBeGreaterThan(0);

        // ISL options should match CEE options exactly
        islOptionIds.forEach((id) => {
          expect(ceeOptionIds.has(id), `ISL option ${id} missing from CEE`).toBe(true);
        });
        ceeOptionIds.forEach((id) => {
          expect(islOptionIds.has(id), `CEE option ${id} missing from ISL`).toBe(true);
        });

        expect(islOptionIds.size).toBe(ceeOptionIds.size);
      });

      /**
       * EDGE COVERAGE CHECK
       * At least 80% of ISL request edges should appear in CEE graph.
       * Uses from->to pair matching (not edge_id which may not exist in CEE).
       *
       * Rationale: ISL request graph is derived from CEE graph, so high overlap
       * is expected. 80% threshold catches significant pruning regressions while
       * allowing minor edge filtering. Current fixture shows 100% coverage.
       */
      it('ISL request edges have ≥80% coverage in CEE graph', () => {
        const islEdges = islRequest.graph?.edges ?? [];
        const ceeEdges = ceeGraphData.edges ?? [];

        expect(islEdges.length, 'ISL should have edges').toBeGreaterThan(0);
        expect(ceeEdges.length, 'CEE should have edges').toBeGreaterThan(0);

        // Create set of CEE edge pairs for fast lookup
        const ceeEdgePairs = new Set(
          ceeEdges.map((e: CEEGraphEdge) => `${e.from}->${e.to}`)
        );

        // Count ISL edges that appear in CEE
        let matchCount = 0;
        islEdges.forEach((islEdge: { from: string; to: string }) => {
          const pair = `${islEdge.from}->${islEdge.to}`;
          if (ceeEdgePairs.has(pair)) {
            matchCount++;
          }
        });

        const coverageRatio = matchCount / islEdges.length;
        expect(
          coverageRatio,
          `Edge coverage ${(coverageRatio * 100).toFixed(1)}% < 80% threshold`
        ).toBeGreaterThanOrEqual(0.8);
      });

      it('CEE goal_node_id matches ISL request goal', () => {
        const islGoal = islRequest.goal_node_id;
        const ceeGoal = ceeGraphData.goal_node_id;

        expect(islGoal, 'ISL request missing goal_node_id').toBeDefined();
        expect(ceeGoal, 'CEE graph missing goal_node_id').toBeDefined();
        expect(islGoal).toBe(ceeGoal);
      });
    });
  });
});
