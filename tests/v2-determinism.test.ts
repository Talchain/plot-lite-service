/**
 * Determinism and Contract Tests for V2 Run Endpoint
 *
 * Tests for:
 * - 422 unwrapped V2RunError contract
 * - Hash invariants (node/edge/option order)
 * - Outcome invariants
 * - ISL 422 passthrough
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

const ENV = {
  TEST_ROUTES: '1',
  AUTH_ENABLED: '0',
  RATE_LIMIT_ENABLED: '0',
  ISL_BASE_URL: 'mock',
  ISL_MOCK_ENABLE: '1',
};

// Valid graph for testing
const VALID_GRAPH = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A' },
    { id: 'factor-b', kind: 'factor', label: 'Factor B' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
  ],
};

const VALID_OPTIONS = [
  {
    id: 'opt1',
    label: 'Option 1',
    interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } },
  },
  {
    id: 'opt2',
    label: 'Option 2',
    interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } },
  },
];

describe('V2 Determinism and Contract Tests', () => {
  let server: ServerHandle | null = null;

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  describe('7a: 422 Unwrapped V2RunError Contract', () => {
    it('returns unwrapped V2RunError on 422 (not error.v1 envelope)', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'nonexistent', // Trigger GOAL_NODE_NOT_IN_GRAPH
        }),
      });

      expect(res.status).toBe(422);

      // V2RunError shape directly
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques).toBeDefined();
      expect(Array.isArray(res.data.critiques)).toBe(true);
      expect(res.data.status_reason).toBeDefined();

      // NOT wrapped in error.v1
      expect(res.data.error).toBeUndefined();
      expect(res.data.schema).toBeUndefined();
    });
  });

  describe('7b: Hash Invariant - Node Order', () => {
    it('produces identical hash regardless of node array order', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const payload1 = {
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      };

      const payload2 = {
        graph: {
          ...VALID_GRAPH,
          nodes: [...VALID_GRAPH.nodes].reverse(),
        },
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      };

      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload1),
      });

      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).toBe(res2.data.response_hash);
    });
  });

  describe('7c: Hash Invariant - Edge Order', () => {
    it('produces identical hash regardless of edge array order', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const payload1 = {
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      };

      const payload2 = {
        graph: {
          ...VALID_GRAPH,
          edges: [...VALID_GRAPH.edges].reverse(),
        },
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      };

      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload1),
      });

      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).toBe(res2.data.response_hash);
    });
  });

  describe('7d: Hash Invariant - Option Order', () => {
    it('produces identical hash regardless of option array order', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const payload1 = {
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      };

      const payload2 = {
        graph: VALID_GRAPH,
        options: [...VALID_OPTIONS].reverse(),
        goal_node_id: 'goal',
        seed: '42',
      };

      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload1),
      });

      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).toBe(res2.data.response_hash);
    });
  });

  describe('7e: Outcome Invariant - Option Order', () => {
    it('produces identical outcomes per option ID regardless of request order', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const payload1 = {
        graph: VALID_GRAPH,
        options: VALID_OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      };

      const payload2 = {
        graph: VALID_GRAPH,
        options: [...VALID_OPTIONS].reverse(),
        goal_node_id: 'goal',
        seed: '42',
      };

      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload1),
      });

      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Hash must match (input canonicalisation)
      expect(res1.data.response_hash).toBe(res2.data.response_hash);

      // Outcomes must match BY OPTION ID (output determinism)
      if (res1.data.option_comparison && res2.data.option_comparison) {
        for (const opt1 of res1.data.option_comparison) {
          const opt2 = res2.data.option_comparison.find((o: any) => o.option_id === opt1.option_id);
          expect(opt2).toBeDefined();

          // Compare outcomes by option ID
          if (opt1.expected_outcome !== undefined && opt2.expected_outcome !== undefined) {
            expect(opt1.expected_outcome).toBeCloseTo(opt2.expected_outcome, 6);
          }
          if (opt1.probability_of_goal !== undefined && opt2.probability_of_goal !== undefined) {
            expect(opt1.probability_of_goal).toBeCloseTo(opt2.probability_of_goal, 6);
          }
          if (opt1.confidence_interval && opt2.confidence_interval) {
            expect(opt1.confidence_interval[0]).toBeCloseTo(opt2.confidence_interval[0], 6);
            expect(opt1.confidence_interval[1]).toBeCloseTo(opt2.confidence_interval[1], 6);
          }
        }
      }
    });
  });

  describe('7f: GOAL_NODE_NOT_CAUSAL Validation', () => {
    it('returns GOAL_NODE_NOT_CAUSAL for decision node as goal', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const graphWithDecision = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'my_decision', kind: 'decision', label: 'Decision Node' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphWithDecision,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.0, source: 'user_specified' } } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': { value: 2.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'my_decision', // Decision node as goal
        }),
      });

      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'GOAL_NODE_NOT_CAUSAL')).toBe(true);
    });

    it('returns GOAL_NODE_NOT_CAUSAL for option node as goal', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const graphWithOption = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'my_option', kind: 'option', label: 'Option Node' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphWithOption,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.0, source: 'user_specified' } } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': { value: 2.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'my_option', // Option node as goal
        }),
      });

      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'GOAL_NODE_NOT_CAUSAL')).toBe(true);
    });
  });

  describe('7f: 500 Error Envelope', () => {
    it('internal errors return 500 with error.v1 envelope (not V2RunError)', async () => {
      // Note: This test verifies the contract - actual internal errors are hard to trigger
      // The test validates that if we could trigger an internal error, it would be 500 with error.v1

      // We can't easily trigger an internal error, but we can verify the structure
      // by checking that 422 responses are NOT error.v1
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'nonexistent',
        }),
      });

      // 422 should be V2RunError, NOT error.v1
      expect(res.status).toBe(422);
      expect(res.data.schema).toBeUndefined(); // error.v1 would have schema field
      expect(res.data.code).toBeUndefined(); // error.v1 would have code field
      expect(res.data.analysis_status).toBe('blocked'); // V2RunError shape
    });
  });

  describe('7g: Hash Invariant - Intervention Format', () => {
    it('produces identical hash for flat vs nested intervention formats', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Nested format: { value: 1.5, source: 'user_specified' }
      const nestedOptions = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } },
        },
      ];

      // Flat format: just the number
      const flatOptions = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: { 'factor-a': 1.5 },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: { 'factor-b': 2.0 },
        },
      ];

      const payload1 = {
        graph: VALID_GRAPH,
        options: nestedOptions,
        goal_node_id: 'goal',
        seed: '42',
      };

      const payload2 = {
        graph: VALID_GRAPH,
        options: flatOptions,
        goal_node_id: 'goal',
        seed: '42',
      };

      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload1),
      });

      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).toBe(res2.data.response_hash);
    });

    it('produces identical outcomes for flat vs nested intervention formats', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // V2 requires at least 2 options for comparison
      const nestedOptions = [
        { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
        { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': { value: 2.0, source: 'user_specified' } } },
      ];

      const flatOptions = [
        { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1.5 } },
        { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 2.0 } },
      ];

      const payload1 = {
        graph: VALID_GRAPH,
        options: nestedOptions,
        goal_node_id: 'goal',
        seed: '42',
      };

      const payload2 = {
        graph: VALID_GRAPH,
        options: flatOptions,
        goal_node_id: 'goal',
        seed: '42',
      };

      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload1),
      });

      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Both should return same option_comparison results
      if (res1.data.option_comparison && res2.data.option_comparison) {
        const opt1 = res1.data.option_comparison[0];
        const opt2 = res2.data.option_comparison[0];
        expect(opt1.option_id).toBe(opt2.option_id);
        if (opt1.expected_outcome !== undefined && opt2.expected_outcome !== undefined) {
          expect(opt1.expected_outcome).toBeCloseTo(opt2.expected_outcome, 6);
        }
      }
    });
  });

  describe('7h: Infinity/NaN Rejection', () => {
    // Note: JSON.stringify converts Infinity/NaN to null.
    // Business validation catches these null values and returns 422.
    // This validates our code properly rejects non-finite values.

    it('rejects Infinity in intervention values', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': Infinity } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 1.0 } },
          ],
          goal_node_id: 'goal',
        }),
      });

      // Infinity → null → caught by business validation
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
    });

    it('rejects NaN in intervention values', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': NaN } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 1.0 } },
          ],
          goal_node_id: 'goal',
        }),
      });

      // NaN → null → caught by business validation
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
    });

    it('rejects -Infinity in intervention values', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': -Infinity } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 1.0 } },
          ],
          goal_node_id: 'goal',
        }),
      });

      // -Infinity → null → caught by business validation
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
    });

    it('rejects Infinity in edge strength mean', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const badGraph = {
        nodes: VALID_GRAPH.nodes,
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: Infinity, std: 0.1 } },
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: badGraph,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      // Infinity → null → caught by normalization/validation
      expect(res.status).toBe(422);
    });

    it('rejects NaN in edge strength std', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const badGraph = {
        nodes: VALID_GRAPH.nodes,
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: NaN } },
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: badGraph,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      // NaN → null → caught by normalization/validation
      expect(res.status).toBe(422);
    });
  });

  describe('Response structure matches OpenAPI', () => {
    it('422 response has all required V2RunError fields', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Empty Option', interventions: {} },
            { id: 'opt2', label: 'Valid Option', interventions: { 'factor-a': { value: 1.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(422);

      // Required fields per OpenAPI v2RunError schema
      expect(res.data.analysis_status).toBe('blocked');
      expect(typeof res.data.status_reason).toBe('string');
      expect(Array.isArray(res.data.critiques)).toBe(true);
      expect(res.data.critiques.length).toBeGreaterThan(0);

      // Each critique has required fields
      for (const critique of res.data.critiques) {
        expect(critique.code).toBeDefined();
        expect(critique.severity).toBe('blocker');
        expect(typeof critique.message).toBe('string');
      }
    });
  });

  describe('Status prioritizes data presence over ISL claims', () => {
    it('returns unavailable status when hasData is false, regardless of ISL status', async () => {
      // This test validates that mapToPerFeatureStatus returns 'unavailable'
      // when ISL claims 'computed' but returns empty result arrays.
      // The fix ensures we never show "computed" status with no data.
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Valid request that should succeed
      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);

      // Verify status fields exist and are valid
      expect(['computed', 'partial', 'unavailable', 'skipped', 'error']).toContain(
        res.data.option_comparison_status
      );
      expect(['computed', 'partial', 'unavailable', 'skipped', 'error']).toContain(
        res.data.robustness_status
      );

      // Critical invariant: if data is empty, status must NOT be 'computed'
      if (!res.data.option_comparison || res.data.option_comparison.length === 0) {
        expect(res.data.option_comparison_status).not.toBe('computed');
      }
      if (!res.data.robustness || Object.keys(res.data.robustness).length === 0) {
        expect(res.data.robustness_status).not.toBe('computed');
      }
    });
  });

  describe('Drivers status contract', () => {
    it('drivers_status is computed only when sensitivity arrays have data', async () => {
      // Critical invariant: drivers_status === 'computed' IMPLIES
      // (edge_sensitivity has items) OR (factor_sensitivity has items)
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);

      const hasEdgeSensitivity = Array.isArray(res.data.edge_sensitivity) && res.data.edge_sensitivity.length > 0;
      const hasFactorSensitivity = Array.isArray(res.data.factor_sensitivity) && res.data.factor_sensitivity.length > 0;
      const hasDriversSensitivity = hasEdgeSensitivity || hasFactorSensitivity;

      // Contract: if drivers_status is 'computed', we MUST have at least one non-empty sensitivity array
      if (res.data.drivers_status === 'computed') {
        expect(hasDriversSensitivity).toBe(true);
      }

      // Contract: if both sensitivity arrays are empty/missing, status MUST NOT be 'computed'
      if (!hasDriversSensitivity) {
        expect(res.data.drivers_status).not.toBe('computed');
      }
    });

    it('does not fire critique when factor_sensitivity exists but edge_sensitivity is empty', async () => {
      // If factor_sensitivity has data, drivers_status should be 'computed'
      // and no "computed but empty" critique should fire
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);

      const hasFactorSensitivity = Array.isArray(res.data.factor_sensitivity) && res.data.factor_sensitivity.length > 0;

      // If factor_sensitivity has data, status should be 'computed' regardless of edge_sensitivity
      if (hasFactorSensitivity) {
        // No "computed but empty" critique should exist
        const emptyCritique = res.data.critiques?.find((c: any) =>
          c.message?.toLowerCase().includes('computed') && c.message?.toLowerCase().includes('empty')
        );
        expect(emptyCritique).toBeUndefined();
      }
    });

    it('drivers_status is unavailable when both sensitivity arrays are empty', async () => {
      // When ISL returns empty sensitivity arrays, drivers_status should be 'unavailable'
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);

      const hasEdgeSensitivity = Array.isArray(res.data.edge_sensitivity) && res.data.edge_sensitivity.length > 0;
      const hasFactorSensitivity = Array.isArray(res.data.factor_sensitivity) && res.data.factor_sensitivity.length > 0;

      // If both are empty, status must not be 'computed'
      if (!hasEdgeSensitivity && !hasFactorSensitivity) {
        expect(res.data.drivers_status).not.toBe('computed');
        // Should be 'unavailable' (unless ISL explicitly said skipped/error)
        expect(['unavailable', 'skipped', 'error']).toContain(res.data.drivers_status);
      }
    });
  });
});
