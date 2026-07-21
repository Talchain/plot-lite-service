/**
 * ISL Robustness Analysis Response Adapter
 *
 * Transforms ISL /api/v1/robustness/analyze/v2 responses to PLoT format.
 * Handles both edge sensitivity (existence + magnitude) and factor sensitivity.
 *
 * When `analysis_types` includes 'sensitivity', ISL returns edge sensitivity data
 * with separate entries for 'existence' and 'magnitude' sensitivity types.
 */

import type { ISLRobustnessAnalyzeV2Response, ISLEdgeSensitivityItem, ISLFragileEdgeInfo } from '../types/isl-types.js';
import type {
  PLoTRobustnessAnalysisResult,
  EdgeSensitivityEntry,
  FactorSensitivityEntry,
  VOIEntry,
  NormalizedEdgeInfo,
  EdgeNormalizationError,
} from '../types/plot-types.js';

// -----------------------------------------------------------------------------
// Edge ID Parsing Helpers
// -----------------------------------------------------------------------------

/**
 * Parse from/to node IDs from an edge ID string.
 * Supports both "->" and "::" separators.
 */
function parseEdgeId(edgeId: string): { from: string; to: string } {
  if (edgeId.includes('->')) {
    const [from, to] = edgeId.split('->');
    return { from: from ?? edgeId, to: to ?? edgeId };
  }
  if (edgeId.includes('::')) {
    const [from, to] = edgeId.split('::');
    return { from: from ?? edgeId, to: to ?? edgeId };
  }
  // Fallback: return edge_id as both from and to (shouldn't happen)
  return { from: edgeId, to: edgeId };
}

// -----------------------------------------------------------------------------
// Edge Normalization
// -----------------------------------------------------------------------------

/**
 * Result of edge normalization with errors tracked.
 * @public Exported for use in route handlers.
 */
export interface NormalizationResult {
  edges: NormalizedEdgeInfo[];
  errors: EdgeNormalizationError[];
}

/**
 * Normalize a fragile edge from ISL format to consistent object shape.
 * ISL returns fragile_edges as objects with edge_id, from_id, to_id, switch_probability.
 */
function normalizeFragileEdge(edge: ISLFragileEdgeInfo): NormalizedEdgeInfo {
  const parsed = parseEdgeId(edge.edge_id);
  return {
    edge_id: edge.edge_id,
    from_id: edge.from_id ?? parsed.from,
    to_id: edge.to_id ?? parsed.to,
    // switch_probability: emit ONLY when ISL provides a finite value. Absent ≠ 0
    // — a fabricated 0 fabricates BOTH severity ('warning') and the doctrine-013
    // `visible` flag (false) downstream. Omit honestly when ISL omits it.
    ...(typeof edge.switch_probability === 'number' && Number.isFinite(edge.switch_probability)
      ? { switch_probability: edge.switch_probability }
      : {}),
    // Passthrough marginal_switch_probability from ISL (optional field)
    ...(edge.marginal_switch_probability !== undefined
      ? { marginal_switch_probability: edge.marginal_switch_probability }
      : {}),
    // Preserve alternative_winner_id from ISL for label resolution downstream
    ...(edge.alternative_winner_id ? { alternative_winner_id: edge.alternative_winner_id } : {}),
  };
}

/**
 * Normalize a robust edge from ISL format to consistent object shape.
 * ISL returns robust_edges as strings in "from->to" format.
 */
function normalizeRobustEdge(edgeId: string): NormalizedEdgeInfo {
  const parsed = parseEdgeId(edgeId);
  return {
    edge_id: edgeId,
    from_id: parsed.from,
    to_id: parsed.to,
    switch_probability: 1, // Robust edges have 100% stability
  };
}

/**
 * Safely normalize fragile edges array with defensive handling.
 * Handles both object format (expected) and string format (legacy fallback).
 * Collects errors for observability instead of silently dropping.
 *
 * @public Exported for use in route handlers.
 */
