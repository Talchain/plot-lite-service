/**
 * Graph Hashing for Determinism
 *
 * Brief 8: Determinism Specification
 *
 * Hard requirement: Given (graph_hash, seed, sampling_config_version),
 * PLoT must produce identical traces.
 *
 * Hashing Algorithm:
 * 1. Extract canonical graph structure (sorted nodes, sorted edges)
 * 2. Include all parameters that affect sampling:
 *    - Node IDs and values
 *    - Edge topology (from, to)
 *    - Edge parameters (weight, belief_exists, belief_strength, functional_form)
 *    - Edge function parameters
 * 3. SHA-256 hash the canonical JSON representation
 */

import { createHash } from 'node:crypto';

/**
 * Canonical node representation for hashing
 */
interface CanonicalNode {
  id: string;
  value?: number;
  kind?: string;
}

/**
 * Canonical edge representation for hashing
 */
interface CanonicalEdge {
  from: string;
  to: string;
  weight?: number;
  belief?: number;
  belief_exists?: number;
  belief_strength?: number;
  functional_form?: string;
  function_type?: string;
  function_params?: Record<string, number>;
}

/**
 * Input graph interface (accepts various graph formats)
 */
interface GraphInput {
  nodes: Array<{
    id: string;
    value?: number;
    kind?: string;
    label?: string;
    [key: string]: unknown;
  }>;
  edges: Array<{
    from: string;
    to: string;
    weight?: number;
    belief?: number;
    belief_exists?: number;
    belief_strength?: number;
    functional_form?: string;
    function_type?: string;
    function_params?: Record<string, number>;
    [key: string]: unknown;
  }>;
}

/**
 * Extract canonical node representation
 * Only includes fields that affect sampling
 */
function canonicalNode(node: GraphInput['nodes'][0]): CanonicalNode {
  const canonical: CanonicalNode = { id: node.id };

  // Include value if present (affects baseline computation)
  if (node.value !== undefined) {
    canonical.value = node.value;
  }

  // Include kind if present (affects binary node detection)
  if (node.kind !== undefined) {
    canonical.kind = node.kind;
  }

  return canonical;
}

/**
 * Extract canonical edge representation
 * Only includes fields that affect sampling
 */
function canonicalEdge(edge: GraphInput['edges'][0]): CanonicalEdge {
  const canonical: CanonicalEdge = {
    from: edge.from,
    to: edge.to,
  };

  // Include weight if not default (1.0)
  if (edge.weight !== undefined && edge.weight !== 1.0) {
    canonical.weight = edge.weight;
  }

  // Include belief parameters
  if (edge.belief !== undefined) {
    canonical.belief = edge.belief;
  }
  if (edge.belief_exists !== undefined) {
    canonical.belief_exists = edge.belief_exists;
  }
  if (edge.belief_strength !== undefined) {
    canonical.belief_strength = edge.belief_strength;
  }

  // Include functional form
  if (edge.functional_form !== undefined && edge.functional_form !== 'linear') {
    canonical.functional_form = edge.functional_form;
  }
  if (edge.function_type !== undefined && edge.function_type !== 'linear') {
    canonical.function_type = edge.function_type;
  }

  // Include function parameters if present
  if (edge.function_params !== undefined && Object.keys(edge.function_params).length > 0) {
    // Sort parameter keys for determinism
    const sortedParams: Record<string, number> = {};
    for (const key of Object.keys(edge.function_params).sort()) {
      sortedParams[key] = edge.function_params[key];
    }
    canonical.function_params = sortedParams;
  }

  return canonical;
}

/**
 * Generate deterministic SHA-256 hash of a graph
 *
 * The hash includes all parameters that affect simulation:
 * - Graph topology (nodes and edges)
 * - Edge weights and belief parameters
 * - Non-linear function configurations
 *
 * @param graph - Graph to hash
 * @returns SHA-256 hex digest
 */
export function hashGraph(graph: GraphInput): string {
  // Sort nodes by ID for determinism
  const sortedNodes = [...graph.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(canonicalNode);

  // Sort edges by (from, to) for determinism
  const sortedEdges = [...graph.edges]
    .sort((a, b) => {
      const fromCmp = a.from.localeCompare(b.from);
      if (fromCmp !== 0) return fromCmp;
      return a.to.localeCompare(b.to);
    })
    .map(canonicalEdge);

  // Build canonical structure
  const canonical = {
    nodes: sortedNodes,
    edges: sortedEdges,
  };

  // Stable JSON stringify (keys already sorted)
  const json = JSON.stringify(canonical);

  // SHA-256 hash
  return createHash('sha256').update(json).digest('hex');
}

/**
 * Generate a cache key string from components
 *
 * @param graphHash - Hash of the graph
 * @param seed - Random seed
 * @param configVersion - Sampling config version
 * @returns Cache key string
 */
export function buildCacheKey(
  graphHash: string,
  seed: number,
  configVersion: string
): string {
  return `${graphHash}:${seed}:${configVersion}`;
}

/**
 * Parse a cache key string back to components
 *
 * @param cacheKey - Cache key string
 * @returns Components or null if invalid
 */
export function parseCacheKey(
  cacheKey: string
): { graphHash: string; seed: number; configVersion: string } | null {
  const parts = cacheKey.split(':');
  if (parts.length !== 3) return null;

  const seed = parseInt(parts[1], 10);
  if (isNaN(seed)) return null;

  return {
    graphHash: parts[0],
    seed,
    configVersion: parts[2],
  };
}

/**
 * Derive a deterministic seed from a graph hash
 * Useful when no explicit seed is provided
 *
 * @param graphHash - Hash of the graph
 * @returns Derived seed (positive integer)
 */
export function deriveSeedFromHash(graphHash: string): number {
  // Take first 8 hex characters and convert to number
  const hexPart = graphHash.slice(0, 8);
  const seed = parseInt(hexPart, 16);

  // Ensure positive and within safe integer range
  return Math.abs(seed) % 2147483647 || 42;
}

/**
 * Generate a sequence of seeds for perturbation sweeps
 *
 * Uses hash-based derivation for determinism:
 * Each seed is derived from hash(baseSeed + perturbationId)
 *
 * @param baseSeed - Base seed for the sequence
 * @param perturbationIds - IDs of perturbations
 * @returns Seed sequence
 */
export function generateSeedSequence(
  baseSeed: number,
  perturbationIds: string[]
): { base_seed: number; seeds: number[]; method: 'hash_based' } {
  const seeds = perturbationIds.map((id) => {
    const input = `${baseSeed}:${id}`;
    const hash = createHash('sha256').update(input).digest('hex');
    return deriveSeedFromHash(hash);
  });

  return {
    base_seed: baseSeed,
    seeds,
    method: 'hash_based',
  };
}

/**
 * Verify that a graph hash matches a graph
 * Useful for cache validation
 *
 * @param graph - Graph to verify
 * @param expectedHash - Expected hash value
 * @returns True if hashes match
 */
export function verifyGraphHash(graph: GraphInput, expectedHash: string): boolean {
  const actualHash = hashGraph(graph);
  return actualHash === expectedHash;
}
