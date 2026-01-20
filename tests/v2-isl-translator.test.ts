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

    it('transforms graph structure correctly', () => {
      const result = toISLRobustnessRequest(graph, options, 'goal', 'req-123', 1000);

      // Check nodes
      expect(result.graph.nodes).toHaveLength(3);
      expect(result.graph.nodes[0]).toEqual({
        id: 'factor-a',
        kind: 'factor',
        label: 'Factor A',
        observed_state: { value: 50 },
        intercept: 0.0,
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

    it('includes intercept for all nodes (default 0.0)', () => {
      const graphWithIntercept: EngineGraphV3 = {
        nodes: [
          { id: 'fac_price', kind: 'factor', label: 'Price', intercept: 0.0 },
          { id: 'out_revenue', kind: 'outcome', label: 'Revenue', intercept: 500.0 },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'fac_price', to: 'out_revenue', exists_probability: 1.0, strength: { mean: 0.5, std: 0.1 } },
          { from: 'out_revenue', to: 'goal', exists_probability: 1.0, strength: { mean: 0.8, std: 0.1 } },
        ],
      };

      const result = toISLRobustnessRequest(graphWithIntercept, options, 'goal', 'req-123', 1000);
      const fac = result.graph.nodes.find((n) => n.id === 'fac_price');
      const out = result.graph.nodes.find((n) => n.id === 'out_revenue');
      const goal = result.graph.nodes.find((n) => n.id === 'goal');

      expect(fac?.intercept).toBe(0.0);
      expect(out?.intercept).toBe(500.0);
      expect(goal?.intercept).toBe(0.0);
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
        analysis_types: ['comparison'] as Array<'comparison' | 'sensitivity' | 'robustness'>,
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
        analysis_types: ['comparison'] as Array<'comparison' | 'sensitivity' | 'robustness'>,
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
        analysis_types: ['comparison'] as Array<'comparison' | 'sensitivity' | 'robustness'>,
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
        analysis_types: ['comparison'] as Array<'comparison' | 'sensitivity' | 'robustness'>,
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

  describe('buildParameterUncertaintiesV3 - std calculation', () => {
    it('uses range-based std when state_space.range is provided', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'pa-hired',
          kind: 'factor',
          label: 'PA Hired',
          observed_state: { value: 0 },
          state_space: { range: { min: 0, max: 1 } },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      // 10% of range (1 - 0) = 0.1
      expect(result![0].std).toBe(0.1);
    });

    it('uses large range-based std for factors like salary', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'pa-salary',
          kind: 'factor',
          label: 'PA Salary',
          observed_state: { value: 0 },
          state_space: { range: { min: 0, max: 50000 } },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      // 10% of range (50000 - 0) = 5000
      expect(result![0].std).toBe(5000);
    });

    it('uses value-based std when no range is provided', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'pro-price',
          kind: 'factor',
          label: 'Pro Price',
          observed_state: { value: 49 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      // 10% of value (49) = 4.9
      expect(result![0].std).toBe(4.9);
    });

    it('uses fallback std=1.0 for zero-valued factor without range', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'zero-factor',
          kind: 'factor',
          label: 'Zero Factor',
          observed_state: { value: 0 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      // Fallback for zero without range = 1.0
      expect(result![0].std).toBe(1.0);
    });

    it('applies floor of 0.1 to small range-based std', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'rate',
          kind: 'factor',
          label: 'Rate',
          observed_state: { value: 0.2 },
          state_space: { range: { min: 0, max: 1 } },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      // 10% of range (1 - 0) = 0.1, which equals floor
      expect(result![0].std).toBe(0.1);
    });

    it('applies floor of 0.1 to very small value-based std', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'tiny-factor',
          kind: 'factor',
          label: 'Tiny Factor',
          observed_state: { value: 0.5 },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      // 10% of value (0.5) = 0.05 < 0.1, so floor applies
      expect(result![0].std).toBe(0.1);
    });

    it('handles degenerate range (max === min)', () => {
      const nodes: EngineNodeV3[] = [
        {
          id: 'degenerate-range',
          kind: 'factor',
          label: 'Degenerate Range',
          observed_state: { value: 5 },
          state_space: { range: { min: 5, max: 5 } },
        },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      // Degenerate range falls back to value-based: 10% of 5 = 0.5
      expect(result![0].std).toBe(0.5);
    });

    it('skips non-factor nodes', () => {
      const nodes: EngineNodeV3[] = [
        { id: 'goal', kind: 'goal', label: 'Goal' },
        { id: 'outcome', kind: 'outcome', label: 'Outcome' },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeUndefined();
    });

    it('skips factor nodes without observed_state', () => {
      const nodes: EngineNodeV3[] = [
        { id: 'factor-no-value', kind: 'factor', label: 'Factor No Value' },
      ];

      const result = buildParameterUncertaintiesV3(nodes);

      expect(result).toBeUndefined();
    });
  });
});
