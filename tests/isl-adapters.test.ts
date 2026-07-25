/**
 * ISL Adapter Unit Tests
 *
 * Tests for the ISL response adapter modules:
 * - validation.ts
 * - counterfactual.ts
 * - robustness-analysis.ts
 * - robustness-enrichment.ts
 */

import { describe, it, expect } from 'vitest';

// Validation adapter
import {
  adaptValidationResponse,
  createFallbackValidation,
} from '../src/integrations/isl/adapters/validation.js';

// Counterfactual adapter
import {
  adaptCounterfactualResponse,
  createFallbackCounterfactual,
} from '../src/integrations/isl/adapters/counterfactual.js';

// Robustness analysis adapter
import {
  normalizeFragileEdges,
  normalizeRobustEdges,
  adaptRobustnessAnalysisResponse,
  createFallbackRobustnessAnalysis,
  createLocalHeuristicResult,
} from '../src/integrations/isl/adapters/robustness-analysis.js';

// Robustness enrichment adapter
import {
  parseEdgeFrom,
  parseEdgeTo,
  getNodeLabel,
  getOptionLabel,
  enrichFragileEdge,
  enrichRobustEdge,
} from '../src/integrations/isl/adapters/robustness-enrichment.js';

// Types
import type { ISLValidationResponse } from '../src/integrations/isl/types/isl-types.js';

// =============================================================================
// Validation Adapter Tests
// =============================================================================

describe('Validation Adapter', () => {
  describe('adaptValidationResponse', () => {
    it('maps identifiable status correctly', () => {
      const islResponse: ISLValidationResponse = {
        status: 'identifiable',
        robustness: 'high',
        adjustment_sets: [['var_a', 'var_b']],
        minimal_adjustment_set: ['var_a'],
        suggestions: [],
      };

      const result = adaptValidationResponse(islResponse);

      expect(result.status).toBe('identifiable');
      expect(result.confidence).toBe('high');
      expect(result.adjustment_sets).toEqual([['var_a', 'var_b']]);
      expect(result.minimal_set).toEqual(['var_a']);
      expect(result.source).toBe('isl');
    });

    it('maps partially_identifiable status to uncertain', () => {
      const islResponse: ISLValidationResponse = {
        status: 'partially_identifiable',
        robustness: 'medium',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [],
      };

      const result = adaptValidationResponse(islResponse);

      expect(result.status).toBe('uncertain');
      expect(result.confidence).toBe('medium');
    });

    it('maps not_identifiable status to cannot_identify', () => {
      const islResponse: ISLValidationResponse = {
        status: 'not_identifiable',
        robustness: 'low',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [],
      };

      const result = adaptValidationResponse(islResponse);

      expect(result.status).toBe('cannot_identify');
      expect(result.confidence).toBe('low');
    });

    it('transforms suggestions to issues', () => {
      const islResponse: ISLValidationResponse = {
        status: 'partially_identifiable',
        robustness: 'medium',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [
          {
            type: 'confounding',
            description: 'Unmeasured confounder detected',
            affected_variables: ['var_x', 'var_y'],
            suggested_action: 'Consider adding measurement for Z',
          },
        ],
      };

      const result = adaptValidationResponse(islResponse);

      expect(result.issues).toHaveLength(1);
      expect(result.issues![0].type).toBe('confounding');
      expect(result.issues![0].affected_nodes).toEqual(['var_x', 'var_y']);
    });

    it('generates explanation for identifiable status', () => {
      const islResponse: ISLValidationResponse = {
        status: 'identifiable',
        robustness: 'high',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [],
      };

      const result = adaptValidationResponse(islResponse);

      expect(result.explanation.summary).toContain('identifiable without adjustment');
      expect(result.explanation.reasoning).toContain('No backdoor paths');
    });

    it('generates explanation with adjustment set', () => {
      const islResponse: ISLValidationResponse = {
        status: 'identifiable',
        robustness: 'high',
        adjustment_sets: [['var_a']],
        minimal_adjustment_set: ['var_a'],
        suggestions: [],
      };

      const result = adaptValidationResponse(islResponse);

      expect(result.explanation.summary).toContain('1 adjustment');
      expect(result.explanation.reasoning).toContain('var_a');
    });

    it('omits empty arrays in result', () => {
      const islResponse: ISLValidationResponse = {
        status: 'identifiable',
        robustness: 'high',
        adjustment_sets: [],
        minimal_adjustment_set: [],
        suggestions: [],
      };

      const result = adaptValidationResponse(islResponse);

      expect(result.adjustment_sets).toBeUndefined();
      expect(result.minimal_set).toBeUndefined();
      expect(result.issues).toBeUndefined();
    });
  });

  describe('createFallbackValidation', () => {
    it('creates uncertain status fallback', () => {
      const result = createFallbackValidation('ISL timeout');

      expect(result.status).toBe('uncertain');
      expect(result.confidence).toBe('low');
      expect(result.explanation.summary).toContain('unavailable');
      expect(result.explanation.reasoning).toBe('ISL timeout');
      expect(result.source).toBe('engine_fallback');
    });
  });
});

