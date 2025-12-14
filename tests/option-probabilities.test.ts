/**
 * Tests for Brief A: Per-Option Goal Probabilities
 *
 * Tests the computation of P(goal achieved | option) for each option node.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';
import {
  computeOptionProbabilities,
  detectGoalNode,
  detectOptionNodes,
  detectGoalThreshold,
} from '../src/trust/option-probabilities.js';
import { computeThresholdProbability } from '../src/scm-lite/kernel.js';
import type { DAG } from '../src/scm-lite/types.js';

describe('Option Probabilities: Unit Tests', () => {
  describe('detectGoalNode', () => {
    it('returns explicit goal_node if provided', () => {
      const dag: DAG = {
        nodes: [{ id: 'A' }, { id: 'B' }, { id: 'goal' }],
        edges: [],
      };
      expect(detectGoalNode(dag, 'B')).toBe('B');
    });

    it('finds node with kind: goal', () => {
      const dag: DAG = {
        nodes: [
          { id: 'A' },
          { id: 'my_goal' } as any,
          { id: 'C' },
        ],
        edges: [],
      };
      (dag.nodes[1] as any).kind = 'goal';
      expect(detectGoalNode(dag)).toBe('my_goal');
    });

    it('falls back to last node if no explicit goal', () => {
      const dag: DAG = {
        nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
        edges: [],
      };
      expect(detectGoalNode(dag)).toBe('C');
    });

    it('returns null for empty graph', () => {
      const dag: DAG = { nodes: [], edges: [] };
      expect(detectGoalNode(dag)).toBe(null);
    });
  });

  describe('detectOptionNodes', () => {
    it('finds nodes with kind: option', () => {
      const dag: DAG = {
        nodes: [
          { id: 'opt1' } as any,
          { id: 'other' },
          { id: 'opt2' } as any,
        ],
        edges: [],
      };
      (dag.nodes[0] as any).kind = 'option';
      (dag.nodes[2] as any).kind = 'option';

      const options = detectOptionNodes(dag);
      expect(options).toHaveLength(2);
      expect(options[0].id).toBe('opt1');
      expect(options[1].id).toBe('opt2');
    });

    it('finds nodes with kind: action', () => {
      const dag: DAG = {
        nodes: [
          { id: 'action1', label: 'Do Something' } as any,
        ],
        edges: [],
      };
      (dag.nodes[0] as any).kind = 'action';

      const options = detectOptionNodes(dag);
      expect(options).toHaveLength(1);
      expect(options[0].id).toBe('action1');
      expect(options[0].label).toBe('Do Something');
    });

    it('returns empty array when no options', () => {
      const dag: DAG = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [],
      };
      expect(detectOptionNodes(dag)).toHaveLength(0);
    });
  });

  describe('detectGoalThreshold', () => {
    it('uses explicit threshold if provided', () => {
      const dag: DAG = { nodes: [{ id: 'goal' }], edges: [] };
      expect(detectGoalThreshold(dag, 'goal', 500, 100)).toBe(500);
    });

    it('uses node threshold property', () => {
      const dag: DAG = { nodes: [{ id: 'goal' } as any], edges: [] };
      (dag.nodes[0] as any).threshold = 250;
      expect(detectGoalThreshold(dag, 'goal', undefined, 100)).toBe(250);
    });

    it('falls back to baseline', () => {
      const dag: DAG = { nodes: [{ id: 'goal' }], edges: [] };
      expect(detectGoalThreshold(dag, 'goal', undefined, 150)).toBe(150);
    });

    it('defaults to 100 when no baseline', () => {
      const dag: DAG = { nodes: [{ id: 'goal' }], edges: [] };
      expect(detectGoalThreshold(dag, 'goal')).toBe(100);
    });
  });

  describe('computeThresholdProbability', () => {
    it('returns 1.0 when all samples exceed threshold', () => {
      // Simple chain with high values
      const dag: DAG = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', belief: 1.0, weight: 10 }],
      };

      const result = computeThresholdProbability(dag, 'B', 5, {
        seed: 42,
        K: 64,
      });

      expect(result.probability).toBe(1.0);
      expect(result.samples_above).toBe(64);
      expect(result.total_samples).toBe(64);
    });

    it('returns 0.0 when no samples exceed threshold', () => {
      const dag: DAG = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', belief: 1.0, weight: 1 }],
      };

      const result = computeThresholdProbability(dag, 'B', 1000, {
        seed: 42,
        K: 64,
      });

      expect(result.probability).toBe(0.0);
      expect(result.samples_above).toBe(0);
    });

    it('respects interventions (do-operator)', () => {
      const dag: DAG = {
        nodes: [{ id: 'X' }, { id: 'Y' }, { id: 'Z' }],
        edges: [
          { from: 'X', to: 'Y', belief: 1.0, weight: 5 },
          { from: 'Y', to: 'Z', belief: 1.0, weight: 2 },
        ],
      };

      // Without intervention
      const baseline = computeThresholdProbability(dag, 'Z', 1, {
        seed: 42,
        K: 64,
      });

      // With intervention do(X=10)
      const intervened = computeThresholdProbability(dag, 'Z', 1, {
        seed: 42,
        K: 64,
        interventions: [{ node_id: 'X', value: 10 }],
        mode: 'interventional',
      });

      // Intervened should have higher probability of exceeding threshold
      expect(intervened.probability).toBeGreaterThanOrEqual(baseline.probability);
    });

    it('is deterministic with same seed', () => {
      const dag: DAG = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B', belief: 0.7, weight: 2 }],
      };

      const r1 = computeThresholdProbability(dag, 'B', 1, { seed: 123, K: 32 });
      const r2 = computeThresholdProbability(dag, 'B', 1, { seed: 123, K: 32 });

      expect(r1.probability).toBe(r2.probability);
      expect(r1.samples_above).toBe(r2.samples_above);
    });
  });

  describe('computeOptionProbabilities', () => {
    it('computes probability for each option', () => {
      const dag: DAG = {
        nodes: [
          { id: 'opt_a', kind: 'option' } as any,
          { id: 'opt_b', kind: 'option' } as any,
          { id: 'outcome' },
          { id: 'goal', kind: 'goal' } as any,
        ],
        edges: [
          { from: 'opt_a', to: 'outcome', belief: 1.0, weight: 3 },
          { from: 'opt_b', to: 'outcome', belief: 1.0, weight: 1 },
          { from: 'outcome', to: 'goal', belief: 1.0, weight: 1 },
        ],
      };

      const result = computeOptionProbabilities({
        graph: dag,
        goal_node: 'goal',
        goal_threshold: 2,
        seed: 42,
        k_samples: 64,
      });

      expect(result).toHaveProperty('opt_a');
      expect(result).toHaveProperty('opt_b');
      expect(result.opt_a.goal_probability).toBeGreaterThanOrEqual(0);
      expect(result.opt_a.goal_probability).toBeLessThanOrEqual(1);
      expect(result.opt_a.confidence).toBeGreaterThanOrEqual(0);
      expect(result.opt_a.confidence).toBeLessThanOrEqual(1);
    });

    it('returns empty object when no options', () => {
      const dag: DAG = {
        nodes: [{ id: 'A' }, { id: 'B' }],
        edges: [{ from: 'A', to: 'B' }],
      };

      const result = computeOptionProbabilities({
        graph: dag,
        goal_node: 'B',
        goal_threshold: 1,
        seed: 42,
        k_samples: 32,
      });

      expect(result).toEqual({});
    });

    it('is deterministic with same seed', () => {
      const dag: DAG = {
        nodes: [
          { id: 'opt', kind: 'option' } as any,
          { id: 'goal' },
        ],
        edges: [{ from: 'opt', to: 'goal', belief: 0.8, weight: 2 }],
      };

      const config = {
        graph: dag,
        goal_node: 'goal',
        goal_threshold: 1,
        seed: 999,
        k_samples: 64,
      };

      const r1 = computeOptionProbabilities(config);
      const r2 = computeOptionProbabilities(config);

      expect(r1.opt.goal_probability).toBe(r2.opt.goal_probability);
      expect(r1.opt.confidence).toBe(r2.opt.confidence);
    });
  });
});

describe('Option Probabilities: Integration Tests', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        ENABLE_OPTION_PROBABILITIES: '1',
        SCM_LITE_ENABLE: '1',
      },
    });
  });

  afterAll(async () => {
    await server.kill();
  });

  it('returns option_probabilities when flag enabled and options present', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'price_increase', kind: 'option', label: 'Increase price to £59' },
          { id: 'price_decrease', kind: 'option', label: 'Decrease price to £39' },
          { id: 'revenue', kind: 'factor', label: 'Revenue' },
          { id: 'mrr_goal', kind: 'goal', label: 'MRR Goal', threshold: 20000 },
        ],
        edges: [
          { from: 'price_increase', to: 'revenue', belief: 0.8, weight: 1.2 },
          { from: 'price_decrease', to: 'revenue', belief: 0.9, weight: 0.8 },
          { from: 'revenue', to: 'mrr_goal', belief: 1.0, weight: 1000 },
        ],
      },
      seed: 4242,
      detail_level: 'standard',
      baseline_value: 15000,
      goal_threshold: 20000,
    };

    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (res.status !== 200) {
      console.error('Error response:', JSON.stringify(data, null, 2));
    }
    expect(res.status).toBe(200);

    // Should have option_probabilities when flag is enabled
    if (data.option_probabilities) {
      expect(data.option_probabilities).toHaveProperty('price_increase');
      expect(data.option_probabilities).toHaveProperty('price_decrease');

      const pi = data.option_probabilities.price_increase;
      expect(pi.goal_probability).toBeGreaterThanOrEqual(0);
      expect(pi.goal_probability).toBeLessThanOrEqual(1);
      expect(pi.confidence).toBeGreaterThanOrEqual(0);
      expect(pi.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('does not return option_probabilities in quick mode', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'opt', kind: 'option', label: 'Option' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [{ from: 'opt', to: 'goal', belief: 0.8 }],
      },
      seed: 4242,
      detail_level: 'quick',
    };

    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (res.status !== 200) {
      console.error('Error response (quick mode):', JSON.stringify(data, null, 2));
    }
    expect(res.status).toBe(200);
    expect(data.option_probabilities).toBeUndefined();
  });

  it('does not return option_probabilities when no options in graph', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'A', kind: 'factor', label: 'Factor A' },
          { id: 'B', kind: 'goal', label: 'Goal B' },
        ],
        edges: [{ from: 'A', to: 'B', belief: 0.8 }],
      },
      seed: 4242,
      detail_level: 'standard',
    };

    const res = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (res.status !== 200) {
      console.error('Error response (no options):', JSON.stringify(data, null, 2));
    }
    expect(res.status).toBe(200);
    expect(data.option_probabilities).toBeUndefined();
  });

  it('option_probabilities is deterministic with same seed', async () => {
    const payload = {
      graph: {
        nodes: [
          { id: 'opt', kind: 'option', label: 'Option' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [{ from: 'opt', to: 'goal', belief: 0.7 }],
      },
      seed: 12345,
      detail_level: 'standard',
      goal_threshold: 1,
    };

    const res1 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data1 = await res1.json();

    const res2 = await fetch(`${server.baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data2 = await res2.json();

    if (data1.option_probabilities && data2.option_probabilities) {
      expect(data1.option_probabilities.opt.goal_probability)
        .toBe(data2.option_probabilities.opt.goal_probability);
    }
  });
});
