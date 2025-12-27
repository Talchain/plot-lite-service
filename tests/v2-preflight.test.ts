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

  describe('MISSING_GOAL_NODE', () => {
    it('fails when goal node does not exist', () => {
      const result = runPreflightValidation(validGraph, validOptions, 'nonexistent-goal', defaultStats);

      expect(result.passed).toBe(false);
      expect(result.blockers.some(b => b.code === 'MISSING_GOAL_NODE')).toBe(true);
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
    it('fails when too many nodes', () => {
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

    it('fails when too many edges', () => {
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
