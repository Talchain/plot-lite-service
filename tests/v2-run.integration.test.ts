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

  describe('Preflight validation', () => {
    it('returns BLOCKER for missing goal node', async () => {
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

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');
      expect(res.data.critiques.some((c: any) => c.code === 'MISSING_GOAL_NODE')).toBe(true);
    });

    it('returns BLOCKER for empty interventions', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: VALID_GRAPH,
          options: [
            { id: 'opt1', label: 'Option 1', interventions: {} },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');
      expect(res.data.critiques.some((c: any) => c.code === 'EMPTY_INTERVENTIONS')).toBe(true);
    });

    it('returns BLOCKER for invalid intervention target', async () => {
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
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');
      expect(res.data.critiques.some((c: any) => c.code === 'INVALID_INTERVENTION_TARGET')).toBe(true);
    });

    it('returns BLOCKER for identical options', async () => {
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

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');
      expect(res.data.critiques.some((c: any) => c.code === 'IDENTICAL_OPTIONS')).toBe(true);
    });

    it('returns BLOCKER for no path to goal', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const graphWithIsolated = {
        nodes: [
          { id: 'isolated', kind: 'factor', label: 'Isolated' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [], // No edges - isolated node has no path to goal
      };

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: graphWithIsolated,
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'isolated': { value: 1.0, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');
      expect(res.data.critiques.some((c: any) => c.code === 'NO_PATH_TO_GOAL')).toBe(true);
    });
  });

  describe('Option node filtering', () => {
    it('filters option nodes from graph', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      // Graph with option nodes that should be filtered
      const graphWithOptions = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
          { id: 'option-node', kind: 'option', label: 'Legacy Option' }, // Should be filtered
        ],
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
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
          ],
          goal_node_id: 'goal',
        }),
      });

      // Should not fail - option nodes filtered, remaining graph is valid
      expect(res.status).toBe(200);
      // Meta should show filtered counts if available
      if (res.data.meta?.preflight_stats) {
        expect(res.data.meta.preflight_stats.option_nodes_filtered).toBeGreaterThanOrEqual(1);
      }
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

      // Status flags should be present
      expect(['available', 'unavailable']).toContain(res.data.option_comparison_status);
      expect(['available', 'unavailable']).toContain(res.data.robustness_status);
      expect(['available', 'unavailable']).toContain(res.data.drivers_status);
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

    it('includes meta with timing info', async () => {
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
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-a', to: 'goal', weight: 0.5, belief_exists: 0.8 }, // Legacy format
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
          { id: 'goal', data: { kind: 'goal', label: 'Goal' } },
        ],
        edges: [
          { source: 'factor-a', target: 'goal', data: { weight: 0.5, belief_exists: 0.8 } },
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
          ],
          goal_node_id: 'goal',
        }),
      });

      // Should succeed - format normalized
      expect(res.status).toBe(200);
    });
  });

  describe('Graph size limits', () => {
    it('rejects graph exceeding max nodes', async () => {
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
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');
      expect(res.data.critiques.some((c: any) => c.code === 'GRAPH_TOO_LARGE')).toBe(true);
    });
  });
});
