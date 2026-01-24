/**
 * Unit tests for V2 preflight validation
 */

import { describe, it, expect } from 'vitest';
import { runPreflightValidation } from '../src/validation/preflight-v2.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

describe('Preflight Validation', () => {
  // Default stats for tests
  const defaultStats = {
    optionNodesFiltered: 0,
    optionEdgesFiltered: 0,
    nodesNormalised: 3,
    edgesNormalised: 2,
  };

  // Valid base graph for testing
  const validGraph: EngineGraphV3 = {
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
  const validOptions: OptionV3[] = [
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

  describe('Goal Node Validation', () => {
    it('fails with MISSING_GOAL_NODE when goal_node_id is empty', () => {
      const result = runPreflightValidation(validGraph, validOptions, '', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'MISSING_GOAL_NODE')).toBe(true);
    });

    it('fails with GOAL_NODE_NOT_IN_GRAPH when goal node does not exist', () => {
      const result = runPreflightValidation(validGraph, validOptions, 'nonexistent-goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'GOAL_NODE_NOT_IN_GRAPH')).toBe(true);
    });

    it('passes when goal node exists', () => {
      const result = runPreflightValidation(validGraph, validOptions, 'goal', defaultStats);

      expect(result.goal_node_exists).toBe(true);
    });
  });

  describe('NO_OPTIONS', () => {
    it('fails when no options provided', () => {
      const result = runPreflightValidation(validGraph, [], 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'NO_OPTIONS')).toBe(true);
    });
  });

  describe('EMPTY_INTERVENTIONS', () => {
    it('fails when option has no interventions', () => {
      const optionsWithEmpty: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {},
        },
      ];

      const result = runPreflightValidation(validGraph, optionsWithEmpty, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'EMPTY_INTERVENTIONS')).toBe(true);
    });
  });

  describe('Intervention Format Normalisation', () => {
    it('accepts nested format { factor_id: { value: 59 } }', () => {
      const optionsNested: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': { value: 59, source: 'user_specified' },
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-a': { value: 49, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(validGraph, optionsNested, 'goal', defaultStats);

      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_VALUE')).toBe(false);
    });

    it('accepts flat format { factor_id: 59 }', () => {
      // Use 'as any' to bypass TypeScript strict typing for flat format
      const optionsFlat = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': 59,
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-a': 49,
          },
        },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsFlat, 'goal', defaultStats);

      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_VALUE')).toBe(false);
      expect(result.blockers.some(b => b.code === 'EMPTY_INTERVENTIONS')).toBe(false);
    });

    it('rejects invalid values (null, undefined, NaN)', () => {
      const optionsInvalid = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': null,
          },
        },
      ] as unknown as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsInvalid, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_VALUE')).toBe(true);
    });

    it('rejects Infinity values', () => {
      const optionsInfinity = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': Infinity,
          },
        },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsInfinity, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_VALUE')).toBe(true);
    });

    it('detects identical options with flat format', () => {
      const optionsIdenticalFlat = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': 59,
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-a': 59, // Same value as opt1
          },
        },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsIdenticalFlat, 'goal', defaultStats);

      expect(result.blockers.some(b => b.code === 'IDENTICAL_OPTIONS')).toBe(true);
    });
  });

  describe('INVALID_INTERVENTION_TARGET', () => {
    it('fails when intervention targets non-existent node', () => {
      const optionsWithInvalidTarget: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'nonexistent-node': { value: 1.0, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(validGraph, optionsWithInvalidTarget, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_TARGET')).toBe(true);
    });
  });

  describe('NO_PATH_TO_GOAL', () => {
    it('fails when no intervention has path to goal', () => {
      const graphWithIsolated: EngineGraphV3 = {
        nodes: [
          { id: 'isolated', kind: 'factor', label: 'Isolated' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [], // No edges
      };

      const optionsTargetingIsolated: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'isolated': { value: 1.0, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(graphWithIsolated, optionsTargetingIsolated, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'NO_PATH_TO_GOAL')).toBe(true);
    });

    it('passes when targeting goal directly', () => {
      const optionsTargetingGoal: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'goal': { value: 100, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(validGraph, optionsTargetingGoal, 'goal', defaultStats);

      expect(result.blockers.some(b => b.code === 'NO_PATH_TO_GOAL')).toBe(false);
    });
  });

  describe('IDENTICAL_OPTIONS', () => {
    it('fails when options have identical interventions', () => {
      const identicalOptions: OptionV3[] = [
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
            'factor-a': { value: 1.5, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(validGraph, identicalOptions, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'IDENTICAL_OPTIONS')).toBe(true);
    });
  });

  describe('INVALID_NODE_ID_PATTERN', () => {
    it('fails when node ID contains invalid characters', () => {
      const graphWithInvalidId: EngineGraphV3 = {
        nodes: [
          { id: 'Valid-Node_1', kind: 'factor', label: 'Valid' },
          { id: 'Invalid Node!', kind: 'goal', label: 'Invalid' }, // Space and !
        ],
        edges: [],
      };

      const result = runPreflightValidation(graphWithInvalidId, validOptions, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'INVALID_NODE_ID_PATTERN')).toBe(true);
    });

    it('allows lowercase letters, numbers, underscore, hyphen, colon', () => {
      const graphWithValidIds: EngineGraphV3 = {
        nodes: [
          { id: 'factor-1', kind: 'factor', label: 'Factor 1' },
          { id: 'goal_node:v2', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-1', to: 'goal_node:v2', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-1': { value: 1.0, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(graphWithValidIds, options, 'goal_node:v2', defaultStats);

      expect(result.blockers.some(b => b.code === 'INVALID_NODE_ID_PATTERN')).toBe(false);
    });
  });

  describe('INVALID_EDGE_ENDPOINT', () => {
    it('fails when edge references non-existent node', () => {
      const graphWithBadEdge: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'factor-a', to: 'nonexistent', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const result = runPreflightValidation(graphWithBadEdge, validOptions, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'INVALID_EDGE_ENDPOINT')).toBe(true);
    });
  });

  describe('DUPLICATE_NODE_IDS', () => {
    it('fails when duplicate node IDs exist', () => {
      const graphWithDuplicates: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'factor-a', kind: 'factor', label: 'Factor A Copy' }, // Duplicate
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [],
      };

      const result = runPreflightValidation(graphWithDuplicates, validOptions, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'DUPLICATE_NODE_IDS')).toBe(true);
    });
  });

  describe('GRAPH_TOO_LARGE', () => {
    it('accepts graph with exactly 50 nodes (boundary)', () => {
      const maxGraph: EngineGraphV3 = {
        nodes: Array.from({ length: 50 }, (_, i) => ({
          id: `node-${i}`,
          kind: i === 49 ? 'goal' as const : 'factor' as const,
          label: `Node ${i}`,
        })),
        edges: [
          { from: 'node-0', to: 'node-49', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const options: OptionV3[] = [
        { id: 'opt1', label: 'Opt 1', interventions: { 'node-0': { value: 1, source: 'user_specified' } } },
        { id: 'opt2', label: 'Opt 2', interventions: { 'node-0': { value: 2, source: 'user_specified' } } },
      ];

      const result = runPreflightValidation(maxGraph, options, 'node-49', defaultStats);

      expect(result.blockers.some(b => b.code === 'GRAPH_TOO_LARGE')).toBe(false);
    });

    it('fails when too many nodes (51 exceeds limit of 50)', () => {
      const largeGraph: EngineGraphV3 = {
        nodes: Array.from({ length: 51 }, (_, i) => ({
          id: `node-${i}`,
          kind: 'factor' as const,
          label: `Node ${i}`,
        })),
        edges: [],
      };

      const result = runPreflightValidation(largeGraph, validOptions, 'node-0', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'GRAPH_TOO_LARGE')).toBe(true);
    });

    it('accepts graph with exactly 100 edges (boundary)', () => {
      const nodes = Array.from({ length: 10 }, (_, i) => ({
        id: `node-${i}`,
        kind: i === 9 ? 'goal' as const : 'factor' as const,
        label: `Node ${i}`,
      }));

      const edges = Array.from({ length: 100 }, (_, i) => ({
        from: `node-${i % 9}`,
        to: `node-9`,
        exists_probability: 0.8,
        strength: { mean: 0.5 + (i * 0.001), std: 0.1 }, // Slightly different to avoid identical edges
      }));

      const maxEdgeGraph: EngineGraphV3 = { nodes, edges };

      const options: OptionV3[] = [
        { id: 'opt1', label: 'Opt 1', interventions: { 'node-0': { value: 1, source: 'user_specified' } } },
        { id: 'opt2', label: 'Opt 2', interventions: { 'node-0': { value: 2, source: 'user_specified' } } },
      ];

      const result = runPreflightValidation(maxEdgeGraph, options, 'node-9', defaultStats);

      expect(result.blockers.some(b => b.code === 'GRAPH_TOO_LARGE')).toBe(false);
    });

    it('fails when too many edges (101 exceeds limit of 100)', () => {
      const nodes = Array.from({ length: 10 }, (_, i) => ({
        id: `node-${i}`,
        kind: 'factor' as const,
        label: `Node ${i}`,
      }));

      const edges = Array.from({ length: 101 }, (_, i) => ({
        from: `node-${i % 10}`,
        to: `node-${(i + 1) % 10}`,
        exists_probability: 0.8,
        strength: { mean: 0.5, std: 0.1 },
      }));

      const largeGraph: EngineGraphV3 = { nodes, edges };

      const result = runPreflightValidation(largeGraph, validOptions, 'node-0', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'GRAPH_TOO_LARGE')).toBe(true);
    });
  });

  describe('TOO_MANY_OPTIONS', () => {
    it('accepts exactly 10 options (boundary)', () => {
      const maxOptions: OptionV3[] = Array.from({ length: 10 }, (_, i) => ({
        id: `opt-${i}`,
        label: `Option ${i}`,
        interventions: {
          'factor-a': { value: i + 1, source: 'user_specified' as const },
        },
      }));

      const result = runPreflightValidation(validGraph, maxOptions, 'goal', defaultStats);

      expect(result.blockers.some(b => b.code === 'TOO_MANY_OPTIONS')).toBe(false);
    });

    it('fails when too many options (11 exceeds limit of 10)', () => {
      const tooManyOptions: OptionV3[] = Array.from({ length: 11 }, (_, i) => ({
        id: `opt-${i}`,
        label: `Option ${i}`,
        interventions: {
          'factor-a': { value: i + 1, source: 'user_specified' as const },
        },
      }));

      const result = runPreflightValidation(validGraph, tooManyOptions, 'goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'TOO_MANY_OPTIONS')).toBe(true);
      expect(result.blockers.find(b => b.code === 'TOO_MANY_OPTIONS')?.message).toContain('11 options');
      expect(result.blockers.find(b => b.code === 'TOO_MANY_OPTIONS')?.message).toContain('limit of 10');
    });
  });

  describe('GRAPH_CYCLE_DETECTED', () => {
    it('blocks on direct cycle', () => {
      const graphWithCycle: EngineGraphV3 = {
        nodes: [
          { id: 'a', kind: 'factor', label: 'A' },
          { id: 'b', kind: 'factor', label: 'B' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [
          { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'b', to: 'a', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } }, // Cycle
          { from: 'b', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: { 'a': { value: 1.0, source: 'user_specified' } },
        },
      ];

      const result = runPreflightValidation(graphWithCycle, options, 'goal', defaultStats);

      // V2: Cycles are blockers - causal graphs must be DAGs
      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'GRAPH_CYCLE_DETECTED')).toBe(true);
    });
  });

  describe('SCALE_MISMATCH_WARNING', () => {
    it('emits warning when intervention values span wide range (ratio > 100)', () => {
      const optionsWithMixedScales = [
        {
          id: 'opt1',
          label: 'Binary Option',
          interventions: {
            'factor-a': 1,  // Binary scale
          },
        },
        {
          id: 'opt2',
          label: 'Dollar Option',
          interventions: {
            'factor-b': 180000,  // Dollar scale
          },
        },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsWithMixedScales, 'goal', defaultStats);

      // Should pass (warning doesn't block)
      expect(result.passed).toBe(true);
      // Should have scale mismatch warning
      expect(result.warnings.some(w => w.code === 'SCALE_MISMATCH_WARNING')).toBe(true);

      const warning = result.warnings.find(w => w.code === 'SCALE_MISMATCH_WARNING');
      expect(warning?.severity).toBe('warning');
      expect(warning?.blocks_analysis).toBe(false);
      expect(warning?.message).toContain('180,000');  // Ratio should be ~180,000
      expect(warning?.suggestion).toBeDefined();
    });

    it('does NOT emit warning when ratio is small (< 100)', () => {
      const optionsWithSmallRange = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': 1,
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-a': 2,
            'factor-b': 5,
          },
        },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsWithSmallRange, 'goal', defaultStats);

      expect(result.warnings.some(w => w.code === 'SCALE_MISMATCH_WARNING')).toBe(false);
    });

    it('does NOT emit warning when all values are zero', () => {
      const optionsWithZeros = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': 0,
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-b': 0,
          },
        },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsWithZeros, 'goal', defaultStats);

      expect(result.warnings.some(w => w.code === 'SCALE_MISMATCH_WARNING')).toBe(false);
    });

    it('does NOT emit warning with single non-zero value', () => {
      const optionsWithSingleValue = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': 1000,
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-b': 0,  // Zero doesn't count
          },
        },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsWithSingleValue, 'goal', defaultStats);

      expect(result.warnings.some(w => w.code === 'SCALE_MISMATCH_WARNING')).toBe(false);
    });

    it('handles nested intervention format', () => {
      const optionsNested: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': { value: 1, source: 'user_specified' },
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-b': { value: 500, source: 'user_specified' },  // 500x ratio > 100
          },
        },
      ];

      const result = runPreflightValidation(validGraph, optionsNested, 'goal', defaultStats);

      expect(result.warnings.some(w => w.code === 'SCALE_MISMATCH_WARNING')).toBe(true);
    });

    it('uses absolute values for ratio calculation (handles negatives)', () => {
      const optionsWithNegatives = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': -1,
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-b': 200,  // |200| / |-1| = 200 > 100
          },
        },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsWithNegatives, 'goal', defaultStats);

      expect(result.warnings.some(w => w.code === 'SCALE_MISMATCH_WARNING')).toBe(true);
    });

    it('emits only ONE warning per request (not per option)', () => {
      const optionsMultiple = [
        { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': 1 } },
        { id: 'opt2', label: 'Option 2', interventions: { 'factor-a': 1000 } },
        { id: 'opt3', label: 'Option 3', interventions: { 'factor-b': 100000 } },
      ] as OptionV3[];

      const result = runPreflightValidation(validGraph, optionsMultiple, 'goal', defaultStats);

      const scaleWarnings = result.warnings.filter(w => w.code === 'SCALE_MISMATCH_WARNING');
      expect(scaleWarnings).toHaveLength(1);  // Only one warning, not multiple
    });
  });

  describe('Full validation pass', () => {
    it('passes with valid inputs', () => {
      const result = runPreflightValidation(validGraph, validOptions, 'goal', defaultStats);

      expect(result.passed).toBe(true);
      expect(result.blockers).toHaveLength(0);
      expect(result.goal_node_exists).toBe(true);
      expect(result.options_count).toBe(2);
      expect(result.options_with_interventions).toBe(2);
    });

    it('collects stats correctly', () => {
      const result = runPreflightValidation(validGraph, validOptions, 'goal', {
        optionNodesFiltered: 2,
        optionEdgesFiltered: 3,
        nodesNormalised: 3,
        edgesNormalised: 2,
      });

      expect(result.option_nodes_filtered).toBe(2);
      expect(result.option_edges_filtered).toBe(3);
      expect(result.nodes_normalised).toBe(3);
      expect(result.edges_normalised).toBe(2);
    });
  });
});
