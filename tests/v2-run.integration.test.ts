/**
 * Integration tests for /v2/run endpoint
 *
 * Tests the full request/response flow with option comparison model.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('POST /v2/run Integration', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
    ISL_BASE_URL: 'mock', // Disable real ISL calls in tests
    ISL_MOCK_ENABLE: '1',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  // Valid graph for testing
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

  // Valid options for testing
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

  describe('Request validation', () => {
    it('rejects request without graph', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          options: VALID_OPTIONS,
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects request without options', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(400);
    });

    it('rejects request without goal_node_id', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: VALID_OPTIONS,
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Preflight validation (422 blockers)', () => {
    it('returns 422 with GOAL_NODE_NOT_IN_GRAPH for missing goal node', async () => {
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

      // P0: Preflight failures return 422 with V2RunError
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'GOAL_NODE_NOT_IN_GRAPH')).toBe(true);
    });

    it('returns 422 with EMPTY_INTERVENTIONS for empty interventions', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: {} },
            { id: 'opt2', label: 'Option 2', interventions: {} },
          ],
          goal_node_id: 'goal',
        }),
      });

      // P0: Preflight failures return 422 with V2RunError
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'EMPTY_INTERVENTIONS')).toBe(true);
    });

    it('returns 422 with INVALID_INTERVENTION_TARGET for invalid target', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: {
                'nonexistent-node': { value: 1.0, source: 'user_specified' },
              },
            },
            {
              id: 'opt2',
              label: 'Option 2',
              interventions: {
                'factor-b': { value: 2.0, source: 'user_specified' },
              },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      // P0: Preflight failures return 422 with V2RunError
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'INVALID_INTERVENTION_TARGET')).toBe(true);
    });

    it('returns 422 with IDENTICAL_OPTIONS for identical options', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } },
            },
            {
              id: 'opt2',
              label: 'Option 2',
              interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      // P0: Preflight failures return 422 with V2RunError
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'IDENTICAL_OPTIONS')).toBe(true);
    });

    it('returns 422 with NO_PATH_TO_GOAL for isolated intervention', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const graphWithIsolated = {
        nodes: [
          { id: 'isolated', kind: 'factor', label: 'Isolated' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [], // No edges - isolated node has no path to goal
      };

      // Add another factor node that DOES have a path to goal for comparison
      const graphWithIsolatedAndConnected = {
        nodes: [
          { id: 'isolated', kind: 'factor', label: 'Isolated' },
          { id: 'connected', kind: 'factor', label: 'Connected' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          // Only connected -> goal, no edge from isolated
          { from: 'connected', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphWithIsolatedAndConnected,
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'isolated': { value: 1.0, source: 'user_specified' } },
            },
            {
              id: 'opt2',
              label: 'Option 2',
              interventions: { 'connected': { value: 2.0, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      // P0: Preflight failures return 422 with V2RunError
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'NO_PATH_TO_GOAL')).toBe(true);
    });
  });

  describe('Option node filtering', () => {
    it('filters option nodes from graph gracefully', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Graph with option nodes that should be filtered
      const graphWithOptions = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'factor-b', kind: 'factor', label: 'Factor B' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
          { id: 'option-node', kind: 'option', label: 'Legacy Option' }, // Should be filtered
          { id: 'decision-node', kind: 'decision', label: 'Legacy Decision' }, // Should be filtered
        ],
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
          { from: 'option-node', to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } }, // Should be filtered
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphWithOptions,
          options: [
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
          ],
          goal_node_id: 'goal',
        }),
      });

      // Should succeed - option/decision nodes filtered, remaining graph is valid
      expect(res.status).toBe(200);
      // ISL may not be enabled in tests, so check for any success or ISL-related status
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
    });
  });

  describe('Response structure', () => {
    it('returns correct schema version and status flags', async () => {
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
      expect(res.data.request_schema_version).toBe('v3');
      expect(res.data.endpoint_version).toBe('v2/run');
      expect(res.data.preflight_version).toBeDefined();
      expect(res.data.request_id).toBeDefined();

      // P0: Status flags use new vocabulary
      expect(['computed', 'partial', 'failed']).toContain(res.data.analysis_status);
      expect(['computed', 'unavailable', 'skipped', 'error']).toContain(res.data.option_comparison_status);
      expect(['computed', 'unavailable', 'skipped', 'error']).toContain(res.data.robustness_status);
      expect(['computed', 'unavailable', 'skipped', 'error']).toContain(res.data.drivers_status);
    });

    it('includes response_hash for determinism verification', async () => {
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
      // P0: response_hash should be a 16-char hex string
      expect(res.data.response_hash).toBeDefined();
      expect(typeof res.data.response_hash).toBe('string');
      expect(res.data.response_hash.length).toBe(16);
      expect(/^[0-9a-f]+$/.test(res.data.response_hash)).toBe(true);
    });

    it('includes critiques array in response', async () => {
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
      expect(Array.isArray(res.data.critiques)).toBe(true);
    });

    it('surfaces coefficient repair warnings as critiques', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'factor-a', kind: 'factor', label: 'Factor A' },
              { id: 'goal', kind: 'goal', label: 'Goal' },
            ],
            edges: [
              {
                from: 'factor-a',
                to: 'goal',
                strength_mean: 2.5,
                strength_std: 1.2,
                belief_exists: 2.0,
              },
            ],
          },
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'factor-a': { value: 1.0, source: 'user_specified' } },
            },
            {
              id: 'opt2',
              label: 'Option 2',
              interventions: { 'factor-a': { value: 2.0, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.critiques.some((c: any) => c.code === 'COEFFICIENT_REPAIRED')).toBe(true);
    });

    it('includes meta with seed_used as string and timing info', async () => {
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
      expect(res.data.meta).toBeDefined();
      expect(typeof res.data.meta.latency_ms).toBe('number');
      // P0: seed_used should be a string (not number)
      expect(typeof res.data.meta.seed_used).toBe('string');
      // When no seed provided, derives deterministic seed from graph hash
      // Should be a numeric string, not UUID
      expect(res.data.meta.seed_used).toMatch(/^\d+$/);
      const seedNum = parseInt(res.data.meta.seed_used, 10);
      expect(seedNum).toBeLessThan(2147483647);
    });

    it('accepts numeric seed and echoes seed_used as string', async () => {
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
      // P0: seed_used should be string even when input was numeric
      expect(typeof res.data.meta.seed_used).toBe('string');
      expect(res.data.meta.seed_used).toBe('12345');
    });
  });

  describe('Edge format normalization', () => {
    it('normalizes legacy edge format', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Graph with legacy edge format (weight/belief_exists)
      const legacyGraph = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'factor-b', kind: 'factor', label: 'Factor B' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-a', to: 'goal', weight: 0.5, belief_exists: 0.8 }, // Legacy format
          { from: 'factor-b', to: 'goal', weight: 0.6, belief_exists: 0.9 }, // Legacy format
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: legacyGraph,
          options: [
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
          ],
          goal_node_id: 'goal',
        }),
      });

      // Should succeed - edge normalized
      expect(res.status).toBe(200);
    });

    it('normalizes React Flow format', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Graph with React Flow node format
      const reactFlowGraph = {
        nodes: [
          { id: 'factor-a', data: { kind: 'factor', label: 'Factor A' } },
          { id: 'factor-b', data: { kind: 'factor', label: 'Factor B' } },
          { id: 'goal', data: { kind: 'goal', label: 'Goal' } },
        ],
        edges: [
          { source: 'factor-a', target: 'goal', data: { weight: 0.5, belief_exists: 0.8 } },
          { source: 'factor-b', target: 'goal', data: { weight: 0.6, belief_exists: 0.9 } },
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: reactFlowGraph,
          options: [
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
          ],
          goal_node_id: 'goal',
        }),
      });

      // Should succeed - format normalized
      expect(res.status).toBe(200);
    });
  });

  describe('Graph size limits', () => {
    it('returns 422 for graph exceeding max nodes', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const largeGraph = {
        nodes: [
          ...Array.from({ length: 51 }, (_, i) => ({
            id: `node-${i}`,
            kind: 'factor',
            label: `Node ${i}`,
          })),
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'node-0', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'node-1', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
        ],
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: largeGraph,
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'node-0': { value: 1.0, source: 'user_specified' } },
            },
            {
              id: 'opt2',
              label: 'Option 2',
              interventions: { 'node-1': { value: 2.0, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      // P0: Validation failures return 422 with V2RunError
      expect(res.status).toBe(422);
      expect(res.data.analysis_status).toBe('blocked');
      expect(res.data.critiques.some((c: any) => c.code === 'GRAPH_TOO_LARGE')).toBe(true);
    });
  });
});
