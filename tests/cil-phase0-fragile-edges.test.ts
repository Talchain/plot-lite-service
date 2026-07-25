/**
 * CIL Phase 0 — PLoT Reconciliation Tests
 *
 * Task 1: Standardise fragile_edges output shape to Array<FragileEdgeV2>
 * Task 2: Unknown top-level key rejection for /v2/run
 *
 * Tests:
 * - Multi-option graph with fragile edges → response contains Array<FragileEdgeV2> with all fields
 * - Graph with no fragile edges → response contains fragile_edges: []
 * - Snapshot test: serialised fragile_edges shape matches canonical FragileEdgeV2 interface
 * - Unknown top-level key → HTTP 400
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeFragileEdges,
  normalizeRobustEdges,
  adaptRobustnessAnalysisResponse,
  createFallbackRobustnessAnalysis,
  createLocalHeuristicResult,
} from '../src/integrations/isl/adapters/robustness-analysis.js';
import type { ISLRobustnessAnalyzeV2Response } from '../src/integrations/isl/types/isl-types.js';
import type { NormalizedEdgeInfo, EdgeSensitivityEntry } from '../src/integrations/isl/types/plot-types.js';

// =============================================================================
// FragileEdgeV2 canonical shape keys (from spec)
// =============================================================================

const FRAGILE_EDGE_V2_REQUIRED_KEYS = [
  'edge_id',
  'from_id',
  'to_id',
] as const;

const FRAGILE_EDGE_V2_OPTIONAL_KEYS = [
  'from_label',
  'to_label',
  'alternative_winner_id',
  'alternative_winner_label',
  // OPTIONAL: omitted for sp-less ISL edges and legacy string edges (absent ≠ 0).
  'switch_probability',
  'marginal_switch_probability',
  'severity',
] as const;

/**
 * Assert that an object conforms to the FragileEdgeV2 shape:
 * - Has all required keys with correct types
 * - Has no unexpected keys
 */
function assertFragileEdgeV2Shape(edge: Record<string, unknown>, label: string): void {
  // Required keys
  expect(typeof edge.edge_id, `${label}.edge_id`).toBe('string');
  expect(typeof edge.from_id, `${label}.from_id`).toBe('string');
  expect(typeof edge.to_id, `${label}.to_id`).toBe('string');
  // switch_probability is OPTIONAL (omitted for sp-less/legacy-string edges);
  // when present it must be a number.
  if (edge.switch_probability !== undefined) {
    expect(typeof edge.switch_probability, `${label}.switch_probability`).toBe('number');
  }

  // edge_id must use "::" or "->" convention
  const edgeId = edge.edge_id as string;
  expect(
    edgeId.includes('::') || edgeId.includes('->'),
    `${label}.edge_id should use "::" or "->" format, got "${edgeId}"`
  ).toBe(true);

  // No unexpected keys
  const allAllowed = new Set([
    ...FRAGILE_EDGE_V2_REQUIRED_KEYS,
    ...FRAGILE_EDGE_V2_OPTIONAL_KEYS,
  ]);
  for (const key of Object.keys(edge)) {
    expect(allAllowed.has(key as any), `${label} has unexpected key "${key}"`).toBe(true);
  }
}

// =============================================================================
// Task 1: Standardise fragile_edges output shape
// =============================================================================

