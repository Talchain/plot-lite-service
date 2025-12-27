/**
 * Graph Normalization for V3 Engine
 *
 * Transforms upstream graph formats (EdgeV2.2, React Flow, legacy)
 * to internal canonical EngineGraphV3 format.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type {
  UpstreamNode,
  UpstreamEdge,
  UpstreamGraph,
  EngineNodeV3,
  EngineEdgeV3,
  EngineGraphV3,
  EngineNodeKindV3,
} from '../types/engine-v3.js';

// -----------------------------------------------------------------------------
// Error Types
// -----------------------------------------------------------------------------

export class NormalisationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly nodeId?: string,
    public readonly edgeId?: string
  ) {
    super(message);
    this.name = 'NormalisationError';
  }
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const VALID_NODE_KINDS: Set<string> = new Set([
  'goal',
  'factor',
  'outcome',
  'decision',
  'risk',
  'action',
]);

const DEFAULT_EXISTS_PROBABILITY = 0.8;
const DEFAULT_WEIGHT = 0.5;
const MIN_STD = 0.001; // ISL requires std > 0

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/**
 * Derive standard deviation from mean and belief/confidence.
 * Higher belief = lower uncertainty = smaller std.
 *
 * CV (coefficient of variation) ranges from 0.1 (high confidence) to 0.4 (low confidence)
 */
export function deriveStd(mean: number, belief: number): number {
  // CV ∈ [0.1, 0.4] based on belief
  const cv = 0.3 * (1 - belief) + 0.1;
  return Math.max(0.05, cv * Math.abs(mean));
}

/**
 * Clamp a value to a range.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// -----------------------------------------------------------------------------
// Node Normalization
// -----------------------------------------------------------------------------

/**
 * Normalize an upstream node to canonical EngineNodeV3 format.
 *
 * Handles:
 * - React Flow nesting (data.kind, data.value, etc.)
 * - Legacy field names (type → kind, body → description)
 * - Missing fields with sensible defaults
 *
 * @param node Upstream node in any supported format
 * @returns Normalized node in EngineNodeV3 format
 * @throws NormalisationError if node is invalid
 */
export function normaliseNode(node: UpstreamNode): EngineNodeV3 {
  if (!node.id) {
    throw new NormalisationError('Node missing id', 'id');
  }

  // Resolve kind from multiple sources
  const rawKind =
    node.kind ?? node.type ?? node.data?.kind ?? node.data?.type ?? 'factor';

  // Validate kind (but allow 'option' - it will be filtered later)
  const kind = rawKind.toLowerCase() as EngineNodeKindV3;

  // Extract observed_state from various locations
  let observedState: EngineNodeV3['observed_state'] | undefined;

  if (node.observed_state?.value !== undefined) {
    observedState = {
      value: node.observed_state.value,
      baseline: node.observed_state.baseline,
      unit: node.observed_state.unit,
    };
  } else if (node.data?.value !== undefined) {
    observedState = {
      value: node.data.value,
      baseline: node.data.baseline,
      unit: node.data.unit,
    };
  }

  return {
    id: node.id,
    kind,
    label: node.label ?? node.id,
    description: node.description ?? node.body,
    observed_state: observedState,
  };
}

// -----------------------------------------------------------------------------
// Edge Normalization
// -----------------------------------------------------------------------------

/**
 * Normalize an upstream edge to canonical EngineEdgeV3 format.
 *
 * Handles:
 * - React Flow naming (source/target → from/to)
 * - Multiple uncertainty field names (exists_probability, belief_exists, belief)
 * - Multiple strength representations (weight, strength, strength_std, belief_strength)
 * - Effect direction (positive/negative)
 *
 * @param edge Upstream edge in any supported format
 * @param index Edge index for error reporting
 * @returns Normalized edge in EngineEdgeV3 format
 * @throws NormalisationError if edge is invalid
 */
