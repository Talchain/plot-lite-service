/**
 * Forbidden-Edge Rerouting Tests
 *
 * Verifies that simpleRepair (normaliseGraphWithRepairs) deterministically
 * reroutes FORBIDDEN_EDGE violations rather than relying on the LLM repair pass.
 *
 * Patterns tested:
 *   1. outcome→outcome  — rerouted via factor parents of source outcome
 *   2. outcome→risk     — rerouted via factor parents of source outcome
 *   3. risk→outcome     — rerouted via factor parents of source risk
 *   4. No factor parents — logged as UNRESOLVABLE_FORBIDDEN_EDGE, edge left in place
 *   5. Factor parent already has edge to target — no duplicate created
 */

import { describe, it, expect } from 'vitest';
import { normaliseGraphWithRepairs } from '../src/normalisation/normalise-and-repair.js';
import { REPAIR_CODES } from '../src/normalisation/repair-codes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal node constructors */
function factor(id: string) { return { id, kind: 'factor' as const, label: id }; }
function outcome(id: string) { return { id, kind: 'outcome' as const, label: id }; }
function risk(id: string) { return { id, kind: 'risk' as const, label: id }; }

/** Edge with explicit strength (avoids default-repair noise) */
function edge(from: string, to: string, mean = 0.6, std = 0.2, ep = 0.9) {
  return { from, to, strength: { mean, std }, exists_probability: ep };
}

// ---------------------------------------------------------------------------
// Pattern 1: outcome→outcome
// ---------------------------------------------------------------------------

