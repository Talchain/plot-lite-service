/**
 * Unit tests for V2 graph normalization
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseNode,
  normaliseEdge,
  normaliseGraph,
  deriveStd,
  NormalisationError,
} from '../src/normalisation/graph-normaliser.js';

describe('Graph Normalisation', () => {
  describe('deriveStd', () => {
    it('returns higher std for low belief', () => {
      const lowBelief = deriveStd(1.0, 0.2);
      const highBelief = deriveStd(1.0, 0.9);
      expect(lowBelief).toBeGreaterThan(highBelief);
    });

    it('scales with mean magnitude', () => {
      const smallMean = deriveStd(0.1, 0.5);
      const largeMean = deriveStd(1.0, 0.5);
      expect(largeMean).toBeGreaterThan(smallMean);
    });

    it('returns minimum 0.05', () => {
      const std = deriveStd(0, 1.0);
      expect(std).toBeGreaterThanOrEqual(0.05);
    });
  });

  describe('normaliseNode', () => {
    it('normalizes basic node', () => {
      const node = normaliseNode({
        id: 'test-node',
        kind: 'factor',
        label: 'Test Node',
      });

      expect(node.id).toBe('test-node');
      expect(node.kind).toBe('factor');
      expect(node.label).toBe('Test Node');
    });

    it('handles React Flow nesting', () => {
      const node = normaliseNode({
        id: 'react-flow-node',
        data: {
          kind: 'goal',
          value: 100,
          baseline: 80,
          unit: 'points',
        },
      });

      expect(node.kind).toBe('goal');
      expect(node.observed_state).toEqual({
        value: 100,
        baseline: 80,
        unit: 'points',
      });
    });

    it('uses type as fallback for kind', () => {
      const node = normaliseNode({
        id: 'legacy-node',
        type: 'decision',
      });

      expect(node.kind).toBe('decision');
    });

    it('uses id as label fallback', () => {
      const node = normaliseNode({
        id: 'unlabeled-node',
        kind: 'factor',
      });

      expect(node.label).toBe('unlabeled-node');
    });

    it('throws on missing id', () => {
      expect(() => normaliseNode({} as any)).toThrow(NormalisationError);
    });

    it('normalizes kind to lowercase', () => {
      const node = normaliseNode({
        id: 'test',
        kind: 'FACTOR',
      });

      expect(node.kind).toBe('factor');
    });

    it('maps body to description', () => {
      const node = normaliseNode({
        id: 'test',
        kind: 'factor',
        body: 'This is a legacy description',
      });

      expect(node.description).toBe('This is a legacy description');
    });

    it('accepts intercept as a finite number', () => {
      const node = normaliseNode({
        id: 'out_revenue',
        kind: 'outcome',
        intercept: 1000,
      } as any);

      expect(node.intercept).toBe(1000);
    });

    it('accepts intercept from React Flow data nesting', () => {
      const node = normaliseNode({
        id: 'out_revenue',
        kind: 'outcome',
        data: { intercept: 500 },
      } as any);

      expect(node.intercept).toBe(500);
    });

    it('rejects null intercept', () => {
      expect(() => normaliseNode({
        id: 'out_revenue',
        kind: 'outcome',
        intercept: null,
      } as any)).toThrow(NormalisationError);
    });

    it('rejects non-finite intercept', () => {
      expect(() => normaliseNode({
        id: 'out_revenue',
        kind: 'outcome',
        intercept: Infinity,
      } as any)).toThrow(NormalisationError);

      expect(() => normaliseNode({
        id: 'out_revenue',
        kind: 'outcome',
        intercept: NaN,
      } as any)).toThrow(NormalisationError);
    });
  });

  describe('normaliseEdge', () => {
    it('normalizes basic edge', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        weight: 0.5,
      }, 0);

      expect(edge.from).toBe('a');
      expect(edge.to).toBe('b');
      expect(edge.strength.mean).toBe(0.5);
      expect(edge.strength.std).toBeGreaterThan(0);
      expect(edge.exists_probability).toBe(0.8); // default
    });

    it('handles React Flow source/target naming', () => {
      const edge = normaliseEdge({
        source: 'node-a',
        target: 'node-b',
        weight: 0.3,
      }, 0);

      expect(edge.from).toBe('node-a');
      expect(edge.to).toBe('node-b');
    });

    it('handles exists_probability field', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        exists_probability: 0.9,
      }, 0);

      expect(edge.exists_probability).toBe(0.9);
    });

    it('falls back to belief_exists', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        belief_exists: 0.7,
      }, 0);

      expect(edge.exists_probability).toBe(0.7);
    });

    it('falls back to belief', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        belief: 0.6,
      }, 0);

      expect(edge.exists_probability).toBe(0.6);
    });

    it('handles explicit strength object', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        strength: { mean: 0.8, std: 0.1 },
      }, 0);

      expect(edge.strength.mean).toBe(0.8);
      expect(edge.strength.std).toBe(0.1);
    });

    it('applies negative direction', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        weight: 0.5,
        effect_direction: 'negative',
      }, 0);

      expect(edge.strength.mean).toBe(-0.5);
    });

    it('clamps exists_probability to [0, 1]', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        exists_probability: 1.5,
      }, 0);

      expect(edge.exists_probability).toBe(1.0);
    });

    it('throws on missing from', () => {
      expect(() => normaliseEdge({ to: 'b' } as any, 0)).toThrow(NormalisationError);
    });

    it('throws on missing to', () => {
      expect(() => normaliseEdge({ from: 'a' } as any, 0)).toThrow(NormalisationError);
    });

    it('ensures std > 0', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        strength: { mean: 0, std: 0 },
      }, 0);

      expect(edge.strength.std).toBeGreaterThan(0);
    });

    it('derives std from belief_strength', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        weight: 1.0,
        belief_strength: 0.9, // high confidence = low std
      }, 0);

      const lowConfEdge = normaliseEdge({
        from: 'a',
        to: 'b',
        weight: 1.0,
        belief_strength: 0.2, // low confidence = high std
      }, 1);

      expect(lowConfEdge.strength.std).toBeGreaterThan(edge.strength.std);
    });
  });

  describe('normaliseGraph', () => {
    it('normalizes complete graph', () => {
      const result = normaliseGraph({
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'b', kind: 'goal', label: 'B' },
        ],
        edges: [
          { from: 'a', to: 'b', weight: 0.5 },
        ],
      });

      expect(result.graph.nodes).toHaveLength(2);
      expect(result.graph.edges).toHaveLength(1);
      expect(result.nodesNormalised).toBe(2);
      expect(result.edgesNormalised).toBe(1);
      expect(result.warnings).toHaveLength(0);
    });

    it('warns about option nodes', () => {
      const result = normaliseGraph({
        nodes: [
          { id: 'opt1', kind: 'option', label: 'Option 1' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('option');
    });

    it('handles empty graph', () => {
      const result = normaliseGraph({ nodes: [], edges: [] });

      expect(result.graph.nodes).toHaveLength(0);
      expect(result.graph.edges).toHaveLength(0);
    });

    it('preserves option nodes (filtering done separately)', () => {
      const result = normaliseGraph({
        nodes: [
          { id: 'opt1', kind: 'option', label: 'Option 1' },
        ],
        edges: [],
      });

      // Option nodes are normalized but NOT filtered here
      expect(result.graph.nodes).toHaveLength(1);
      expect(result.graph.nodes[0].kind).toBe('option');
    });

    it('infers negative coefficient for risk → goal edges', () => {
      const result = normaliseGraph({
        nodes: [
          { id: 'risk_budget_overrun', kind: 'risk', label: 'Budget Overrun' },
          { id: 'goal_productivity', kind: 'goal', label: 'Increase Productivity' },
        ],
        edges: [
          { from: 'risk_budget_overrun', to: 'goal_productivity', weight: 0.5 },
        ],
      });

      // Risk → goal should have NEGATIVE coefficient (risks reduce goal achievement)
      expect(result.graph.edges[0].strength.mean).toBe(-0.5);
    });

    it('infers negative coefficient for risk → outcome edges', () => {
      const result = normaliseGraph({
        nodes: [
          { id: 'risk_delay', kind: 'risk', label: 'Project Delay' },
          { id: 'out_delivery', kind: 'outcome', label: 'On-time Delivery' },
        ],
        edges: [
          { from: 'risk_delay', to: 'out_delivery', weight: 0.7 },
        ],
      });

      // Risk → outcome should have NEGATIVE coefficient
      expect(result.graph.edges[0].strength.mean).toBe(-0.7);
    });

    it('preserves positive coefficient for outcome → goal edges', () => {
      const result = normaliseGraph({
        nodes: [
          { id: 'out_quality', kind: 'outcome', label: 'High Quality' },
          { id: 'goal_success', kind: 'goal', label: 'Project Success' },
        ],
        edges: [
          { from: 'out_quality', to: 'goal_success', weight: 0.8 },
        ],
      });

      // Outcome → goal should have POSITIVE coefficient (outcomes increase goal)
      expect(result.graph.edges[0].strength.mean).toBe(0.8);
    });

    it('respects explicit effect_direction over inferred', () => {
      const result = normaliseGraph({
        nodes: [
          { id: 'risk_node', kind: 'risk', label: 'Risk' },
          { id: 'goal_node', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          // Explicit positive direction should override the inferred negative
          { from: 'risk_node', to: 'goal_node', weight: 0.5, effect_direction: 'positive' },
        ],
      });

      // Explicit direction takes precedence
      expect(result.graph.edges[0].strength.mean).toBe(0.5);
    });

    it('handles risk → factor edges as positive (not a goal)', () => {
      const result = normaliseGraph({
        nodes: [
          { id: 'risk_market', kind: 'risk', label: 'Market Risk' },
          { id: 'factor_cost', kind: 'factor', label: 'Operating Cost' },
        ],
        edges: [
          { from: 'risk_market', to: 'factor_cost', weight: 0.6 },
        ],
      });

      // Risk → factor defaults to positive (only risk→goal/outcome is negative)
      expect(result.graph.edges[0].strength.mean).toBe(0.6);
    });
  });
});
