/**
 * Golden Scenario Tests for /v2/run
 *
 * These tests verify the four key scenarios from the Integration Alignment Brief:
 * 1. Canonical option comparison (happy path)
 * 2. Option node filtering
 * 3. Preflight validation blockers
 * 4. Format normalization
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('V2 Run Golden Scenarios', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  /**
   * Scenario 1: Canonical Option Comparison (Happy Path)
   *
   * Given a valid causal graph and well-formed options with interventions,
   * the /v2/run endpoint returns a response with:
   * - status flags indicating analysis availability
   * - no blocker critiques
   * - meta timing information
   */
  describe('Scenario 1: Canonical Option Comparison', () => {
    it('accepts valid graph with options as intervention bundles', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'marketing-spend', kind: 'factor', label: 'Marketing Spend' },
              { id: 'brand-awareness', kind: 'factor', label: 'Brand Awareness' },
              { id: 'sales', kind: 'goal', label: 'Sales' },
            ],
            edges: [
              { from: 'marketing-spend', to: 'brand-awareness', exists_probability: 0.85, strength: { mean: 0.6, std: 0.1 } },
              { from: 'brand-awareness', to: 'sales', exists_probability: 0.9, strength: { mean: 0.7, std: 0.12 } },
            ],
          },
          options: [
            {
              id: 'opt-high-spend',
              label: 'High Marketing Spend',
              interventions: {
                'marketing-spend': { value: 100, source: 'user_specified' },
              },
            },
            {
              id: 'opt-low-spend',
              label: 'Low Marketing Spend',
              interventions: {
                'marketing-spend': { value: 25, source: 'user_specified' },
              },
            },
          ],
          goal_node_id: 'sales',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.request_schema_version).toBe('v3');
      expect(res.data.endpoint_version).toBe('v2/run');
      expect(res.data.preflight_version).toBe('2025-12-26');

      // Status flags present
      expect(res.data.option_comparison_status).toBeDefined();
      expect(res.data.robustness_status).toBeDefined();
      expect(res.data.drivers_status).toBeDefined();

      // No blockers
      const blockers = res.data.critiques.filter((c: any) => c.severity === 'blocker');
      expect(blockers.length).toBe(0);

      // Timing info present
      expect(res.data.meta.latency_ms).toBeDefined();
      expect(res.data.meta.normalization_ms).toBeDefined();
      expect(res.data.meta.validation_ms).toBeDefined();
    });

    it('handles multi-intervention options', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'price', kind: 'factor', label: 'Price' },
              { id: 'quality', kind: 'factor', label: 'Quality' },
              { id: 'demand', kind: 'goal', label: 'Demand' },
            ],
            edges: [
              { from: 'price', to: 'demand', exists_probability: 0.9, strength: { mean: -0.5, std: 0.1 } },
              { from: 'quality', to: 'demand', exists_probability: 0.85, strength: { mean: 0.7, std: 0.15 } },
            ],
          },
          options: [
            {
              id: 'opt-premium',
              label: 'Premium Strategy',
              interventions: {
                'price': { value: 150, source: 'user_specified' },
                'quality': { value: 95, source: 'user_specified' },
              },
            },
            {
              id: 'opt-budget',
              label: 'Budget Strategy',
              interventions: {
                'price': { value: 50, source: 'user_specified' },
                'quality': { value: 60, source: 'user_specified' },
              },
            },
          ],
          goal_node_id: 'demand',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.critiques.filter((c: any) => c.severity === 'blocker').length).toBe(0);
    });
  });

  /**
   * Scenario 2: Option Node Filtering
   *
   * When the graph contains legacy option nodes (kind='option'),
   * they should be filtered out along with their incident edges
   * before analysis.
   */
  describe('Scenario 2: Option Node Filtering', () => {
    it('filters out option nodes and incident edges', async () => {
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
              // Legacy option nodes that should be filtered
              { id: 'legacy-opt-1', kind: 'option', label: 'Legacy Option 1' },
              { id: 'legacy-opt-2', kind: 'option', label: 'Legacy Option 2' },
            ],
            edges: [
              { from: 'factor-a', to: 'goal', exists_probability: 0.9, strength: { mean: 0.6, std: 0.1 } },
              // Edges incident to option nodes should be filtered
              { from: 'legacy-opt-1', to: 'goal', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
              { from: 'legacy-opt-2', to: 'goal', exists_probability: 0.6, strength: { mean: 0.4, std: 0.1 } },
            ],
          },
          options: [
            {
              id: 'opt1',
              label: 'New Option 1',
              interventions: {
                'factor-a': { value: 1.5, source: 'user_specified' },
              },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);

      // Should succeed without blockers - option nodes were filtered
      const blockers = res.data.critiques.filter((c: any) => c.severity === 'blocker');
      expect(blockers.length).toBe(0);

      // The response should not contain references to filtered option nodes
      if (res.data.option_comparison) {
        for (const opt of res.data.option_comparison) {
          expect(opt.option_id).not.toBe('legacy-opt-1');
          expect(opt.option_id).not.toBe('legacy-opt-2');
        }
      }
    });
  });

  /**
   * Scenario 3: Preflight Validation Blockers
   *
   * The endpoint should return 200 with blocker critiques (not 4xx)
   * when validation fails, allowing the UI to display helpful messages.
   */
  describe('Scenario 3: Preflight Validation Blockers', () => {
    it('returns MISSING_GOAL_NODE when goal not in graph', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [{ id: 'factor-a', kind: 'factor', label: 'Factor A' }],
            edges: [],
          },
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'factor-a': { value: 1.0, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'nonexistent-goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');
      expect(res.data.unavailable_reason).toBe('preflight_validation_failed');

      const blocker = res.data.critiques.find((c: any) => c.code === 'MISSING_GOAL_NODE');
      expect(blocker).toBeDefined();
      expect(blocker.severity).toBe('blocker');
    });

    it('returns NO_PATH_TO_GOAL when intervention cannot affect goal', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'isolated-factor', kind: 'factor', label: 'Isolated Factor' },
              { id: 'connected-factor', kind: 'factor', label: 'Connected Factor' },
              { id: 'goal', kind: 'goal', label: 'Goal' },
            ],
            edges: [
              // Only connected-factor has path to goal
              { from: 'connected-factor', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
            ],
          },
          options: [
            {
              id: 'opt1',
              label: 'Useless Option',
              interventions: {
                // This intervention cannot affect the goal
                'isolated-factor': { value: 1.0, source: 'user_specified' },
              },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');

      const blocker = res.data.critiques.find((c: any) => c.code === 'NO_PATH_TO_GOAL');
      expect(blocker).toBeDefined();
    });

    it('returns IDENTICAL_OPTIONS when options have same interventions', async () => {
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
              { from: 'factor-a', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
            ],
          },
          options: [
            {
              id: 'opt1',
              label: 'Option A',
              interventions: { 'factor-a': { value: 50, source: 'user_specified' } },
            },
            {
              id: 'opt2',
              label: 'Option B',
              // Same intervention value as opt1
              interventions: { 'factor-a': { value: 50, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');

      const blocker = res.data.critiques.find((c: any) => c.code === 'IDENTICAL_OPTIONS');
      expect(blocker).toBeDefined();
    });

    it('returns EMPTY_INTERVENTIONS when option has no interventions', async () => {
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
              { from: 'factor-a', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
            ],
          },
          options: [
            {
              id: 'opt1',
              label: 'Empty Option',
              interventions: {}, // No interventions
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.option_comparison_status).toBe('unavailable');

      const blocker = res.data.critiques.find((c: any) => c.code === 'EMPTY_INTERVENTIONS');
      expect(blocker).toBeDefined();
    });
  });

  /**
   * Scenario 4: Format Normalization
   *
   * The endpoint should accept various legacy formats and normalize them
   * to the canonical V3 format internally.
   */
  describe('Scenario 4: Format Normalization', () => {
    it('normalizes React Flow format (source/target, data wrapper)', async () => {
      vi.resetModules();
      server = await spawnServer({ env: ENV });

      const res = await requestJSON(`${server.baseUrl}/v2/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: {
            nodes: [
              { id: 'factor-a', data: { kind: 'factor', label: 'Factor A' } },
              { id: 'goal', data: { kind: 'goal', label: 'Goal' } },
            ],
            edges: [
              { source: 'factor-a', target: 'goal', data: { weight: 0.7, belief_exists: 0.9 } },
            ],
          },
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'factor-a': { value: 1.0, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.critiques.filter((c: any) => c.severity === 'blocker').length).toBe(0);
    });

    it('normalizes legacy edge format (weight, belief_exists)', async () => {
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
                weight: 0.6,
                belief_exists: 0.85,
                strength_std: 0.12,
              },
            ],
          },
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'factor-a': { value: 1.0, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.critiques.filter((c: any) => c.severity === 'blocker').length).toBe(0);
    });

    it('normalizes EdgeV2.2 format (exists_probability, strength object)', async () => {
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
                exists_probability: 0.9,
                strength: { mean: 0.7, std: 0.1 },
              },
            ],
          },
          options: [
            {
              id: 'opt1',
              label: 'Option 1',
              interventions: { 'factor-a': { value: 1.0, source: 'user_specified' } },
            },
          ],
          goal_node_id: 'goal',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.data.critiques.filter((c: any) => c.severity === 'blocker').length).toBe(0);
    });
  });
});
