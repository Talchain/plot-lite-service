/**
 * Identifiability Tests - A.3
 * 
 * Verifies d-separation logic, adjustment sets, and determinism.
 */

import { describe, it, expect } from 'vitest';
import { checkIdentifiability } from '../src/trust/identifiability.js';

describe('Identifiability & Adjustment Sets (Task A.3)', () => {
  it('identifies direct causal path with no confounders', () => {
    const graph = {
      nodes: [
        { id: 'treatment', label: 'Treatment', type: 'decision' },
        { id: 'outcome', label: 'Outcome', type: 'outcome' },
      ],
      edges: [
        { from: 'treatment', to: 'outcome' },
      ],
    };

    const result = checkIdentifiability({
      graph,
      treatment_node: 'treatment',
      outcome_node: 'outcome',
    });

    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toEqual([]);
    expect(result.summary).toContain('No confounders detected');
    expect(result.notes).toBeDefined();
    expect(result.notes.length).toBeGreaterThan(0);
  });

  it('identifies confounder requiring adjustment', () => {
    const graph = {
      nodes: [
        { id: 'confounder', label: 'Confounder', type: 'decision' },
        { id: 'treatment', label: 'Treatment', type: 'decision' },
        { id: 'outcome', label: 'Outcome', type: 'outcome' },
      ],
      edges: [
        { from: 'confounder', to: 'treatment' },
        { from: 'confounder', to: 'outcome' },
        { from: 'treatment', to: 'outcome' },
      ],
    };

    const result = checkIdentifiability({
      graph,
      treatment_node: 'treatment',
      outcome_node: 'outcome',
    });

    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toContain('confounder');
    expect(result.summary).toContain('Adjust for');
    expect(result.notes).toContain('Backdoor criterion: adjust for 1 confounder(s)');
  });

  it('returns false for missing treatment node', () => {
    const graph = {
      nodes: [
        { id: 'outcome', label: 'Outcome', type: 'outcome' },
      ],
      edges: [],
    };

    const result = checkIdentifiability({
      graph,
      treatment_node: 'nonexistent',
      outcome_node: 'outcome',
    });

    expect(result.identifiable).toBe(false);
    expect(result.adjustment_set).toEqual([]);
    expect(result.notes).toContain('Treatment or outcome node not found in graph');
  });

  it('returns false for no causal path', () => {
    const graph = {
      nodes: [
        { id: 'treatment', label: 'Treatment', type: 'decision' },
        { id: 'outcome', label: 'Outcome', type: 'outcome' },
        { id: 'isolated', label: 'Isolated', type: 'decision' },
      ],
      edges: [
        { from: 'isolated', to: 'outcome' },
      ],
    };

    const result = checkIdentifiability({
      graph,
      treatment_node: 'treatment',
      outcome_node: 'outcome',
    });

    expect(result.identifiable).toBe(false);
    expect(result.notes).toContain('No causal path from treatment to outcome');
  });

  it('produces deterministic adjustment sets (sorted)', () => {
    const graph = {
      nodes: [
        { id: 'z_conf', label: 'Z Confounder', type: 'decision' },
        { id: 'a_conf', label: 'A Confounder', type: 'decision' },
        { id: 'm_conf', label: 'M Confounder', type: 'decision' },
        { id: 'treatment', label: 'Treatment', type: 'decision' },
        { id: 'outcome', label: 'Outcome', type: 'outcome' },
      ],
      edges: [
        { from: 'z_conf', to: 'treatment' },
        { from: 'z_conf', to: 'outcome' },
        { from: 'a_conf', to: 'treatment' },
        { from: 'a_conf', to: 'outcome' },
        { from: 'm_conf', to: 'treatment' },
        { from: 'm_conf', to: 'outcome' },
        { from: 'treatment', to: 'outcome' },
      ],
    };

    const results = [];
    for (let i = 0; i < 10; i++) {
      const result = checkIdentifiability({
        graph,
        treatment_node: 'treatment',
        outcome_node: 'outcome',
      });
      results.push(JSON.stringify(result.adjustment_set));
    }

    // All results should be identical
    const uniqueResults = new Set(results);
    expect(uniqueResults.size).toBe(1);

    // Verify alphabetical ordering
    const firstResult = JSON.parse(results[0]);
    expect(firstResult).toEqual(['a_conf', 'm_conf', 'z_conf']);
  });

  it('handles chain graphs correctly', () => {
    const graph = {
      nodes: [
        { id: 'a', label: 'A', type: 'decision' },
        { id: 'b', label: 'B', type: 'decision' },
        { id: 'c', label: 'C', type: 'decision' },
        { id: 'd', label: 'D', type: 'outcome' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'd' },
      ],
    };

    const result = checkIdentifiability({
      graph,
      treatment_node: 'a',
      outcome_node: 'd',
    });

    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toEqual([]);
  });

  it('identifies multiple common causes', () => {
    const graph = {
      nodes: [
        { id: 'conf1', label: 'Confounder 1', type: 'decision' },
        { id: 'conf2', label: 'Confounder 2', type: 'decision' },
        { id: 'treatment', label: 'Treatment', type: 'decision' },
        { id: 'mediator', label: 'Mediator', type: 'decision' },
        { id: 'outcome', label: 'Outcome', type: 'outcome' },
      ],
      edges: [
        { from: 'conf1', to: 'treatment' },
        { from: 'conf1', to: 'outcome' },
        { from: 'conf2', to: 'treatment' },
        { from: 'conf2', to: 'outcome' },
        { from: 'treatment', to: 'mediator' },
        { from: 'mediator', to: 'outcome' },
      ],
    };

    const result = checkIdentifiability({
      graph,
      treatment_node: 'treatment',
      outcome_node: 'outcome',
    });

    expect(result.identifiable).toBe(true);
    expect(result.adjustment_set).toHaveLength(2);
    expect(result.adjustment_set).toContain('conf1');
    expect(result.adjustment_set).toContain('conf2');
    // Should be sorted
    expect(result.adjustment_set).toEqual(['conf1', 'conf2']);
  });

  it('produces identical results across 20 calls', () => {
    const graph = {
      nodes: [
        { id: 'x', label: 'X', type: 'decision' },
        { id: 'y', label: 'Y', type: 'decision' },
        { id: 'z', label: 'Z', type: 'outcome' },
      ],
      edges: [
        { from: 'x', to: 'y' },
        { from: 'x', to: 'z' },
        { from: 'y', to: 'z' },
      ],
    };

    const results = [];
    for (let i = 0; i < 20; i++) {
      const result = checkIdentifiability({
        graph,
        treatment_node: 'y',
        outcome_node: 'z',
      });
      results.push(JSON.stringify(result));
    }

    const uniqueResults = new Set(results);
    expect(uniqueResults.size).toBe(1);
  });
});
