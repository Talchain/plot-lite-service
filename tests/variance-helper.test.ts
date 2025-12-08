/**
 * Tests for Graph Health / Variance Detection Helpers
 */

import { describe, it, expect } from 'vitest';
import {
  detectUniformWeights,
  detectUniformBeliefs,
  detectSinglePath,
  buildGraphHealth,
} from '../src/trust/variance-helper.js';
import type { Graph, GraphEdge } from '../src/trust/types.js';

describe('variance-helper', () => {
  describe('detectUniformWeights', () => {
    it('returns true when all edges have the same explicit weight', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', weight: 0.5 },
        { from: 'b', to: 'c', weight: 0.5 },
        { from: 'c', to: 'd', weight: 0.5 },
      ];
      expect(detectUniformWeights(edges)).toBe(true);
    });

    it('returns true when all edges have no weight (default)', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
      ];
      expect(detectUniformWeights(edges)).toBe(true);
    });

    it('returns false when edges have different weights', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', weight: 0.5 },
        { from: 'b', to: 'c', weight: 1.0 },
        { from: 'c', to: 'd', weight: 1.5 },
      ];
      expect(detectUniformWeights(edges)).toBe(false);
    });

    it('returns false for empty edges array', () => {
      expect(detectUniformWeights([])).toBe(false);
    });

    it('returns true for single edge', () => {
      const edges: GraphEdge[] = [{ from: 'a', to: 'b', weight: 1.0 }];
      expect(detectUniformWeights(edges)).toBe(true);
    });
  });

  describe('detectUniformBeliefs', () => {
    it('returns true when all edges have the same explicit belief', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', belief: 0.5 },
        { from: 'b', to: 'c', belief: 0.5 },
        { from: 'c', to: 'd', belief: 0.5 },
      ];
      expect(detectUniformBeliefs(edges)).toBe(true);
    });

    it('returns true when all edges have no belief (default)', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
      ];
      expect(detectUniformBeliefs(edges)).toBe(true);
    });

    it('returns false when edges have different beliefs', () => {
      const edges: GraphEdge[] = [
        { from: 'a', to: 'b', belief: 0.5 },
        { from: 'b', to: 'c', belief: 0.8 },
        { from: 'c', to: 'd', belief: 1.0 },
      ];
      expect(detectUniformBeliefs(edges)).toBe(false);
    });

    it('returns false for empty edges array', () => {
      expect(detectUniformBeliefs([])).toBe(false);
    });
  });

  describe('detectSinglePath', () => {
    it('returns true for linear chain (no branching)', () => {
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
          { id: 'd', label: 'D' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'b', to: 'c' },
          { from: 'c', to: 'd' },
        ],
      };
      expect(detectSinglePath(graph)).toBe(true);
    });

    it('returns false when there is branching (multiple incoming edges)', () => {
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
          { id: 'd', label: 'D' },
        ],
        edges: [
          { from: 'a', to: 'c' },
          { from: 'b', to: 'c' }, // Second edge to 'c' creates branching
          { from: 'c', to: 'd' },
        ],
      };
      expect(detectSinglePath(graph)).toBe(false);
    });

    it('returns false for empty graph', () => {
      expect(detectSinglePath({ nodes: [], edges: [] })).toBe(false);
    });

    it('returns false for graph with only nodes (no edges)', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }],
        edges: [],
      };
      expect(detectSinglePath(graph)).toBe(false);
    });

    it('returns false for diverging graph (one node has multiple outgoing edges)', () => {
      // A -> B and A -> C (diverging, node 'a' has >1 outgoing edge)
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'a', to: 'c' },
        ],
      };
      expect(detectSinglePath(graph)).toBe(false);
    });

    it('returns true for disjoint chains (no branching anywhere)', () => {
      // Two separate chains: A -> B and C -> D
      // Current semantics: "no branching" = true (not "exactly one connected chain")
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
          { id: 'd', label: 'D' },
        ],
        edges: [
          { from: 'a', to: 'b' },
          { from: 'c', to: 'd' },
        ],
      };
      // Semantics: detectSinglePath means "no node has >1 in or out edge"
      // not "exactly one connected path". Disjoint chains have no branching.
      expect(detectSinglePath(graph)).toBe(true);
    });
  });

  describe('buildGraphHealth', () => {
    it('returns healthy status for graph with varied weights and beliefs', () => {
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b', weight: 0.5, belief: 0.7 },
          { from: 'a', to: 'c', weight: 1.2, belief: 0.9 }, // Different weights and beliefs
        ],
      };
      const health = buildGraphHealth(graph);
      expect(health.variance_status).toBe('healthy');
      expect(health.issues).toBeUndefined();
      expect(health.suggestion).toBeUndefined();
      expect(health.source).toBe('engine');
    });

    it('returns limited status with uniform_weights issue', () => {
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b', weight: 1.0, belief: 0.7 },
          { from: 'a', to: 'c', weight: 1.0, belief: 0.9 }, // Same weight, different belief
        ],
      };
      const health = buildGraphHealth(graph);
      expect(health.variance_status).toBe('limited');
      expect(health.issues).toContain('uniform_weights');
      expect(health.issues).not.toContain('uniform_beliefs');
      expect(health.suggestion).toBeDefined();
    });

    it('returns limited status with both uniform_weights and uniform_beliefs', () => {
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b', weight: 0.5, belief: 0.5 },
          { from: 'a', to: 'c', weight: 0.5, belief: 0.5 },
        ],
      };
      const health = buildGraphHealth(graph);
      expect(health.variance_status).toBe('limited');
      expect(health.issues).toContain('uniform_weights');
      expect(health.issues).toContain('uniform_beliefs');
      expect(health.suggestion).toContain('weights and beliefs');
    });

    it('returns limited status with single_path issue for linear chain', () => {
      const graph: Graph = {
        nodes: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ],
        edges: [
          { from: 'a', to: 'b', weight: 0.5, belief: 0.7 },
          { from: 'b', to: 'c', weight: 1.2, belief: 0.9 },
        ],
      };
      const health = buildGraphHealth(graph);
      expect(health.variance_status).toBe('limited');
      expect(health.issues).toContain('single_path');
    });

    it('sets source to isl when ISL sensitivity is provided', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }],
        edges: [],
      };
      const islSensitivity = {
        overall_robustness: 'moderate' as const,
        sensitive_parameters: [],
        recommendations: [],
        source: 'isl' as const,
      };
      const health = buildGraphHealth(graph, islSensitivity);
      expect(health.source).toBe('isl');
    });

    it('sets source to engine when ISL sensitivity is engine_fallback', () => {
      const graph: Graph = {
        nodes: [{ id: 'a', label: 'A' }],
        edges: [],
      };
      const islSensitivity = {
        overall_robustness: 'moderate' as const,
        sensitive_parameters: [],
        recommendations: [],
        source: 'engine_fallback' as const,
      };
      const health = buildGraphHealth(graph, islSensitivity);
      expect(health.source).toBe('engine');
    });
  });
});