// =============================================================================
// Counterfactual Adapter Tests
// =============================================================================

describe('Counterfactual Adapter', () => {
  describe('adaptCounterfactualResponse', () => {
    it('transforms ISL response to PLoT format', () => {
      const islResponse = {
        estimate: 0.75,
        confidence_interval: { lower: 0.5, upper: 1.0 },
        uncertainty_decomposition: {
          parametric: 0.1,
          structural: 0.2,
          stochastic: 0.15,
        },
      };

      const result = adaptCounterfactualResponse(islResponse);

      expect(result.estimate).toBe(0.75);
      expect(result.confidence_interval.p10).toBe(0.5);
      expect(result.confidence_interval.p50).toBe(0.75);
      expect(result.confidence_interval.p90).toBe(1.0);
      expect(result.source).toBe('isl');
    });

    it('calculates total uncertainty correctly', () => {
      const islResponse = {
        estimate: 0.5,
        confidence_interval: { lower: 0.3, upper: 0.7 },
        uncertainty_decomposition: {
          parametric: 0.3,
          structural: 0.4,
          stochastic: 0.0,
        },
      };

      const result = adaptCounterfactualResponse(islResponse);

      // sqrt(0.3^2 + 0.4^2 + 0^2) = sqrt(0.09 + 0.16) = sqrt(0.25) = 0.5
      expect(result.uncertainty.total).toBe(0.5);
    });

    it('preserves uncertainty breakdown', () => {
      const islResponse = {
        estimate: 0.5,
        confidence_interval: { lower: 0.3, upper: 0.7 },
        uncertainty_decomposition: {
          parametric: 0.1,
          structural: 0.2,
          stochastic: 0.3,
        },
      };

      const result = adaptCounterfactualResponse(islResponse);

      expect(result.uncertainty.breakdown.parametric).toBe(0.1);
      expect(result.uncertainty.breakdown.structural).toBe(0.2);
      expect(result.uncertainty.breakdown.stochastic).toBe(0.3);
    });
  });

  describe('createFallbackCounterfactual', () => {
    it('creates zero estimate fallback', () => {
      const result = createFallbackCounterfactual('ISL unavailable');

      expect(result.estimate).toBe(0);
      expect(result.confidence_interval.p10).toBe(0);
      expect(result.confidence_interval.p50).toBe(0);
      expect(result.confidence_interval.p90).toBe(0);
      expect(result.uncertainty.total).toBe(1);
      expect(result.source).toBe('engine_fallback');
    });
  });
});

// =============================================================================
// Robustness Analysis Adapter Tests
// =============================================================================

