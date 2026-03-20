/**
 * Tests for post-normalization validation warnings.
 *
 * - INBOUND_STRENGTH_SUM_EXCEEDED: effective inbound influence > 1.0
 *   on nodes with explicit bounded range (state_space.range)
 */

import { describe, it, expect } from 'vitest';
import { validateInboundStrengthSum } from '../src/validation/preflight-v2.js';
import type { EngineGraphV3, EngineEdgeV3, EngineNodeV3 } from '../src/types/engine-v3.js';

// =============================================================================
// Fixtures
// =============================================================================

function makeNode(
  id: string,
  kind: string,
  opts?: { label?: string; range?: { min: number; max: number } },
): EngineNodeV3 {
  return {
    id,
    kind,
    label: opts?.label ?? id,
    observed_state: { value: 0.5 },
    state_space: opts?.range ? { range: opts.range } : undefined,
  };
}

/** Bounded node with explicit state_space.range — the only kind checked */
function makeBoundedNode(id: string, kind: string, label?: string): EngineNodeV3 {
  return makeNode(id, kind, { label, range: { min: 0, max: 1 } });
}

function makeEdge(
  from: string,
  to: string,
  mean: number,
  std = 0.1,
  existsProb = 1.0,
  edgeType?: string,
): EngineEdgeV3 {
  return {
    from,
    to,
    strength: { mean, std },
    exists_probability: existsProb,
    ...(edgeType ? { edge_type: edgeType } : {}),
  } as EngineEdgeV3;
}

function makeGraph(nodes: EngineNodeV3[], edges: EngineEdgeV3[]): EngineGraphV3 {
  return { nodes, edges };
}

// =============================================================================
// INBOUND_STRENGTH_SUM_EXCEEDED
// =============================================================================

describe('validateInboundStrengthSum', () => {
  it('emits no warning when effective sum <= 1.0', () => {
    const graph = makeGraph(
      [
        makeNode('a', 'factor'),
        makeNode('b', 'factor'),
        makeBoundedNode('goal', 'goal'),
      ],
      [
        makeEdge('a', 'goal', 0.4),
        makeEdge('b', 'goal', 0.5),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(0);
  });

  it('emits warning when effective sum > 1.0 on bounded node', () => {
    const graph = makeGraph(
      [
        makeNode('a', 'factor', { label: 'Factor A' }),
        makeNode('b', 'factor', { label: 'Factor B' }),
        makeNode('c', 'factor', { label: 'Factor C' }),
        makeBoundedNode('goal', 'goal', 'Revenue'),
      ],
      [
        makeEdge('a', 'goal', 0.6),
        makeEdge('b', 'goal', 0.5),
        makeEdge('c', 'goal', -0.3),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('INBOUND_STRENGTH_SUM_EXCEEDED');
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].blocks_analysis).toBe(false);
    expect(warnings[0].affected_node_ids).toEqual(['goal']);
    expect(warnings[0].message).toContain('Revenue');
    expect(warnings[0].message).toContain('1.40');
  });

  it('skips nodes without explicit state_space.range (no false alarms)', () => {
    // Node without state_space.range — should NOT be checked
    const graph = makeGraph(
      [
        makeNode('a', 'factor'),
        makeNode('b', 'factor'),
        makeNode('goal', 'goal'), // no state_space.range
      ],
      [
        makeEdge('a', 'goal', 0.8),
        makeEdge('b', 'goal', 0.9),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(0);
  });

  it('uses effective influence (mean × exists_probability)', () => {
    // mean=0.8 × exists_prob=0.3 = 0.24 effective per edge
    // sum = 0.24 + 0.24 = 0.48 — should NOT warn
    const graph = makeGraph(
      [
        makeNode('a', 'factor'),
        makeNode('b', 'factor'),
        makeBoundedNode('goal', 'goal'),
      ],
      [
        makeEdge('a', 'goal', 0.8, 0.1, 0.3),
        makeEdge('b', 'goal', 0.8, 0.1, 0.3),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(0);
  });

  it('accounts for exists_probability in effective influence', () => {
    // mean=0.8 × exists_prob=0.8 = 0.64 per edge
    // sum = 0.64 + 0.64 = 1.28 — should warn
    const graph = makeGraph(
      [
        makeNode('a', 'factor'),
        makeNode('b', 'factor'),
        makeBoundedNode('goal', 'goal'),
      ],
      [
        makeEdge('a', 'goal', 0.8, 0.1, 0.8),
        makeEdge('b', 'goal', 0.8, 0.1, 0.8),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('1.28');
  });

  it('excludes structural edges (from decision/option nodes)', () => {
    const graph = makeGraph(
      [
        makeNode('d1', 'decision'),
        makeNode('o1', 'option'),
        makeNode('f1', 'factor'),
        makeBoundedNode('goal', 'goal'),
      ],
      [
        makeEdge('d1', 'o1', 1.0),
        makeEdge('o1', 'f1', 1.0),
        makeEdge('f1', 'goal', 0.8),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(0);
  });

  it('excludes bidirected edges from sum', () => {
    const graph = makeGraph(
      [
        makeNode('a', 'factor'),
        makeNode('b', 'factor'),
        makeBoundedNode('goal', 'goal'),
      ],
      [
        makeEdge('a', 'goal', 0.6),
        makeEdge('b', 'goal', 0.8, 0.1, 1.0, 'bidirected'),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    // Only 0.6 counted (bidirected excluded), sum < 1.0
    expect(warnings).toHaveLength(0);
  });

  it('uses absolute value of negative means', () => {
    const graph = makeGraph(
      [
        makeNode('a', 'factor'),
        makeNode('b', 'risk'),
        makeBoundedNode('goal', 'goal'),
      ],
      [
        makeEdge('a', 'goal', 0.6),
        makeEdge('b', 'goal', -0.6),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('1.20');
  });

  it('handles empty graph', () => {
    const warnings = validateInboundStrengthSum(makeGraph([], []));
    expect(warnings).toHaveLength(0);
  });

  it('handles graph with no edges', () => {
    const graph = makeGraph(
      [makeBoundedNode('goal', 'goal')],
      [],
    );
    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(0);
  });

  it('warns on multiple bounded nodes independently', () => {
    const graph = makeGraph(
      [
        makeNode('a', 'factor'),
        makeNode('b', 'factor'),
        makeNode('c', 'factor'),
        makeBoundedNode('goal', 'goal'),
        makeBoundedNode('outcome', 'outcome'),
      ],
      [
        makeEdge('a', 'goal', 0.7),
        makeEdge('b', 'goal', 0.5),
        makeEdge('b', 'outcome', 0.8),
        makeEdge('c', 'outcome', 0.6),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(2);
    const nodeIds = warnings.map((w) => w.affected_node_ids?.[0]);
    expect(nodeIds).toContain('goal');
    expect(nodeIds).toContain('outcome');
  });

  it('produces deterministic output order (sorted by node ID)', () => {
    const graph = makeGraph(
      [
        makeNode('x', 'factor'),
        makeBoundedNode('z_node', 'goal'),
        makeBoundedNode('a_node', 'outcome'),
      ],
      [
        makeEdge('x', 'z_node', 0.8),
        makeEdge('x', 'z_node', 0.8),
        makeEdge('x', 'a_node', 0.8),
        makeEdge('x', 'a_node', 0.8),
      ],
    );

    const warnings = validateInboundStrengthSum(graph);
    expect(warnings).toHaveLength(2);
    expect(warnings[0].affected_node_ids?.[0]).toBe('a_node');
    expect(warnings[1].affected_node_ids?.[0]).toBe('z_node');
  });
});
