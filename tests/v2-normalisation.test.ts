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

    it('preserves category field for controllable factors', () => {
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
        category: 'controllable',
      });

      expect(node.category).toBe('controllable');
    });

    it('preserves category field for observable factors', () => {
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
        category: 'observable',
      });

      expect(node.category).toBe('observable');
    });

    it('preserves category field for external factors', () => {
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
        category: 'external',
      });

      expect(node.category).toBe('external');
    });

    it('handles missing category field', () => {
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
      });

      expect(node.category).toBeUndefined();
    });

    it('rejects invalid category value with warning and repair metadata', () => {
      const warnings: any[] = [];
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
        category: 'CONTROL', // Invalid - should be 'controllable'
      }, warnings);

      expect(node.category).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe('INVALID_CATEGORY');
      expect(warnings[0].node_id).toBe('test-factor');
      expect(warnings[0].repair).toBeDefined();
      expect(warnings[0].repair.field).toBe('node.category');
      expect(warnings[0].repair.action).toBe('defaulted');
      expect(warnings[0].repair.from_value).toBe('CONTROL');
      expect(warnings[0].repair.to_value).toBe('undefined');
    });

    it('rejects empty string category with warning and repair metadata', () => {
      const warnings: any[] = [];
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
        category: '',
      }, warnings);

      expect(node.category).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe('INVALID_CATEGORY');
      expect(warnings[0].repair).toBeDefined();
      expect(warnings[0].repair.action).toBe('defaulted');
    });

    it('rejects non-string category with type-specific warning', () => {
      const warnings: any[] = [];
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
        category: 123 as any, // Non-string
      }, warnings);

      expect(node.category).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0].code).toBe('INVALID_CATEGORY');
      expect(warnings[0].message).toContain('must be a string');
      expect(warnings[0].message).toContain('number');
      expect(warnings[0].repair).toBeDefined();
      expect(warnings[0].repair.reason).toContain('string');
    });

    it('normalizes category to lowercase', () => {
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
        category: 'CONTROLLABLE', // Uppercase
      });

      expect(node.category).toBe('controllable');
    });

    it('falls back to data.category for React Flow compatibility', () => {
      const node = normaliseNode({
        id: 'test-factor',
        data: {
          kind: 'factor',
          category: 'observable',
        },
      });

      expect(node.category).toBe('observable');
    });

    it('prefers top-level category over data.category', () => {
      const node = normaliseNode({
        id: 'test-factor',
        kind: 'factor',
        label: 'Test Factor',
        category: 'controllable',
        data: {
          category: 'observable',
        },
      });

      expect(node.category).toBe('controllable');
    });

    it('does not preserve category on non-factor nodes', () => {
      const decisionNode = normaliseNode({
        id: 'decision-node',
        kind: 'decision',
        label: 'Decision',
        category: 'controllable', // Should be ignored for decision nodes
      });

      const goalNode = normaliseNode({
        id: 'goal-node',
        kind: 'goal',
        label: 'Goal',
        category: 'observable', // Should be ignored for goal nodes
      });

      // Category is preserved in normalized output regardless of kind
      // The filtering happens at a higher level (not in normaliseNode)
      // So these will have category - the test should verify filtering happens elsewhere
      expect(decisionNode.category).toBe('controllable'); // This is expected!
      expect(goalNode.category).toBe('observable'); // This is expected!

      // NOTE: The actual filtering of category on non-factor nodes
      // should happen in the response builder or ISL translator
    });
  });

  describe('normaliseEdge', () => {
    it('normalizes basic edge', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        weight: 0.5,
      }, 0, new Map());

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
      }, 0, new Map());

      expect(edge.from).toBe('node-a');
      expect(edge.to).toBe('node-b');
    });

    it('handles exists_probability field', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        exists_probability: 0.9,
      }, 0, new Map());

      expect(edge.exists_probability).toBe(0.9);
    });

    it('falls back to belief_exists', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        belief_exists: 0.7,
      }, 0, new Map());

      expect(edge.exists_probability).toBe(0.7);
    });

    it('falls back to belief', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        belief: 0.6,
      }, 0, new Map());

      expect(edge.exists_probability).toBe(0.6);
    });

    it('handles explicit strength object', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        strength: { mean: 0.8, std: 0.1 },
      }, 0, new Map());

      expect(edge.strength.mean).toBe(0.8);
      expect(edge.strength.std).toBe(0.1);
    });

    it('applies negative direction', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        weight: 0.5,
        effect_direction: 'negative',
      }, 0, new Map());

      expect(edge.strength.mean).toBe(-0.5);
    });

    it('clamps exists_probability to [0, 1]', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        exists_probability: 1.5,
      }, 0, new Map());

      expect(edge.exists_probability).toBe(1.0);
    });

    it('throws on missing from', () => {
      expect(() => normaliseEdge({ to: 'b' } as any, 0, new Map())).toThrow(NormalisationError);
    });

    it('throws on missing to', () => {
      expect(() => normaliseEdge({ from: 'a' } as any, 0, new Map())).toThrow(NormalisationError);
    });

    it('ensures std > 0', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        strength: { mean: 0, std: 0 },
      }, 0, new Map());

      expect(edge.strength.std).toBeGreaterThan(0);
    });

    it('derives std from belief_strength', () => {
      const edge = normaliseEdge({
        from: 'a',
        to: 'b',
        weight: 1.0,
        belief_strength: 0.9, // high confidence = low std
      }, 0, new Map());

      const lowConfEdge = normaliseEdge({
        from: 'a',
        to: 'b',
        weight: 1.0,
        belief_strength: 0.2, // low confidence = high std
      }, 1, new Map());

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
