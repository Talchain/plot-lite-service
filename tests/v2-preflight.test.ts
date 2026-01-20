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

  describe('Option ID Consistency', () => {
    it('passes when option IDs match option nodes', () => {
      const result = runPreflightValidation(
        validGraph,
        validOptions,
        'goal',
        defaultStats,
        ['opt1', 'opt2']
      );

      expect(result.blockers.some(b => b.code === 'OPTION_NODE_MISSING_FROM_ARRAY')).toBe(false);
      expect(result.blockers.some(b => b.code === 'OPTION_ID_NOT_IN_GRAPH')).toBe(false);
    });

    it('blocks when option node is missing from options array', () => {
      const optionsMissing: OptionV3[] = [validOptions[0]];
      const result = runPreflightValidation(
        validGraph,
        optionsMissing,
        'goal',
        defaultStats,
        ['opt1', 'opt2']
      );

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'OPTION_NODE_MISSING_FROM_ARRAY')).toBe(true);
    });

    it('blocks when option ID not found in option nodes', () => {
      const result = runPreflightValidation(
        validGraph,
        validOptions,
        'goal',
        defaultStats,
        ['opt1']
      );

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'OPTION_ID_NOT_IN_GRAPH')).toBe(true);
    });

    it('skips check when no option nodes are provided', () => {
      const result = runPreflightValidation(
        validGraph,
        validOptions,
        'goal',
        defaultStats,
        []
      );

      expect(result.passed).toBe(true);
      expect(result.blockers.some(b => b.code === 'OPTION_NODE_MISSING_FROM_ARRAY')).toBe(false);
      expect(result.blockers.some(b => b.code === 'OPTION_ID_NOT_IN_GRAPH')).toBe(false);
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
      ] as unknown as OptionV3[];

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
      ] as unknown as OptionV3[];

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
      ] as unknown as OptionV3[];

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

  describe('INVALID_INTERVENTION_TARGET_KIND', () => {
    it('fails when intervention targets a goal node', () => {
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

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_TARGET_KIND')).toBe(true);
      expect(result.blockers.find(b => b.code === 'INVALID_INTERVENTION_TARGET_KIND')?.message).toContain("'goal' is a 'goal' node");
    });

    it('fails when intervention targets an outcome node', () => {
      const graphWithOutcome: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'revenue', kind: 'outcome', label: 'Revenue' },
        ],
        edges: [
          { from: 'factor-a', to: 'revenue', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const optionsTargetingOutcome: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'revenue': { value: 100, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(graphWithOutcome, optionsTargetingOutcome, 'revenue', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_TARGET_KIND')).toBe(true);
      expect(result.blockers.find(b => b.code === 'INVALID_INTERVENTION_TARGET_KIND')?.message).toContain("'revenue' is a 'outcome' node");
    });

    it('fails when intervention targets a risk node', () => {
      const graphWithRisk: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'churn-risk', kind: 'risk', label: 'Churn Risk' },
        ],
        edges: [
          { from: 'factor-a', to: 'churn-risk', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        ],
      };

      const optionsTargetingRisk: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'churn-risk': { value: 0.5, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(graphWithRisk, optionsTargetingRisk, 'churn-risk', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_TARGET_KIND')).toBe(true);
      expect(result.blockers.find(b => b.code === 'INVALID_INTERVENTION_TARGET_KIND')?.message).toContain("'churn-risk' is a 'risk' node");
    });

    it('passes when intervention targets a factor node', () => {
      const result = runPreflightValidation(validGraph, validOptions, 'goal', defaultStats);

      expect(result.blockers.some(b => b.code === 'INVALID_INTERVENTION_TARGET_KIND')).toBe(false);
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

    it('passes when factor has direct path to goal', () => {
      // factor-a has direct edge to goal in validGraph
      const optionsTargetingFactor: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-a': { value: 100, source: 'user_specified' },
          },
        },
        {
          id: 'opt2',
          label: 'Option 2',
          interventions: {
            'factor-a': { value: 50, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(validGraph, optionsTargetingFactor, 'goal', defaultStats);

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

  describe('MISSING_OUTCOME_OR_RISK', () => {
    it('fails when graph has only factor nodes (no outcome/risk/goal)', () => {
      const graphWithOnlyFactors: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'factor-b', kind: 'factor', label: 'Factor B' },
          { id: 'factor-c', kind: 'factor', label: 'Factor C' },
        ],
        edges: [
          { from: 'factor-a', to: 'factor-b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
          { from: 'factor-b', to: 'factor-c', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
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
      ];

      const result = runPreflightValidation(graphWithOnlyFactors, options, 'factor-c', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'MISSING_OUTCOME_OR_RISK')).toBe(true);
      expect(result.blockers.find(b => b.code === 'MISSING_OUTCOME_OR_RISK')?.message).toContain('outcome, risk, or goal node');
    });

    it('passes when graph has a goal node', () => {
      const result = runPreflightValidation(validGraph, validOptions, 'goal', defaultStats);

      expect(result.blockers.some(b => b.code === 'MISSING_OUTCOME_OR_RISK')).toBe(false);
    });

    it('passes when graph has an outcome node', () => {
      const graphWithOutcome: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'revenue', kind: 'outcome', label: 'Revenue' },
        ],
        edges: [
          { from: 'factor-a', to: 'revenue', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
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
            'factor-a': { value: 2.5, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(graphWithOutcome, options, 'revenue', defaultStats);

      expect(result.blockers.some(b => b.code === 'MISSING_OUTCOME_OR_RISK')).toBe(false);
    });

    it('passes when graph has a risk node', () => {
      const graphWithRisk: EngineGraphV3 = {
        nodes: [
          { id: 'factor-a', kind: 'factor', label: 'Factor A' },
          { id: 'churn-risk', kind: 'risk', label: 'Churn Risk' },
        ],
        edges: [
          { from: 'factor-a', to: 'churn-risk', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
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
            'factor-a': { value: 2.5, source: 'user_specified' },
          },
        },
      ];

      const result = runPreflightValidation(graphWithRisk, options, 'churn-risk', defaultStats);

      expect(result.blockers.some(b => b.code === 'MISSING_OUTCOME_OR_RISK')).toBe(false);
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
