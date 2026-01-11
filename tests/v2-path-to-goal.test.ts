/**
 * Unit tests for V2 path-to-goal validation
 */

import { describe, it, expect } from 'vitest';
import {
  buildAdjacencyList,
  checkPathToGoal,
  validateOptionPaths,
  allOptionsHavePaths,
} from '../src/validation/path-to-goal.js';
import type { EngineGraphV3, EngineEdgeV3, OptionV3 } from '../src/types/engine-v3.js';

describe('Path to Goal Validation', () => {
  describe('buildAdjacencyList', () => {
    it('builds adjacency list from edges', () => {
      const edges: EngineEdgeV3[] = [
        { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'b', to: 'c', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
      ];

      const adj = buildAdjacencyList(edges);

      expect(adj.get('a')).toContain('b');
      expect(adj.get('b')).toContain('c');
      expect(adj.has('c')).toBe(false); // c has no outgoing edges
    });

    it('excludes edges with zero exists_probability', () => {
      const edges: EngineEdgeV3[] = [
        { from: 'a', to: 'b', exists_probability: 0, strength: { mean: 0.5, std: 0.1 } },
      ];

      const adj = buildAdjacencyList(edges);

      expect(adj.has('a')).toBe(false);
    });

    it('handles multiple outgoing edges', () => {
      const edges: EngineEdgeV3[] = [
        { from: 'a', to: 'b', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'a', to: 'c', exists_probability: 0.7, strength: { mean: 0.3, std: 0.1 } },
      ];

      const adj = buildAdjacencyList(edges);

      expect(adj.get('a')).toContain('b');
      expect(adj.get('a')).toContain('c');
      expect(adj.get('a')!.length).toBe(2);
    });
  });

  describe('checkPathToGoal', () => {
    it('finds direct path to goal', () => {
      const adj = new Map<string, string[]>();
      adj.set('a', ['goal']);

      const result = checkPathToGoal(adj, 'a', 'goal');

      expect(result.reachable).toBe(true);
      expect(result.path).toEqual(['a', 'goal']);
    });

    it('finds indirect path to goal', () => {
      const adj = new Map<string, string[]>();
      adj.set('a', ['b']);
      adj.set('b', ['c']);
      adj.set('c', ['goal']);

      const result = checkPathToGoal(adj, 'a', 'goal');

      expect(result.reachable).toBe(true);
      expect(result.path).toEqual(['a', 'b', 'c', 'goal']);
    });

    it('returns unreachable when no path exists', () => {
      const adj = new Map<string, string[]>();
      adj.set('a', ['b']);
      adj.set('b', ['c']); // c has no path to goal

      const result = checkPathToGoal(adj, 'a', 'goal');

      expect(result.reachable).toBe(false);
      expect(result.blocked_reason).toContain('No path');
    });

    it('handles source = goal', () => {
      const adj = new Map<string, string[]>();

      const result = checkPathToGoal(adj, 'goal', 'goal');

      expect(result.reachable).toBe(true);
      expect(result.path).toEqual(['goal']);
    });

    it('handles cyclic graphs without infinite loop', () => {
      const adj = new Map<string, string[]>();
      adj.set('a', ['b']);
      adj.set('b', ['c', 'a']); // cycle back to a
      adj.set('c', ['goal']);

      const result = checkPathToGoal(adj, 'a', 'goal');

      expect(result.reachable).toBe(true);
    });
  });

  describe('validateOptionPaths', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'factor-1', kind: 'factor', label: 'Factor 1' },
        { id: 'factor-2', kind: 'factor', label: 'Factor 2' },
        { id: 'goal', kind: 'goal', label: 'Goal' },
      ],
      edges: [
        { from: 'factor-1', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        // factor-2 has no path to goal
      ],
    };

    it('validates option with valid path', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-1': { value: 1.5, source: 'user_specified' },
          },
        },
      ];

      const results = validateOptionPaths(graph, options, 'goal');

      expect(results.size).toBe(1);
      expect(results.get('opt1')?.hasPath).toBe(true);
      expect(allOptionsHavePaths(results)).toBe(true);
    });

    it('detects option with no path to goal', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-2': { value: 1.5, source: 'user_specified' },
          },
        },
      ];

      const results = validateOptionPaths(graph, options, 'goal');

      expect(results.get('opt1')?.hasPath).toBe(false);
      expect(allOptionsHavePaths(results)).toBe(false);
    });

    it('validates option targeting goal directly', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'goal': { value: 100, source: 'user_specified' },
          },
        },
      ];

      const results = validateOptionPaths(graph, options, 'goal');

      expect(results.get('opt1')?.hasPath).toBe(true);
    });

    it('handles multiple intervention targets', () => {
      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'factor-1': { value: 1.5, source: 'user_specified' },
            'factor-2': { value: 0.5, source: 'user_specified' },
          },
        },
      ];

      // At least one target has path to goal
      const results = validateOptionPaths(graph, options, 'goal');

      expect(results.get('opt1')?.hasPath).toBe(true);
    });

    it('fails when no intervention target has path', () => {
      const graphNoPath: EngineGraphV3 = {
        nodes: [
          { id: 'isolated-1', kind: 'factor', label: 'Isolated 1' },
          { id: 'isolated-2', kind: 'factor', label: 'Isolated 2' },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [], // No edges at all
      };

      const options: OptionV3[] = [
        {
          id: 'opt1',
          label: 'Option 1',
          interventions: {
            'isolated-1': { value: 1.5, source: 'user_specified' },
            'isolated-2': { value: 0.5, source: 'user_specified' },
          },
        },
      ];

      const results = validateOptionPaths(graphNoPath, options, 'goal');

      expect(results.get('opt1')?.hasPath).toBe(false);
    });
  });
});
