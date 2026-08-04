/**
 * Sampling Engine Core
 *
 * Brief 8: Sampling Engine & Caching
 *
 * Produces deterministic, structured traces for ISL robustness analysis.
 * Guarantees: Given (graph_hash, seed, sampling_config_version), produces identical traces.
 */

import { createHash } from 'node:crypto';
import type {
  SimulationTraces,
  Trace,
  Distribution,
  TraceConfig,
  Perturbation,
  BatchSimulationRequest,
  BatchSimulationResponse,
  SamplingMetrics,
} from './types.js';
import { SAMPLING_CONFIG_VERSION as CONFIG_VERSION } from './types.js';
import { hashGraph, generateSeedSequence } from './graph-hash.js';
import { getTraceCache } from './trace-cache.js';
import { XorShift128Plus } from '../scm-lite/rng.js';
import { applyEdgeFunction } from '../engine/edge-functions.js';
import { FLAGS } from '../config/flags.js';
import { getBeliefExists, getEdgeStd, sampleNormal } from '../engine/edge-migration.js';
import type { InferenceMode } from '../scm-lite/types.js';

import type { FunctionalForm, EdgeFunctionType } from '../trust/types.js';

/**
 * Graph input interface
 */
interface GraphInput {
  nodes: Array<{
    id: string;
    label?: string;
    value?: number;
    kind?: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    weight?: number;
    belief?: number;
    belief_exists?: number;
    belief_strength?: number;
    functional_form?: FunctionalForm;
    function_type?: EdgeFunctionType;
    function_params?: Record<string, number>;
  }>;
}

/**
 * Performance timing tracker
 */
interface TimingTracker {
  sampling_ms: number;
  propagation_ms: number;
  aggregation_ms: number;
}

/**
 * Default configuration values
 */
const DEFAULTS = {
  N_SAMPLES: 256,
  BELIEF_DEFAULT: 0.7,
  BELIEF_STRENGTH_DEFAULT: 0.8,
  WEIGHT_DEFAULT: 1.0,
  MODE: 'interventional' as InferenceMode,
};

/**
 * Topological sort for DAG traversal
 */
