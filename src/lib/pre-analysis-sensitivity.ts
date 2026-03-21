/**
 * Pre-Analysis Sensitivity — Linear Path Approximation
 *
 * Computes approximate factor and edge influence without running a full MC
 * simulation. Uses the same path-based algorithm as factor-influence.ts but
 * returns the result in the PreAnalysisSensitivity wire format.
 *
 * Method: For each factor, find all directed paths to the goal node and
 * compute the product of edge strength.mean along each path. The sum of
 * absolute path effects gives the total influence (sign-cancellation-free
 * for stable ranking). Edge influence is the maximum
 * contribution any single edge makes across all paths.
 *
 * Performance: O(V × E) in practice (bounded by MAX_PATH_DEPTH = 10).
 * Target: <500ms for graphs up to 20 nodes.
 *
 * Reduced MC fallback: The interface supports method: 'linear' | 'reduced_mc'.
 * Currently only 'linear' is implemented. For ranking purposes (which is all
 * the UI pre-analysis tab needs), linear approximation is sufficient. A
 * reduced_mc path (100 samples) would be needed only if graphs contain
 * non-linear edge functions — those are not yet supported by the ISL engine.
 * When/if non-linear edges are added, this module should detect them and
 * switch to reduced_mc automatically.
 */

import type {
  EngineGraphV3,
  EngineEdgeV3,
  PreAnalysisSensitivity,
  ContestedEdgeInput,
  EVOIEdgeResult,
  EVOIResult,
} from '../types/engine-v3.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_PATH_DEPTH = 10;
const MIN_EXISTS_PROBABILITY = 0.01;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface EdgeInfo {
  from: string;
  to: string;
  strength_mean: number;
  exists_probability: number;
}

interface PathResult {
  effect: number;
  edges: EdgeInfo[];
}

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

function buildAdjacency(edges: EngineEdgeV3[]): Map<string, EdgeInfo[]> {
  const adj = new Map<string, EdgeInfo[]>();
  for (const e of edges) {
    if (e.exists_probability < MIN_EXISTS_PROBABILITY) continue;
    if (e.edge_type === 'bidirected') continue; // Skip non-causal edges
    const info: EdgeInfo = {
      from: e.from,
      to: e.to,
      strength_mean: e.strength.mean,
      exists_probability: e.exists_probability,
    };
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(info);
  }
  return adj;
}

/**
 * DFS to find all paths from `source` to `goal`, returning accumulated
 * path effect and the edges traversed.
 */
