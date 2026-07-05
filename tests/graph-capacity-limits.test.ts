import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildCritique } from '../src/trust/critique-builder.js';
import { CRITIQUE_CODES } from '../src/trust/critique-codes.js';
import {
  RUN_CRITIQUE_NODE_LIMIT,
  RUN_EDGE_SOFT_LIMIT,
  RUN_EDGE_HARD_LIMIT,
} from '../src/constants/limits.js';
import type { Graph } from '../src/trust/types.js';

/**
 * Run-path graph capacity boundaries.
 *
 * - node limit 40: BLOCKER critique above, results marked approximate
 * - edge soft limit 120: advisory (non-blocking) critique above
 * - edge hard limit 160: BLOCKER critique above, results marked approximate
 *
 * Fixture: fixtures/capacity/run-40n-120e.json — deterministic 40-node /
 * 120-edge run request (decision → options → factors → outcomes/risks → goal,
 * seed 4242) sitting exactly at both boundaries; must produce no size critique.
 */

/** Acyclic graph: n nodes, first `edgeCount` forward pairs (i < j) as edges. */
function makeGraph(nodeCount: number, edgeCount: number): Graph {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n${i}`,
    label: `Node ${i}`,
  }));
  const edges: Graph['edges'] = [];
  outer: for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      if (edges.length >= edgeCount) break outer;
      edges.push({ from: `n${i}`, to: `n${j}`, weight: 0.5 });
    }
  }
  if (edges.length !== edgeCount) {
    throw new Error(`could not build ${edgeCount} edges from ${nodeCount} nodes`);
  }
  return { nodes, edges };
}

const sizeBlockers = (critique: ReturnType<typeof buildCritique>) =>
  critique.filter(c => c.code === CRITIQUE_CODES.GRAPH_TOO_LARGE);

const denseAdvisories = (critique: ReturnType<typeof buildCritique>) =>
  critique.filter(c => c.severity === 'IMPROVEMENT' && c.message.includes('Dense graph'));

describe('run-path node limit (default 40)', () => {
  it('constants expose the enforced values', () => {
    expect(RUN_CRITIQUE_NODE_LIMIT).toBe(40);
    expect(RUN_EDGE_SOFT_LIMIT).toBe(120);
    expect(RUN_EDGE_HARD_LIMIT).toBe(160);
  });

  it('40 nodes passes without a GRAPH_TOO_LARGE critique', () => {
    const critique = buildCritique({ graph: makeGraph(40, 39), identifiable: true });
    expect(sizeBlockers(critique)).toHaveLength(0);
  });

  it('41 nodes triggers the BLOCKER critique with the enforced limit in the copy', () => {
    const critique = buildCritique({ graph: makeGraph(41, 40), identifiable: true });
    const blockers = sizeBlockers(critique);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].severity).toBe('BLOCKER');
    expect(blockers[0].semantic_severity).toBe('ERROR');
    expect(blockers[0].message).toContain('41 nodes (limit: 40)');
    expect(blockers[0].message).toContain('Results marked approximate');
  });

  it('caller-supplied node_limit still overrides the default', () => {
    const critique = buildCritique({ graph: makeGraph(15, 14), identifiable: true, node_limit: 12 });
    expect(sizeBlockers(critique)).toHaveLength(1);
    expect(sizeBlockers(critique)[0].message).toContain('(limit: 12)');
  });
});

describe('run-path edge caps (soft 120, hard 160)', () => {
  it('120 edges passes without any edge-size critique', () => {
    const critique = buildCritique({ graph: makeGraph(40, 120), identifiable: true });
    expect(sizeBlockers(critique)).toHaveLength(0);
    expect(denseAdvisories(critique)).toHaveLength(0);
  });

  it('121 edges triggers the advisory critique only (non-blocking)', () => {
    const critique = buildCritique({ graph: makeGraph(40, 121), identifiable: true });
    expect(sizeBlockers(critique)).toHaveLength(0);
    const advisories = denseAdvisories(critique);
    expect(advisories).toHaveLength(1);
    expect(advisories[0].severity).toBe('IMPROVEMENT');
    expect(advisories[0].semantic_severity).toBe('WARNING');
    expect(advisories[0].message).toContain('121 edges (recommended maximum: 120)');
    expect(advisories[0].code).toBe('GRAPH_DENSE');
  });

  it('160 edges stays advisory, not blocking', () => {
    const critique = buildCritique({ graph: makeGraph(40, 160), identifiable: true });
    expect(sizeBlockers(critique)).toHaveLength(0);
    expect(denseAdvisories(critique)).toHaveLength(1);
  });

  it('161 edges triggers the BLOCKER critique with the enforced limit in the copy', () => {
    const critique = buildCritique({ graph: makeGraph(40, 161), identifiable: true });
    const blockers = sizeBlockers(critique);
    expect(blockers).toHaveLength(1);
    expect(blockers[0].severity).toBe('BLOCKER');
    expect(blockers[0].message).toContain('161 edges (limit: 160)');
    expect(blockers[0].message).toContain('Results marked approximate');
    // Hard cap supersedes the soft advisory — no duplicate edge critique
    expect(denseAdvisories(critique)).toHaveLength(0);
  });
});

describe('capacity fixture (40 nodes / 120 edges, seed 4242)', () => {
  const fixture = JSON.parse(
    readFileSync(resolve(process.cwd(), 'fixtures/capacity/run-40n-120e.json'), 'utf8')
  );

  it('is exactly at the supported boundary', () => {
    expect(fixture.seed).toBe(4242);
    expect(fixture.graph.nodes).toHaveLength(40);
    expect(fixture.graph.edges).toHaveLength(120);
  });

  it('is acyclic and fully connected with valid endpoints', () => {
    const ids = new Set<string>(fixture.graph.nodes.map((n: any) => n.id));
    expect(ids.size).toBe(40);
    const touched = new Set<string>();
    for (const e of fixture.graph.edges) {
      expect(ids.has(e.from)).toBe(true);
      expect(ids.has(e.to)).toBe(true);
      touched.add(e.from);
      touched.add(e.to);
    }
    expect(touched.size).toBe(40);
  });

  it('produces no graph-size critique at the new limits', () => {
    const critique = buildCritique({ graph: fixture.graph, identifiable: true });
    expect(sizeBlockers(critique)).toHaveLength(0);
    expect(denseAdvisories(critique)).toHaveLength(0);
    expect(critique.filter(c => c.severity === 'BLOCKER')).toHaveLength(0);
  });
});
