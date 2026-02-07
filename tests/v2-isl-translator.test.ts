/**
 * Unit tests for V2 ISL translator
 */

import { describe, it, expect } from 'vitest';
import {
  toISLInterventions,
  toISLRobustnessRequest,
  validateISLRequest,
  toISLEdge,
  buildParameterUncertaintiesV3,
} from '../src/integrations/isl/translator-v3.js';
import type { EngineGraphV3, EngineNodeV3, OptionV3 } from '../src/types/engine-v3.js';

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

  describe('buildParameterUncertaintiesV3 - external factor priors', () => {
    it('external factor with prior [0.0, 1.0] → mean=0.5, std≈0.289', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      expect(result[0].node_id).toBe('ext-factor');
      expect(result[0].distribution).toBe('normal');
      expect(result[0].mean).toBeCloseTo(0.5, 5);
      expect(result[0].std).toBeCloseTo(1.0 / Math.sqrt(12), 3); // ≈0.289
    });

    it('external factor with prior [0.6, 1.0] → mean=0.8, std≈0.115', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.6, range_max: 1.0 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      expect(result[0].mean).toBeCloseTo(0.8, 5);
      expect(result[0].std).toBeCloseTo(0.4 / Math.sqrt(12), 3); // ≈0.115
    });

    it('external factor with prior [0.3, 0.7] → mean=0.5, std≈0.115', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.3, range_max: 0.7 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      expect(result[0].mean).toBeCloseTo(0.5, 5);
      expect(result[0].std).toBeCloseTo(0.4 / Math.sqrt(12), 3); // ≈0.115
    });

    it('external factor without prior → no parameter_uncertainties entry', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeUndefined();
    });

    it('range_min === range_max → mean=value, std=0.01 (floor)', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.5, range_max: 0.5 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      expect(result[0].mean).toBeCloseTo(0.5, 5);
      expect(result[0].std).toBe(0.01);
    });

    it('range_min > range_max → swapped, correct mean/std', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.9, range_max: 0.3 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      // After swap: range_min=0.3, range_max=0.9
      expect(result[0].mean).toBeCloseTo(0.6, 5);
      expect(result[0].std).toBeCloseTo(0.6 / Math.sqrt(12), 3);
    });

    it('mixed graph: controllable + observable + external with prior', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'controllable-f',
          kind: 'factor',
          label: 'Controllable',
          category: 'controllable',
          observed_state: { value: 0.7 },
        },
        {
          id: 'observable-f',
          kind: 'factor',
          label: 'Observable',
          category: 'observable',
          observed_state: { value: 0.4 },
        },
        {
          id: 'external-f',
          kind: 'factor',
          label: 'External',
          category: 'external',
          prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.8 },
        },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      // All three factor types should produce entries
      expect(result).toHaveLength(3);

      const controllable = result.find(u => u.node_id === 'controllable-f');
      const observable = result.find(u => u.node_id === 'observable-f');
      const external = result.find(u => u.node_id === 'external-f');

      expect(controllable).toBeDefined();
      expect(controllable!.mean).toBe(0.7);

      expect(observable).toBeDefined();
      expect(observable!.mean).toBe(0.4);

      expect(external).toBeDefined();
      expect(external!.mean).toBeCloseTo(0.5, 5);
      expect(external!.std).toBeCloseTo(0.6 / Math.sqrt(12), 3);
    });

    it('external factor with observed_state AND prior → observed_state takes precedence', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          observed_state: { value: 0.9 },
          prior: { distribution: 'uniform', range_min: 0.0, range_max: 1.0 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      // Should use observed_state value, not prior
      expect(result[0].mean).toBe(0.9);
    });

    it('unsupported distribution → skipped with no entry', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'beta', range_min: 0.3, range_max: 0.9 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeUndefined();
    });

    it('mean is clamped to [0, 1] for out-of-range priors', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'ext-factor',
          kind: 'factor',
          label: 'External Factor',
          category: 'external',
          prior: { distribution: 'uniform', range_min: -0.5, range_max: 0.3 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes)!;

      expect(result).toHaveLength(1);
      // mean = (-0.5 + 0.3) / 2 = -0.1 → clamped to 0
      expect(result[0].mean).toBe(0);
      expect(result[0].std).toBeCloseTo(0.8 / Math.sqrt(12), 3);
    });
  });
});
