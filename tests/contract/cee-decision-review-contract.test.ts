/**
 * CEE Decision Review Contract Test
 *
 * Validates that PLoT's buildDecisionReviewRequest() produces payloads
 * that match CEE's /assist/v1/decision-review expected input schema.
 *
 * No HTTP calls. No mocks of CEE responses.
 * This test only checks: "does what we SEND match what they REQUIRE?"
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { buildDecisionReviewRequest } from '../../src/cee/decision-review-request.js';
import type { EngineGraphV3, OptionV3 } from '../../src/types/engine-v3.js';
import type { M1Coaching } from '../../src/coaching/types.js';

// =============================================================================
// CEE Contract Schema
// =============================================================================

// CEE contract schema — duplicated from CEE's /assist/v1/decision-review Zod validation.
// If this test fails after a CEE schema change, update this schema to match.
// If this test fails after a PLoT builder change, the builder has regressed.

const CeeDecisionReviewSchema = z.object({
  brief: z.string(),
  brief_hash: z.string(),
  graph: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        kind: z.string(),
        label: z.string(),
      }).passthrough()
    ),
    edges: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        strength: z.object({
          mean: z.number(),
          std: z.number(),
        }),
        exists_probability: z.number(),
      }).passthrough()
    ),
  }),
  isl_results: z.object({
    option_comparison: z.array(
      z.object({
        option_id: z.string(),
        option_label: z.string(),
        win_probability: z.number(),
      }).passthrough()
    ),
    factor_sensitivity: z.array(
      z.object({
        factor_id: z.string(),
        factor_label: z.string(),
        elasticity: z.number(),
      }).passthrough()
    ),
    fragile_edges: z.array(z.any()).optional(),
    robustness: z.object({
      recommendation_stability: z.number(),
    }).passthrough(),
  }),
  deterministic_coaching: z.object({
    headline_type: z.string(),
    readiness: z.string(),
    evidence_gaps: z.array(z.any()),
    model_critiques: z.array(z.any()),
  }).passthrough(),
  winner: z.object({
    id: z.string(),
    label: z.string(),
    win_probability: z.number(),
    outcome_mean: z.number().optional(),
  }).passthrough(),
  runner_up: z.object({
    id: z.string(),
    label: z.string(),
    win_probability: z.number(),
    outcome_mean: z.number().optional(),
  }).passthrough().nullable(),
  flip_threshold_data: z.array(
    z.object({
      factor_id: z.string(),
      factor_label: z.string(),
      current_value: z.number(),
      flip_value: z.number(),
      direction: z.enum(['increase', 'decrease']),
    })
  ).optional(),
  margin: z.number().optional(),
  correlation_id: z.string().optional(),
});

// Schema specifically for winner/runner_up validation
const WinnerSchema = z.object({
  id: z.string(),
  label: z.string(),
  win_probability: z.number(),
  outcome_mean: z.number().optional(),
});

// Legacy schema with option_id/option_label (should FAIL validation)
const LegacyWinnerSchema = z.object({
  option_id: z.string(),
  option_label: z.string(),
  win_probability: z.number(),
});

// =============================================================================
// Test Fixtures
// =============================================================================

const testGraph: EngineGraphV3 = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Maximize Revenue' },
    { id: 'factor_a', kind: 'factor', label: 'Market Size' },
    { id: 'factor_b', kind: 'factor', label: 'Competition' },
  ],
  edges: [
    {
      from: 'factor_a',
      to: 'goal',
      strength: { mean: 0.6, std: 0.15 },
      exists_probability: 0.9,
    },
    {
      from: 'factor_b',
      to: 'goal',
      strength: { mean: -0.4, std: 0.1 },
      exists_probability: 0.85,
    },
  ],
};

const testOptions: OptionV3[] = [
  { id: 'opt_a', label: 'Option A', interventions: { factor_a: 0.8 } },
  { id: 'opt_b', label: 'Option B', interventions: { factor_a: 0.4, factor_b: 0.6 } },
];

const testIslResult = {
  options: [
    {
      option_id: 'opt_a',
      option_label: 'Option A',
      win_probability: 0.65,
      outcome: { mean: 0.72 },
    },
    {
      option_id: 'opt_b',
      option_label: 'Option B',
      win_probability: 0.35,
      outcome: { mean: 0.58 },
    },
  ],
  factor_sensitivity: [
    // factor_a and factor_b are option-intervention targets (see testOptions)
    // → structural-union levers, filtered out of the CEE request since the
    // PR #219 review fixup. factor_c is the non-lever survivor that keeps the
    // populated factor_sensitivity entry shape under contract coverage.
    {
      factor_id: 'factor_a',
      factor_label: 'Market Size',
      elasticity: 0.45,
      confidence: 0.8,
    },
    {
      factor_id: 'factor_b',
      factor_label: 'Competition',
      elasticity: 0.25,
      confidence: 0.7,
    },
    {
      factor_id: 'factor_c',
      factor_label: 'Brand Strength',
      elasticity: 0.15,
      confidence: 0.6,
    },
  ],
  robustness: {
    recommendation_stability: 0.78,
    flip_risk_category: 'low',
    is_robust: true,
    fragile_edges: [],
  },
};

const testM1Coaching: M1Coaching = {
  readiness: 'ready',
  headline_type: 'clear_winner',
  evidence_gaps: [
    {
      factor_id: 'factor_b',
      factor_label: 'Competition',
      confidence: 0.5,
      voi_score: 0.3,
    },
  ],
  model_critiques: [
    {
      type: 'missing_factor',
      severity: 'low',
      challenge_question: 'Have you considered market timing?',
    },
  ],
};

// =============================================================================
// Tests
// =============================================================================

describe('CEE Decision Review Contract', () => {
  describe('winner/runner_up field mapping', () => {
    it('winner object passes CEE schema validation (has id, label, win_probability)', () => {
      const request = buildDecisionReviewRequest(
        'Which market strategy should we pursue?',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      const result = WinnerSchema.safeParse(request.winner);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('opt_a');
        expect(result.data.label).toBe('Option A');
        expect(result.data.win_probability).toBe(0.65);
      }
    });

    it('runner_up object passes CEE schema validation (same fields)', () => {
      const request = buildDecisionReviewRequest(
        'Which market strategy should we pursue?',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      expect(request.runner_up).not.toBeNull();
      const result = WinnerSchema.safeParse(request.runner_up);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('opt_b');
        expect(result.data.label).toBe('Option B');
        expect(result.data.win_probability).toBe(0.35);
      }
    });

    it('runner_up: null passes CEE schema validation (single-option scenarios)', () => {
      const singleOptionIslResult = {
        options: [
          {
            option_id: 'opt_a',
            option_label: 'Option A',
            win_probability: 1.0,
            outcome: { mean: 0.72 },
          },
        ],
        factor_sensitivity: testIslResult.factor_sensitivity,
        robustness: testIslResult.robustness,
      };

      const request = buildDecisionReviewRequest(
        'Single option decision',
        testGraph,
        [testOptions[0]],
        singleOptionIslResult,
        testM1Coaching
      );

      expect(request.runner_up).toBeNull();
      const schema = WinnerSchema.nullable();
      const result = schema.safeParse(request.runner_up);
      expect(result.success).toBe(true);
    });

    it('REGRESSION: request with option_id instead of id on winner FAILS CEE validation', () => {
      // This test ensures we catch regressions if someone changes field names back
      const legacyWinner = {
        option_id: 'opt_a',
        option_label: 'Option A',
        win_probability: 0.65,
      };

      // Legacy schema passes (for comparison)
      const legacyResult = LegacyWinnerSchema.safeParse(legacyWinner);
      expect(legacyResult.success).toBe(true);

      // CEE schema fails (id/label required, not option_id/option_label)
      const ceeResult = WinnerSchema.safeParse(legacyWinner);
      expect(ceeResult.success).toBe(false);
      if (!ceeResult.success) {
        const issues = ceeResult.error.issues.map((i) => i.path[0]);
        expect(issues).toContain('id');
        expect(issues).toContain('label');
      }
    });
  });

  describe('full request schema validation', () => {
    it('full request built from fixture data passes complete CEE schema validation', () => {
      const request = buildDecisionReviewRequest(
        'Which market strategy should we pursue?',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      const result = CeeDecisionReviewSchema.safeParse(request);
      if (!result.success) {
        // Log detailed errors for debugging
        console.error('Schema validation errors:', JSON.stringify(result.error.issues, null, 2));
      }
      expect(result.success).toBe(true);
    });

    it('all required top-level fields are present', () => {
      const request = buildDecisionReviewRequest(
        'Which market strategy should we pursue?',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      expect(request.brief).toBeDefined();
      expect(request.brief_hash).toBeDefined();
      expect(request.graph).toBeDefined();
      expect(request.isl_results).toBeDefined();
      expect(request.deterministic_coaching).toBeDefined();
      expect(request.winner).toBeDefined();
      expect(request.runner_up !== undefined).toBe(true); // Can be null
      expect(request.flip_threshold_data).toBeDefined();
      expect(request.margin).toBeDefined();
    });

    it('graph.nodes have required subfields', () => {
      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      for (const node of request.graph.nodes) {
        expect(node.id).toBeDefined();
        expect(typeof node.id).toBe('string');
        expect(node.label).toBeDefined();
        expect(typeof node.label).toBe('string');
        expect(node.kind).toBeDefined();
        expect(typeof node.kind).toBe('string');
      }
    });

    it('graph.edges have required subfields', () => {
      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      for (const edge of request.graph.edges) {
        expect(edge.from).toBeDefined();
        expect(typeof edge.from).toBe('string');
        expect(edge.to).toBeDefined();
        expect(typeof edge.to).toBe('string');
        expect(edge.strength).toBeDefined();
        expect(edge.strength.mean).toBeDefined();
        expect(typeof edge.strength.mean).toBe('number');
        expect(edge.strength.std).toBeDefined();
        expect(typeof edge.strength.std).toBe('number');
        expect(edge.exists_probability).toBeDefined();
        expect(typeof edge.exists_probability).toBe('number');
      }
    });

    it('isl_results.option_comparison entries have required subfields', () => {
      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      for (const option of request.isl_results.option_comparison) {
        expect(option.option_id).toBeDefined();
        expect(typeof option.option_id).toBe('string');
        expect(option.option_label).toBeDefined();
        expect(typeof option.option_label).toBe('string');
        expect(option.win_probability).toBeDefined();
        expect(typeof option.win_probability).toBe('number');
      }
    });

    it('deterministic_coaching has required subfields', () => {
      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      expect(request.deterministic_coaching.readiness).toBeDefined();
      expect(request.deterministic_coaching.headline_type).toBeDefined();
      expect(request.deterministic_coaching.evidence_gaps).toBeDefined();
      expect(Array.isArray(request.deterministic_coaching.evidence_gaps)).toBe(true);
      expect(request.deterministic_coaching.model_critiques).toBeDefined();
      expect(Array.isArray(request.deterministic_coaching.model_critiques)).toBe(true);
    });

    it('REGRESSION: deterministic_coaching uses model_critiques (not critiques)', () => {
      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      // CEE prompt expects model_critiques — verify exact field name
      expect(request.deterministic_coaching).toHaveProperty('model_critiques');
      expect((request.deterministic_coaching as any).critiques).toBeUndefined();

      // Verify critique structure
      expect(request.deterministic_coaching.model_critiques.length).toBeGreaterThan(0);
      const critique = request.deterministic_coaching.model_critiques[0];
      expect(critique).toHaveProperty('type');
      expect(critique).toHaveProperty('severity');
      expect(critique).toHaveProperty('message');
    });

    it('critique with suggested_action and targets maps to suggested_action and affected_node_ids', () => {
      const m1WithFullCritiques: M1Coaching = {
        ...testM1Coaching,
        model_critiques: [
          {
            type: 'DOMINANT_FACTOR',
            severity: 'warning',
            challenge_question: 'Is Market Size too dominant?',
            suggested_action: 'Add a competing factor to balance the model',
            targets: ['factor_a', 'factor_b'],
          },
        ],
      };

      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        testIslResult,
        m1WithFullCritiques
      );

      const critique = request.deterministic_coaching.model_critiques[0];
      expect(critique.suggested_action).toBe('Add a competing factor to balance the model');
      expect(critique.affected_node_ids).toEqual(['factor_a', 'factor_b']);
    });

    it('critique without suggested_action/targets omits keys from serialised JSON (not null)', () => {
      // testM1Coaching critiques have no suggested_action or targets
      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      const critique = request.deterministic_coaching.model_critiques[0];
      const serialised = JSON.parse(JSON.stringify(critique));

      expect('suggested_action' in serialised).toBe(false);
      expect('affected_node_ids' in serialised).toBe(false);
    });
  });

  describe('brief_hash computation', () => {
    it('brief_hash is a 16-character hex string', () => {
      const request = buildDecisionReviewRequest(
        'Test brief for hashing',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      expect(request.brief_hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('same brief produces same hash', () => {
      const brief = 'Consistent brief text';
      const request1 = buildDecisionReviewRequest(
        brief,
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );
      const request2 = buildDecisionReviewRequest(
        brief,
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      expect(request1.brief_hash).toBe(request2.brief_hash);
    });

    it('different briefs produce different hashes', () => {
      const request1 = buildDecisionReviewRequest(
        'Brief A',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );
      const request2 = buildDecisionReviewRequest(
        'Brief B',
        testGraph,
        testOptions,
        testIslResult,
        testM1Coaching
      );

      expect(request1.brief_hash).not.toBe(request2.brief_hash);
    });
  });

  describe('edge cases', () => {
    it('handles empty factor_sensitivity array', () => {
      const islResultNoSensitivity = {
        ...testIslResult,
        factor_sensitivity: [],
      };

      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        islResultNoSensitivity,
        testM1Coaching
      );

      expect(request.isl_results.factor_sensitivity).toEqual([]);
      const result = CeeDecisionReviewSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('handles missing robustness fragile_edges', () => {
      const islResultNoFragile = {
        ...testIslResult,
        robustness: {
          recommendation_stability: 0.8,
          flip_risk_category: 'low',
          is_robust: true,
          // fragile_edges omitted
        },
      };

      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        islResultNoFragile,
        testM1Coaching
      );

      expect(request.isl_results.fragile_edges).toEqual([]);
      const result = CeeDecisionReviewSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('handles empty evidence_gaps in m1_coaching', () => {
      const m1CoachingNoGaps: M1Coaching = {
        ...testM1Coaching,
        evidence_gaps: [],
      };

      const request = buildDecisionReviewRequest(
        'Test brief',
        testGraph,
        testOptions,
        testIslResult,
        m1CoachingNoGaps
      );

      expect(request.deterministic_coaching.evidence_gaps).toEqual([]);
      const result = CeeDecisionReviewSchema.safeParse(request);
      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // Flip-threshold selection guard on the legacy assembly path. The contract
  // schema only validates shape/presence, so this exercises the exclusion
  // behaviour directly.
  //
  // RULING CHANGE (PR #219 review fixup): the excluded set is the STRUCTURAL
  // UNION (any option intervenes), not just the all-options intersection. A
  // some-but-not-all-options lever must not become a CEE flip candidate
  // either — lever suppression outranks the probe-usefulness argument the old
  // intersection guard encoded.
  // ===========================================================================
  describe('flip-threshold lever exclusion (structural union)', () => {
    // The shared testGraph omits observed_state.value, which would skip every factor
    // during flip-threshold selection. Give the factors values so they are genuinely
    // eligible, then assert the union guard removes every lever and only levers.
    const graphWithValues: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Maximize Revenue' },
        { id: 'factor_a', kind: 'factor', label: 'Market Size', observed_state: { value: 0.5, belief: 0.8 } },
        { id: 'factor_b', kind: 'factor', label: 'Competition', observed_state: { value: 0.5, belief: 0.7 } },
        { id: 'factor_c', kind: 'factor', label: 'Brand Strength', observed_state: { value: 0.5, belief: 0.6 } },
      ],
      edges: testGraph.edges,
    };

    it('excludes every option-intervention target (all-options AND some-options), preserves the non-lever', () => {
      // testOptions: opt_a → {factor_a}; opt_b → {factor_a, factor_b}.
      //   factor_a is overridden by every option → excluded (as before).
      //   factor_b is overridden by only opt_b → union lever → NOW excluded.
      //   factor_c is intervened by nobody → the surviving flip candidate.
      // testIslResult.factor_sensitivity carries all three with no
      // intervention_override zero_reason, so the structural-union guard (not
      // the ISL zero_reason filter) is what removes factor_a and factor_b.
      const request = buildDecisionReviewRequest(
        'Flip-threshold exclusion unit test',
        graphWithValues,
        testOptions,
        testIslResult,
        testM1Coaching,
      );

      const flipFactorIds = request.flip_threshold_data.map((f) => f.factor_id);
      expect(flipFactorIds).toContain('factor_c');     // non-lever → eligible
      expect(flipFactorIds).not.toContain('factor_a'); // overridden by all → excluded
      expect(flipFactorIds).not.toContain('factor_b'); // some-options lever → excluded (ruling change)
    });
  });
});
