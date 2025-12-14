/**
 * SCM-Lite Kernel
 * Deterministic structural causal approximation with edge masking
 *
 * Supports Pearl's do-operator for intervention semantics:
 * - Interventional mode (default): P(Y | do(X)) - cuts incoming edges to intervention targets
 * - Observational mode: P(Y | X) - conditions on observed values
 *
 * When evaluating options/decisions, use interventional semantics to model
 * "what happens when we actively choose this option" rather than
 * "what we learn when we observe this option was chosen".
 *
 * EdgeV2 Dual Beliefs Support:
 * - belief_exists: Edge inclusion probability (Bernoulli)
 * - belief_strength: Weight variance (higher = tighter distribution around weight)
 */
import { createHash } from 'node:crypto';
import type { DAG, KernelConfig, KernelResult, Intervention, Edge } from './types.js';
import { XorShift128Plus } from './rng.js';
import { applyEdgeFunction } from '../engine/edge-functions.js';
import { FLAGS } from '../config/flags.js';

/** Default values for EdgeV2 dual beliefs */
const EDGE_V2_DEFAULTS = {
  BELIEF_EXISTS: 1.0,
  BELIEF_STRENGTH: 0.8,
  WEIGHT_VARIANCE_SCALE: 0.5,
};

const DEFAULT_CONFIG: Partial<KernelConfig> = {
  K: 256,
  maxNodes: 50,
  maxEdges: 200,
  beliefDefault: 0.7,
  beliefStrengthDefault: 0.8, // Default belief_strength for EdgeV2
  // Adaptive K defaults
  adaptiveK: false,
  convergenceThreshold: 0.01, // 1% default
  kStep: 8,
  kMin: 16,
  // Intervention defaults
  mode: 'interventional', // Default to do-operator semantics for option evaluation
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
  
  // Build intervention map for do-operator semantics
  // Only apply in interventional mode (default)
  const interventionMap = new Map<string, number>();
  if (cfg.mode !== 'observational' && cfg.interventions) {
    for (const iv of cfg.interventions) {
      interventionMap.set(iv.node_id, iv.value);
    }
  }

  // Sample K edge masks with optional adaptive early-stopping
  const rng = new XorShift128Plus(cfg.seed);
  const samples: number[] = [];
  const graphHashes = new Set<string>();

  const K_requested = cfg.K;
  const kStep = cfg.kStep ?? 8;
  const kMin = cfg.kMin ?? 16;
  const threshold = cfg.convergenceThreshold ?? 0.01;
  let K_converged = false;
  let prevP50Int: number | null = null;

  for (let k = 0; k < cfg.K; k++) {
    const { mask, sampledWeights } = sampleEdgeMask(dag, rng, cfg);
    const value = forwardPass(dag, mask, sampledWeights, topoOrder, target, interventionMap);
    samples.push(value);
    graphHashes.add(hashMask(mask));

    // Adaptive K convergence check
    if (cfg.adaptiveK && k >= kMin - 1 && (k + 1) % kStep === 0) {
      // Compute p50 on current samples (without mutating for hash consistency)
      const sorted = [...samples].sort((a, b) => a - b);
      const currP50 = sorted[Math.floor(sorted.length / 2)];
      // Integer-based comparison for determinism: Math.round(p50 * 1000)
      const currP50Int = Math.round(currP50 * 1000);

      if (prevP50Int !== null) {
        // Check if change is within threshold
        const changeRatio = prevP50Int !== 0
          ? Math.abs(currP50Int - prevP50Int) / Math.abs(prevP50Int)
          : Math.abs(currP50Int - prevP50Int) / 1000;

        if (changeRatio <= threshold) {
          K_converged = true;
          break;
        }
      }
      prevP50Int = currP50Int;
    }
  }

  // Compute quantiles on final samples
  samples.sort((a, b) => a - b);
  const K_evaluated = samples.length;

  // Epistemic humility cap - probabilistic models should never claim certainty
  // Only cap values that would display as "100%" (near 1.0), not magnitude outputs
  const MAX_PROBABILITY = 0.99;
  const capNearOne = (v: number) => (v >= 0.995 && v <= 1.005) ? MAX_PROBABILITY : v;

  const p10 = capNearOne(samples[Math.floor(K_evaluated * 0.1)]);
  const p50 = capNearOne(samples[Math.floor(K_evaluated * 0.5)]);
  const p90 = capNearOne(samples[Math.floor(K_evaluated * 0.9)]);
  
  // Confidence heuristic
  const uniqueGraphs = graphHashes.size;
  const diversity = uniqueGraphs / K_evaluated;
  const signStability = computeSignStability(samples);
  const identifiedPaths = countPaths(dag, target);

  const confidence = mapConfidence(diversity, signStability, identifiedPaths);

  // BMA hash
  const canonical = samples.map(s => s.toFixed(6)).join(',');
  const bma_hash = createHash('sha256').update(canonical).digest('hex');

  // Build meta with optional adaptive K fields
  const meta: KernelResult['meta'] = {
    K_evaluated,
    unique_graphs: uniqueGraphs,
    sign_stability: signStability,
    identified_paths: identifiedPaths,
  };

  // Only include adaptive K fields when enabled
  if (cfg.adaptiveK) {
    meta.K_requested = K_requested;
    meta.K_converged = K_converged;
  }

  // Include intervention semantics in meta
  if (cfg.interventions && cfg.interventions.length > 0) {
    meta.inference_mode = cfg.mode ?? 'interventional';
    meta.intervention_count = interventionMap.size;
  }

  return {
    target,
    quantiles: { p10, p50, p90 },
    confidence,
    bma_hash,
    meta,
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

/**
 * Get effective belief_exists value for an edge.
 * Supports both EdgeV1 (single belief) and EdgeV2 (dual beliefs).
 */
function getBeliefExists(edge: Edge, defaultBelief: number): number {
  // EdgeV2: use belief_exists directly
  if (edge.belief_exists !== undefined) {
    return Math.max(0, Math.min(1, edge.belief_exists));
  }
  // EdgeV1: use legacy belief field
  if (edge.belief !== undefined) {
    return Math.max(0, Math.min(1, edge.belief));
  }
  // Default
  return defaultBelief;
}

/**
 * Get effective belief_strength value for an edge.
 * Supports both EdgeV1 (single belief) and EdgeV2 (dual beliefs).
 */
function getBeliefStrength(edge: Edge, defaultBeliefStrength: number): number {
  // EdgeV2: use belief_strength directly
  if (edge.belief_strength !== undefined) {
    return Math.max(0, Math.min(1, edge.belief_strength));
  }
  // EdgeV1: use legacy belief field as strength proxy
  if (edge.belief !== undefined) {
    return Math.max(0, Math.min(1, edge.belief));
  }
  // Default
  return defaultBeliefStrength;
}

/**
 * Sample weight with variance based on belief_strength.
 *
 * When belief_strength is high (close to 1), weight is returned as-is.
 * When belief_strength is low, weight varies around its center.
 *
 * @param baseWeight - The base weight value
 * @param beliefStrength - Confidence in weight precision (0-1)
 * @param random - Random value [0, 1) for sampling
 * @returns Sampled weight value
 */
function sampleWeightWithVariance(
  baseWeight: number,
  beliefStrength: number,
  random: number
): number {
  const variance = EDGE_V2_DEFAULTS.WEIGHT_VARIANCE_SCALE * (1 - beliefStrength);

  if (variance <= 0) {
    return baseWeight;
  }

  // Simple symmetric adjustment using uniform random
  const adjustment = (random - 0.5) * 2 * Math.sqrt(variance * 3);
  return baseWeight + adjustment * Math.abs(baseWeight || 1);
}

/**
 * Sample edge mask and weights for a single Monte Carlo iteration.
 *
 * EdgeV1 behaviour (legacy): Uses single belief for edge inclusion
 * EdgeV2 behaviour (dual beliefs): Uses belief_exists for inclusion, belief_strength for weight variance
 *
 * @param dag - The DAG
 * @param rng - Random number generator
 * @param cfg - Kernel configuration
 * @returns Object with mask (active edges) and sampledWeights (edge→weight)
 */
function sampleEdgeMask(
  dag: DAG,
  rng: XorShift128Plus,
  cfg: KernelConfig
): { mask: Set<string>; sampledWeights: Map<string, number> } {
  const mask = new Set<string>();
  const sampledWeights = new Map<string, number>();
  const useDualBeliefs = FLAGS.ENABLE_DUAL_BELIEFS;

  for (const edge of dag.edges) {
    const edgeKey = `${edge.from}->${edge.to}`;
    const beliefExists = getBeliefExists(edge, cfg.beliefDefault);

    // Step 1: Edge inclusion (Bernoulli with probability belief_exists)
    if (rng.next() < beliefExists) {
      mask.add(edgeKey);

      // Step 2: Weight sampling (only when dual beliefs enabled)
      if (useDualBeliefs) {
        const baseWeight = edge.weight ?? 1.0;
        const beliefStrength = getBeliefStrength(edge, cfg.beliefStrengthDefault ?? EDGE_V2_DEFAULTS.BELIEF_STRENGTH);
        const weightRandom = rng.next();
        const sampledWeight = sampleWeightWithVariance(baseWeight, beliefStrength, weightRandom);
        sampledWeights.set(edgeKey, sampledWeight);
      } else {
        // EdgeV1: use base weight directly
        sampledWeights.set(edgeKey, edge.weight ?? 1.0);
      }
    }
  }

  return { mask, sampledWeights };
}

/**
 * Forward pass through the DAG with intervention support
 *
 * When a node is in the interventionMap:
 * - Its value is set directly to the intervention value
 * - All incoming edges are ignored (do-operator cuts parent influences)
 * - Downstream effects propagate normally
 *
 * This implements Pearl's do(X=x) semantics:
 * Original: X = f(Parents(X), U_x)
 * Intervention: X = x (constant, parents ignored)
 *
 * @param dag - The directed acyclic graph
 * @param mask - Set of active edges for this sample
 * @param sampledWeights - Map of edge key to sampled weight (from dual beliefs)
 * @param topoOrder - Nodes in topological order
 * @param target - Target node to compute value for
 * @param interventionMap - Map of node_id → intervention value (optional)
 * @returns Computed value of target node
 */
function forwardPass(
  dag: DAG,
  mask: Set<string>,
  sampledWeights: Map<string, number>,
  topoOrder: string[],
  target: string,
  interventionMap?: Map<string, number>
): number {
  const values = new Map<string, number>();
  for (const id of topoOrder) values.set(id, 0);

  for (const node of topoOrder) {
    // Check if this node is intervened upon (do-operator)
    // Intervention cuts all incoming edges and sets value directly
    if (interventionMap?.has(node)) {
      values.set(node, interventionMap.get(node)!);
      continue; // Skip natural evaluation - this is the key do-operator behavior
    }

    // Natural evaluation: compute from parents
    const incoming = dag.edges.filter(e => e.to === node && mask.has(`${e.from}->${e.to}`));
    let sum = 0;
    for (const edge of incoming) {
      const edgeKey = `${edge.from}->${edge.to}`;
      const parentValue = values.get(edge.from) || 0;
      // Use sampled weight from dual beliefs (already accounts for belief_strength variance)
      const weight = sampledWeights.get(edgeKey) ?? edge.weight ?? 1.0;
      // Apply non-linear edge function if specified
      const transformedValue = applyEdgeFunction(parentValue, edge);
      sum += transformedValue * weight;
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

  // P0 fix: O(E) root finding instead of O(V×E)
  const hasIncoming = new Set(dag.edges.map(e => e.to));
  const roots = dag.nodes.filter(n => !hasIncoming.has(n.id));
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

/**
 * Compute P(target ≥ threshold | do(interventions))
 *
 * Runs Monte Carlo sampling and counts how many samples exceed the threshold.
 * Used for computing per-option goal probabilities (Brief A).
 *
 * @param dag - The directed acyclic graph
 * @param target - Target node to evaluate
 * @param threshold - Value to consider "achieved"
 * @param config - Kernel configuration (including interventions for do-operator)
 * @returns Probability and confidence metrics
 */
export interface ThresholdProbabilityResult {
  probability: number;      // P(target ≥ threshold)
  confidence: number;       // 1 - 2*SE (binomial standard error)
  samples_above: number;    // Count of samples exceeding threshold
  total_samples: number;    // Total samples evaluated
}

export function computeThresholdProbability(
  dag: DAG,
  target: string,
  threshold: number,
  config: Partial<KernelConfig>
): ThresholdProbabilityResult {
  const cfg = { ...DEFAULT_CONFIG, ...config } as KernelConfig;

  // Validate scope guardrails
  if (dag.nodes.length > cfg.maxNodes) {
    throw new Error(`Graph exceeds max nodes: ${dag.nodes.length} > ${cfg.maxNodes}`);
  }
  if (dag.edges.length > cfg.maxEdges) {
    throw new Error(`Graph exceeds max edges: ${dag.edges.length} > ${cfg.maxEdges}`);
  }
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

  // Build intervention map for do-operator semantics
  const interventionMap = new Map<string, number>();
  if (cfg.mode !== 'observational' && cfg.interventions) {
    for (const iv of cfg.interventions) {
      interventionMap.set(iv.node_id, iv.value);
    }
  }

  // Sample and count threshold crossings
  const rng = new XorShift128Plus(cfg.seed);
  let samplesAbove = 0;
  const K = cfg.K;

  for (let k = 0; k < K; k++) {
    const { mask, sampledWeights } = sampleEdgeMask(dag, rng, cfg);
    const value = forwardPass(dag, mask, sampledWeights, topoOrder, target, interventionMap);
    if (value >= threshold) {
      samplesAbove++;
    }
  }

  const probability = samplesAbove / K;

  // Confidence based on binomial standard error
  // SE = sqrt(p * (1-p) / n)
  // Confidence = 1 - 2*SE (rough 95% CI width proxy)
  const se = Math.sqrt((probability * (1 - probability)) / K);
  const confidence = Math.max(0, Math.min(1, 1 - 2 * se));

  return {
    probability,
    confidence,
    samples_above: samplesAbove,
    total_samples: K,
  };
}