describe('Robustness Analysis Adapter', () => {
  describe('normalizeFragileEdges', () => {
    it('normalizes object format edges', () => {
      const edges = [
        { edge_id: 'a->b', from_id: 'a', to_id: 'b', switch_probability: 0.3 },
        { edge_id: 'c::d', from_id: 'c', to_id: 'd', switch_probability: 0.7 },
      ];

      const result = normalizeFragileEdges(edges);

      expect(result.edges).toHaveLength(2);
      // Field mapping asserted by IDENTITY, not position — normalizeFragileEdges
      // sorts most-fragile-first (see the ordering test below), so `a->b`
      // (0.3) is no longer index 0.
      const ab = result.edges.find((e) => e.edge_id === 'a->b')!;
      expect(ab).toBeDefined();
      expect(ab.from_id).toBe('a');
      expect(ab.to_id).toBe('b');
      expect(ab.switch_probability).toBe(0.3);
      expect(result.errors).toHaveLength(0);
    });

    it('sorts most-fragile-first (ISL does not emit fragility order)', () => {
      // Deliberately supplied ascending, i.e. the SHAPE of the live ISL wire,
      // where fragile_edges[0] was the LEAST fragile.
      const edges = [
        { edge_id: 'low', from_id: 'a', to_id: 'b', switch_probability: 0.075 },
        { edge_id: 'mid', from_id: 'c', to_id: 'd', switch_probability: 0.4 },
        { edge_id: 'high', from_id: 'e', to_id: 'f', switch_probability: 0.61 },
      ];
      const result = normalizeFragileEdges(edges);
      expect(result.edges.map((e) => e.edge_id)).toEqual(['high', 'mid', 'low']);
    });

    it('sorts entries with NO switch_probability last, never ahead of a measured edge', () => {
      // Legacy STRING entries deliberately carry no switch_probability (omitted
      // rather than fabricated as 0) — they must not outrank a measured edge.
      const result = normalizeFragileEdges([
        'legacy_a->legacy_b',
        { edge_id: 'measured', from_id: 'c', to_id: 'd', switch_probability: 0.02 },
      ]);
      expect(result.edges.map((e) => e.edge_id)).toEqual(['measured', 'legacy_a->legacy_b']);
      expect(result.edges[1].switch_probability).toBeUndefined();
    });

    it('handles string format edges (legacy)', () => {
      const edges = ['a->b', 'c::d'];

      const result = normalizeFragileEdges(edges);

      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].edge_id).toBe('a->b');
      expect(result.edges[0].from_id).toBe('a');
      expect(result.edges[0].to_id).toBe('b');
      // Legacy string edges carry no sp data — omitted, not fabricated 0.
      expect(result.edges[0].switch_probability).toBeUndefined();
    });

    it('parses from_id and to_id from edge_id when missing', () => {
      const edges = [{ edge_id: 'node1->node2' }];

      const result = normalizeFragileEdges(edges);

      expect(result.edges[0].from_id).toBe('node1');
      expect(result.edges[0].to_id).toBe('node2');
    });

    it('handles double-colon separator', () => {
      const edges = [{ edge_id: 'factor_a::goal_node' }];

      const result = normalizeFragileEdges(edges);

      expect(result.edges[0].from_id).toBe('factor_a');
      expect(result.edges[0].to_id).toBe('goal_node');
    });

    it('tracks errors for unknown formats', () => {
      const edges = [123, null, { no_edge_id: true }];

      const result = normalizeFragileEdges(edges as any);

      expect(result.edges).toHaveLength(0);
      expect(result.errors).toHaveLength(3);
    });

    it('handles undefined input', () => {
      const result = normalizeFragileEdges(undefined);

      expect(result.edges).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('omits switch_probability when missing (absent ≠ 0)', () => {
      const edges = [{ edge_id: 'a->b' }];

      const result = normalizeFragileEdges(edges);

      expect(result.edges[0].switch_probability).toBeUndefined();
    });
  });

  describe('normalizeRobustEdges', () => {
    it('normalizes string format edges', () => {
      const edges = ['a->b', 'c::d'];

      const result = normalizeRobustEdges(edges);

      expect(result.edges).toHaveLength(2);
      expect(result.edges[0].edge_id).toBe('a->b');
      expect(result.edges[0].from_id).toBe('a');
      expect(result.edges[0].to_id).toBe('b');
      expect(result.edges[0].switch_probability).toBe(1); // Robust = 100% stability
    });

    it('handles object format edges (fallback)', () => {
      const edges = [{ edge_id: 'x->y', from_id: 'x', to_id: 'y', switch_probability: 0.9 }];

      const result = normalizeRobustEdges(edges);

      expect(result.edges[0].switch_probability).toBe(0.9);
    });

    it('defaults switch_probability to 1 for object format', () => {
      const edges = [{ edge_id: 'x->y' }];

      const result = normalizeRobustEdges(edges);

      expect(result.edges[0].switch_probability).toBe(1);
    });

    it('tracks errors for unknown formats', () => {
      const edges = [456, null];

      const result = normalizeRobustEdges(edges as any);

      expect(result.edges).toHaveLength(0);
      expect(result.errors).toHaveLength(2);
    });
  });

  describe('adaptRobustnessAnalysisResponse', () => {
    it('transforms full ISL V2 response', () => {
      const islResponse = {
        options: [
          { id: 'opt1', outcome: { mean: 0.8, std: 0.1 } },
        ],
        robustness: {
          confidence: 0.85,
          level: 'high' as const,
          fragile_edges: [{ edge_id: 'a->b', switch_probability: 0.2, marginal_switch_probability: 0.08 }],
          robust_edges: ['c->d'],
        },
        sensitivity: [
          { edge_from: 'a', edge_to: 'b', elasticity: 0.5, sensitivity_type: 'existence', importance_rank: 1, interpretation: 'High sensitivity' },
        ],
        factor_sensitivity: [
          { node_id: 'factor_1', sensitivity: 0.7, value_of_information: 0.3, direction: 'positive' },
        ],
      };

      const result = adaptRobustnessAnalysisResponse(
        islResponse as any,
        150,
        'available',
        'available'
      );

      expect(result.robustness_score).toBe(0.85);
      expect(result.overall_robustness).toBe('robust');
      expect(result.fragile_edges).toHaveLength(1);
      expect(result.robust_edges).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
      expect(result.factors).toHaveLength(1);
      expect(result.latency_ms).toBe(150);
      expect(result.source).toBe('isl');
    });

    it('maps robustness level to label correctly', () => {
      const testCases = [
        { level: 'high', expected: 'robust' },
        { level: 'medium', expected: 'moderate' },
        { level: 'low', expected: 'fragile' },
        { level: 'very_low', expected: 'fragile' },
      ];

      for (const { level, expected } of testCases) {
        const islResponse = {
          options: [],
          robustness: { level: level as any, fragile_edges: [], robust_edges: [] },
          sensitivity: [],
          factor_sensitivity: [],
        };

        const result = adaptRobustnessAnalysisResponse(
          islResponse as any,
          100,
          'available',
          'available'
        );

        expect(result.overall_robustness).toBe(expected);
      }
    });

    it('merges edge sensitivity by highest elasticity', () => {
      const islResponse = {
        options: [],
        robustness: { fragile_edges: [], robust_edges: [] },
        sensitivity: [
          { edge_from: 'a', edge_to: 'b', elasticity: 0.3, sensitivity_type: 'existence', importance_rank: 1, interpretation: '' },
          { edge_from: 'a', edge_to: 'b', elasticity: 0.7, sensitivity_type: 'magnitude', importance_rank: 2, interpretation: '' },
        ],
        factor_sensitivity: [],
      };

      const result = adaptRobustnessAnalysisResponse(
        islResponse as any,
        100,
        'available',
        'available'
      );

      // Should keep the magnitude entry with higher elasticity
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0].elasticity).toBe(0.7);
      expect(result.edges[0].sensitivity_type).toBe('magnitude');
    });

    it('sorts factors by absolute sensitivity descending', () => {
      const islResponse = {
        options: [],
        robustness: { fragile_edges: [], robust_edges: [] },
        sensitivity: [],
        factor_sensitivity: [
          { node_id: 'f1', sensitivity: 0.3, value_of_information: 0.1, direction: 'positive' },
          { node_id: 'f2', sensitivity: -0.8, value_of_information: 0.2, direction: 'negative' },
          { node_id: 'f3', sensitivity: 0.5, value_of_information: 0.15, direction: 'positive' },
        ],
      };

      const result = adaptRobustnessAnalysisResponse(
        islResponse as any,
        100,
        'available',
        'available'
      );

      expect(result.factors[0].factor_id).toBe('f2'); // |−0.8| highest
      expect(result.factors[1].factor_id).toBe('f3'); // |0.5|
      expect(result.factors[2].factor_id).toBe('f1'); // |0.3|
    });
  });

  describe('createFallbackRobustnessAnalysis', () => {
    it('creates empty result with failed status', () => {
      const result = createFallbackRobustnessAnalysis('ISL timeout');

      expect(result.edges).toHaveLength(0);
      expect(result.factors).toHaveLength(0);
      expect(result.overall_robustness).toBe('moderate');
      expect(result.robustness_score).toBe(0.5);
      expect(result.edge_sensitivity_status).toBe('failed');
      expect(result.factor_sensitivity_status).toBe('failed');
      expect(result.source).toBe('unavailable');
    });

    it('accepts custom status values', () => {
      const result = createFallbackRobustnessAnalysis(
        'reason',
        'skipped_no_parameter_uncertainties',
        'unavailable'
      );

      expect(result.edge_sensitivity_status).toBe('skipped_no_parameter_uncertainties');
      expect(result.factor_sensitivity_status).toBe('unavailable');
    });
  });

  describe('createLocalHeuristicResult', () => {
    it('creates result from local edge sensitivity', () => {
      const localEdges = [
        { edge_id: 'a::b', from: 'a', to: 'b', elasticity: 0.6, sensitivity_type: 'magnitude' as const, importance_rank: 1, interpretation: '' },
        { edge_id: 'c::d', from: 'c', to: 'd', elasticity: 0.1, sensitivity_type: 'magnitude' as const, importance_rank: 2, interpretation: '' },
      ];

      const result = createLocalHeuristicResult(localEdges, 50);

      expect(result.edges).toEqual(localEdges);
      expect(result.edges_provenance).toBe('plot:computeSensitivityAll');
      expect(result.edge_sensitivity_status).toBe('fallback_local_heuristic');
      expect(result.latency_ms).toBe(50);
    });

    it('derives fragile edges from high elasticity', () => {
      const localEdges = [
        { edge_id: 'a::b', from: 'a', to: 'b', elasticity: 0.8, sensitivity_type: 'magnitude' as const, importance_rank: 1, interpretation: '' },
      ];

      const result = createLocalHeuristicResult(localEdges, 50);

      expect(result.fragile_edges).toHaveLength(1);
      expect(result.fragile_edges[0].edge_id).toBe('a::b');
    });

    it('derives robust edges from low elasticity', () => {
      const localEdges = [
        { edge_id: 'x::y', from: 'x', to: 'y', elasticity: 0.1, sensitivity_type: 'magnitude' as const, importance_rank: 1, interpretation: '' },
      ];

      const result = createLocalHeuristicResult(localEdges, 50);

      expect(result.robust_edges).toHaveLength(1);
      expect(result.robust_edges[0].edge_id).toBe('x::y');
    });

    it('derives overall robustness from edge sensitivity', () => {
      // High elasticity = fragile
      const highElasticityEdges = [
        { edge_id: 'a::b', from: 'a', to: 'b', elasticity: 0.9, sensitivity_type: 'magnitude' as const, importance_rank: 1, interpretation: '' },
      ];
      expect(createLocalHeuristicResult(highElasticityEdges, 0).overall_robustness).toBe('fragile');

      // Medium elasticity = moderate
      const mediumElasticityEdges = [
        { edge_id: 'a::b', from: 'a', to: 'b', elasticity: 0.5, sensitivity_type: 'magnitude' as const, importance_rank: 1, interpretation: '' },
      ];
      expect(createLocalHeuristicResult(mediumElasticityEdges, 0).overall_robustness).toBe('moderate');

      // Low elasticity = robust
      const lowElasticityEdges = [
        { edge_id: 'a::b', from: 'a', to: 'b', elasticity: 0.2, sensitivity_type: 'magnitude' as const, importance_rank: 1, interpretation: '' },
      ];
      expect(createLocalHeuristicResult(lowElasticityEdges, 0).overall_robustness).toBe('robust');
    });
  });
});

