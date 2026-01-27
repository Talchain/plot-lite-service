/**
 * Golden Fixtures - Data Alignment & Regression Tests
 *
 * Purpose: Catch boundary drift and regression in CI before it reaches staging.
 * Validates data alignment across ISL -> PLoT -> UI pipeline.
 *
 * Scenario: pricing-canary
 * Decision: Keep £49 vs Raise to £59
 * CEE mode: Skipped (tests graph-supplied path)
 * Captured: 2026-01-24 from debug bundle 97985a35
 */

import { describe, it, expect } from 'vitest';
import { loadScenario } from './fixtures.js';

// Load fixtures from contracts/examples/
const { islResponse, plotResponse } = loadScenario('pricing-canary');

// Type definitions for fixture data
interface FragileEdge {
  edge_id: string;
  from_id: string;
  to_id: string;
  switch_probability: number | null;
  marginal_switch_probability: number;
  alternative_winner_id: string | null;
  alternative_winner_label?: string | null;
}

interface FactorSensitivity {
  factor_id?: string;
  node_id?: string;
  factor_label?: string;
  label?: string;
  confidence?: number;
  value_of_information?: number;
  flip_risk_category?: string;
  source?: string;
}

interface OptionResult {
  option_id?: string;
  id?: string;
  win_probability: number;
  outcome: {
    mean: number;
    std: number;
  };
}

