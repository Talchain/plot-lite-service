import type { SCM, Intervention, VarId } from '../types.js';

// Deterministic PRNG (Mulberry32)
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function topoSort(nodes: VarId[], edges: Array<[VarId, VarId]>): VarId[] {
  const inDeg = new Map<VarId, number>();
  const adj = new Map<VarId, Set<VarId>>();
  for (const n of nodes) { inDeg.set(n, 0); adj.set(n, new Set()); }
  for (const [u, v] of edges) { inDeg.set(v, (inDeg.get(v) || 0) + 1); adj.get(u)!.add(v); }
  const q: VarId[] = nodes.filter(n => (inDeg.get(n) || 0) === 0).sort();
  const order: VarId[] = [];
  while (q.length) {
    const n = q.shift()!;
    order.push(n);
    for (const m of Array.from(adj.get(n) || []).sort()) {
      inDeg.set(m, (inDeg.get(m) || 0) - 1);
      if ((inDeg.get(m) || 0) === 0) q.push(m);
      q.sort();
    }
  }
  if (order.length !== nodes.length) throw new Error('DAG required');
  return order;
}

export function rollout(scm: SCM, interventions: Intervention[], T: number, seed: number) {
  const prng = mulberry32(seed >>> 0);
  const order = topoSort(scm.dag.nodes.slice().sort(), scm.dag.edges);
  const trace: Array<Record<VarId, number>> = [];

  for (let t = 0; t < T; t++) {
    const u: Record<VarId, number> = {};
    const x: Record<VarId, number> = {};
    for (const v of order) {
      // sample exogenous
      const spec = scm.U[v];
      let val = prng();
      if (spec?.dist === 'normal') {
        // Box-Muller
        const u1 = Math.max(prng(), 1e-9);
        const u2 = prng();
        const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        val = z0;
      } else if (spec?.dist === 'uniform') {
        val = prng();
      }
      u[v] = val;
      // parents values
      const parents: Record<VarId, number> = {};
      for (const [a, b] of scm.dag.edges) if (b === v) parents[a] = x[a];
      // intervention override
      const doMap = Object.assign({}, ...interventions.map(iv => iv.do));
      if (v in doMap) x[v] = doMap[v]!;
      else x[v] = scm.f[v] ? scm.f[v](parents, u) : u[v];
    }
    // emit record with stable key order
    const rec: Record<VarId, number> = {};
    for (const v of order) rec[v] = x[v];
    trace.push(rec);
  }

  return { trace };
}