export function normaliseEdge(edge: UpstreamEdge, index: number): EngineEdgeV3 {
  // 1. Resolve from/to
  const from = edge.from ?? edge.source;
  const to = edge.to ?? edge.target;

  if (!from) {
    throw new NormalisationError(
      `Edge at index ${index} missing 'from' or 'source'`,
      'from',
      undefined,
      `edge_${index}`
    );
  }

  if (!to) {
    throw new NormalisationError(
      `Edge at index ${index} missing 'to' or 'target'`,
      'to',
      undefined,
      `edge_${index}`
    );
  }

  // 2. Resolve exists_probability (fallback chain)
  const existsProbability = clamp(
    edge.exists_probability ??
      edge.belief_exists ??
      edge.belief ??
      DEFAULT_EXISTS_PROBABILITY,
    0,
    1
  );

  // 3. Resolve strength
  let mean: number;
  let std: number;

  if (edge.strength?.mean !== undefined) {
    // Explicit strength object
    mean = edge.strength.mean;
    std = edge.strength.std ?? deriveStd(mean, existsProbability);
  } else {
    // Derive from weight and direction
    const weight = edge.weight ?? DEFAULT_WEIGHT;
    const direction =
      edge.effect_direction ?? edge.direction ?? 'positive';
    mean = direction === 'negative' ? -Math.abs(weight) : Math.abs(weight);

    // Derive std from strength_std, belief_strength, or exists_probability
    if (edge.strength_std !== undefined) {
      std = edge.strength_std;
    } else if (edge.belief_strength !== undefined) {
      // Higher belief_strength = lower uncertainty
      std = (1 - edge.belief_strength) * 0.5 * Math.abs(mean) + 0.05;
    } else {
      std = deriveStd(mean, existsProbability);
    }
  }

  // 4. Ensure std > 0 (ISL requirement)
  std = Math.max(MIN_STD, std);

  return {
    from,
    to,
    exists_probability: existsProbability,
    strength: { mean, std },
    label: edge.label,
  };
}

// -----------------------------------------------------------------------------
// Graph Normalization
// -----------------------------------------------------------------------------

/**
 * Result of graph normalization.
 */
export interface NormalisationResult {
  /** Normalized graph */
  graph: EngineGraphV3;
  /** Number of nodes normalized */
  nodesNormalised: number;
  /** Number of edges normalized */
  edgesNormalised: number;
  /** Warnings generated during normalization */
  warnings: string[];
}

/**
 * Normalize an entire upstream graph to canonical EngineGraphV3 format.
 *
 * This does NOT filter option nodes - that is done separately.
 * This just normalizes all field formats to canonical form.
 *
 * @param upstreamGraph Graph in upstream format
 * @returns Normalized graph with stats
 * @throws NormalisationError if any node/edge is invalid
 */
export function normaliseGraph(upstreamGraph: UpstreamGraph): NormalisationResult {
  const warnings: string[] = [];
  const nodes: EngineNodeV3[] = [];
  const edges: EngineEdgeV3[] = [];

  // Normalize nodes
  for (const upstreamNode of upstreamGraph.nodes ?? []) {
    try {
      const node = normaliseNode(upstreamNode);

      // Warn about option nodes (they'll be filtered later)
      if ((upstreamNode.kind ?? upstreamNode.type ?? upstreamNode.data?.kind ?? upstreamNode.data?.type) === 'option') {
        warnings.push(
          `Node '${node.id}' has kind='option'. Option nodes are filtered before analysis.`
        );
      }

      nodes.push(node);
    } catch (err) {
      if (err instanceof NormalisationError) {
        throw err;
      }
      throw new NormalisationError(
        `Failed to normalize node: ${(err as Error).message}`,
        'node',
        upstreamNode.id
      );
    }
  }

  // Normalize edges
  let edgeIndex = 0;
  for (const upstreamEdge of upstreamGraph.edges ?? []) {
    try {
      edges.push(normaliseEdge(upstreamEdge, edgeIndex));
      edgeIndex++;
    } catch (err) {
      if (err instanceof NormalisationError) {
        throw err;
      }
      throw new NormalisationError(
        `Failed to normalize edge at index ${edgeIndex}: ${(err as Error).message}`,
        'edge',
        undefined,
        `edge_${edgeIndex}`
      );
    }
  }

  return {
    graph: { nodes, edges },
    nodesNormalised: nodes.length,
    edgesNormalised: edges.length,
    warnings,
  };
}