describe('outcome→outcome: rerouted via factor parent', () => {
  const graph = {
    nodes: [factor('fac_a'), outcome('out_x'), outcome('out_y')],
    edges: [
      edge('fac_a', 'out_x', 0.6, 0.2, 0.9),  // factor → source outcome
      edge('out_x', 'out_y', 0.4, 0.1, 0.8),  // forbidden edge
    ],
  };

  const result = normaliseGraphWithRepairs(graph);

  it('removes the forbidden outcome→outcome edge', () => {
    const found = result.graph.edges.find(e => e.from === 'out_x' && e.to === 'out_y');
    expect(found).toBeUndefined();
  });

  it('adds an attenuated edge from factor parent to target', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'out_y');
    expect(newEdge).toBeDefined();
  });

  it('attenuates strength.mean by 0.5', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'out_y');
    expect(newEdge!.strength.mean).toBeCloseTo(0.4 * 0.5, 10);
  });

  it('uses max(source std, 0.15) for attenuated std', () => {
    // source std = 0.1 → max(0.1, 0.15) = 0.15
    const newEdge = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'out_y');
    expect(newEdge!.strength.std).toBe(0.15);
  });

  it('attenuates exists_probability by 0.8', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'out_y');
    expect(newEdge!.exists_probability).toBeCloseTo(0.8 * 0.8, 10);
  });

  it('logs REROUTE_OUTCOME_CHAIN repair entry', () => {
    const repair = result.repairs.find(r => r.code === REPAIR_CODES.REROUTE_OUTCOME_CHAIN);
    expect(repair).toBeDefined();
    expect(repair!.severity).toBe('warn');
    expect(repair!.layer).toBe('plot');
  });

  it('repair entry has correct before/after', () => {
    const repair = result.repairs.find(r => r.code === REPAIR_CODES.REROUTE_OUTCOME_CHAIN);
    expect(repair!.before).toEqual({ from: 'out_x', to: 'out_y' });
    expect(repair!.after).toEqual({ from: 'fac_a', to: 'out_y', attenuated: true });
  });

  it('preserves the original factor→outcome edge', () => {
    const orig = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'out_x');
    expect(orig).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Pattern 2: outcome→risk
// ---------------------------------------------------------------------------

describe('outcome→risk: rerouted via factor parent', () => {
  const graph = {
    nodes: [factor('fac_a'), outcome('out_x'), risk('risk_y')],
    edges: [
      edge('fac_a', 'out_x', 0.5, 0.2, 0.9),
      edge('out_x', 'risk_y', 0.3, 0.08, 0.7),
    ],
  };

  const result = normaliseGraphWithRepairs(graph);

  it('removes the forbidden outcome→risk edge', () => {
    const found = result.graph.edges.find(e => e.from === 'out_x' && e.to === 'risk_y');
    expect(found).toBeUndefined();
  });

  it('adds attenuated edge from factor parent to risk target', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'risk_y');
    expect(newEdge).toBeDefined();
  });

  it('std is max(0.08, 0.15) = 0.15', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'risk_y');
    expect(newEdge!.strength.std).toBe(0.15);
  });

  it('logs REROUTE_OUTCOME_CHAIN (outcome→risk uses same code)', () => {
    const repair = result.repairs.find(r => r.code === REPAIR_CODES.REROUTE_OUTCOME_CHAIN);
    expect(repair).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Pattern 3: risk→outcome
// ---------------------------------------------------------------------------

describe('risk→outcome: rerouted via factor parent', () => {
  const graph = {
    nodes: [factor('fac_b'), risk('risk_r'), outcome('out_z')],
    edges: [
      edge('fac_b', 'risk_r', 0.7, 0.25, 0.85),
      edge('risk_r', 'out_z', 0.5, 0.2, 0.75),
    ],
  };

  const result = normaliseGraphWithRepairs(graph);

  it('removes the forbidden risk→outcome edge', () => {
    const found = result.graph.edges.find(e => e.from === 'risk_r' && e.to === 'out_z');
    expect(found).toBeUndefined();
  });

  it('adds attenuated edge from factor parent to outcome target', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_b' && e.to === 'out_z');
    expect(newEdge).toBeDefined();
  });

  it('attenuates mean by 0.5', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_b' && e.to === 'out_z');
    expect(newEdge!.strength.mean).toBeCloseTo(0.5 * 0.5, 10);
  });

  it('std is max(0.2, 0.15) = 0.2', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_b' && e.to === 'out_z');
    expect(newEdge!.strength.std).toBe(0.2);
  });

  it('attenuates exists_probability by 0.8', () => {
    const newEdge = result.graph.edges.find(e => e.from === 'fac_b' && e.to === 'out_z');
    expect(newEdge!.exists_probability).toBeCloseTo(0.75 * 0.8, 10);
  });

  it('logs REROUTE_RISK_TO_OUTCOME repair entry', () => {
    const repair = result.repairs.find(r => r.code === REPAIR_CODES.REROUTE_RISK_TO_OUTCOME);
    expect(repair).toBeDefined();
    expect(repair!.severity).toBe('warn');
    expect(repair!.layer).toBe('plot');
  });

  it('repair entry has correct before/after', () => {
    const repair = result.repairs.find(r => r.code === REPAIR_CODES.REROUTE_RISK_TO_OUTCOME);
    expect(repair!.before).toEqual({ from: 'risk_r', to: 'out_z' });
    expect(repair!.after).toEqual({ from: 'fac_b', to: 'out_z', attenuated: true });
  });
});

// ---------------------------------------------------------------------------
// Pattern 4: no factor parents → UNRESOLVABLE_FORBIDDEN_EDGE
// ---------------------------------------------------------------------------

