/**
 * Request Canonicalisation for Determinism Hash
 *
 * Computes a response_hash from the canonical form of the request.
 * Only SEMANTIC fields that affect inference results are included.
 *
 * Key principle: Same semantic request → same hash, regardless of:
 * - Option order
 * - Node labels/descriptions
 * - Field ordering in objects
 *
 * @see P0-PLOT-5: Determinism Hash with Full Numeric Normalisation
 */

import { createHash } from 'node:crypto';
import type { RunRequestV3, OptionV3, EngineGraphV3 } from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/** Number of decimal places for float normalisation */
const DECIMAL_PRECISION = 6;

// -----------------------------------------------------------------------------
// Float Normalisation
// -----------------------------------------------------------------------------

/**
 * Normalise a float to fixed precision.
 * Ensures 0.5 and 0.500000 produce identical hash.
 */
function normaliseFloat(n: number): number {
  return parseFloat(n.toFixed(DECIMAL_PRECISION));
}

/**
 * Normalise an optional float (undefined-safe).
 */
function normaliseOptionalFloat(n: number | undefined): number | undefined {
  return n !== undefined ? normaliseFloat(n) : undefined;
}

// -----------------------------------------------------------------------------
// Canonical Node
// -----------------------------------------------------------------------------

interface CanonicalNode {
  id: string;
  kind: string;
  observed_state?: {
    value: number;
    std?: number;
  };
}

/**
 * Extract only semantic fields from a node.
 * Excludes: label, description, and other UI metadata.
 */
function canonicaliseNode(node: EngineGraphV3['nodes'][0]): CanonicalNode {
  const canonical: CanonicalNode = {
    id: node.id,
    kind: node.kind,
  };

  if (node.observed_state && node.observed_state.value !== undefined) {
    canonical.observed_state = {
      value: normaliseFloat(node.observed_state.value),
    };

    // Include std if present (some nodes have observed_state.std)
    const std = (node.observed_state as any).std;
    if (std !== undefined) {
      canonical.observed_state.std = normaliseFloat(std);
    }
  }

  return canonical;
}

// -----------------------------------------------------------------------------
// Canonical Edge
// -----------------------------------------------------------------------------

interface CanonicalEdge {
  from: string;
  to: string;
  strength: {
    mean: number;
    std: number;
  };
  exists_probability: number;
}

/**
 * Extract only semantic fields from an edge.
 * Excludes: label, provenance, and other UI metadata.
 */
function canonicaliseEdge(edge: EngineGraphV3['edges'][0]): CanonicalEdge {
  return {
    from: edge.from,
    to: edge.to,
    strength: {
      mean: normaliseFloat(edge.strength.mean),
      std: normaliseFloat(edge.strength.std),
    },
    exists_probability: normaliseFloat(edge.exists_probability),
  };
}

// -----------------------------------------------------------------------------
// Canonical Option
// -----------------------------------------------------------------------------

interface CanonicalOption {
  id: string;
  interventions: Record<string, number>;
}

/**
 * Extract only semantic fields from an option.
 * Excludes: label (which is UI-only).
 *
 * Supports both intervention formats:
 * - Simple: { "node_id": 10 }
 * - Rich: { "node_id": { "value": 10, "source": "user" } }
 */
function canonicaliseOption(option: OptionV3): CanonicalOption {
  // Sort intervention keys alphabetically
  const sortedInterventions: Record<string, number> = {};
  const sortedKeys = Object.keys(option.interventions).sort();

  for (const key of sortedKeys) {
    const intervention = option.interventions[key] as number | { value: number };
    // Handle both simple numbers and rich objects
    const value = typeof intervention === 'number' ? intervention : intervention.value;
    sortedInterventions[key] = normaliseFloat(value);
  }

  return {
    id: option.id,
    interventions: sortedInterventions,
  };
}

// -----------------------------------------------------------------------------
// Canonical Request
// -----------------------------------------------------------------------------

interface CanonicalRequest {
  seed: string;
  goal_node_id: string;
  detail_level: string;
  /** Goal threshold affects probability_of_goal computation */
  goal_threshold?: number;
  graph: {
    nodes: CanonicalNode[];
    edges: CanonicalEdge[];
  };
  options: CanonicalOption[];
}

/**
 * Build a canonical representation of the request.
 * Only includes semantic fields that affect inference results.
 *
 * Sorting rules:
 * - Nodes sorted by id
 * - Edges sorted by (from, to)
 * - Options sorted by id
 * - Intervention keys sorted alphabetically
 *
 * @param req V2 run request
 * @param normalizedGraph Normalized graph (post-normalisation)
 * @param seedUsed Seed that will be used (already normalised to string)
 * @returns Canonical JSON string
 */
export function canonicaliseRequest(
  req: RunRequestV3,
  normalizedGraph: EngineGraphV3,
  seedUsed: string
): string {
  const canonical: CanonicalRequest = {
    seed: seedUsed,
    goal_node_id: req.goal_node_id,
    detail_level: req.detail_level ?? 'standard',
    graph: {
      // Sort nodes by id
      nodes: [...normalizedGraph.nodes]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(canonicaliseNode),
      // Sort edges by (from, to)
      edges: [...normalizedGraph.edges]
        .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
        .map(canonicaliseEdge),
    },
    // Sort options by id
    options: [...req.options]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(canonicaliseOption),
  };

  // Include goal_threshold in hash if provided (affects probability_of_goal computation)
  // Treat null as absent (not included in hash)
  if (typeof req.goal_threshold === 'number' && Number.isFinite(req.goal_threshold)) {
    canonical.goal_threshold = normaliseFloat(req.goal_threshold);
  }

  return JSON.stringify(canonical);
}

/**
 * Compute the response hash from a canonicalised request.
 *
 * @param canonicalised JSON string from canonicaliseRequest
 * @returns 16-character hex hash
 */
export function computeResponseHash(canonicalised: string): string {
  return createHash('sha256').update(canonicalised).digest('hex').slice(0, 16);
}

/**
 * Convenience function: canonicalise and hash in one call.
 *
 * @param req V2 run request
 * @param normalizedGraph Normalized graph (post-normalisation)
 * @param seedUsed Seed that will be used (already normalised to string)
 * @returns 16-character hex hash
 */
export function hashRequest(
  req: RunRequestV3,
  normalizedGraph: EngineGraphV3,
  seedUsed: string
): string {
  const canonical = canonicaliseRequest(req, normalizedGraph, seedUsed);
  return computeResponseHash(canonical);
}