function findPaths(
  adj: Map<string, EdgeInfo[]>,
  source: string,
  goal: string,
): PathResult[] {
  const results: PathResult[] = [];

  function dfs(node: string, visited: Set<string>, effect: number, edges: EdgeInfo[]): void {
    if (node === goal) {
      results.push({ effect, edges: [...edges] });
      return;
    }
    if (visited.size >= MAX_PATH_DEPTH) return;
    const neighbours = adj.get(node);
    if (!neighbours) return;
    for (const e of neighbours) {
      if (visited.has(e.to)) continue;
      visited.add(e.to);
      edges.push(e);
      dfs(e.to, visited, effect * e.strength_mean, edges);
      edges.pop();
      visited.delete(e.to);
    }
  }

  const visited = new Set<string>([source]);
  dfs(source, visited, 1, []);
  return results;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute pre-analysis factor and edge influence via linear path approximation.
 *
 * @param graph  Normalised EngineGraphV3
 * @param goalNodeId  The goal node to compute influence towards
 * @returns PreAnalysisSensitivity with normalised factor & edge influence
 */
export function computePreAnalysisSensitivity(
  graph: EngineGraphV3,
  goalNodeId: string,
): PreAnalysisSensitivity {
  const t0 = Date.now();

  const adj = buildAdjacency(graph.edges);

  // --- Factor influence ---
  const rawFactorInfluence = new Map<string, number>();
  // --- Edge influence accumulator: edge_id → max |contribution| across all paths ---
  const rawEdgeInfluence = new Map<string, number>();

  const factorNodes = graph.nodes.filter(n => n.kind === 'factor' && n.id !== goalNodeId);

  for (const factor of factorNodes) {
    const paths = findPaths(adj, factor.id, goalNodeId);
    // Use sum of absolute path effects for ranking stability.
    // Avoids sign cancellation when a factor has opposing paths (e.g.,
    // price → revenue = +0.7 and price → churn → revenue = -0.3).
    // For ranking "which factors matter most", total absolute contribution
    // is more informative than net signed effect.
    let totalAbsInfluence = 0;
    for (const p of paths) {
      totalAbsInfluence += Math.abs(p.effect);
      // Attribute the path effect to each edge in the path.
      // An edge's influence is the max absolute path effect it participates in.
      for (const e of p.edges) {
        const edgeId = `${e.from}::${e.to}`;
        const prev = rawEdgeInfluence.get(edgeId) ?? 0;
        if (Math.abs(p.effect) > prev) {
          rawEdgeInfluence.set(edgeId, Math.abs(p.effect));
        }
      }
    }
    rawFactorInfluence.set(factor.id, totalAbsInfluence);
  }

  // --- Normalise factor influence to [0, 1] ---
  // Values are already absolute (sum of |path effects|), so no Math.abs needed.
  const maxFactorAbs = Math.max(
    ...Array.from(rawFactorInfluence.values()),
    1e-9,
  );
  const factor_influence: Record<string, number> = {};
  for (const [id, val] of rawFactorInfluence) {
    factor_influence[id] = val / maxFactorAbs;
  }

  // --- Normalise edge influence to [0, 1] ---
  const maxEdgeAbs = Math.max(
    ...Array.from(rawEdgeInfluence.values()),
    1e-9,
  );
  const edge_influence: Record<string, number> = {};
  for (const [id, val] of rawEdgeInfluence) {
    edge_influence[id] = val / maxEdgeAbs;
  }

  return {
    factor_influence,
    edge_influence,
    method: 'linear',
    computation_ms: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// EVOI computation
// ---------------------------------------------------------------------------

// Re-export canonical types for consumers
export type { ContestedEdgeInput as ContestedEdge, EVOIEdgeResult as EVOIEdge } from '../types/engine-v3.js';

/**
 * Compute Expected Value of Information for contested edges.
 *
 * Uses the linear approximation: evoi_impact ≈ edge_influence × |pass1 - pass2|.
 * The edge_influence is computed from the pre-analysis sensitivity.
 *
 * @param graph           Normalised graph
 * @param goalNodeId      Goal node
 * @param contestedEdges  Edges with divergent pass1/pass2 strengths
 * @returns EVOIResult with sorted edges and computation time
 */
export function computeEVOI(
  graph: EngineGraphV3,
  goalNodeId: string,
  contestedEdges: ContestedEdgeInput[],
): EVOIResult {
  const t0 = Date.now();

  // Compute edge influence via linear approximation
  const sensitivity = computePreAnalysisSensitivity(graph, goalNodeId);

  const results: EVOIEdgeResult[] = contestedEdges.map(ce => {
    const influence = sensitivity.edge_influence[ce.edge_id] ?? 0;
    const divergence = Math.abs(ce.pass1_strength - ce.pass2_strength);
    return {
      edge_id: ce.edge_id,
      evoi_impact: influence * divergence,
      evoi_rank: 0, // assigned after sort
    };
  });

  // Sort by evoi_impact descending
  results.sort((a, b) => b.evoi_impact - a.evoi_impact);

  // Assign ranks (1-indexed)
  for (let i = 0; i < results.length; i++) {
    results[i].evoi_rank = i + 1;
  }

  return {
    edges: results,
    computation_ms: Date.now() - t0,
  };
}