describe('outcome→outcome with no factor parents: logged as unresolvable', () => {
  // out_x has NO factor parent — only another outcome feeding into it
  const graph = {
    nodes: [outcome('out_x'), outcome('out_w'), outcome('out_y')],
    edges: [
      edge('out_w', 'out_x', 0.5, 0.2, 0.9),  // non-factor parent (also forbidden, but no factor)
      edge('out_x', 'out_y', 0.4, 0.1, 0.8),
    ],
  };

  const result = normaliseGraphWithRepairs(graph);

  it('does NOT remove the unresolvable forbidden edge', () => {
    const found = result.graph.edges.find(e => e.from === 'out_x' && e.to === 'out_y');
    expect(found).toBeDefined();
  });

  it('logs UNRESOLVABLE_FORBIDDEN_EDGE', () => {
    const repair = result.repairs.find(r => r.code === REPAIR_CODES.UNRESOLVABLE_FORBIDDEN_EDGE);
    expect(repair).toBeDefined();
    expect(repair!.severity).toBe('warn');
  });

  it('does NOT log REROUTE_OUTCOME_CHAIN for unresolvable edge', () => {
    const repair = result.repairs.find(r =>
      r.code === REPAIR_CODES.REROUTE_OUTCOME_CHAIN &&
      (r.before as any)?.from === 'out_x'
    );
    expect(repair).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pattern 5: factor parent already has edge to target → no duplicate
// ---------------------------------------------------------------------------

describe('factor parent already has edge to target: no duplicate created', () => {
  const graph = {
    nodes: [factor('fac_a'), outcome('out_x'), outcome('out_y')],
    edges: [
      edge('fac_a', 'out_x', 0.6, 0.2, 0.9),
      edge('fac_a', 'out_y', 0.7, 0.2, 0.9),  // pre-existing edge fac_a → out_y
      edge('out_x', 'out_y', 0.4, 0.1, 0.8),  // forbidden edge
    ],
  };

  const result = normaliseGraphWithRepairs(graph);

  it('removes the forbidden edge', () => {
    const found = result.graph.edges.find(e => e.from === 'out_x' && e.to === 'out_y');
    expect(found).toBeUndefined();
  });

  it('does not create a duplicate fac_a→out_y edge', () => {
    const dupes = result.graph.edges.filter(e => e.from === 'fac_a' && e.to === 'out_y');
    expect(dupes).toHaveLength(1);
  });

  it('preserves the original fac_a→out_y edge strength', () => {
    const existing = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'out_y');
    expect(existing!.strength.mean).toBeCloseTo(0.7, 10);
  });

  it('does not emit a REROUTE repair for the duplicate-guarded case', () => {
    // No reroute repair should appear since no new edge was added
    const reroutes = result.repairs.filter(r => r.code === REPAIR_CODES.REROUTE_OUTCOME_CHAIN);
    expect(reroutes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Pattern 6: multiple factor parents → one rerouted edge per parent
// ---------------------------------------------------------------------------

describe('multiple factor parents: one rerouted edge per parent', () => {
  const graph = {
    nodes: [factor('fac_a'), factor('fac_b'), outcome('out_x'), outcome('out_y')],
    edges: [
      edge('fac_a', 'out_x', 0.5, 0.2, 0.9),
      edge('fac_b', 'out_x', 0.4, 0.18, 0.85),
      edge('out_x', 'out_y', 0.6, 0.12, 0.8),  // forbidden
    ],
  };

  const result = normaliseGraphWithRepairs(graph);

  it('removes the forbidden edge', () => {
    const found = result.graph.edges.find(e => e.from === 'out_x' && e.to === 'out_y');
    expect(found).toBeUndefined();
  });

  it('adds rerouted edge from fac_a to out_y', () => {
    const e = result.graph.edges.find(e => e.from === 'fac_a' && e.to === 'out_y');
    expect(e).toBeDefined();
  });

  it('adds rerouted edge from fac_b to out_y', () => {
    const e = result.graph.edges.find(e => e.from === 'fac_b' && e.to === 'out_y');
    expect(e).toBeDefined();
  });

  it('emits two REROUTE_OUTCOME_CHAIN repair entries', () => {
    const reroutes = result.repairs.filter(r => r.code === REPAIR_CODES.REROUTE_OUTCOME_CHAIN);
    expect(reroutes).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Pattern 7: permitted edges are not affected
// ---------------------------------------------------------------------------

describe('permitted edges are not touched', () => {
  const graph = {
    nodes: [factor('fac_a'), outcome('out_x'), { id: 'goal_g', kind: 'goal', label: 'Goal' }],
    edges: [
      edge('fac_a', 'out_x', 0.5, 0.2, 0.9),     // factor → outcome: allowed
      edge('fac_a', 'goal_g', 0.4, 0.15, 0.85),   // factor → goal: allowed
      edge('out_x', 'goal_g', 0.6, 0.2, 0.8),     // outcome → goal: allowed
    ],
  };

  const result = normaliseGraphWithRepairs(graph);

  it('leaves all edges in place', () => {
    expect(result.graph.edges).toHaveLength(3);
  });

  it('emits no reroute repairs', () => {
    const reroutes = result.repairs.filter(r =>
      r.code === REPAIR_CODES.REROUTE_OUTCOME_CHAIN ||
      r.code === REPAIR_CODES.REROUTE_RISK_TO_OUTCOME ||
      r.code === REPAIR_CODES.UNRESOLVABLE_FORBIDDEN_EDGE
    );
    expect(reroutes).toHaveLength(0);
  });
});
