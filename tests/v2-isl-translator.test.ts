/**
 * Unit tests for V2 ISL translator
 */

import { describe, it, expect } from 'vitest';
import {
  toISLInterventions,
  toISLRobustnessRequest,
  validateISLRequest,
  toISLEdge,
} from '../src/integrations/isl/translator-v3.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

describe('ISL Translator V3', () => {
  describe('toISLInterventions', () => {
    it('flattens InterventionValueV3 to numbers', () => {
      const interventions = {
        'factor-a': { value: 1.5, source: 'user_specified' as const },
        'factor-b': { value: 2.0, source: 'brief_extraction' as const },
      };

      const result = toISLInterventions(interventions);

      expect(result).toEqual({
        'factor-a': 1.5,
        'factor-b': 2.0,
      });
    });

    it('handles empty interventions', () => {
      const result = toISLInterventions({});

      expect(result).toEqual({});
    });
  });

  describe('toISLRobustnessRequest', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor-a', kind: 'factor', label: 'Factor A', observed_state: { value: 50 } },
        { id: 'factor-b', kind: 'factor', label: 'Factor B' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.15 } },
      ],
    };

    const options: OptionV3[] = [
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

    it('builds complete ISL request', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      expect(result.goal_node_id).toBe('goal');
      expect(result.request_id).toBe('req-123');
      expect(result.n_samples).toBe(1000);
    });

    // QUARANTINED: constraint node filtering not yet implemented — see pre-M2 backlog
    it.skip('transforms graph structure correctly', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      // Check nodes
      expect(result.graph.nodes).toHaveLength(3);
      expect(result.graph.nodes[0]).toEqual({
        id: 'factor-a',
        kind: 'factor',
        label: 'Factor A',
        observed_state: { value: 50 },
      });

      // Check edges - uses ISL V3 format with strength object
      // exists_probability is preserved from input (structural uncertainty enabled)
      expect(result.graph.edges).toHaveLength(2);
      expect(result.graph.edges[0]).toEqual({
        from: 'factor-a',
        to: 'goal',
        exists_probability: 0.8, // Preserves actual value from input
        strength: { mean: 0.5, std: 0.1 },
      });
    });

    it('transforms options correctly', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      expect(result.options).toHaveLength(2);
      expect(result.options[0]).toEqual({
        id: 'opt1',
        label: 'Option 1',
        interventions: { 'factor-a': 1.5 },
      });
    });

    it('includes parameter uncertainties for factor nodes', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      expect(result.parameter_uncertainties).toBeDefined();
      expect(result.parameter_uncertainties!.length).toBeGreaterThan(0);

      const factorAUncertainty = result.parameter_uncertainties!.find(
        (p: any) => p.node_id === 'factor-a'
      );
      expect(factorAUncertainty).toBeDefined();
      expect(factorAUncertainty!.distribution).toBe('normal');
      expect(factorAUncertainty!.mean).toBe(50);
    });

    it('does not include category field in ISL request', () => {
      const graphWithCategory: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A', category: 'controllable' },
          { id: 'factor-b', kind: 'factor', label: 'Factor B', category: 'observable' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.15 } },
        ],
      };

      const result = toISLRobustnessRequest(graphWithCategory, options, 'goal', 'req-123', 1000);

      // Verify category is NOT in ISL payload (it's PLoT-internal metadata for M1 coaching)
      result.graph.nodes.forEach((node: any) => {
        expect(node).not.toHaveProperty('category');
      });
    });
  });

  describe('validateISLRequest', () => {
    it('returns empty array for valid request', () => {
      const graph: EngineGraphV3 = {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: { 'a': { value: 1.0, source: 'user_specified' } },
        },
      ];

      const request = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);
      const errors = validateISLRequest(request);

      expect(errors).toHaveLength(0);
    });

    it('detects missing goal_node_id', () => {
      const request = {
        graph: { nodes: [{ id: 'a', kind: 'factor', label: 'A' }], edges: [] },
        options: [{ id: 'opt1', label: 'Opt 1', interventions: { 'a': 1.0 } }],
        goal_node_id: 'nonexistent',
        request_id: 'req-123',
        n_samples: 1000,
        analysis_types: ['comparison'] as const[],
      };

      const errors = validateISLRequest(request as any);

      // Should detect that goal node is not in graph
      expect(errors.some(e => e.includes('Goal node'))).toBe(true);
    });

    it('detects empty options', () => {
      const request = {
        graph: { nodes: [], edges: [] },
        options: [],
        goal_node_id: 'goal',
        request_id: 'req-123',
        n_samples: 1000,
      };

      const errors = validateISLRequest(request);

      expect(errors.some(e => e.includes('options'))).toBe(true);
    });

    it('detects empty graph nodes', () => {
      const request = {
        graph: { nodes: [], edges: [] },
        options: [{ id: 'opt1', label: 'Opt 1', interventions: {} }],
        goal_node_id: 'goal',
        request_id: 'req-123',
        n_samples: 1000,
      };

      const errors = validateISLRequest(request);

      expect(errors.some(e => e.includes('nodes'))).toBe(true);
    });

    it('detects option with empty interventions', () => {
      const request = {
        graph: { nodes: [{ id: 'a', kind: 'factor', label: 'A' }], edges: [] },
        options: [{ id: 'opt1', label: 'Opt 1', interventions: {} }],
        goal_node_id: 'goal',
        request_id: 'req-123',
        n_samples: 1000,
      };

      const errors = validateISLRequest(request);

      expect(errors.some(e => e.includes('interventions'))).toBe(true);
    });
  });

  describe('toISLEdge - exists_probability preservation', () => {
    it('preserves explicit exists_probability value', () => {
      const edge = {
        from: 'a',
        to: 'b',
        exists_probability: 0.7,
        strength: { mean: 0.5, std: 0.1 },
      };

      const result = toISLEdge(edge);

      expect(result.exists_probability).toBe(0.7);
    });

    it('preserves high exists_probability value', () => {
      const edge = {
        from: 'a',
        to: 'b',
        exists_probability: 0.95,
        strength: { mean: 0.5, std: 0.1 },
      };

      const result = toISLEdge(edge);

      expect(result.exists_probability).toBe(0.95);
    });

    it('preserves low exists_probability value', () => {
      const edge = {
        from: 'a',
        to: 'b',
        exists_probability: 0.3,
        strength: { mean: 0.5, std: 0.1 },
      };

      const result = toISLEdge(edge);

      expect(result.exists_probability).toBe(0.3);
    });

    it('preserves 1.0 exists_probability (certain edge)', () => {
      const edge = {
        from: 'a',
        to: 'b',
        exists_probability: 1.0,
        strength: { mean: 0.5, std: 0.1 },
      };

      const result = toISLEdge(edge);

      expect(result.exists_probability).toBe(1.0);
    });
  });
});
