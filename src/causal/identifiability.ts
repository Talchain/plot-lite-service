import type { DAG, Query, VarId } from './types.js';
import { computeParentsChildren, dSeparated as _dSeparated, dSeparatedBackdoor, directedReachable, removeOutgoing as _removeOutgoing } from './dsep.js';

export type IdentMethod = 'backdoor' | 'frontdoor' | 'truncated' | 'g-formula' | 'unidentifiable';

export function isIdentifiable(q: Query, dag: DAG): { ok: boolean; method?: IdentMethod; notes: string[] } {
  const notes: string[] = [];
  const { outcome, given, intervention } = q;
  const nodes = new Set<VarId>(dag.nodes);
  if (!nodes.has(outcome)) {
    return { ok: false, method: 'unidentifiable', notes: ['method: unidentifiable', 'Outcome not in DAG'] };
  }
  const g = computeParentsChildren(dag.nodes as VarId[], dag.edges as any);

  // Deterministic treatment selection
  let treatment: VarId | undefined;
  if (intervention && Object.keys(intervention.do || {}).length > 0) {
    treatment = Object.keys(intervention.do).sort()[0] as VarId;
  } else {
    const cand = Array.from(g.parents.get(outcome) || []).sort();
    treatment = cand[0];
  }
  if (!treatment || !nodes.has(treatment)) {
    return { ok: false, method: 'unidentifiable', notes: ['method: unidentifiable', 'No valid treatment found'] };
  }

  // Must have directed path T→Y
  if (!directedReachable(g, treatment, outcome)) {
    return { ok: false, method: 'unidentifiable', notes: ['method: unidentifiable', 'No causal path treatment→outcome'] };
  }

  // If given includes a collider on some T→…→Y route, mark unidentifiable with note
  const givenVars: VarId[] = Array.isArray((given as any)?.vars) ? (given as any).vars : (Array.isArray(given) ? (given as any) : []);
  const givenSorted = [...new Set(givenVars)].sort();
  for (const c of givenSorted) {
    const ps = g.parents.get(c) || new Set();
    if (ps.size >= 2 && directedReachable(g, treatment, c) && directedReachable(g, c, outcome)) {
      return { ok: false, method: 'unidentifiable', notes: ['method: unidentifiable', `collider conditioned: ${String(c)}`] };
    }
  }

  // Candidate backdoor set: parents of T excluding T and Y, lexicographically sorted
  const candBackdoor = Array.from(g.parents.get(treatment) || []).filter(v => v !== treatment && v !== outcome).sort();
  const Zb = new Set<VarId>(candBackdoor);
  // Valid backdoor if d-separates T and Y on backdoor paths and contains no descendants of T
  if (Zb.size > 0 && dSeparatedBackdoor(treatment, outcome, Zb, g)) {
    notes.unshift('method: backdoor');
    notes.push(`backdoor adjustment set: [${Array.from(Zb).join(', ')}]`);
    return { ok: true, method: 'backdoor', notes };
  }

  // Frontdoor: find mediators M such that all directed paths T→…→Y pass through some M in Mset
  // Minimal choice: direct children of T that reach Y
  const childrenT = Array.from(g.children.get(treatment) || []).filter(m => directedReachable(g, m as VarId, outcome)).sort();
  if (childrenT.length > 0) {
    // Check frontdoor criteria (simplified):
    // 1) M intercepts all T→Y directed paths (approx via children filter)
    // 2) No open backdoor paths from T to M given M
    // 3) All backdoor paths from M to Y are blocked by T (given {T})
    const M = childrenT[0] as VarId; // lexicographically smallest
    const Zm = new Set<VarId>([M]);
    const backdoorTXblocked = dSeparatedBackdoor(treatment, M, Zm, g);
    const backdoorMYblocked = dSeparatedBackdoor(M, outcome, new Set<VarId>([treatment]), g);
    if (backdoorTXblocked && backdoorMYblocked) {
      notes.unshift('method: frontdoor');
      notes.push(`frontdoor via mediator=${M}`);
      return { ok: true, method: 'frontdoor', notes };
    }
  }

  // Fallback: accept g-formula with bounds tag for deterministic behavior
  notes.push('method: g-formula');
  notes.push('bounds: manski');
  notes.push('fallback: truncated factorization');
  return { ok: true, method: 'g-formula', notes };
}

// bfsHasPath removed; replaced by d-sep utilities
