/**
 * Factor Influence Computation
 *
 * Computes factor influence and confidence from graph edge data.
 * Uses path analysis to derive total causal effect from each factor to the goal.
 *
 * Scientific Approach:
 * - Influence = Sum of path effects (product of strength.mean along each path)
 * - Confidence = Combined certainty from exists_probability and strength.std
 * - Direction = Sign of total influence (positive/negative effect on goal)
 *
 * @see Schema D.5 - Factor influence derived from edge-level data
 */

import type { EngineGraphV3, EngineEdgeV3, EngineNodeV3, FactorSensitivityResultV3 } from '../types/engine-v3.js';

/**
 * Minimal fragile edge interface for VOI and flip risk computation.
 * Compatible with both NormalizedEdgeInfo and NormalizedEdgeInfoV3.
 */
interface FragileEdgeForVoi {
  from_id: string;
  to_id: string;
  switch_probability?: number;
  marginal_switch_probability?: number;
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/**
 * Computed factor influence result.
 */
export interface FactorInfluence {
  factor_id: string;
  label: string;
  influence: number;            // Raw total causal effect (sum of path effects)
  normalised_influence: number; // 0-1 for display (relative to max |influence|)
  confidence: number;           // 0-1 (combined path certainty)
  direction: 'positive' | 'negative';
}

/**
 * Internal edge representation for path computation.
 */
interface EdgeInfo {
  to: string;
  strength_mean: number;
  strength_std: number;
  exists_probability: number;
}

/**
 * Path through the graph from factor to goal.
 */
interface PathInfo {
  nodes: string[];
  effect: number;      // Product of strength.mean along path
  confidence: number;  // Combined certainty along path
}

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/** Maximum path depth to prevent infinite loops in cyclic graphs */
const MAX_PATH_DEPTH = 10;

/** Minimum exists_probability to consider an edge viable */
const MIN_EXISTS_PROBABILITY = 0.01;

// -----------------------------------------------------------------------------
// Core Implementation
// -----------------------------------------------------------------------------

/**
 * Build an edge lookup map from graph edges.
 *
 * Maps each source node to all outgoing edges with their strength data.
 * Only includes edges with exists_probability > MIN_EXISTS_PROBABILITY.
 *
 * @param edges Graph edges
 * @returns Map of source node ID → outgoing edge info
 */
function buildEdgeLookup(edges: EngineEdgeV3[]): Map<string, EdgeInfo[]> {
  const lookup = new Map<string, EdgeInfo[]>();

  for (const edge of edges) {
    // Skip edges with very low existence probability
    if (edge.exists_probability < MIN_EXISTS_PROBABILITY) {
      continue;
    }

    const edgeInfo: EdgeInfo = {
      to: edge.to,
      strength_mean: edge.strength.mean,
      strength_std: edge.strength.std,
      exists_probability: edge.exists_probability,
    };

    if (!lookup.has(edge.from)) {
      lookup.set(edge.from, []);
    }
    lookup.get(edge.from)!.push(edgeInfo);
  }

  return lookup;
}

/**
 * Find all paths from a source node to the goal using DFS.
 *
 * Handles cycles by tracking visited nodes per path.
 * Limits depth to MAX_PATH_DEPTH to prevent explosion in dense graphs.
 *
 * @param edgeLookup Edge lookup map
 * @param sourceId Starting node
 * @param goalId Target goal node
 * @returns Array of all paths found
 */
function findAllPathsToGoal(
  edgeLookup: Map<string, EdgeInfo[]>,
  sourceId: string,
  goalId: string
): PathInfo[] {
  const paths: PathInfo[] = [];

  // DFS with path tracking to detect cycles
  function dfs(
    currentNode: string,
    path: string[],
    effect: number,
    confidences: number[]
  ): void {
    // Reached goal - record path
    if (currentNode === goalId) {
      // Compute path confidence as product of exists_probability × certainty from std
      // Use geometric mean of individual edge confidences
      let avgConfidence = confidences.length > 0
        ? confidences.reduce((a, b) => a * b, 1) ** (1 / confidences.length)
        : 1;

      // Guard against NaN/Infinity from edge cases (e.g., 0 confidence, overflow)
      if (!Number.isFinite(avgConfidence)) {
        avgConfidence = 0;
      }

      paths.push({
        nodes: [...path],
        effect,
        confidence: avgConfidence,
      });
      return;
    }

    // Depth limit reached
    if (path.length >= MAX_PATH_DEPTH) {
      return;
    }

    // Get outgoing edges
    const outEdges = edgeLookup.get(currentNode);
    if (!outEdges) {
      return;
    }

    // Explore each neighbor
    for (const edge of outEdges) {
      // Skip if already in path (cycle detection)
      if (path.includes(edge.to)) {
        continue;
      }

      // Compute edge confidence: exists_probability × certainty_from_std
      // certainty = 1 / (1 + |std / mean|) when mean != 0, else use exists_probability only
      let edgeCertainty: number;
      if (Math.abs(edge.strength_mean) > 0.001) {
        const relativeStd = Math.abs(edge.strength_std / edge.strength_mean);
        edgeCertainty = 1 / (1 + relativeStd);
      } else {
        // Mean is ~0, use exists_probability as proxy for certainty
        edgeCertainty = edge.exists_probability;
      }
      const edgeConfidence = edge.exists_probability * edgeCertainty;

      // Recurse with accumulated effect and confidence
      dfs(
        edge.to,
        [...path, edge.to],
        effect * edge.strength_mean,
        [...confidences, edgeConfidence]
      );
    }
  }

  // Start DFS from source
  dfs(sourceId, [sourceId], 1, []);

  return paths;
}

/**
 * Compute total influence and confidence for a factor.
 *
 * Influence = Sum of all path effects
 * Confidence = Weighted average of path confidences (weighted by |effect|)
 *
 * @param paths All paths from factor to goal
 * @returns { influence, confidence }
 */
function computeInfluenceFromPaths(paths: PathInfo[]): { influence: number; confidence: number } {
  if (paths.length === 0) {
    return { influence: 0, confidence: 0 };
  }

  // Sum all path effects to get total influence
  let totalInfluence = paths.reduce((sum, p) => sum + p.effect, 0);

  // Weighted average of confidences (weighted by |effect|)
  const totalWeight = paths.reduce((sum, p) => sum + Math.abs(p.effect), 0);
  let weightedConfidence = totalWeight > 0
    ? paths.reduce((sum, p) => sum + Math.abs(p.effect) * p.confidence, 0) / totalWeight
    : 0;

  // Guard against NaN/Infinity from edge cases (e.g., overflow, invalid input data)
  if (!Number.isFinite(totalInfluence)) {
    totalInfluence = 0;
  }
  if (!Number.isFinite(weightedConfidence)) {
    weightedConfidence = 0;
  }

  return {
    influence: totalInfluence,
    confidence: weightedConfidence,
  };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Compute factor influence and confidence from graph structure.
 *
 * For each factor node, finds all paths to the goal and computes:
 * - influence: total causal effect (sum of path effects)
 * - confidence: combined certainty along paths
 * - direction: positive or negative effect on goal
 *
 * No dependency on parameter_uncertainties - derived purely from edge data.
 *
 * @param graph Graph with nodes and edges
 * @param goalNodeId Target goal node ID
 * @returns Array of factor influences, sorted by |influence| descending
 */
export function computeFactorInfluence(
  graph: EngineGraphV3,
  goalNodeId: string
): FactorInfluence[] {
  // Validate goal node exists
  const goalNode = graph.nodes.find(n => n.id === goalNodeId);
  if (!goalNode) {
    return [];
  }

  // Build edge lookup for efficient path finding
  const edgeLookup = buildEdgeLookup(graph.edges);

  // Find all factor nodes
  const factorNodes = graph.nodes.filter(n => n.kind === 'factor');

  // Compute influence for each factor
  const results: Array<{ factor: EngineNodeV3; influence: number; confidence: number }> = [];

  for (const factor of factorNodes) {
    // Skip if factor is the goal itself
    if (factor.id === goalNodeId) {
      continue;
    }

    // Find all paths from factor to goal
    const paths = findAllPathsToGoal(edgeLookup, factor.id, goalNodeId);

    // Compute influence and confidence
    const { influence, confidence } = computeInfluenceFromPaths(paths);

    results.push({ factor, influence, confidence });
  }

  // Find max absolute influence for normalization
  const maxAbsInfluence = Math.max(
    ...results.map(r => Math.abs(r.influence)),
    0.001 // Prevent division by zero
  );

  // Build final output with normalized values
  const output: FactorInfluence[] = results.map(({ factor, influence, confidence }) => ({
    factor_id: factor.id,
    label: factor.label,
    influence,
    normalised_influence: Math.abs(influence) / maxAbsInfluence,
    confidence,
    direction: influence >= 0 ? 'positive' : 'negative',
  }));

  // Sort by absolute influence descending
  output.sort((a, b) => Math.abs(b.influence) - Math.abs(a.influence));

  return output;
}

/**
 * Compute factor influence with additional metadata for debugging.
 *
 * Same as computeFactorInfluence but includes path details.
 *
 * @param graph Graph with nodes and edges
 * @param goalNodeId Target goal node ID
 * @returns Array of factor influences with path details
 */
export function computeFactorInfluenceWithPaths(
  graph: EngineGraphV3,
  goalNodeId: string
): Array<FactorInfluence & { paths: PathInfo[] }> {
  const goalNode = graph.nodes.find(n => n.id === goalNodeId);
  if (!goalNode) {
    return [];
  }

  const edgeLookup = buildEdgeLookup(graph.edges);
  const factorNodes = graph.nodes.filter(n => n.kind === 'factor');

  const results: Array<{
    factor: EngineNodeV3;
    influence: number;
    confidence: number;
    paths: PathInfo[];
  }> = [];

  for (const factor of factorNodes) {
    if (factor.id === goalNodeId) continue;

    const paths = findAllPathsToGoal(edgeLookup, factor.id, goalNodeId);
    const { influence, confidence } = computeInfluenceFromPaths(paths);

    results.push({ factor, influence, confidence, paths });
  }

  const maxAbsInfluence = Math.max(
    ...results.map(r => Math.abs(r.influence)),
    0.001
  );

  const output = results.map(({ factor, influence, confidence, paths }) => ({
    factor_id: factor.id,
    label: factor.label,
    influence,
    normalised_influence: Math.abs(influence) / maxAbsInfluence,
    confidence,
    direction: (influence >= 0 ? 'positive' : 'negative') as 'positive' | 'negative',
    paths,
  }));

  output.sort((a, b) => Math.abs(b.influence) - Math.abs(a.influence));

  return output;
}

// -----------------------------------------------------------------------------
// Value of Information (VOI) Computation
// -----------------------------------------------------------------------------

/**
 * Compute Value of Information for a factor.
 *
 * Heuristic VOI proxy (v1) - not formal EVPI.
 *
 * Formula: |sensitivity_score| × (1 - confidence) × decision_fragility
 *
 * Where decision_fragility = max marginal_switch_probability for fragile edges
 * where this factor is from_id or to_id.
 *
 * @param factorId Factor node ID
 * @param sensitivityScore Factor's sensitivity score (or influence_score as fallback)
 * @param confidence Factor's confidence (0-1), defaults to 0.5 if missing
 * @param fragileEdges Array of fragile edges from robustness analysis
 * @returns VOI value clamped to [0, 1]
 */
export function computeValueOfInformation(
  factorId: string,
  sensitivityScore: number | undefined,
  confidence: number | undefined,
  fragileEdges: FragileEdgeForVoi[] | undefined
): number {
  // Handle missing inputs gracefully
  if (!fragileEdges || fragileEdges.length === 0) {
    return 0;
  }

  const effectiveSensitivity = sensitivityScore ?? 0;
  const effectiveConfidence = confidence ?? 0.5;

  // Find max marginal_switch_probability for edges adjacent to this factor
  // Use from_id/to_id equality matching (NOT string contains)
  let decisionFragility = 0;
  for (const edge of fragileEdges) {
    if (edge.from_id === factorId || edge.to_id === factorId) {
      const marginal = edge.marginal_switch_probability ?? 0;
      if (marginal > decisionFragility) {
        decisionFragility = marginal;
      }
    }
  }

  // Factor not adjacent to any fragile edge → VOI = 0
  if (decisionFragility === 0) {
    return 0;
  }

  // Compute VOI: |sensitivity| × (1 - confidence) × fragility
  const voi = Math.abs(effectiveSensitivity) * (1 - effectiveConfidence) * decisionFragility;

  // Clamp to [0, 1]
  return Math.max(0, Math.min(1, voi));
}

/**
 * Compute flip risk category for a factor based on adjacent fragile edges.
 *
 * Categories:
 * - 'isolated': This factor alone can flip the recommendation (max marginal_switch_probability > 0.05)
 * - 'correlated': This factor can flip in combination with others (max switch_probability > 0.05, marginal <= 0.05)
 * - 'negligible': Minimal flip risk (both probabilities <= 0.05 or no adjacent fragile edges)
 *
 * @param factorId Factor node ID
 * @param fragileEdges Array of fragile edges from robustness analysis
 * @returns Flip risk category
 */
export function computeFlipRiskCategory(
  factorId: string,
  fragileEdges: FragileEdgeForVoi[] | undefined
): 'isolated' | 'correlated' | 'negligible' {
  if (!fragileEdges || fragileEdges.length === 0) {
    return 'negligible';
  }

  // Find max switch_probability and max marginal_switch_probability for edges adjacent to this factor
  let maxSwitchProb = 0;
  let maxMarginalProb = 0;

  for (const edge of fragileEdges) {
    if (edge.from_id === factorId || edge.to_id === factorId) {
      const switchProb = edge.switch_probability ?? 0;
      const marginalProb = edge.marginal_switch_probability ?? 0;

      if (switchProb > maxSwitchProb) {
        maxSwitchProb = switchProb;
      }
      if (marginalProb > maxMarginalProb) {
        maxMarginalProb = marginalProb;
      }
    }
  }

  // Threshold for significant flip risk
  const FLIP_THRESHOLD = 0.05;

  // 'isolated' if marginal > threshold (factor alone can flip)
  if (maxMarginalProb > FLIP_THRESHOLD) {
    return 'isolated';
  }

  // 'correlated' if switch > threshold (factor can flip in combination)
  if (maxSwitchProb > FLIP_THRESHOLD) {
    return 'correlated';
  }

  // Otherwise negligible
  return 'negligible';
}

// -----------------------------------------------------------------------------
// Wrapper for v2/run response format
// -----------------------------------------------------------------------------

/**
 * Compute factor sensitivity from graph structure.
 *
 * This is the primary source for factor sensitivity - ISL is the fallback.
 * Maps FactorInfluence output to FactorSensitivityResultV3 format.
 *
 * @param graph Graph with nodes and edges
 * @param goalNodeId Target goal node ID
 * @param fragileEdges Optional fragile edges for VOI computation
 * @returns Array of factor sensitivity results, or null if computation fails/empty
 */
export function computeFactorSensitivityFromGraph(
  graph: EngineGraphV3,
  goalNodeId: string,
  fragileEdges?: FragileEdgeForVoi[]
): FactorSensitivityResultV3[] | null {
  // Compute using the core algorithm
  const influences = computeFactorInfluence(graph, goalNodeId);

  // Return null if no factors found (triggers ISL fallback)
  if (influences.length === 0) {
    return null;
  }

  // Map to FactorSensitivityResultV3 format
  return influences.map((f, index) => ({
    // Core identification
    factor_id: f.factor_id,
    factor_label: f.label || undefined,

    // Influence from graph calculation
    influence_score: f.normalised_influence,
    influence_rank: index + 1, // 1-indexed rank (already sorted by |influence|)

    // Map influence to sensitivity_score (raw total causal effect)
    sensitivity_score: f.influence,

    // Elasticity is the normalized influence (same as influence_score for graph-based)
    elasticity: f.normalised_influence,

    // Direction from sign of influence
    direction: f.direction,

    // Importance rank same as influence rank for graph-based
    importance_rank: index + 1,

    // Graph-based doesn't provide interpretation text
    interpretation: undefined,

    // Heuristic VOI proxy (v1) - not formal EVPI
    // Formula: |sensitivity| × (1 - confidence) × decision_fragility
    value_of_information: computeValueOfInformation(
      f.factor_id,
      f.normalised_influence, // Use normalised influence as sensitivity proxy
      f.confidence,
      fragileEdges
    ),

    // Confidence from edge path analysis
    confidence: f.confidence,

    // Zero reason for factors with no path to goal
    zero_reason: f.influence === 0 && f.confidence === 0
      ? 'no_path_to_goal'
      : undefined,

    // Mark source as graph-based
    source: 'graph' as const,

    // Flip risk category based on fragile edge adjacency
    flip_risk_category: computeFlipRiskCategory(f.factor_id, fragileEdges),
  }));
}

// -----------------------------------------------------------------------------
// 3C: ISL stability fields — source-scoping guard
// -----------------------------------------------------------------------------

/**
 * @deprecated No longer called — 3C stability fields are only valid for
 * ISL-sourced sensitivity entries. Graph-derived and ISL elasticity use
 * different scales — mixing them produces contradictory output
 * (e.g., elasticity=1.0 with attribution_stability="negligible").
 *
 * Retained as a no-op guard to prevent future reintroduction.
 * If you need 3C fields on graph entries, the underlying elasticity
 * definitions must first be reconciled (ISL perturbation-based vs
 * graph structural influence).
 */
export function enrichGraphFactorsWithISL3C(
  graphFactors: FactorSensitivityResultV3[],
  _islFactors: FactorSensitivityResultV3[] | undefined
): FactorSensitivityResultV3[] {
  // Guard: never attach ISL 3C fields to non-ISL-source entries.
  return graphFactors;
}