describe('Golden Fixtures - Pricing Canary', () => {
  // =============================================================================
  // TIER 1: PASSTHROUGH (ISL -> PLoT)
  // Validates that ISL computation results pass through PLoT unchanged
  // =============================================================================
  describe('Tier 1: ISL -> PLoT Passthrough', () => {
    // Build ID-keyed maps for comparison
    const islEdgeMap = new Map<string, FragileEdge>(
      (islResponse.robustness.fragile_edges as FragileEdge[]).map((e) => [e.edge_id, e])
    );

    it('marginal_switch_probability passes through by edge ID', () => {
      (plotResponse.robustness.fragile_edges as FragileEdge[]).forEach((plotEdge) => {
        const islEdge = islEdgeMap.get(plotEdge.edge_id);
        expect(islEdge, `edge ${plotEdge.edge_id} not found in ISL response`).toBeDefined();
        expect(plotEdge.marginal_switch_probability).toBe(islEdge!.marginal_switch_probability);
      });
    });

    it('switch_probability passes through by edge ID', () => {
      (plotResponse.robustness.fragile_edges as FragileEdge[]).forEach((plotEdge) => {
        const islEdge = islEdgeMap.get(plotEdge.edge_id);
        expect(plotEdge.switch_probability).toBe(islEdge!.switch_probability);
      });
    });

    it('recommendation_stability passes through', () => {
      expect(plotResponse.robustness.recommendation_stability).toBe(
        islResponse.robustness.recommendation_stability
      );
    });

    it('recommended_option_id matches winner from win_probability', () => {
      // Winner is argmax(option_comparison[].win_probability)
      const options = plotResponse.option_comparison as OptionResult[];
      const maxWinProb = Math.max(...options.map((o) => o.win_probability));
      const winner = options.find((o) => o.win_probability === maxWinProb);

      expect(plotResponse.robustness.recommended_option_id).toBe(winner?.option_id ?? winner?.id);
    });

    it('recommended_option_label is present and non-empty', () => {
      expect(plotResponse.robustness.recommended_option_label).toBeDefined();
      expect(typeof plotResponse.robustness.recommended_option_label).toBe('string');
      expect((plotResponse.robustness.recommended_option_label as string).length).toBeGreaterThan(0);
    });

    it('near_tie object is present in robustness', () => {
      expect(plotResponse.robustness.near_tie).toBeDefined();
    });

    it('near_tie.is_tie = false for wide gap (45.5%)', () => {
      expect(plotResponse.robustness.near_tie.is_tie).toBe(false);
    });

    it('near_tie.gap = 0.455 (72.75% - 27.25%)', () => {
      expect(plotResponse.robustness.near_tie.gap).toBe(0.455);
    });

    it('near_tie.threshold = 0.1 (10%)', () => {
      expect(plotResponse.robustness.near_tie.threshold).toBe(0.1);
    });

    it('near_tie.top_option_id matches recommended_option_id', () => {
      expect(plotResponse.robustness.near_tie.top_option_id).toBe(
        plotResponse.robustness.recommended_option_id
      );
    });

    it('near_tie.tied_option_ids contains only top option for non-tie', () => {
      expect(plotResponse.robustness.near_tie.tied_option_ids).toHaveLength(1);
      expect(plotResponse.robustness.near_tie.tied_option_ids[0]).toBe(
        plotResponse.robustness.near_tie.top_option_id
      );
    });
  });

  // =============================================================================
  // TIER 2: SEMANTIC VALIDITY
  // Validates that output values are mathematically coherent
  // =============================================================================
  describe('Tier 2: Semantic Validity', () => {
    it('meta.computed_at is valid ISO 8601 timestamp', () => {
      const meta = plotResponse.meta as { computed_at?: string };
      expect(meta.computed_at).toBeDefined();
      expect(typeof meta.computed_at).toBe('string');

      // Validate ISO 8601 format
      const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/;
      expect(meta.computed_at).toMatch(isoPattern);

      // Validate it parses to a valid date
      const parsed = new Date(meta.computed_at as string);
      expect(Number.isNaN(parsed.getTime())).toBe(false);
    });
    it('win_probability sums to ~1', () => {
      const sum = (plotResponse.option_comparison as OptionResult[]).reduce(
        (s, o) => s + o.win_probability,
        0
      );
      expect(sum).toBeGreaterThanOrEqual(0.98);
      expect(sum).toBeLessThanOrEqual(1.02);
    });

    it('confidence values in [0, 1]', () => {
      (plotResponse.factor_sensitivity as FactorSensitivity[]).forEach((f) => {
        if (f.confidence !== undefined) {
          expect(f.confidence).toBeGreaterThanOrEqual(0);
          expect(f.confidence).toBeLessThanOrEqual(1);
        }
      });
    });

    it('value_of_information values in [0, 1]', () => {
      (plotResponse.factor_sensitivity as FactorSensitivity[]).forEach((f) => {
        if (f.value_of_information !== undefined) {
          expect(f.value_of_information).toBeGreaterThanOrEqual(0);
          expect(f.value_of_information).toBeLessThanOrEqual(1);
        }
      });
    });

    it('VOI != confidence for at least one factor (canary prerequisite: max MSP > 0.01)', () => {
      // This assertion is conditional on the scenario being a valid canary
      // If max MSP <= 0.01, VOI may legitimately equal confidence
      const maxMsp = Math.max(
        ...(plotResponse.robustness.fragile_edges as FragileEdge[]).map(
          (e) => e.marginal_switch_probability
        )
      );

      if (maxMsp > 0.01) {
        const hasDiff = (plotResponse.factor_sensitivity as FactorSensitivity[]).some(
          (f) => f.value_of_information !== f.confidence
        );
        expect(
          hasDiff,
          'Expected VOI != confidence for at least one factor in canary scenario'
        ).toBe(true);
      }
    });

    it('flip_risk_category present and valid', () => {
      const validCategories = ['isolated', 'correlated', 'negligible'];
      (plotResponse.factor_sensitivity as FactorSensitivity[]).forEach((f) => {
        if (f.flip_risk_category !== undefined) {
          expect(validCategories).toContain(f.flip_risk_category);
        }
      });
    });

    it('all factor_sensitivity have source: graph', () => {
      (plotResponse.factor_sensitivity as FactorSensitivity[]).forEach((f) => {
        expect(f.source).toBe('graph');
      });
    });

    it('outcomes in reasonable range [-100, 100]', () => {
      (plotResponse.option_comparison as OptionResult[]).forEach((o) => {
        expect(o.outcome.mean).toBeGreaterThanOrEqual(-100);
        expect(o.outcome.mean).toBeLessThanOrEqual(100);
      });
    });
  });

  // =============================================================================
  // TIER 3: SUBSET CONSISTENCY
  // Validates structural alignment across boundaries using ID-based checks
  // =============================================================================
  describe('Tier 3: Subset Consistency', () => {
    it('PLoT fragile edges subset of ISL fragile edges (by ID)', () => {
      const islEdgeIds = new Set(
        (islResponse.robustness.fragile_edges as FragileEdge[]).map((e) => e.edge_id)
      );
      (plotResponse.robustness.fragile_edges as FragileEdge[]).forEach((plotEdge) => {
        expect(islEdgeIds.has(plotEdge.edge_id), `PLoT edge ${plotEdge.edge_id} not found in ISL`).toBe(
          true
        );
      });
    });

    it('PLoT option IDs subset of ISL option IDs', () => {
      const islOptionIds = new Set((islResponse.options as OptionResult[]).map((o) => o.id || o.option_id));
      (plotResponse.option_comparison as OptionResult[]).forEach((plotOpt) => {
        const optId = plotOpt.option_id || plotOpt.id;
        expect(islOptionIds.has(optId), `PLoT option ${optId} not found in ISL`).toBe(true);
      });
    });

    it('ISL factors subset of PLoT factors (PLoT may enrich from graph)', () => {
      // PLoT can add factors from graph that weren't in ISL computation
      // But ISL factors should all appear in PLoT
      const plotFactorIds = new Set(
        (plotResponse.factor_sensitivity as FactorSensitivity[]).map((f) => f.factor_id || f.node_id)
      );
      (islResponse.factor_sensitivity as FactorSensitivity[]).forEach((islFactor) => {
        const factorId = islFactor.node_id || islFactor.factor_id;
        expect(plotFactorIds.has(factorId), `ISL factor ${factorId} not found in PLoT`).toBe(true);
      });
    });
  });

  // =============================================================================
  // TIER 4: CANARY QUALIFICATION
  // Ensures the fixture remains a valid regression trap
  // =============================================================================
  describe('Tier 4: Canary Qualification', () => {
    it('max(marginal_switch_probability) > 0.01', () => {
      // This ensures the fixture exercises fragility detection
      // A too-stable fixture would miss marginal_switch_probability bugs
      const maxMsp = Math.max(
        ...(plotResponse.robustness.fragile_edges as FragileEdge[]).map(
          (e) => e.marginal_switch_probability
        )
      );
      expect(
        maxMsp,
        'Fixture is too stable - canary requires max MSP > 0.01 to catch fragility bugs'
      ).toBeGreaterThan(0.01);
    });

    it('has fragile edges (robustness analysis exercised)', () => {
      expect(plotResponse.robustness.fragile_edges.length).toBeGreaterThan(0);
    });

    it('has factor sensitivity (drivers analysis exercised)', () => {
      expect(plotResponse.factor_sensitivity.length).toBeGreaterThan(0);
    });
  });
});
