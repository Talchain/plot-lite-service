/**
 * SCM-Lite Kernel
 * Deterministic structural causal approximation with edge masking
 */
import { createHash } from 'node:crypto';
import type { DAG, KernelConfig, KernelResult } from './types.js';
import { XorShift128Plus } from './rng.js';

const DEFAULT_CONFIG: Partial<KernelConfig> = {
  K: 256,
  maxNodes: 50,
  maxEdges: 200,
  beliefDefault: 0.7,
};

export function runKernel(dag: DAG, target: string, config: Partial<KernelConfig>): KernelResult {
  const cfg = { ...DEFAULT_CONFIG, ...config } as KernelConfig;
  
  // Validate scope guardrails
  if (dag.nodes.length > cfg.maxNodes) {
    throw new Error(`Graph exceeds max nodes: ${dag.nodes.length} > ${cfg.maxNodes}. Simplify by removing weak edges or grouping nodes.`);
  }
  
  if (dag.edges.length > cfg.maxEdges) {
    throw new Error(`Graph exceeds max edges: ${dag.edges.length} > ${cfg.maxEdges}. Remove edges with low belief or weight.`);
  }
  
  // Check acyclic (simple DFS)
  if (hasCycle(dag)) {
    throw new Error('Graph contains cycle');
  }
  
  // Stable sort nodes by id
  const nodes = [...dag.nodes].sort((a, b) => a.id.localeCompare(b.id));
  const nodeIds = nodes.map(n => n.id);
  
  if (!nodeIds.includes(target)) {
    throw new Error(`Target node ${target} not in graph`);
  }
  
  // Topological order
  const topoOrder = topologicalSort(dag, nodeIds);
  
  // Sample K edge masks
  const rng = new XorShift128Plus(cfg.seed);
  const samples: number[] = [];
  const graphHashes = new Set<string>();
  
  for (let k = 0; k < cfg.K; k++) {
    const mask = sampleEdgeMask(dag, rng, cfg.beliefDefault);
    const value = forwardPass(dag, mask, topoOrder, target);
    samples.push(value);
    graphHashes.add(hashMask(mask));
  }
  
  // Compute quantiles
  samples.sort((a, b) => a - b);
  const p10 = samples[Math.floor(cfg.K * 0.1)];
  const p50 = samples[Math.floor(cfg.K * 0.5)];
  const p90 = samples[Math.floor(cfg.K * 0.9)];
  
  // Confidence heuristic
  const uniqueGraphs = graphHashes.size;
  const diversity = uniqueGraphs / cfg.K;
  const signStability = computeSignStability(samples);
  const identifiedPaths = countPaths(dag, target);
  
  const confidence = mapConfidence(diversity, signStability, identifiedPaths);
  
  // BMA hash
  const canonical = samples.map(s => s.toFixed(6)).join(',');
  const bma_hash = createHash('sha256').update(canonical).digest('hex');
  
  return {
    target,
    quantiles: { p10, p50, p90 },
    confidence,
    bma_hash,
    meta: {
      K_evaluated: cfg.K,
      unique_graphs: uniqueGraphs,
      sign_stability: signStability,
      identified_paths: identifiedPaths,
    },
  };
}

function hasCycle(dag: DAG): boolean {
  const adj = new Map<string, string[]>();
  for (const node of dag.nodes) adj.set(node.id, []);
  for (const edge of dag.edges) {
    adj.get(edge.from)?.push(edge.to);
  }
  
  const visited = new Set<string>();
  const recStack = new Set<string>();
  
  const dfs = (node: string): boolean => {
    visited.add(node);
    recStack.add(node);
    for (const neighbor of adj.get(node) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        return true;
      }
    }
    recStack.delete(node);
    return false;
  };
  
  for (const node of dag.nodes) {
    if (!visited.has(node.id) && dfs(node.id)) return true;
  }
  return false;
}

function topologicalSort(dag: DAG, nodeIds: string[]): string[] {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  
  for (const id of nodeIds) {
    adj.set(id, []);
    inDegree.set(id, 0);
  }
  
  for (const edge of dag.edges) {
    adj.get(edge.from)?.push(edge.to);
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }
  
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  
  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const neighbor of adj.get(node) || []) {
      const newDeg = (inDegree.get(neighbor) || 0) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }
  
  return result;
}

function sampleEdgeMask(dag: DAG, rng: XorShift128Plus, defaultBelief: number): Set<string> {
  const mask = new Set<string>();
  for (const edge of dag.edges) {
    const belief = edge.belief ?? defaultBelief;
    if (rng.next() < belief) {
      mask.add(`${edge.from}->${edge.to}`);
    }
  }
  return mask;
}

function forwardPass(dag: DAG, mask: Set<string>, topoOrder: string[], target: string): number {
  const values = new Map<string, number>();
  for (const id of topoOrder) values.set(id, 0);
  
  for (const node of topoOrder) {
    const incoming = dag.edges.filter(e => e.to === node && mask.has(`${e.from}->${e.to}`));
    let sum = 0;
    for (const edge of incoming) {
      const weight = edge.weight ?? 1.0;
      sum += (values.get(edge.from) || 0) * weight;
    }
    values.set(node, sum || 1); // baseline 1 if no incoming
  }
  
  return values.get(target) || 0;
}

function hashMask(mask: Set<string>): string {
  return Array.from(mask).sort().join(',');
}

function computeSignStability(samples: number[]): number {
  const pos = samples.filter(s => s > 0).length;
  const neg = samples.filter(s => s < 0).length;
  const total = samples.length;
  return Math.max(pos, neg) / total;
}

function countPaths(dag: DAG, target: string): number {
  // Simple path count (BFS from roots to target)
  const adj = new Map<string, string[]>();
  for (const node of dag.nodes) adj.set(node.id, []);
  for (const edge of dag.edges) adj.get(edge.from)?.push(edge.to);
  
  const roots = dag.nodes.filter(n => !dag.edges.some(e => e.to === n.id));
  let paths = 0;
  
  const dfs = (node: string, visited: Set<string>) => {
    if (node === target) {
      paths++;
      return;
    }
    for (const neighbor of adj.get(node) || []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        dfs(neighbor, visited);
        visited.delete(neighbor);
      }
    }
  };
  
  for (const root of roots) {
    dfs(root.id, new Set([root.id]));
  }
  
  return paths;
}

function mapConfidence(diversity: number, signStability: number, paths: number): 'low' | 'medium' | 'high' {
  const score = diversity * 0.3 + signStability * 0.5 + Math.min(paths / 10, 1) * 0.2;
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}