export function normalizeFragileEdges(
  edges: unknown[] | undefined,
  requestId?: string
): NormalizationResult {
  const result: NormalizationResult = { edges: [], errors: [] };
  if (!Array.isArray(edges)) return result;

  for (const edge of edges) {
    try {
      // Object format (expected from ISL)
      if (typeof edge === 'object' && edge !== null && 'edge_id' in edge) {
        result.edges.push(normalizeFragileEdge(edge as ISLFragileEdgeInfo));
        continue;
      }
      // String format (legacy fallback)
      if (typeof edge === 'string') {
        const parsed = parseEdgeId(edge);
        // Legacy STRING fragile edges carry NO switch_probability data — omit it
        // (honest) rather than fabricate 0, which would fabricate severity
        // ('warning') and the doctrine-013 `visible` flag (false) downstream.
        result.edges.push({
          edge_id: edge,
          from_id: parsed.from,
          to_id: parsed.to,
        });
        continue;
      }
      // Unknown format - track error
      const errorMsg = `Unexpected fragile_edge format: ${typeof edge}`;
      console.warn(JSON.stringify({
        event: 'edge_normalization_error',
        request_id: requestId,
        edge_type: 'fragile',
        error: errorMsg,
        raw_type: typeof edge,
      }));
      result.errors.push({ edge_type: 'fragile', error: errorMsg, raw_value: edge });
    } catch (err) {
      const errorMsg = `Error normalizing fragile_edge: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(JSON.stringify({
        event: 'edge_normalization_error',
        request_id: requestId,
        edge_type: 'fragile',
        error: errorMsg,
      }));
      result.errors.push({ edge_type: 'fragile', error: errorMsg, raw_value: edge });
    }
  }
  return result;
}

/**
 * Safely normalize robust edges array with defensive handling.
 * Handles both string format (expected) and object format (fallback).
 * Collects errors for observability instead of silently dropping.
 *
 * @public Exported for use in route handlers.
 */
export function normalizeRobustEdges(
  edges: unknown[] | undefined,
  requestId?: string
): NormalizationResult {
  const result: NormalizationResult = { edges: [], errors: [] };
  if (!Array.isArray(edges)) return result;

  for (const edge of edges) {
    try {
      // String format (expected from ISL)
      if (typeof edge === 'string') {
        result.edges.push(normalizeRobustEdge(edge));
        continue;
      }
      // Object format (fallback - treat like fragile but with switch_probability=1)
      if (typeof edge === 'object' && edge !== null && 'edge_id' in edge) {
        const objEdge = edge as ISLFragileEdgeInfo;
        const parsed = parseEdgeId(objEdge.edge_id);
        result.edges.push({
          edge_id: objEdge.edge_id,
          from_id: objEdge.from_id ?? parsed.from,
          to_id: objEdge.to_id ?? parsed.to,
          switch_probability: objEdge.switch_probability ?? 1,
        });
        continue;
      }
      // Unknown format - track error
      const errorMsg = `Unexpected robust_edge format: ${typeof edge}`;
      console.warn(JSON.stringify({
        event: 'edge_normalization_error',
        request_id: requestId,
        edge_type: 'robust',
        error: errorMsg,
        raw_type: typeof edge,
      }));
      result.errors.push({ edge_type: 'robust', error: errorMsg, raw_value: edge });
    } catch (err) {
      const errorMsg = `Error normalizing robust_edge: ${err instanceof Error ? err.message : String(err)}`;
      console.warn(JSON.stringify({
        event: 'edge_normalization_error',
        request_id: requestId,
        edge_type: 'robust',
        error: errorMsg,
      }));
      result.errors.push({ edge_type: 'robust', error: errorMsg, raw_value: edge });
    }
  }
  return result;
}

// -----------------------------------------------------------------------------
// Level to Label Mapping
// -----------------------------------------------------------------------------

/**
 * Map ISL V2 (Option C) level to PLoT robustness label
 *
 * ISL V2 levels: 'high' | 'medium' | 'low' | 'very_low'
 * PLoT labels: 'robust' | 'moderate' | 'fragile'
 */
function mapLevelToLabel(
  level: 'high' | 'medium' | 'low' | 'very_low' | undefined
): 'robust' | 'moderate' | 'fragile' {
  switch (level) {
    case 'high':
      return 'robust';
    case 'medium':
      return 'moderate';
    case 'low':
    case 'very_low':
      return 'fragile';
    default:
      return 'moderate';
  }
}

/**
 * Transform ISL edge sensitivity item to PLoT format
 */
function transformEdgeSensitivity(item: ISLEdgeSensitivityItem): EdgeSensitivityEntry {
  return {
    edge_id: `${item.edge_from}::${item.edge_to}`,
    from: item.edge_from,
    to: item.edge_to,
    elasticity: item.elasticity,
    sensitivity_type: item.sensitivity_type,
    importance_rank: item.importance_rank,
    interpretation: item.interpretation,
  };
}

/**
 * Merge existence and magnitude sensitivity into combined edge entries
 *
 * Takes the higher absolute elasticity value for each edge, preserving
 * both separate arrays for detailed analysis.
 */
function mergeEdgeSensitivity(
  existenceItems: EdgeSensitivityEntry[],
  magnitudeItems: EdgeSensitivityEntry[]
): EdgeSensitivityEntry[] {
  const edgeMap = new Map<string, EdgeSensitivityEntry>();

  // Add existence items
  for (const item of existenceItems) {
    edgeMap.set(item.edge_id, { ...item });
  }

  // Merge magnitude items, taking higher absolute elasticity
  for (const item of magnitudeItems) {
    const existing = edgeMap.get(item.edge_id);
    if (!existing || Math.abs(item.elasticity) > Math.abs(existing.elasticity)) {
      edgeMap.set(item.edge_id, { ...item });
    }
  }

  // Sort by absolute elasticity descending
  return Array.from(edgeMap.values()).sort(
    (a, b) => Math.abs(b.elasticity) - Math.abs(a.elasticity)
  );
}

/**
 * Transform ISL robustness/analyze/v2 response to PLoT format
 *
 * @param isl - Raw ISL robustness analysis response
 * @param latencyMs - Request latency in milliseconds
 * @param edgeStatus - Status of edge sensitivity analysis
 * @param factorStatus - Status of factor sensitivity analysis
 * @param requestId - Request ID for log correlation (optional)
 * @returns PLoT-formatted robustness analysis result
 *
 * @example
 * ```typescript
 * const islResponse = await islClient.request<ISLRobustnessAnalyzeV2Response>(...);
 * const plotResult = adaptRobustnessAnalysisResponse(
 *   islResponse,
 *   280,
 *   'available',
 *   'available',
 *   'req-123'
 * );
 * ```
 */
export function adaptRobustnessAnalysisResponse(
  isl: ISLRobustnessAnalyzeV2Response,
  latencyMs: number,
  edgeStatus: PLoTRobustnessAnalysisResult['edge_sensitivity_status'],
  factorStatus: PLoTRobustnessAnalysisResult['factor_sensitivity_status'],
  requestId?: string
): PLoTRobustnessAnalysisResult {
  // Transform edge sensitivity - separate by type
  const allEdges = (isl.sensitivity ?? []).map(transformEdgeSensitivity);
  const existenceEdges = allEdges.filter((e) => e.sensitivity_type === 'existence');
  const magnitudeEdges = allEdges.filter((e) => e.sensitivity_type === 'magnitude');

  // Merge into combined array
  const mergedEdges = mergeEdgeSensitivity(existenceEdges, magnitudeEdges);

  // Transform factor sensitivity
  // Filter out items without valid numeric sensitivity (Schema v2.6 uses sensitivity_score, legacy uses sensitivity)
  const factors: FactorSensitivityEntry[] = (isl.factor_sensitivity ?? [])
    .filter((item) => {
      const sensitivity = item.sensitivity_score ?? item.sensitivity;
      return typeof sensitivity === 'number';
    })
    .map((item) => ({
      factor_id: item.node_id,
      sensitivity_score: (item.sensitivity_score ?? item.sensitivity) as number,
      direction: item.direction ?? 'mixed',
    }));

  // Sort factors by absolute sensitivity descending
  factors.sort((a, b) => Math.abs(b.sensitivity_score) - Math.abs(a.sensitivity_score));

  // Transform value of information
  // Filter out items without valid numeric value_of_information
  const voiEntries: VOIEntry[] = (isl.factor_sensitivity ?? [])
    .filter((item) => typeof item.value_of_information === 'number' && item.value_of_information > 0)
    .map((item) => ({
      factor_id: item.node_id,
      voi: item.value_of_information as number,
    }))
    .sort((a, b) => b.voi - a.voi);

  // Extract robustness data - normalize V2 (Option C) format to PLoT format
  // V1: { score, label: 'robust'|'moderate'|'fragile' }
  // V2: { confidence, level: 'high'|'medium'|'low'|'very_low' }
  const rawRobustness = isl.robustness ?? {};

  // Normalize edges with error tracking
  const fragileResult = normalizeFragileEdges(rawRobustness.fragile_edges as unknown[], requestId);
  const robustResult = normalizeRobustEdges(rawRobustness.robust_edges as unknown[], requestId);
  const normalizationErrors = [...fragileResult.errors, ...robustResult.errors];

  const robustness = {
    score: rawRobustness.score ?? rawRobustness.confidence ?? 0.5,
    label: rawRobustness.label ?? mapLevelToLabel(rawRobustness.level),
    fragile_edges: fragileResult.edges,
    robust_edges: robustResult.edges,
  };

  const result: PLoTRobustnessAnalysisResult = {
    // Edge sensitivity
    edges: mergedEdges,
    edges_existence: existenceEdges.length > 0 ? existenceEdges : undefined,
    edges_magnitude: magnitudeEdges.length > 0 ? magnitudeEdges : undefined,
    edges_provenance: 'isl:/api/v1/robustness/analyze/v2',
    edge_sensitivity_status: edgeStatus,

    // Factor sensitivity
    factors,
    value_of_information: voiEntries,
    factors_provenance: factors.length > 0 ? 'isl:/api/v1/robustness/analyze/v2' : 'unavailable',
    factor_sensitivity_status: factorStatus,

    // Robustness
    overall_robustness: robustness.label,
    robustness_score: robustness.score,
    fragile_edges: robustness.fragile_edges,
    robust_edges: robustness.robust_edges,

    // Metadata
    latency_ms: latencyMs,
    source: 'isl',
  };

  // Include normalization errors if any occurred
  if (normalizationErrors.length > 0) {
    result.normalization_errors = normalizationErrors;
  }

  return result;
}

/**
 * Create a fallback robustness analysis result when ISL is unavailable
 *
 * @param reason - Why fallback is being used
 * @param edgeStatus - Status of edge sensitivity analysis
 * @param factorStatus - Status of factor sensitivity analysis
 * @returns Fallback robustness analysis result
 */
export function createFallbackRobustnessAnalysis(
  reason: string,
  edgeStatus: PLoTRobustnessAnalysisResult['edge_sensitivity_status'] = 'failed',
  factorStatus: PLoTRobustnessAnalysisResult['factor_sensitivity_status'] = 'failed'
): PLoTRobustnessAnalysisResult {
  return {
    // Edge sensitivity - empty
    edges: [],
    edges_provenance: 'plot:computeSensitivityAll',
    edge_sensitivity_status: edgeStatus,

    // Factor sensitivity - empty
    factors: [],
    value_of_information: [],
    factors_provenance: 'unavailable',
    factor_sensitivity_status: factorStatus,

    // Robustness - default moderate
    overall_robustness: 'moderate',
    robustness_score: 0.5,
    fragile_edges: [],
    robust_edges: [],

    // Metadata
    latency_ms: 0,
    source: 'unavailable',
  };
}

/**
 * Create result with local heuristic fallback for edge sensitivity
 *
 * Used when ISL call fails but we have local computeSensitivityAll results.
 *
 * @param localEdges - Edge sensitivity from local heuristic
 * @param latencyMs - Local computation latency
 * @returns Result with local edge sensitivity
 */
export function createLocalHeuristicResult(
  localEdges: EdgeSensitivityEntry[],
  latencyMs: number
): PLoTRobustnessAnalysisResult {
  return {
    // Edge sensitivity from local heuristic
    edges: localEdges,
    edges_provenance: 'plot:computeSensitivityAll',
    edge_sensitivity_status: 'fallback_local_heuristic',

    // Factor sensitivity - unavailable with local fallback
    factors: [],
    value_of_information: [],
    factors_provenance: 'unavailable',
    factor_sensitivity_status: 'skipped_no_parameter_uncertainties',

    // Robustness - derive from local edges
    overall_robustness: deriveRobustnessFromEdges(localEdges),
    robustness_score: deriveRobustnessScore(localEdges),
    fragile_edges: localEdges
      .filter((e) => Math.abs(e.elasticity) > 0.5)
      .map((e): NormalizedEdgeInfo => ({
        edge_id: e.edge_id,
        from_id: e.from,
        to_id: e.to,
        switch_probability: 1 - Math.min(1, Math.abs(e.elasticity)), // Higher elasticity = lower stability
      })),
    robust_edges: localEdges
      .filter((e) => Math.abs(e.elasticity) <= 0.2)
      .map((e): NormalizedEdgeInfo => ({
        edge_id: e.edge_id,
        from_id: e.from,
        to_id: e.to,
        switch_probability: 1, // Robust edges have full stability
      })),

    // Metadata
    latency_ms: latencyMs,
    source: 'unavailable',
  };
}

/**
 * Derive robustness label from edge sensitivity scores
 */
function deriveRobustnessFromEdges(
  edges: EdgeSensitivityEntry[]
): 'robust' | 'moderate' | 'fragile' {
  if (edges.length === 0) return 'moderate';

  const maxElasticity = Math.max(...edges.map((e) => Math.abs(e.elasticity)));

  if (maxElasticity > 0.7) return 'fragile';
  if (maxElasticity > 0.4) return 'moderate';
  return 'robust';
}

/**
 * Derive robustness score from edge sensitivity
 */
function deriveRobustnessScore(edges: EdgeSensitivityEntry[]): number {
  if (edges.length === 0) return 0.5;

  const avgElasticity = edges.reduce((sum, e) => sum + Math.abs(e.elasticity), 0) / edges.length;

  // Invert: high elasticity = low robustness
  return Math.max(0, Math.min(1, 1 - avgElasticity));
}
