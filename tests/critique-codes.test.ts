/**
 * Tests for critique codes standardization
 */

import { describe, it, expect } from 'vitest';
import { buildCritique } from '../src/trust/critique-builder.js';
import { CRITIQUE_CODES } from '../src/trust/critique-codes.js';
import type { Graph } from '../src/trust/types.js';

describe('Critique codes', () => {
  it('includes GRAPH_TOO_LARGE code when graph exceeds node limit', () => {
    const nodes = Array.from({ length: 15 }, (_, i) => ({
      id: `n${i}`,
      label: `Node ${i}`,
    }));
    const graph: Graph = {
      nodes,
      edges: [],
    };

    const critique = buildCritique({
      graph,
      identifiable: true,
      node_limit: 12,
    });

    const largeCritique = critique.find((c) => c.code === CRITIQUE_CODES.GRAPH_TOO_LARGE);
    expect(largeCritique).toBeDefined();
    expect(largeCritique?.severity).toBe('BLOCKER');
    expect(largeCritique?.semantic_severity).toBe('ERROR');
    expect(largeCritique?.source).toBe('engine');
  });

  it('includes IDENTIFIABILITY_ISSUE code when not identifiable', () => {
    const graph: Graph = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    };

    const critique = buildCritique({
      graph,
      identifiable: false,
      node_limit: 12,
    });

    const identCritique = critique.find((c) => c.code === CRITIQUE_CODES.IDENTIFIABILITY_ISSUE);
    expect(identCritique).toBeDefined();
    expect(identCritique?.severity).toBe('BLOCKER');
    expect(identCritique?.semantic_severity).toBe('ERROR');
  });

  it('includes GRAPH_CYCLE_DETECTED code when cycles exist', () => {
    const graph: Graph = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' }, // Creates cycle
      ],
    };

    const critique = buildCritique({
      graph,
      identifiable: true,
      node_limit: 12,
    });

    const cycleCritique = critique.find((c) => c.code === CRITIQUE_CODES.GRAPH_CYCLE_DETECTED);
    expect(cycleCritique).toBeDefined();
    expect(cycleCritique?.severity).toBe('BLOCKER');
    expect(cycleCritique?.semantic_severity).toBe('ERROR');
  });

  it('includes GRAPH_DISCONNECTED code for disconnected nodes', () => {
    const graph: Graph = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'Disconnected' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };

    const critique = buildCritique({
      graph,
      identifiable: true,
      node_limit: 12,
    });

    const disconnectedCritique = critique.find((c) => c.code === CRITIQUE_CODES.GRAPH_DISCONNECTED);
    expect(disconnectedCritique).toBeDefined();
    expect(disconnectedCritique?.severity).toBe('IMPROVEMENT');
    expect(disconnectedCritique?.message).toContain('Disconnected');
  });

  it('all CRITIQUE_CODES are exported correctly', () => {
    expect(CRITIQUE_CODES.GRAPH_TOO_LARGE).toBe('GRAPH_TOO_LARGE');
    expect(CRITIQUE_CODES.GRAPH_CYCLE_DETECTED).toBe('GRAPH_CYCLE_DETECTED');
    expect(CRITIQUE_CODES.GRAPH_DISCONNECTED).toBe('GRAPH_DISCONNECTED');
    expect(CRITIQUE_CODES.IDENTIFIABILITY_ISSUE).toBe('IDENTIFIABILITY_ISSUE');
    expect(CRITIQUE_CODES.ISL_CANNOT_IDENTIFY).toBe('ISL_CANNOT_IDENTIFY');
    expect(CRITIQUE_CODES.ISL_UNCERTAIN).toBe('ISL_UNCERTAIN');
    expect(CRITIQUE_CODES.ISL_ISSUE).toBe('ISL_ISSUE');
    expect(CRITIQUE_CODES.ISL_FRAGILE).toBe('ISL_FRAGILE');
    expect(CRITIQUE_CODES.CEE_UNIFORM_WEIGHTS).toBe('CEE_UNIFORM_WEIGHTS');
    expect(CRITIQUE_CODES.CEE_WEIGHT_ISSUE).toBe('CEE_WEIGHT_ISSUE');
    expect(CRITIQUE_CODES.CEE_BELIEF_ISSUE).toBe('CEE_BELIEF_ISSUE');
    expect(CRITIQUE_CODES.EVIDENCE_STALE).toBe('EVIDENCE_STALE');
    expect(CRITIQUE_CODES.EVIDENCE_MISSING).toBe('EVIDENCE_MISSING');
  });

  it('critiques have consistent structure with optional code', () => {
    const graph: Graph = {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    };

    const critique = buildCritique({
      graph,
      identifiable: true,
      node_limit: 12,
    });

    // Should have at least one critique
    expect(critique.length).toBeGreaterThan(0);

    // All critiques should have required fields
    for (const c of critique) {
      expect(['BLOCKER', 'IMPROVEMENT', 'OBSERVATION']).toContain(c.severity);
      expect(c.message).toBeDefined();
      expect(typeof c.message).toBe('string');
      expect(c.source).toBe('engine');
      // semantic_severity is now always set
      expect(['ERROR', 'WARNING', 'INFO']).toContain(c.semantic_severity);
    }
  });
});