function topologicalSort(
  nodes: Array<{ id: string }>,
  edges: Array<{ from: string; to: string }>
): string[] {
  const adj = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    adj.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
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
 * Sample edge mask and weights for one Monte Carlo iteration
 */
function sampleEdges(
  edges: GraphInput['edges'],
  rng: XorShift128Plus,
  useDualBeliefs: boolean
): { mask: Record<string, boolean>; weights: Record<string, number> } {
  const mask: Record<string, boolean> = {};
  const weights: Record<string, number> = {};

  for (const edge of edges) {
    const edgeKey = `${edge.from}->${edge.to}`;
    const beliefExists = getBeliefExists(edge);

    // Edge inclusion via Bernoulli(belief_exists)
    const isActive = rng.next() < beliefExists;
    mask[edgeKey] = isActive;

    if (isActive) {
      const baseWeight = edge.weight ?? DEFAULTS.WEIGHT_DEFAULT;

      if (useDualBeliefs) {
        // v2.2: All edges use Normal sampling N(weight, std)
        // getEdgeStd handles priority: strength_std > belief_strength > default
        const std = getEdgeStd(edge);
        weights[edgeKey] = sampleNormal(baseWeight, std, rng);
      } else {
        weights[edgeKey] = baseWeight;
      }
    }
  }

  return { mask, weights };
}

/**
 * Forward pass through the graph
 */
function forwardPass(
  graph: GraphInput,
  topoOrder: string[],
  edgeMask: Record<string, boolean>,
  edgeWeights: Record<string, number>,
  interventionMap: Map<string, number>
): Record<string, number> {
  const values: Record<string, number> = {};

  // Initialize all nodes to 0
  for (const nodeId of topoOrder) {
    values[nodeId] = 0;
  }

  // Forward propagation
  for (const nodeId of topoOrder) {
    // Check for intervention (do-operator)
    if (interventionMap.has(nodeId)) {
      values[nodeId] = interventionMap.get(nodeId)!;
      continue;
    }

    // Compute from parents
    const incomingEdges = graph.edges.filter(
      (e) => e.to === nodeId && edgeMask[`${e.from}->${e.to}`]
    );

    let sum = 0;
    for (const edge of incomingEdges) {
      const edgeKey = `${edge.from}->${edge.to}`;
      const parentValue = values[edge.from] || 0;
      const weight = edgeWeights[edgeKey] ?? edge.weight ?? DEFAULTS.WEIGHT_DEFAULT;

      // Apply non-linear edge function
      const transformedValue = applyEdgeFunction(parentValue, edge as any);
      sum += transformedValue * weight;
    }

    // Baseline 1 if no incoming edges contribute
    values[nodeId] = sum || 1;
  }

  return values;
}

/**
 * Compute distribution statistics from samples
 */
function computeDistribution(
  samples: number[],
  includeRawSamples: boolean
): Distribution {
  if (samples.length === 0) {
    return {
      mean: 0,
      std: 0,
      percentiles: { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0 },
    };
  }

  // Compute mean
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;

  // Compute standard deviation
  const variance =
    samples.reduce((sum, x) => sum + Math.pow(x - mean, 2), 0) / samples.length;
  const std = Math.sqrt(variance);

  // Sort for percentiles
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;

  const percentile = (p: number): number => {
    const idx = Math.floor(p * n);
    return sorted[Math.min(idx, n - 1)];
  };

  const distribution: Distribution = {
    mean,
    std,
    percentiles: {
      p5: percentile(0.05),
      p25: percentile(0.25),
      p50: percentile(0.5),
      p75: percentile(0.75),
      p95: percentile(0.95),
    },
  };

  if (includeRawSamples) {
    distribution.samples = samples;
  }

  return distribution;
}

/**
 * Identify option nodes (for expected utility calculation)
 */
function findOptionNodes(graph: GraphInput): string[] {
  return graph.nodes
    .filter((n) => n.kind === 'option' || n.kind === 'decision')
    .map((n) => n.id);
}

/**
 * Generate simulation traces for a graph
 *
 * This is the core sampling function that ISL calls for robustness analysis.
 *
 * @param graph - Input graph to simulate
 * @param config - Trace generation configuration
 * @returns Structured simulation traces
 */
export function generateTraces(
  graph: GraphInput,
  config: TraceConfig
): SimulationTraces {
  const timing: TimingTracker = { sampling_ms: 0, propagation_ms: 0, aggregation_ms: 0 };

  // Configuration
  const seed = config.seed;
  const nSamples = config.n_samples ?? DEFAULTS.N_SAMPLES;
  const storeTraces = config.store_traces ?? true;
  const storeRawSamples = config.store_raw_samples ?? false;
  const mode = config.mode ?? DEFAULTS.MODE;
  const interventions = config.interventions ?? [];

  // Build intervention map
  const interventionMap = new Map<string, number>();
  if (mode !== 'observational') {
    for (const iv of interventions) {
      interventionMap.set(iv.node_id, iv.value);
    }
  }

  // Graph hash for caching
  const graphHash = hashGraph(graph);

  // Check cache first
  const cache = getTraceCache();
  const cachedResult = cache.get(graphHash, seed);
  if (cachedResult) {
    return cachedResult;
  }

  // Initialize RNG
  const rng = new XorShift128Plus(seed);

  // Topological order
  const topoOrder = topologicalSort(graph.nodes, graph.edges);

  // Use dual beliefs if enabled
  const useDualBeliefs = FLAGS.ENABLE_DUAL_BELIEFS;

  // Collect traces
  const traces: Trace[] = [];
  const nodeSamples: Record<string, number[]> = {};

  // Initialize sample collectors
  for (const node of graph.nodes) {
    nodeSamples[node.id] = [];
  }

  // Monte Carlo sampling
  const samplingStart = performance.now();

  for (let sampleId = 0; sampleId < nSamples; sampleId++) {
    // Sample edge mask and weights
    const { mask, weights } = sampleEdges(graph.edges, rng, useDualBeliefs);

    // Forward pass
    const propStart = performance.now();
    const nodeValues = forwardPass(graph, topoOrder, mask, weights, interventionMap);
    timing.propagation_ms += performance.now() - propStart;

    // Collect samples
    for (const nodeId of Object.keys(nodeValues)) {
      nodeSamples[nodeId].push(nodeValues[nodeId]);
    }

    // Store trace if requested
    if (storeTraces) {
      traces.push({
        sample_id: sampleId,
        node_values: nodeValues,
        edge_mask: mask,
        edge_weights: weights,
      });
    }
  }

  timing.sampling_ms = performance.now() - samplingStart - timing.propagation_ms;

  // Compute aggregates
  const aggregationStart = performance.now();

  const nodeDistributions: Record<string, Distribution> = {};
  for (const nodeId of Object.keys(nodeSamples)) {
    nodeDistributions[nodeId] = computeDistribution(nodeSamples[nodeId], storeRawSamples);
  }

  // Compute expected utilities for option nodes
  const optionNodes = findOptionNodes(graph);
  const expectedUtilities: Record<string, number> = {};
  for (const nodeId of optionNodes) {
    expectedUtilities[nodeId] = nodeDistributions[nodeId]?.mean ?? 0;
  }

  timing.aggregation_ms = performance.now() - aggregationStart;

  // Build result
  const result: SimulationTraces = {
    meta: {
      graph_hash: graphHash,
      seed,
      sampling_config_version: CONFIG_VERSION,
      n_samples: nSamples,
      timestamp: new Date(),
      inference_mode: mode,
      interventions,
    },
    traces: storeTraces ? traces : [],
    aggregates: {
      node_distributions: nodeDistributions,
      expected_utilities: expectedUtilities,
    },
  };

  // Cache result
  if (config.store_traces !== false) {
    cache.set(graphHash, seed, result);
  }

  return result;
}

/**
 * Apply perturbation to a graph
 */
function applyPerturbation(
  graph: GraphInput,
  perturbation: Perturbation
): GraphInput {
  // Deep copy the graph
  const newGraph: GraphInput = {
    nodes: graph.nodes.map((n) => ({ ...n })),
    edges: graph.edges.map((e) => ({ ...e })),
  };

  // Apply parameter changes to nodes
  for (const [id, value] of Object.entries(perturbation.parameter_changes)) {
    const node = newGraph.nodes.find((n) => n.id === id);
    if (node) {
      node.value = value;
    }
  }

  // Apply edge changes
  if (perturbation.edge_changes) {
    for (const [edgeKey, changes] of Object.entries(perturbation.edge_changes)) {
      const [from, to] = edgeKey.split('->');
      const edge = newGraph.edges.find((e) => e.from === from && e.to === to);
      if (edge) {
        if (changes.weight !== undefined) edge.weight = changes.weight;
        if (changes.belief_exists !== undefined) edge.belief_exists = changes.belief_exists;
        if (changes.belief_strength !== undefined) edge.belief_strength = changes.belief_strength;
      }
    }
  }

  return newGraph;
}

/**
 * Run batch simulation with multiple perturbations
 *
 * Efficiently runs simulations for a base graph and multiple perturbations.
 * Results are cached for future use.
 *
 * @param request - Batch simulation request
 * @returns Batch simulation response with all results
 */
export function runBatchSimulation(
  request: BatchSimulationRequest
): BatchSimulationResponse {
  const startTime = performance.now();
  const cache = getTraceCache();
  const cacheHits: string[] = [];

  // Generate seed sequence for perturbations
  const perturbationIds = request.perturbations.map((p) => p.perturbation_id);
  const seedSequence = generateSeedSequence(request.base_seed, perturbationIds);

  // Run base simulation
  const baseConfig: TraceConfig = {
    seed: request.base_seed,
    n_samples: request.options.n_samples,
    store_traces: request.options.return_traces,
    mode: request.options.mode,
    interventions: request.options.interventions,
  };

  const baseResult = generateTraces(request.base_graph, baseConfig);

  // Run perturbation simulations
  const perturbationResults: Record<string, SimulationTraces> = {};

  for (let i = 0; i < request.perturbations.length; i++) {
    const perturbation = request.perturbations[i];
    const perturbedGraph = applyPerturbation(request.base_graph, perturbation);
    const perturbedHash = hashGraph(perturbedGraph);
    const perturbedSeed = seedSequence.seeds[i];

    // Check cache
    const cached = cache.get(perturbedHash, perturbedSeed);
    if (cached) {
      cacheHits.push(perturbation.perturbation_id);
      perturbationResults[perturbation.perturbation_id] = cached;
      continue;
    }

    // Run simulation
    const perturbedConfig: TraceConfig = {
      seed: perturbedSeed,
      n_samples: request.options.n_samples,
      store_traces: request.options.return_traces,
      mode: request.options.mode,
      interventions: request.options.interventions,
    };

    const result = generateTraces(perturbedGraph, perturbedConfig);
    perturbationResults[perturbation.perturbation_id] = result;

    // Cache if requested
    if (request.options.cache_results) {
      cache.set(perturbedHash, perturbedSeed, result);
    }
  }

  const computationTime = performance.now() - startTime;

  return {
    base_result: baseResult,
    perturbation_results: perturbationResults,
    cache_hits: cacheHits,
    computation_time_ms: computationTime,
  };
}

/**
 * Get sampling metrics for monitoring
 */
export function getSamplingMetrics(): SamplingMetrics {
  const cache = getTraceCache();
  const stats = cache.getStats();

  // Note: samples_per_second and time_breakdown require active tracking
  // This provides a snapshot of cache performance
  return {
    samples_per_second: 0, // Would need active tracking
    cache_hit_rate: stats.hit_rate,
    time_breakdown: {
      sampling_ms: 0,
      propagation_ms: 0,
      aggregation_ms: 0,
    },
    memory_usage_bytes: cache.estimatedMemoryBytes(),
  };
}

/**
 * Verify determinism: run same simulation twice and compare hashes
 *
 * @param graph - Graph to test
 * @param seed - Seed to use
 * @returns True if deterministic
 */
export function verifyDeterminism(graph: GraphInput, seed: number): boolean {
  // Disable cache for this test
  const cache = getTraceCache();
  const wasEnabled = cache.isEnabled();
  cache.setEnabled(false);

  try {
    const config: TraceConfig = { seed, n_samples: 64, store_traces: true };

    const result1 = generateTraces(graph, config);
    const result2 = generateTraces(graph, config);

    // Compare BMA-style hash of results
    const hash1 = createHash('sha256')
      .update(JSON.stringify(result1.traces))
      .digest('hex');
    const hash2 = createHash('sha256')
      .update(JSON.stringify(result2.traces))
      .digest('hex');

    return hash1 === hash2;
  } finally {
    cache.setEnabled(wasEnabled);
  }
}