// =============================================================================
// Robustness Enrichment Adapter Tests
// =============================================================================

describe('Robustness Enrichment Adapter', () => {
  describe('parseEdgeFrom', () => {
    it('parses from node with arrow separator', () => {
      expect(parseEdgeFrom('node_a->node_b')).toBe('node_a');
    });

    it('parses from node with double-colon separator', () => {
      expect(parseEdgeFrom('factor_1::goal')).toBe('factor_1');
    });

    it('returns original string for no separator (fallback)', () => {
      expect(parseEdgeFrom('no_separator')).toBe('no_separator');
      expect(parseEdgeFrom('')).toBe('');
    });
  });

  describe('parseEdgeTo', () => {
    it('parses to node with arrow separator', () => {
      expect(parseEdgeTo('node_a->node_b')).toBe('node_b');
    });

    it('parses to node with double-colon separator', () => {
      expect(parseEdgeTo('factor_1::goal')).toBe('goal');
    });

    it('returns original string for no separator (fallback)', () => {
      expect(parseEdgeTo('no_separator')).toBe('no_separator');
    });
  });

  describe('getNodeLabel', () => {
    const graph = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        { id: 'goal_node', kind: 'goal', label: 'Revenue Goal' },
      ],
      edges: [],
    };

    it('returns label from graph', () => {
      expect(getNodeLabel(graph as any, 'factor_a')).toBe('Factor A');
    });

    it('falls back to node ID when not in graph', () => {
      expect(getNodeLabel(graph as any, 'unknown_node')).toBe('unknown_node');
    });
  });

  describe('getOptionLabel', () => {
    const options = [
      { id: 'opt_1', label: 'Option One', interventions: {} },
      { id: 'opt_2', label: 'Option Two', interventions: {} },
    ];

    it('returns label from options array', () => {
      expect(getOptionLabel(options as any, 'opt_1')).toBe('Option One');
    });

    it('falls back to option ID when not found', () => {
      expect(getOptionLabel(options as any, 'unknown_opt')).toBe('unknown_opt');
    });
  });

  describe('enrichFragileEdge', () => {
    const graph = {
      nodes: [
        { id: 'factor_a', kind: 'factor', label: 'Factor A' },
        { id: 'goal', kind: 'goal', label: 'Goal Node' },
      ],
      edges: [],
    };
    const options = [{ id: 'opt_1', label: 'Option 1', interventions: {} }];

    it('enriches object edge with node labels', () => {
      const edge = {
        edge_id: 'factor_a->goal',
        from_id: 'factor_a',
        to_id: 'goal',
        switch_probability: 0.3,
      };

      const result = enrichFragileEdge(edge, graph as any, options as any);

      expect(result.edge_id).toBe('factor_a->goal');
      expect(result.from_label).toBe('Factor A');
      expect(result.to_label).toBe('Goal Node');
      expect(result.switch_probability).toBe(0.3);
    });

    it('enriches string edge with parsed IDs', () => {
      const edge = 'factor_a->goal';

      const result = enrichFragileEdge(edge, graph as any, options as any);

      expect(result.edge_id).toBe('factor_a->goal');
      expect(result.from_id).toBe('factor_a');
      expect(result.to_id).toBe('goal');
      expect(result.from_label).toBe('Factor A');
      expect(result.to_label).toBe('Goal Node');
    });

    it('uses node IDs when labels not available', () => {
      const edge = {
        edge_id: 'unknown1->unknown2',
        from_id: 'unknown1',
        to_id: 'unknown2',
        switch_probability: 0.5,
      };

      const result = enrichFragileEdge(edge, graph as any, options as any);

      expect(result.from_label).toBe('unknown1');
      expect(result.to_label).toBe('unknown2');
    });
  });

  describe('enrichRobustEdge', () => {
    const graph = {
      nodes: [
        { id: 'input', kind: 'factor', label: 'Input Factor' },
        { id: 'output', kind: 'goal', label: 'Output Goal' },
      ],
      edges: [],
    };

    it('enriches edge string with node labels', () => {
      const edgeId = 'input->output';

      const result = enrichRobustEdge(edgeId, graph as any);

      expect(result.edge_id).toBe('input->output');
      expect(result.from_label).toBe('Input Factor');
      expect(result.to_label).toBe('Output Goal');
    });

    it('handles double-colon separator', () => {
      const edgeId = 'input::output';

      const result = enrichRobustEdge(edgeId, graph as any);

      expect(result.from_label).toBe('Input Factor');
      expect(result.to_label).toBe('Output Goal');
    });
  });
});
