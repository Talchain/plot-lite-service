import type { VarId } from './types.js';

export type Graph = { parents: Map<VarId, Set<VarId>>; children: Map<VarId, Set<VarId>> };

function ancestorsOf(zset: Set<VarId>, parents: Map<VarId, Set<VarId>>): Set<VarId> {
  const out = new Set<VarId>();
  const q: VarId[] = Array.from(zset);
  while (q.length) {
    const v = q.shift()!;
    for (const p of parents.get(v) || []) {
      if (!out.has(p)) { out.add(p); q.push(p as VarId); }
    }
  }
  return out;
}

export function dSeparated(x: VarId, y: VarId, Z: Set<VarId>, g: Graph): boolean {
  // Bayes-ball: standard rules without directed-path pre-check
  type Dir = 'up' | 'down';
  const AZ = ancestorsOf(Z, g.parents);
  const key = (n: VarId, d: Dir) => `${n}|${d}`;
  const visited = new Set<string>();
  const q: Array<{ n: VarId; d: Dir }> = [ { n: x, d: 'up' }, { n: x, d: 'down' } ];
  while (q.length) {
    const st = q.shift()!;
    const k = key(st.n, st.d);
    if (visited.has(k)) continue;
    visited.add(k);
    if (st.n === y) return false;
    const observed = Z.has(st.n);
    if (!observed) {
      if (st.d === 'up') {
        // Unobserved, from parent: traverse to parents and children
        for (const p of g.parents.get(st.n) || []) q.push({ n: p as VarId, d: 'up' });
        for (const c of g.children.get(st.n) || []) q.push({ n: c as VarId, d: 'down' });
      } else {
        // Unobserved, from child: traverse to children; if collider (in AZ), traverse to parents
        for (const c of g.children.get(st.n) || []) q.push({ n: c as VarId, d: 'down' });
        if (AZ.has(st.n)) {
          for (const p of g.parents.get(st.n) || []) q.push({ n: p as VarId, d: 'up' });
        }
      }
    } else {
      // Observed node
      if (st.d === 'up') {
        // Observed, from parent: traverse to parents only (blocked from children)
        for (const p of g.parents.get(st.n) || []) q.push({ n: p as VarId, d: 'up' });
      } else {
        // Observed, from child: this is a collider, traverse to parents
        for (const p of g.parents.get(st.n) || []) q.push({ n: p as VarId, d: 'up' });
      }
    }
  }
  return true;
}

export function dSeparatedBackdoor(x: VarId, y: VarId, Z: Set<VarId>, g: Graph): boolean {
  // Only consider paths that enter X from a parent side (backdoor)
  type Dir = 'up' | 'down';
  const AZ = ancestorsOf(Z, g.parents);
  const key = (n: VarId, d: Dir) => `${n}|${d}`;
  const visited = new Set<string>();
  const q: Array<{ n: VarId; d: Dir; start?: boolean }> = [ { n: x, d: 'up', start: true } ];
  while (q.length) {
    const st = q.shift()!;
    const k = key(st.n, st.d);
    if (visited.has(k)) continue;
    visited.add(k);
    if (st.n === y) return false;
    const observed = Z.has(st.n);
    if (!observed) {
      if (st.d === 'up') {
        for (const p of g.parents.get(st.n) || []) q.push({ n: p as VarId, d: 'up', start: false });
        // Do not traverse children from the starting node; only after leaving X
        if (!st.start) {
          for (const c of g.children.get(st.n) || []) q.push({ n: c as VarId, d: 'down', start: false });
        }
      } else {
        for (const c of g.children.get(st.n) || []) q.push({ n: c as VarId, d: 'down', start: false });
        if (AZ.has(st.n)) {
          for (const p of g.parents.get(st.n) || []) q.push({ n: p as VarId, d: 'up', start: false });
        }
      }
    } else {
      if (st.d === 'up') {
        for (const p of g.parents.get(st.n) || []) q.push({ n: p as VarId, d: 'up', start: false });
      } else {
        // observed from parent: stop
      }
    }
  }
  return true;
}

export function computeParentsChildren(nodes: VarId[], edges: Array<[VarId, VarId]>): Graph {
  const parents = new Map<VarId, Set<VarId>>();
  const children = new Map<VarId, Set<VarId>>();
  for (const v of nodes) { parents.set(v, new Set()); children.set(v, new Set()); }
  for (const [u, v] of edges) { parents.get(v)!.add(u); children.get(u)!.add(v); }
  return { parents, children };
}

export function descendantsOf(src: VarId, g: Graph): Set<VarId> {
  const out = new Set<VarId>();
  const q: VarId[] = [src];
  while (q.length) {
    const v = q.shift()!;
    for (const c of g.children.get(v) || []) {
      if (!out.has(c)) { out.add(c); q.push(c as VarId); }
    }
  }
  return out;
}

export function cloneGraph(g: Graph): Graph {
  const parents = new Map<VarId, Set<VarId>>();
  const children = new Map<VarId, Set<VarId>>();
  for (const [k, vs] of g.parents.entries()) parents.set(k, new Set(vs));
  for (const [k, vs] of g.children.entries()) children.set(k, new Set(vs));
  return { parents, children };
}

export function removeOutgoing(g: Graph, x: VarId): Graph {
  const h = cloneGraph(g);
  const childs = h.children.get(x) || new Set();
  for (const c of childs) {
    h.parents.get(c)!.delete(x);
  }
  h.children.set(x, new Set());
  return h;
}

export function directedReachable(g: Graph, src: VarId, dst: VarId): boolean {
  const seen = new Set<VarId>();
  const q: VarId[] = [src];
  while (q.length) {
    const v = q.shift()!;
    if (v === dst) return true;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const c of g.children.get(v) || []) q.push(c as VarId);
  }
  return false;
}

// Set-wise d-separation: X ⟂ Y | Z iff every x∈X is d-separated from every y∈Y given Z
export function dSeparatedSets(X: Set<VarId>, Y: Set<VarId>, Z: Set<VarId>, g: Graph): boolean {
  const xs = Array.from(X);
  const ys = Array.from(Y);
  for (const x of xs) {
    for (const y of ys) {
      if (!dSeparated(x, y, Z, g)) return false;
    }
  }
  return true;
}

export function directedReachableAvoid(g: Graph, src: VarId, dst: VarId, avoid: Set<VarId>): boolean {
  const seen = new Set<VarId>();
  const q: VarId[] = [src];
  while (q.length) {
    const v = q.shift()!;
    if (v === dst) return true;
    if (avoid.has(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    for (const c of g.children.get(v) || []) {
      if (!avoid.has(c)) q.push(c as VarId);
    }
  }
  return false;
}
