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
 * Infer effect direction from source node kind when not explicitly provided.
 *
 * Risk nodes should have negative effect on goals/outcomes by default.
 * This aligns with the semantics: risks reduce goal achievement.
 *
 * @param fromNodeKind Kind of the source node (if known)
 * @param toNodeKind Kind of the target node (if known)
 * @returns Inferred effect direction
 */
function inferEffectDirection(
  fromNodeKind: string | undefined,
  toNodeKind: string | undefined
): 'positive' | 'negative' {
  // Risk nodes have negative effects on goals/outcomes
  if (fromNodeKind === 'risk') {
    // Risk → goal/outcome = negative (risks reduce achievement)
    if (toNodeKind === 'goal' || toNodeKind === 'outcome') {
      return 'negative';
    }
  }
  // Default to positive for all other relationships
  return 'positive';
}

/**
 * Normalize an upstream edge to canonical EngineEdgeV3 format.
 *
 * Handles:
 * - React Flow naming (source/target → from/to)
 * - Multiple uncertainty field names (exists_probability, belief_exists, belief)
 * - Multiple strength representations (weight, strength, strength_std, belief_strength)
 * - Effect direction (positive/negative) - inferred from node kinds if not provided
 *
 * @param edge Upstream edge in any supported format
 * @param index Edge index for error reporting
 * @param nodeKindMap Optional map of node IDs to their kinds for effect direction inference
 * @returns Normalized edge in EngineEdgeV3 format
 * @throws NormalisationError if edge is invalid
 */
export function normaliseEdge(
  edge: UpstreamEdge,
  index: number,
  nodeKindMap?: Map<string, string>
): EngineEdgeV3 {
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
    // Explicit strength object - use mean directly (already signed)
    mean = edge.strength.mean;
    std = edge.strength.std ?? deriveStd(mean, existsProbability);
  } else {
    // Derive from weight and direction
    const weight = edge.weight ?? DEFAULT_WEIGHT;

    // Resolve effect direction: explicit > inferred from node kinds > positive default
    let direction: 'positive' | 'negative' = edge.effect_direction ?? edge.direction ?? 'positive';

    // If no explicit direction and we have node kind info, infer from semantics
    if (!edge.effect_direction && !edge.direction && nodeKindMap) {
      const fromKind = nodeKindMap.get(from);
      const toKind = nodeKindMap.get(to);
      direction = inferEffectDirection(fromKind, toKind);
    }

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
 * Effect direction inference:
 * - If edge has explicit effect_direction, use it
 * - If not, infer from node kinds (e.g., risk → goal = negative)
 * - Otherwise default to positive
 *
 * @param upstreamGraph Graph in upstream format
 * @returns Normalized graph with stats
 * @throws NormalisationError if any node/edge is invalid
 */
export function normaliseGraph(upstreamGraph: UpstreamGraph): NormalisationResult {
  const warnings: string[] = [];
  const nodes: EngineNodeV3[] = [];
  const edges: EngineEdgeV3[] = [];

  // Build node kind map for effect direction inference
  // Map node IDs to their kinds so edges can infer direction from source/target semantics
  const nodeKindMap = new Map<string, string>();
  for (const upstreamNode of upstreamGraph.nodes ?? []) {
    const kind = upstreamNode.kind ?? upstreamNode.type ?? upstreamNode.data?.kind ?? upstreamNode.data?.type ?? 'factor';
    nodeKindMap.set(upstreamNode.id, kind.toLowerCase());
  }

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

  // Normalize edges (with node kind map for effect direction inference)
  let edgeIndex = 0;
  for (const upstreamEdge of upstreamGraph.edges ?? []) {
    try {
      edges.push(normaliseEdge(upstreamEdge, edgeIndex, nodeKindMap));
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
