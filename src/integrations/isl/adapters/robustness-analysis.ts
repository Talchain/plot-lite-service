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
import { isFiniteNumber, finiteNum } from '../../../util/numeric.js';

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
    ...(isFiniteNumber(edge.switch_probability)
      ? { switch_probability: edge.switch_probability }
      : {}),
    // marginal_switch_probability: same rule as switch_probability above.
    // `!== undefined` admits a null straight through to egress, where
    // @talchain/schemas 0.22.0 types this `z.number().optional()` and a null
    // FAILS validation. Not reachable on the pinned V2 path — ISL's V2 handler
    // serialises with `model_dump(by_alias=True, exclude_none=True)`, which is
    // recursive, so a null is OMITTED rather than sent, and PLoT pins that path
    // on every call (client.ts:98 `?response_version=2`, :180
    // `X-ISL-Response-Version: 2`). It arms the day that pin changes, which is
    // exactly the asymmetry #278 documented: a guard that costs nothing now and
    // closes a class later.
    ...(isFiniteNumber(edge.marginal_switch_probability)
      ? { marginal_switch_probability: edge.marginal_switch_probability }
      : {}),
    // Preserve alternative_winner_id from ISL for label resolution downstream
    ...(edge.alternative_winner_id ? { alternative_winner_id: edge.alternative_winner_id } : {}),
  };
}

/**
 * Normalize a robust edge from ISL format to consistent object shape.
 * ISL returns robust_edges as strings in "from->to" format.
 *
 * ✅ FABRICATION REMOVED — the cross-repo blocker is CLOSED (ROADMAP 2.160,
 * 2026-07-30). History is kept because the reasoning is the point.
 *
 * WHAT USED TO BE HERE: `switch_probability: 1`, MANUFACTURED. A bare
 * `"from->to"` string carries no measurement at all, and the 1 was manufactured
 * under the WRONG NAME: `switch_probability` is the probability that flipping
 * the edge switches the recommended option — `normalizeFragileEdge` feeds
 * exactly this field to `classifyEdgeSeverity` and to the doctrine-013
 * `visible` gate, where HIGHER means MORE fragile. "100% stability" would be
 * switch_probability ≈ 0. So it was absent data rendered as the MAXIMUM of an
 * INVERTED scale — the most alarming possible reading of "we have no number".
 *
 * WHY IT COULD NOT BE FIXED HERE AT THE TIME: omitting it (attempted and
 * measured by the earlier lane) made every /v2/run response fail its own egress
 * contract, because `@talchain/schemas` up to 0.22.0 declared
 * `EnrichmentRobustnessEdgeSchema.switch_probability: z.number()` REQUIRED for
 * robust_edges as well as fragile_edges. Trading a wrong number for a standing
 * false alarm on a fail-open guard is the broken-alarm trap, so that lane
 * reverted the omission and reported the blocker (plot-lite-service#278)
 * instead of quietly fabricating OR quietly breaking the contract. It also
 * recorded the exact close condition, which is what made this fix a two-line
 * change instead of a re-investigation.
 *
 * HOW IT CLOSED: olumi-schemas **0.28.0** relaxed the field to
 * `switch_probability: z.number().optional()` — expressly citing
 * plot-lite-service#278 — and its own note now records that the required-ness
 * "was a latent disagreement, not an invariant anyone honoured" (PLoT's
 * `NormalizedEdgeInfoV3.switch_probability?: number` had been optional all
 * along, and `normalizeFragileEdge` already omitted it on that basis). The
 * vendored tarball here is now 0.30.0, so the precondition is satisfied at the
 * bytes and the omission below is contract-legal.
 *
 * CONSEQUENCE FOR CONSUMERS — absent means NOT COMPUTED, never 0 and never 1.
 * A consumer MUST branch on presence (`typeof x === 'number'`) and must omit
 * anything derived from it (severity, the doctrine-013 `visible` gate, ranking
 * position) rather than derive it from a substitute. Coalescing (`?? 0`,
 * `|| 0`, `?? 1`) re-creates the fabrication at the reader.
 *
 * Pinned by tests/gates/numeric-safety-deep-scan.test.ts §D3 (the previously
 * skipped case is now live, and its inverse — the old fabricated `1` — is
 * asserted absent).
 */
