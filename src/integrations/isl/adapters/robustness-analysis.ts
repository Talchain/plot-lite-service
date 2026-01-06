/**
 * ISL Robustness Analysis Response Adapter
 *
 * Transforms ISL /api/v1/robustness/analyze/v2 responses to PLoT format.
 * Handles both edge sensitivity (existence + magnitude) and factor sensitivity.
 *
 * When `analysis_types` includes 'sensitivity', ISL returns edge sensitivity data
 * with separate entries for 'existence' and 'magnitude' sensitivity types.
 */

import type { ISLRobustnessAnalyzeV2Response, ISLEdgeSensitivityItem } from '../types/isl-types.js';
import type {
  PLoTRobustnessAnalysisResult,
  EdgeSensitivityEntry,
  FactorSensitivityEntry,
  VOIEntry,
} from '../types/plot-types.js';

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
 * @returns PLoT-formatted robustness analysis result
 *
 * @example
 * ```typescript
 * const islResponse = await islClient.request<ISLRobustnessAnalyzeV2Response>(...);
 * const plotResult = adaptRobustnessAnalysisResponse(
 *   islResponse,
 *   280,
 *   'available',
 *   'available'
 * );
 * ```
 */
export function adaptRobustnessAnalysisResponse(
  isl: ISLRobustnessAnalyzeV2Response,
  latencyMs: number,
  edgeStatus: PLoTRobustnessAnalysisResult['edge_sensitivity_status'],
  factorStatus: PLoTRobustnessAnalysisResult['factor_sensitivity_status']
): PLoTRobustnessAnalysisResult {
  // Transform edge sensitivity - separate by type
  const allEdges = (isl.sensitivity ?? []).map(transformEdgeSensitivity);
  const existenceEdges = allEdges.filter((e) => e.sensitivity_type === 'existence');
  const magnitudeEdges = allEdges.filter((e) => e.sensitivity_type === 'magnitude');

  // Merge into combined array
  const mergedEdges = mergeEdgeSensitivity(existenceEdges, magnitudeEdges);

  // Transform factor sensitivity
  const factors: FactorSensitivityEntry[] = (isl.factor_sensitivity ?? []).map((item) => ({
    factor_id: item.node_id,
    sensitivity_score: item.sensitivity,
    direction: item.direction ?? 'mixed',
  }));

  // Sort factors by absolute sensitivity descending
  factors.sort((a, b) => Math.abs(b.sensitivity_score) - Math.abs(a.sensitivity_score));

  // Transform value of information
  const voiEntries: VOIEntry[] = (isl.factor_sensitivity ?? [])
    .filter((item) => item.value_of_information > 0)
    .map((item) => ({
      factor_id: item.node_id,
      voi: item.value_of_information,
    }))
    .sort((a, b) => b.voi - a.voi);

  // Extract robustness data - normalize V2 (Option C) format to PLoT format
  // V1: { score, label: 'robust'|'moderate'|'fragile' }
  // V2: { confidence, level: 'high'|'medium'|'low'|'very_low' }
  const rawRobustness = isl.robustness ?? {};
  const robustness = {
    score: rawRobustness.score ?? rawRobustness.confidence ?? 0.5,
    label: rawRobustness.label ?? mapLevelToLabel(rawRobustness.level),
    fragile_edges: rawRobustness.fragile_edges ?? [],
    robust_edges: rawRobustness.robust_edges ?? [],
  };

  return {
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
    fragile_edges: robustness.fragile_edges ?? [],
    robust_edges: robustness.robust_edges ?? [],

    // Metadata
    latency_ms: latencyMs,
    source: 'isl',
  };
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
    fragile_edges: localEdges.filter((e) => Math.abs(e.elasticity) > 0.5).map((e) => e.edge_id),
    robust_edges: localEdges.filter((e) => Math.abs(e.elasticity) <= 0.2).map((e) => e.edge_id),

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
