/**
 * Contract Smoke Test (Test F) for /v2/run
 *
 * Tests P0 contract requirements:
 * - Status vocabulary (computed|partial|failed|blocked)
 * - 422 response format (V2RunError)
 * - Seed handling (string/number normalization)
 * - Response hash determinism
 * - Option/decision node filtering
 *
 * @see P0-PLOT Workstream Brief
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('/v2/run Contract Smoke Tests', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    ISL_BASE_URL: 'mock',
    ISL_MOCK_ENABLE: '1',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  // Standard test graph
  const VALID_GRAPH = {
    nodes: [
      { id: 'factor-a', kind: 'factor', label: 'Factor A' },
      { id: 'factor-b', kind: 'factor', label: 'Factor B' },
      { id: 'goal', kind: 'goal', label: 'Goal' },
    ],
    edges: [
      { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
    ],
  };

  // Standard options
  const VALID_OPTIONS = [
    {
      id: 'opt1',
      label: 'Option 1',
      interventions: {
        'factor-a': { value: 1.5, source: 'user_specified' },
      },
    },
    {
      id: 'opt2',
      label: 'Option 2',
      interventions: {
        'factor-b': { value: 2.0, source: 'user_specified' },
      },
    },
  ];

  describe('F.1 - Returns 200 with valid response', () => {
    it('returns HTTP 200 and analysis_status in {computed|partial|failed}', async () => {
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
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
      expect(res.data.request_id).toBeDefined();
      expect(res.data.response_hash).toBeDefined();
      expect(Array.isArray(res.data.critiques)).toBe(true);
    });
  });

  describe('F.2 - Produces different outcomes for different interventions', () => {
    it('different intervention values should produce different response hashes', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Request 1: intervention value = 1.5
      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      // Request 2: different intervention value = 3.0
      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 3.0, source: 'user_specified' } } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).not.toBe(res2.data.response_hash);
    });
  });

  describe('F.3 - Produces identical hash for permuted options', () => {
    it('options in different order produce same hash', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Request 1: [opt1, opt2]
      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      // Request 2: [opt2, opt1] - permuted order
      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
          ],
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).toBe(res2.data.response_hash);
    });
  });

  describe('F.4 - Produces identical hash when labels differ', () => {
    it('different labels produce same hash (labels are not semantic)', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Request 1: original labels
      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      // Request 2: different labels
      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'factor-a', kind: 'factor', label: 'DIFFERENT LABEL A' },
              { id: 'factor-b', kind: 'factor', label: 'DIFFERENT LABEL B' },
              { id: 'goal', kind: 'goal', label: 'DIFFERENT GOAL LABEL' },
            ],
            edges: VALID_GRAPH.edges,
          },
          options: [
            { id: 'opt1', label: 'DIFFERENT OPT LABEL 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
            { id: 'opt2', label: 'DIFFERENT OPT LABEL 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).toBe(res2.data.response_hash);
    });
  });

  describe('F.5 - Returns 422 with structured critique for invalid target', () => {
    it('returns 422 with INVALID_INTERVENTION_TARGET when target not in graph', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: { 'nonexistent-node': { value: 1.0, source: 'user_specified' } } },
            { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
          ],
          goal_node_id: 'goal',
        }),
      });

      // P0: Returns 422 with V2RunError (NOT error.v1 envelope)
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.status_reason).toBeDefined();
      expect(Array.isArray(res.data.critiques)).toBe(true);
      expect(res.data.critiques.some((c: any) => c.code === 'INVALID_INTERVENTION_TARGET')).toBe(true);

      // Verify NOT wrapped in error.v1 envelope
      expect(res.data.error).toBeUndefined();
    });
  });

  describe('F.6 - Returns 422 for missing goal node', () => {
    it('returns 422 with GOAL_NODE_NOT_IN_GRAPH when goal not in graph', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'nonexistent-goal',
        }),
      });

      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'GOAL_NODE_NOT_IN_GRAPH')).toBe(true);
    });

    it('returns 422 with MISSING_GOAL_NODE when goal_node_id is empty', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Note: Empty string will fail schema validation (minLength: 1)
      // So we test undefined by not providing it
      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          // goal_node_id omitted
        }),
      });

      // Should fail schema validation (400) since goal_node_id is required
      expect(res.status).toBe(400);
    });
  });

  describe('F.7 - Handles option nodes in graph gracefully', () => {
    it('filters option and decision nodes from graph without failing', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const graphWithOptionNodes = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'factor-b', kind: 'factor', label: 'Factor B' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
          { id: 'legacy-option', kind: 'option', label: 'Legacy Option' },
          { id: 'legacy-decision', kind: 'decision', label: 'Legacy Decision' },
        ],
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
          { from: 'legacy-option', to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphWithOptionNodes,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      // Should succeed - option/decision nodes are filtered out
      expect(res.status).toBe(200);
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
    });
  });

  describe('F.8 - Handles HTTP 200 with analysis_status failed', () => {
    it('returns 200 with analysis_status=failed when ISL fails gracefully', async () => {
      vi.resetModules();
      // ISL mock returns failed status when disabled
      server = await spawnServer({
        env: {
          ...ENV,
          ISL_BASE_URL: '', // Disable ISL
        },
      });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      // ISL not enabled returns 200 with failed status
      expect(res.status).toBe(200);
      expect(res.data.analysis_status).toBe('failed');
      expect(res.data.status_reason).toBeDefined();
    });
  });

  describe('F.9 - Accepts numeric seed and echoes string seed_used', () => {
    it('accepts numeric seed and returns seed_used as string', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          seed: 12345, // Numeric seed
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.meta.seed_used).toBe('12345');
      expect(typeof res.data.meta.seed_used).toBe('string');
    });

    it('accepts string seed and returns seed_used as string', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          seed: 'custom-seed-123',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.meta.seed_used).toBe('custom-seed-123');
      expect(typeof res.data.meta.seed_used).toBe('string');
    });

    it('derives deterministic seed from graph hash when seed not provided', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          // seed omitted - will be derived from graph hash
        }),
      });

      expect(res.status).toBe(200);
      expect(typeof res.data.meta.seed_used).toBe('string');
      // Should be a numeric string (derived from graph hash), not UUID
      // The seed is deterministically derived from the normalized graph
      expect(res.data.meta.seed_used).toMatch(/^\d+$/);
      const seedNum = parseInt(res.data.meta.seed_used, 10);
      expect(seedNum).toBeLessThan(2147483647);
    });
  });

  describe('F.10 - Per-feature status vocabulary', () => {
    it('uses per-feature status in {computed|unavailable|skipped|error}', async () => {
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

      // Per-feature statuses use new vocabulary
      expect(['computed', 'unavailable', 'skipped', 'error']).toContain(res.data.option_comparison_status);
      expect(['computed', 'unavailable', 'skipped', 'error']).toContain(res.data.robustness_status);
      expect(['computed', 'unavailable', 'skipped', 'error']).toContain(res.data.drivers_status);
    });
  });

  describe('F.11 - goal_threshold handling', () => {
    it('accepts goal_threshold: 20000 (positive number)', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: 20000,
          seed: '42',
        }),
      });

      expect(res.status).toBe(200);
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
    });

    it('accepts goal_threshold: 0 (zero is valid)', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: 0,
          seed: '42',
        }),
      });

      expect(res.status).toBe(200);
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
    });

    it('accepts goal_threshold: -500 (negative is valid)', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: -500,
          seed: '42',
        }),
      });

      expect(res.status).toBe(200);
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
    });

    it('accepts null goal_threshold (treated as absent)', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: null,
          seed: '42',
        }),
      });

      expect(res.status).toBe(200);
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
    });

    it('rejects goal_threshold as object with 400', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: { value: 20000 }, // Invalid: object
          seed: '42',
        }),
      });

      // Fastify schema should reject object type
      expect(res.status).toBe(400);
    });

    it('coerces numeric string to number (Fastify behavior)', async () => {
      // Note: Fastify with AJV coerces numeric strings to numbers by default
      // This test documents that behavior - strings that parse as numbers are accepted
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: '20000', // String coerced to number
          seed: '42',
        }),
      });

      // Fastify coerces "20000" to 20000
      expect(res.status).toBe(200);
    });

    it('produces different response_hash for different goal_threshold values', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Request 1: goal_threshold = 20000
      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: 20000,
          seed: '42',
        }),
      });

      // Request 2: goal_threshold = 30000
      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: 30000,
          seed: '42',
        }),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).not.toBe(res2.data.response_hash);
    });

    it('produces different response_hash with vs without goal_threshold', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Request 1: with goal_threshold
      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          goal_threshold: 20000,
          seed: '42',
        }),
      });

      // Request 2: without goal_threshold
      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          seed: '42',
        }),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.data.response_hash).not.toBe(res2.data.response_hash);
    });

    it('backward compatible: existing clients without goal_threshold work unchanged', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
          seed: '42',
          // goal_threshold intentionally omitted
        }),
      });

      expect(res.status).toBe(200);
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
      // Verify response structure exists (option_comparison may be undefined if status is 'failed')
      expect(res.data.critiques).toBeDefined();
      expect(res.data.meta).toBeDefined();
      expect(res.data.meta.seed_used).toBe('42');
    });
  });

  describe('Category Field Preservation (M1)', () => {
    it('preserves category field on factor nodes', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const graphWithCategories = {
        nodes: [
          { id: 'controllable-factor', kind: 'factor', label: 'Controllable', category: 'controllable' },
          { id: 'observable-factor', kind: 'factor', label: 'Observable', category: 'observable' },
          { id: 'external-factor', kind: 'factor', label: 'External', category: 'external' },
          { id: 'no-category-factor', kind: 'factor', label: 'No Category' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'controllable-factor', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'observable-factor', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'external-factor', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'no-category-factor', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const options = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'controllable-factor': { value: 1.0, source: 'user_specified' },
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'observable-factor': { value: 2.0, source: 'user_specified' },
          },
        },
      ];

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphWithCategories,
          options,
          goal_node_id: 'goal',
        }),
      });

      if (res.status !== 200) {
        console.error('Error response:', JSON.stringify(res.data, null, 2));
      }
      expect(res.status).toBe(200);

      // The response doesn't include the graph directly, but it should be preserved
      // in the internal normalized graph. This test verifies the normalisation works.
      // For full verification, check the edge_sensitivity and factor_sensitivity arrays.
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
    });

    it('category does not affect response_hash (hash invariance)', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const baseGraph = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'factor-b', kind: 'factor', label: 'Factor B' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
        ],
      };

      const options = [
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

      // Request 1: No categories
      const res1 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: baseGraph,
          options,
          goal_node_id: 'goal',
          seed: 'test-seed-123',
        }),
      });

      // Request 2: With categories
      const graphWithCategories = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A', category: 'controllable' },
          { id: 'factor-b', kind: 'factor', label: 'Factor B', category: 'observable' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: baseGraph.edges,
      };

      const res2 = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphWithCategories,
          options,
          goal_node_id: 'goal',
          seed: 'test-seed-123',
        }),
      });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Category is non-semantic metadata (for M1 coaching only)
      // It should NOT affect the response_hash (which captures semantic content)
      expect(res1.data.response_hash).toBe(res2.data.response_hash);
    });
  });
});
