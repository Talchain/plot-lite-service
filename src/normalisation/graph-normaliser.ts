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
import { NON_CAUSAL_NODE_KINDS } from '../types/engine-v3.js';

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
const STD_RANGE_MIN = 0.05;
const STD_RANGE_MAX = 0.4;

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
export function normaliseNode(
  node: UpstreamNode,
  warnings?: NormalisationWarning[]
): EngineNodeV3 {
  if (!node.id) {
    throw new NormalisationError('Node missing id', 'id');
  }

  // Resolve kind from multiple sources
  const rawKind =
    node.kind ?? node.type ?? node.data?.kind ?? node.data?.type ?? 'factor';

  // Validate kind (but allow 'option' - it will be filtered later)
  const normalizedKind = rawKind.toLowerCase();
  const kind = normalizedKind as EngineNodeKindV3;

  if (
    !VALID_NODE_KINDS.has(normalizedKind) &&
    !NON_CAUSAL_NODE_KINDS.includes(normalizedKind as (typeof NON_CAUSAL_NODE_KINDS)[number])
  ) {
    warnings?.push({
      code: 'UNKNOWN_NODE_KIND',
      message: `Node '${node.id}' has unknown kind '${normalizedKind}'`,
      node_id: node.id,
    });
  }

  // Extract observed_state from various locations
  let observedState: EngineNodeV3['observed_state'] | undefined;

  // Extract and validate intercept from various locations
  // Contract: optional; if present must be a finite number.
  //
  // Null rejection rationale:
  // - `undefined` or omitted = "not specified" → defaults to 0.0 in hash computation
  // - `null` = explicit "no value" → rejected as anti-pattern
  // - This prevents accidental null values from being silently converted to 0.0
  // - Clients should omit the field entirely if intercept is unknown
  //
  // Migration: If receiving 422 errors for null intercept, filter out null values
  // before sending the request, or omit the intercept field entirely.
  let rawIntercept: unknown = undefined;
  if (Object.prototype.hasOwnProperty.call(node, 'intercept')) {
    rawIntercept = node.intercept;
  } else if (node.data && Object.prototype.hasOwnProperty.call(node.data, 'intercept')) {
    rawIntercept = node.data.intercept;
  }

  if (rawIntercept === null) {
    throw new NormalisationError(
      `Node '${node.id}': intercept cannot be null. ` +
      `To use the default intercept (0.0), omit the field entirely instead of setting it to null.`,
      'intercept',
      node.id
    );
  }
  if (rawIntercept !== undefined) {
    if (typeof rawIntercept !== 'number' || !Number.isFinite(rawIntercept)) {
      throw new NormalisationError(
        `Node '${node.id}': intercept must be a finite number`,
        'intercept',
        node.id
      );
    }
  }

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

  // Extract state_space from various locations
  const stateSpace = node.state_space ?? node.data?.state_space;

  return {
    id: node.id,
    kind,
    label: node.label ?? node.id,
    description: node.description ?? node.body,
    intercept: rawIntercept === undefined ? undefined : (rawIntercept as number),
    observed_state: observedState,
    state_space: stateSpace,
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
  nodeKindMap?: Map<string, string>,
  warnings?: NormalisationWarning[]
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

  const edgeId = `${from}::${to}`;
  const pushCoefficientWarning = (message: string) => {
    warnings?.push({
      code: 'COEFFICIENT_REPAIRED',
      message,
      edge_id: edgeId,
    });
  };

  // 2. Resolve exists_probability (fallback chain)
  const rawExistsProbability = edge.exists_probability ?? edge.belief_exists ?? edge.belief;
  let existsProbability: number;
  if (rawExistsProbability === undefined) {
    existsProbability = DEFAULT_EXISTS_PROBABILITY;
    pushCoefficientWarning(
      `Edge ${edgeId}: exists_probability defaulted to ${DEFAULT_EXISTS_PROBABILITY}`
    );
  } else if (typeof rawExistsProbability !== 'number' || !Number.isFinite(rawExistsProbability)) {
    existsProbability = DEFAULT_EXISTS_PROBABILITY;
    pushCoefficientWarning(
      `Edge ${edgeId}: exists_probability invalid, defaulted to ${DEFAULT_EXISTS_PROBABILITY}`
    );
  } else {
    const clampedExistsProbability = clamp(rawExistsProbability, 0, 1);
    if (clampedExistsProbability !== rawExistsProbability) {
      pushCoefficientWarning(
        `Edge ${edgeId}: exists_probability clamped from ${rawExistsProbability} to ${clampedExistsProbability}`
      );
    }
    existsProbability = clampedExistsProbability;
  }

  // 3. Resolve strength
  // Accept BOTH nested (strength.mean/std) AND flat (strength_mean/std) formats
  // This enables compatibility with CEE V3 which outputs flat fields
  let mean: number = DEFAULT_WEIGHT;
  let std: number = MIN_STD;

  // Check for explicit strength: nested object OR flat fields
  const rawMean = edge.strength?.mean ?? edge.strength_mean;
  let hasExplicitMean = false;

  if (rawMean !== undefined) {
    if (typeof rawMean === 'number' && Number.isFinite(rawMean)) {
      mean = rawMean;
      hasExplicitMean = true;
    } else {
      pushCoefficientWarning(`Edge ${edgeId}: strength.mean invalid, defaulted using weight`);
    }
  }

  if (!hasExplicitMean) {
    // Derive from weight and direction
    let weight = edge.weight;
    if (weight === undefined) {
      weight = DEFAULT_WEIGHT;
      pushCoefficientWarning(
        `Edge ${edgeId}: strength.mean defaulted using weight ${DEFAULT_WEIGHT}`
      );
    } else if (typeof weight !== 'number' || !Number.isFinite(weight)) {
      weight = DEFAULT_WEIGHT;
      pushCoefficientWarning(
        `Edge ${edgeId}: strength.mean defaulted using weight ${DEFAULT_WEIGHT} (invalid weight)`
      );
    }

    // Resolve effect direction: explicit > inferred from node kinds > positive default
    let direction: 'positive' | 'negative' = edge.effect_direction ?? edge.direction ?? 'positive';

    // If no explicit direction and we have node kind info, infer from semantics
    if (!edge.effect_direction && !edge.direction && nodeKindMap) {
      const fromKind = nodeKindMap.get(from);
      const toKind = nodeKindMap.get(to);
      direction = inferEffectDirection(fromKind, toKind);
      if (direction === 'negative') {
        warnings?.push({
          code: 'DIRECTION_INFERRED',
          message: `Edge '${from}' -> '${to}': effect direction inferred as 'negative' from ${fromKind ?? 'unknown'} -> ${toKind ?? 'unknown'}`,
          edge_id: edgeId,
        });
      }
    }

    mean = direction === 'negative' ? -Math.abs(weight) : Math.abs(weight);
  }

  const clampedMean = clamp(mean, -1, 1);
  if (clampedMean !== mean) {
    pushCoefficientWarning(`Edge ${edgeId}: strength.mean clamped from ${mean} to ${clampedMean}`);
    mean = clampedMean;
  }

  const rawStd = edge.strength?.std ?? edge.strength_std;
  if (rawStd !== undefined) {
    if (typeof rawStd === 'number' && Number.isFinite(rawStd)) {
      std = rawStd;
    } else {
      std = deriveStd(mean, existsProbability);
      pushCoefficientWarning(`Edge ${edgeId}: strength.std invalid, defaulted to ${std}`);
    }
  } else if (edge.belief_strength !== undefined) {
    if (typeof edge.belief_strength === 'number' && Number.isFinite(edge.belief_strength)) {
      // Higher belief_strength = lower uncertainty
      std = (1 - edge.belief_strength) * 0.5 * Math.abs(mean) + 0.05;
    } else {
      std = deriveStd(mean, existsProbability);
      pushCoefficientWarning(
        `Edge ${edgeId}: strength.std defaulted to ${std} (invalid belief_strength)`
      );
    }
  } else {
    std = deriveStd(mean, existsProbability);
    pushCoefficientWarning(`Edge ${edgeId}: strength.std defaulted to ${std}`);
  }

  if (!Number.isFinite(std)) {
    const prevStd = std;
    std = MIN_STD;
    pushCoefficientWarning(`Edge ${edgeId}: strength.std floored from ${prevStd} to ${MIN_STD}`);
  } else {
    const clampedStd = clamp(std, STD_RANGE_MIN, STD_RANGE_MAX);
    if (clampedStd !== std) {
      pushCoefficientWarning(`Edge ${edgeId}: strength.std clamped from ${std} to ${clampedStd}`);
    }
    std = clampedStd;

    // Final guard for ISL requirement (std > 0)
    if (std <= 0) {
      const prevStd = std;
      std = MIN_STD;
      pushCoefficientWarning(`Edge ${edgeId}: strength.std floored from ${prevStd} to ${MIN_STD}`);
    }
  }

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
export interface NormalisationWarning {
  code: string;
  message: string;
  /** Affected node ID (for node-level warnings) */
  node_id?: string;
  /** Affected edge ID (for edge-level warnings) */
  edge_id?: string;
}

export interface NormalisationResult {
  /** Normalized graph */
  graph: EngineGraphV3;
  /** Number of nodes normalized */
  nodesNormalised: number;
  /** Number of edges normalized */
  edgesNormalised: number;
  /** Warnings generated during normalization */
  warnings: NormalisationWarning[];
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
  const warnings: NormalisationWarning[] = [];
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
      const node = normaliseNode(upstreamNode, warnings);

      // Warn about option nodes (they'll be filtered later)
      if ((upstreamNode.kind ?? upstreamNode.type ?? upstreamNode.data?.kind ?? upstreamNode.data?.type) === 'option') {
        warnings.push({
          code: 'NORMALIZATION_WARNING',
          message: `Node '${node.id}' has kind='option'. Option nodes are filtered before analysis.`,
        });
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
      edges.push(normaliseEdge(upstreamEdge, edgeIndex, nodeKindMap, warnings));
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