function normalizeRobustEdge(edgeId: string): NormalizedEdgeInfo {
  const parsed = parseEdgeId(edgeId);
  // switch_probability is deliberately OMITTED: a bare "from->to" string
  // carries no measurement, and absent is the honest representation of that.
  return {
    edge_id: edgeId,
    from_id: parsed.from,
    to_id: parsed.to,
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
  // ── Fragility ORDER (lane PLoT importance-authority, 25 Jul 2026) ──
  //
  // ISL emits `fragile_edges` in an order that is NOT fragility order. Live on
  // plot-lite-service-staging build 1dd45b6 the array came back with
  // switch_probability [0.075, 0.281, 0.375, 0.487, 0.569, 0.61, 0.307] —
  // `[0]` was the LEAST fragile of seven and the maximum sat at index 5. PLoT
  // preserved that order verbatim, so every downstream `[0]` reader named the
  // least fragile edge as the most fragile. Confirmed consumers of the head of
  // this array, none of which sort it themselves:
  //   - PLoT  `src/assembly/decision-brief.ts` buildWhatWouldChange (presentation order)
  //   - PLoT  `src/routes/v2/run.ts` sensitive_parameters recommendations (.slice(0,3))
  //   - CEE   `src/cee/decision-review/decompose.ts` `fragileEdges[0]` → `stabilityHint.top_fragile_edge`
  //   - CEE   `src/orchestrator/context/analysis-compact.ts` deriveTopFragileEdges (.slice(0,3), no sort)
  //   - CEE   several `renderableFragileEdges(analysis)[0]` advice-gate sites that inherit that order
  // Consumers that already take a max/sort (PLoT `pickTopFragile`, CEE
  // `deriveTopFragileEdgesFromTopLevel`, `resolveCautionCandidate`) are
  // unaffected — sorting an already-max-first array is a no-op for them.
  //
  // Descending by switch_probability. Entries with NO switch_probability (the
  // legacy STRING format deliberately omits it rather than fabricating 0) sort
  // LAST, and never ahead of a measured edge. Ties and missing-vs-missing keep
  // their arrival order (stable sort, Node ≥ 11 guarantees stability), so this
  // is deterministic.
  sortByFragility(result.edges);
  return result;
}

/**
 * Sort fragile edges into FRAGILITY ORDER, in place, and return the array.
 *
 * THE ONE definition of that order. It was previously inlined inside
 * `normalizeFragileEdges`, which is why the two CEE-facing builders
 * (`buildRobustnessDataForCee`, `extractFragileEdges`) could forward ISL's raw
 * order without anything noticing: the fix lived where they could not reach
 * it. Exported so every outbound path shares one comparator rather than three
 * copies that can drift apart.
 *
 * Descending by `switch_probability`. Entries with none — the legacy STRING
 * format deliberately omits it rather than fabricating 0 — sort LAST and never
 * ahead of a measured edge. Ties, and missing-vs-missing, keep arrival order
 * (stable sort, guaranteed for Node >= 11), so the result is deterministic.
 */
export function sortByFragility<T extends { switch_probability?: number | null }>(
  edges: T[]
): T[] {
  return edges.sort((a, b) => {
    const pa = typeof a.switch_probability === 'number' && Number.isFinite(a.switch_probability)
      ? a.switch_probability : -Infinity;
    const pb = typeof b.switch_probability === 'number' && Number.isFinite(b.switch_probability)
      ? b.switch_probability : -Infinity;
    return pb - pa;
  });
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
      // Object format (fallback). switch_probability is FORWARDED when ISL
      // measured it and OMITTED otherwise (ROADMAP 1.240, sibling 3) — it used
      // to end `?? 1`, fabricating maximum switch probability from an absent
      // field, on the inverted scale described in normalizeRobustEdge above.
      // `isFiniteNumber` also rejects null/NaN/±Infinity, so this arm now
      // matches normalizeFragileEdge's admission rule exactly.
      if (typeof edge === 'object' && edge !== null && 'edge_id' in edge) {
        const objEdge = edge as ISLFragileEdgeInfo;
        const parsed = parseEdgeId(objEdge.edge_id);
        result.edges.push({
          edge_id: objEdge.edge_id,
          from_id: objEdge.from_id ?? parsed.from,
          to_id: objEdge.to_id ?? parsed.to,
          ...(isFiniteNumber(objEdge.switch_probability)
            ? { switch_probability: objEdge.switch_probability }
            : {}),
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

  // ROADMAP 1.240, sibling 2 — the two fabrications that used to live here.
  //
  //   score: rawRobustness.score ?? rawRobustness.confidence ?? 0.5
  //   label: rawRobustness.label ?? mapLevelToLabel(rawRobustness.level)
  //
  // `??` handles null correctly, so this was never the `!== undefined` bug —
  // it is the broader class: a plausible substitute standing in for a
  // measurement that does not exist. The `0.5` published "we assessed this
  // decision as exactly half robust" and the label default published
  // 'moderate' — `mapLevelToLabel`'s `default:` arm returns 'moderate' for
  // undefined, so an ISL response carrying NEITHER `label` NOR `level` was
  // rendered as a moderate-robustness VERDICT about the user's graph. That is
  // the same species as the 'uncertain' identifiability verdict a 404 used to
  // produce (Instance A) — a verdict manufactured from silence — and it is the
  // worse of the two here, because a label is read as a conclusion where a
  // score is read as a statistic.
  //
  // Both now degrade to absence. `finiteNum` also rejects NaN/±Infinity, and
  // `mapLevelToLabel` is only consulted when `level` is actually present, so
  // its 'moderate' default can no longer be reached from absent data.
  const robustness = {
    score: finiteNum(rawRobustness.score ?? rawRobustness.confidence),
    label: rawRobustness.label ?? (rawRobustness.level !== undefined && rawRobustness.level !== null
      ? mapLevelToLabel(rawRobustness.level)
      : undefined),
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

    // Robustness. Both fields are OMITTED when ISL measured neither — never
    // substituted (see the block above). `overall_robustness` was already
    // consumed absence-safely by the only caller: routes/v1/run.ts guards the
    // CEE payload with `hasRobustness = isl_sensitivity?.overall_robustness
    // !== undefined` and gates its ISL_FRAGILE critique on `=== 'fragile'`.
    ...(robustness.label !== undefined && { overall_robustness: robustness.label }),
    ...(robustness.score !== undefined && { robustness_score: robustness.score }),
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

    // Robustness — OMITTED, not "default moderate" (ROADMAP 1.240).
    // This is the ISL-unavailable path: nothing was computed, so there is no
    // robustness verdict and no robustness score to report. It used to return
    // `overall_robustness: 'moderate', robustness_score: 0.5`, which is
    // Instance A's defect in the robustness channel — a fabricated assessment
    // of the user's graph, indistinguishable from a genuine ISL 'moderate'.
    // `source: 'unavailable'` below is the machine-readable refusal; absence of
    // the two fields is the honest human-readable one.
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