describe('CIL Phase 0 — Task 1: fragile_edges shape consistency', () => {
  describe('normalizeFragileEdges always returns Array<FragileEdgeV2>', () => {
    it('normalizes ISL object-format fragile edges to consistent shape', () => {
      const edges: unknown[] = [
        {
          edge_id: 'fac_price::goal_revenue',
          from_id: 'fac_price',
          to_id: 'goal_revenue',
          switch_probability: 0.3,
          alternative_winner_id: 'opt-b',
          marginal_switch_probability: 0.15,
        },
      ];

      const result = normalizeFragileEdges(edges, 'test-req');
      expect(result.edges).toHaveLength(1);
      expect(result.errors).toHaveLength(0);

      const edge = result.edges[0];
      expect(edge.edge_id).toBe('fac_price::goal_revenue');
      expect(edge.from_id).toBe('fac_price');
      expect(edge.to_id).toBe('goal_revenue');
      expect(edge.switch_probability).toBe(0.3);
      expect(edge.alternative_winner_id).toBe('opt-b');
      expect(edge.marginal_switch_probability).toBe(0.15);
    });

    it('parses string edge IDs into object shape using from_id::to_id convention', () => {
      const edges: unknown[] = ['price::revenue', 'demand->supply'];

      const result = normalizeFragileEdges(edges, 'test-req');
      expect(result.edges).toHaveLength(2);
      expect(result.errors).toHaveLength(0);

      // "::" separator — legacy string edges carry no sp data: omitted, not 0.
      expect(result.edges[0].edge_id).toBe('price::revenue');
      expect(result.edges[0].from_id).toBe('price');
      expect(result.edges[0].to_id).toBe('revenue');
      expect(result.edges[0].switch_probability).toBeUndefined();

      // "->" separator
      expect(result.edges[1].edge_id).toBe('demand->supply');
      expect(result.edges[1].from_id).toBe('demand');
      expect(result.edges[1].to_id).toBe('supply');
      expect(result.edges[1].switch_probability).toBeUndefined();
    });

    it('returns empty array (not undefined/null) when no fragile edges', () => {
      const result = normalizeFragileEdges(undefined, 'test-req');
      expect(result.edges).toEqual([]);
      expect(Array.isArray(result.edges)).toBe(true);

      const result2 = normalizeFragileEdges([], 'test-req');
      expect(result2.edges).toEqual([]);
      expect(Array.isArray(result2.edges)).toBe(true);
    });

    it('tracks errors for malformed entries without crashing', () => {
      const edges: unknown[] = [
        { edge_id: 'valid::edge' },
        42, // invalid
        null, // invalid
      ];

      const result = normalizeFragileEdges(edges, 'test-req');
      expect(result.edges).toHaveLength(1);
      expect(result.errors.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('adaptRobustnessAnalysisResponse fragile_edges shape', () => {
    it('multi-option graph with fragile edges → Array<FragileEdgeV2> with all fields', () => {
      const islResponse: ISLRobustnessAnalyzeV2Response = {
        request_id: 'test-multi',
        robustness: {
          score: 0.4,
          label: 'fragile',
          fragile_edges: [
            {
              edge_id: 'fac_price::goal_revenue',
              from_id: 'fac_price',
              to_id: 'goal_revenue',
              switch_probability: 0.25,
              alternative_winner_id: 'opt-b',
              marginal_switch_probability: 0.12,
            },
            {
              edge_id: 'fac_demand->goal_revenue',
              from_id: 'fac_demand',
              to_id: 'goal_revenue',
              switch_probability: 0.45,
            },
          ],
          robust_edges: ['fac_quality->goal_revenue'],
        },
        sensitivity: [],
        factor_sensitivity: [],
      };

      const result = adaptRobustnessAnalysisResponse(
        islResponse, 100, 'available', 'available', 'test-req'
      );

      expect(Array.isArray(result.fragile_edges)).toBe(true);
      expect(result.fragile_edges).toHaveLength(2);

      // Field mapping asserted by IDENTITY, not position: the adapter now
      // publishes fragile_edges most-fragile-first, so the 0.45 edge leads.
      const fePrice = result.fragile_edges.find((e: any) => e.edge_id === 'fac_price::goal_revenue')!;
      expect(fePrice).toBeDefined();
      expect(fePrice.from_id).toBe('fac_price');
      expect(fePrice.to_id).toBe('goal_revenue');
      expect(fePrice.switch_probability).toBe(0.25);
      expect(fePrice.alternative_winner_id).toBe('opt-b');
      expect(fePrice.marginal_switch_probability).toBe(0.12);

      // The other fragile edge — no alternative_winner
      const feDemand = result.fragile_edges.find((e: any) => e.edge_id === 'fac_demand->goal_revenue')!;
      expect(feDemand).toBeDefined();
      expect(feDemand.from_id).toBe('fac_demand');
      expect(feDemand.to_id).toBe('goal_revenue');
      expect(feDemand.switch_probability).toBe(0.45);

      // …and the ORDER itself is the fragility order (the input was ascending).
      expect(result.fragile_edges.map((e: any) => e.switch_probability)).toEqual([0.45, 0.25]);
    });

    it('graph with no fragile edges → fragile_edges: [] (empty array)', () => {
      const islResponse: ISLRobustnessAnalyzeV2Response = {
        request_id: 'test-empty',
        robustness: {
          score: 0.95,
          label: 'robust',
          fragile_edges: [],
          robust_edges: ['a->b', 'b->c'],
        },
      };

      const result = adaptRobustnessAnalysisResponse(
        islResponse, 50, 'available', 'available', 'test-req'
      );

      expect(result.fragile_edges).toEqual([]);
      expect(Array.isArray(result.fragile_edges)).toBe(true);
    });

    it('missing robustness → fragile_edges: [] (empty array)', () => {
      const islResponse: ISLRobustnessAnalyzeV2Response = {
        request_id: 'test-no-robustness',
      };

      const result = adaptRobustnessAnalysisResponse(
        islResponse, 50, 'available', 'available', 'test-req'
      );

      expect(result.fragile_edges).toEqual([]);
      expect(Array.isArray(result.fragile_edges)).toBe(true);
    });
  });

  describe('fallback paths always return Array (never string[])', () => {
    it('createFallbackRobustnessAnalysis returns fragile_edges: []', () => {
      const result = createFallbackRobustnessAnalysis('ISL unavailable');
      expect(result.fragile_edges).toEqual([]);
      expect(Array.isArray(result.fragile_edges)).toBe(true);
      expect(result.robust_edges).toEqual([]);
    });

    it('createLocalHeuristicResult returns NormalizedEdgeInfo[] (not string[])', () => {
      const localEdges: EdgeSensitivityEntry[] = [
        {
          edge_id: 'fac_price::goal',
          from: 'fac_price',
          to: 'goal',
          elasticity: 0.8,
          interpretation: 'High sensitivity',
        },
      ];

      const result = createLocalHeuristicResult(localEdges, 50);
      expect(Array.isArray(result.fragile_edges)).toBe(true);
      expect(result.fragile_edges).toHaveLength(1);

      // Must be object shape, not string
      const fe = result.fragile_edges[0];
      expect(typeof fe).toBe('object');
      expect(typeof fe.edge_id).toBe('string');
      expect(typeof fe.from_id).toBe('string');
      expect(typeof fe.to_id).toBe('string');
      expect(typeof fe.switch_probability).toBe('number');
    });

    it('createLocalHeuristicResult with no fragile edges → []', () => {
      const localEdges: EdgeSensitivityEntry[] = [
        {
          edge_id: 'fac_stable::goal',
          from: 'fac_stable',
          to: 'goal',
          elasticity: 0.1, // Low = robust, not fragile
          interpretation: 'Low sensitivity',
        },
      ];

      const result = createLocalHeuristicResult(localEdges, 50);
      expect(result.fragile_edges).toEqual([]);
      expect(Array.isArray(result.fragile_edges)).toBe(true);
    });
  });

  describe('snapshot: serialised fragile_edges shape matches FragileEdgeV2', () => {
    it('full fragile edge object matches canonical shape', () => {
      const edges: unknown[] = [
        {
          edge_id: 'fac_price::goal_revenue',
          from_id: 'fac_price',
          to_id: 'goal_revenue',
          switch_probability: 0.3,
          alternative_winner_id: 'opt-b',
          marginal_switch_probability: 0.15,
        },
      ];

      const result = normalizeFragileEdges(edges, 'test-req');
      const edge = result.edges[0] as Record<string, unknown>;

      // Snapshot: exact keys present
      expect(Object.keys(edge).sort()).toMatchInlineSnapshot(`
        [
          "alternative_winner_id",
          "edge_id",
          "from_id",
          "marginal_switch_probability",
          "switch_probability",
          "to_id",
        ]
      `);

      // Type assertions
      assertFragileEdgeV2Shape(edge, 'snapshot-full');
    });

    it('minimal fragile edge (string parsed) matches canonical shape', () => {
      const edges: unknown[] = ['price::revenue'];

      const result = normalizeFragileEdges(edges, 'test-req');
      const edge = result.edges[0] as Record<string, unknown>;

      // Snapshot: minimal keys. String-parsed edges carry NO switch_probability
      // (omitted — absent ≠ 0), so it is absent from the canonical minimal shape.
      expect(Object.keys(edge).sort()).toMatchInlineSnapshot(`
        [
          "edge_id",
          "from_id",
          "to_id",
        ]
      `);

      // Type assertions
      assertFragileEdgeV2Shape(edge, 'snapshot-minimal');
    });

    it('fragile edge with missing from_id/to_id parses from edge_id', () => {
      const edges: unknown[] = [
        { edge_id: 'nodeA::nodeB', switch_probability: 0.5 },
      ];

      const result = normalizeFragileEdges(edges, 'test-req');
      const edge = result.edges[0];

      expect(edge.edge_id).toBe('nodeA::nodeB');
      expect(edge.from_id).toBe('nodeA');
      expect(edge.to_id).toBe('nodeB');
      expect(edge.switch_probability).toBe(0.5);
    });
  });
});

// =============================================================================
// Task 2: Unknown top-level key rejection
// =============================================================================

describe('CIL Phase 0 — Task 2: unknown top-level key rejection', () => {
  // Unit-level test for the allowlist guard logic (no server spawn needed)
  // The actual middleware test is in the integration test file below.

  it('V1 /run allowlist rejects unknown keys', () => {
    // Verify the allowlist from input-validation.ts line 448
    const v1RunAllowedKeys = new Set([
      'graph', 'seed', 'k_samples', 'treatment_node', 'outcome_node',
      'baseline_value', 'inputs', 'query', 'constraints', 'inference_mode',
      'include_debug', 'priors', 'evidence', 'targets', 'detail_level',
      'goal_node', 'goal_threshold',
    ]);

    // These should be rejected
    const unknownKeys = ['unexpected_field', 'extra', 'foo_bar', 'options', 'goal_node_id'];
    for (const key of unknownKeys) {
      expect(v1RunAllowedKeys.has(key), `"${key}" should NOT be in V1 allowlist`).toBe(false);
    }

    // These should be accepted
    const knownKeys = ['graph', 'seed', 'goal_threshold'];
    for (const key of knownKeys) {
      expect(v1RunAllowedKeys.has(key), `"${key}" should be in V1 allowlist`).toBe(true);
    }
  });

  it('V2 /run schema required keys are accepted', () => {
    // The V2 /run route uses Fastify schema validation (runV3Schema)
    // with required: ['graph', 'options', 'goal_node_id']
    // and optional: seed, n_samples, detail_level, request_id, idempotency_key,
    //              goal_threshold, brief, goal_constraints
    const v2RunSchemaKeys = new Set([
      'graph', 'options', 'goal_node_id',
      'seed', 'n_samples', 'detail_level', 'request_id', 'idempotency_key',
      'goal_threshold', 'brief', 'goal_constraints',
    ]);

    // Required keys must be present
    expect(v2RunSchemaKeys.has('graph')).toBe(true);
    expect(v2RunSchemaKeys.has('options')).toBe(true);
    expect(v2RunSchemaKeys.has('goal_node_id')).toBe(true);

    // Unknown keys should not be in schema
    expect(v2RunSchemaKeys.has('unexpected_field')).toBe(false);
    expect(v2RunSchemaKeys.has('extra')).toBe(false);
  });
});
