import { describe, it, expect } from 'vitest';
import { generateIdentifiabilityTag, isDecisionReady } from '../src/trust/identifiability-tag.js';
import type { Graph } from '../src/trust/types.js';

describe('Identifiability tag (plain English)', () => {
  describe('Decision-ready cases', () => {
    it('tags clean graph as Decision-ready', () => {
      // Simple chain: A → B → C (no confounders)
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'Treatment' },
          { id: 'B', label: 'Mediator' },
          { id: 'C', label: 'Outcome' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5 },
          { from: 'B', to: 'C', weight: 0.7 },
        ],
      };

      const tag = generateIdentifiabilityTag({
        graph,
        treatment_node: 'A',
        outcome_node: 'C',
      });

      expect(tag.tag).toBe('Decision-ready');
      expect(tag.reason).toContain('No confounders');
      expect(tag.adjustment_set).toEqual([]);
    });

    it('tags graph with confounders as Decision-ready with adjustment set', () => {
      // Confounded: Z → A, Z → C (Z is confounder)
      const graph: Graph = {
        nodes: [
          { id: 'Z', label: 'Confounder' },
          { id: 'A', label: 'Treatment' },
          { id: 'C', label: 'Outcome' },
        ],
        edges: [
          { from: 'Z', to: 'A', weight: 0.3 },
          { from: 'Z', to: 'C', weight: 0.4 },
          { from: 'A', to: 'C', weight: 0.6 },
        ],
      };

      const tag = generateIdentifiabilityTag({
        graph,
        treatment_node: 'A',
        outcome_node: 'C',
      });

      expect(tag.tag).toBe('Decision-ready');
      expect(tag.reason).toContain('Adjust for');
      expect(tag.reason).toContain('Confounder');
      expect(tag.adjustment_set).toContain('Z');
    });

    it('provides deterministic tags for same input', () => {
      const graph: Graph = {
        nodes: [
          { id: 'X', label: 'X' },
          { id: 'Y', label: 'Y' },
        ],
        edges: [
          { from: 'X', to: 'Y', weight: 0.5 },
        ],
      };

      const inputs = {
        graph,
        treatment_node: 'X',
        outcome_node: 'Y',
      };

      const tags = Array.from({ length: 5 }, () => generateIdentifiabilityTag(inputs));

      // All tags should be identical
      const tagValues = tags.map(t => t.tag);
      const reasons = tags.map(t => t.reason);

      expect(new Set(tagValues).size).toBe(1);
      expect(new Set(reasons).size).toBe(1);
      expect(tagValues[0]).toBe('Decision-ready');
    });
  });

  describe('Exploratory cases', () => {
    it('tags graph without treatment as Exploratory', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5 },
        ],
      };

      const tag = generateIdentifiabilityTag({
        graph,
        outcome_node: 'B',
        // No treatment_node specified
      });

      expect(tag.tag).toBe('Exploratory');
      expect(tag.reason).toContain('No treatment specified');
    });

    it('tags graph with no causal path as Exploratory', () => {
      // Disconnected: A, C (no path from A to C)
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'Treatment' },
          { id: 'C', label: 'Outcome' },
        ],
        edges: [],
      };

      const tag = generateIdentifiabilityTag({
        graph,
        treatment_node: 'A',
        outcome_node: 'C',
      });

      expect(tag.tag).toBe('Exploratory');
      expect(tag.reason).toContain('No causal path');
    });

    it('tags graph with missing nodes as Exploratory', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'A' },
        ],
        edges: [],
      };

      const tag = generateIdentifiabilityTag({
        graph,
        treatment_node: 'A',
        outcome_node: 'NonExistent',
      });

      expect(tag.tag).toBe('Exploratory');
      expect(tag.reason).toContain('not found');
    });

    it('provides deterministic tags for exploratory cases', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'A' },
        ],
        edges: [],
      };

      const inputs = {
        graph,
        treatment_node: 'A',
        outcome_node: 'B',
      };

      const tags = Array.from({ length: 5 }, () => generateIdentifiabilityTag(inputs));

      const tagValues = tags.map(t => t.tag);
      const reasons = tags.map(t => t.reason);

      expect(new Set(tagValues).size).toBe(1);
      expect(new Set(reasons).size).toBe(1);
      expect(tagValues[0]).toBe('Exploratory');
    });
  });

  describe('isDecisionReady helper', () => {
    it('returns true for decision-ready graph', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5 },
        ],
      };

      const ready = isDecisionReady({
        graph,
        treatment_node: 'A',
        outcome_node: 'B',
      });

      expect(ready).toBe(true);
    });

    it('returns false for exploratory graph', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [],
      };

      const ready = isDecisionReady({
        graph,
        treatment_node: 'A',
        outcome_node: 'B',
      });

      expect(ready).toBe(false);
    });
  });

  describe('Tag structure and format', () => {
    it('always returns valid tag type', () => {
      const graph: Graph = {
        nodes: [
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [
          { from: 'A', to: 'B', weight: 0.5 },
        ],
      };

      const tag = generateIdentifiabilityTag({
        graph,
        treatment_node: 'A',
        outcome_node: 'B',
      });

      expect(['Decision-ready', 'Exploratory']).toContain(tag.tag);
      expect(typeof tag.reason).toBe('string');
      expect(tag.reason.length).toBeGreaterThan(0);
    });

    it('includes adjustment_set for Decision-ready with confounders', () => {
      const graph: Graph = {
        nodes: [
          { id: 'Z', label: 'Z' },
          { id: 'A', label: 'A' },
          { id: 'B', label: 'B' },
        ],
        edges: [
          { from: 'Z', to: 'A', weight: 0.3 },
          { from: 'Z', to: 'B', weight: 0.4 },
          { from: 'A', to: 'B', weight: 0.5 },
        ],
      };

      const tag = generateIdentifiabilityTag({
        graph,
        treatment_node: 'A',
        outcome_node: 'B',
      });

      expect(tag.tag).toBe('Decision-ready');
      expect(tag.adjustment_set).toBeDefined();
      expect(Array.isArray(tag.adjustment_set)).toBe(true);
      expect(tag.adjustment_set!.length).toBeGreaterThan(0);
    });
  });
});
