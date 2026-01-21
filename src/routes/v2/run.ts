/**
 * POST /v2/run - Option Comparison Mode
 *
 * V2 endpoint with canonical option-comparison model:
 * - Options are intervention bundles (not graph nodes)
 * - Strict preflight validation with BLOCKER critiques
 * - No intervention synthesis - require explicit interventions
 * - Option/decision nodes filtered from graph before analysis
 *
 * P0 Changes:
 * - Seed: accepts string OR number, normalizes to string, echoes seed_used as string
 * - Status vocabulary: per-feature uses computed|unavailable|skipped|error
 * - Top-level analysis_status: computed|partial|failed (HTTP 200) or blocked (HTTP 422)
 * - 422: Returns unwrapped V2RunError (NOT error.v1 envelope)
 * - response_hash: Computed from semantic fields only
 *
 * @see Integration Alignment Implementation Brief v1.1
 * @see P0-PLOT Workstream
 */

import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  RunRequestV3,
  RunResponseV3,
  OptionV3,
  CritiqueV3,
  EngineGraphV3,
  PerFeatureStatus,
  TopLevelAnalysisStatus,
  V2RunError,
  RobustnessSynthesisV3,
  RobustnessAssessmentV3,
  NormalizedEdgeInfoV3,
  CeeStatusV3,
  DecisionQualityV3,
  InsightV3,
  ImprovementGuidanceV3,
  RationaleV3,
  EdgeSensitivityResultV3,
  FactorSensitivityResultV3,
  RepairRecord,
  CanonicalMeta,
  SourcePath,
  DownstreamCallsV3,
} from '../../types/engine-v3.js';
// Seed derivation: when seed omitted, derive deterministically from graph hash
import { normaliseGraph, NormalisationError, type NormalisationWarning } from '../../normalisation/graph-normaliser.js';
import { filterOptionNodes } from '../../normalisation/option-filter.js';
import { hashRequest } from '../../normalisation/canonicalise.js';
import { hashGraph, deriveSeedFromHash } from '../../sampling/graph-hash.js';
import { runPreflightValidation } from '../../validation/preflight-v2.js';
import { toISLRobustnessRequest, validateISLRequest } from '../../integrations/isl/translator-v3.js';
import {
  createPreflightLog,
  createISLRequestLog,
  addISLResponseToLog,
  logPreflight,
  logISLCall,
} from '../../logging/preflight-logger.js';
import { getISLService } from '../../integrations/isl/index.js';
import { ISLHttpError } from '../../integrations/isl/errors.js';
import { buildRobustnessDataForCee } from '../../integrations/isl/adapters/robustness-enrichment.js';
import {
  normalizeFragileEdges,
  normalizeRobustEdges,
} from '../../integrations/isl/adapters/robustness-analysis.js';
import type { RobustnessDataForCee, NormalizedEdgeInfo } from '../../integrations/isl/types/plot-types.js';
import { orchestrateCeeReview } from '../../cee/orchestrator.js';
import type { CeeReviewRequest, CeeTrace } from '../../cee/types.js';
import { getDownstreamCallsForLog } from '../../util/downstream-tracker.js';

// -----------------------------------------------------------------------------
// Feature Flags
// -----------------------------------------------------------------------------

/**
 * Check if UI_CANONICAL_META feature flag is enabled.
 * When enabled, responses include `_meta` with repairs_applied.
 */
function isCanonicalMetaEnabled(): boolean {
  return process.env.UI_CANONICAL_META === '1';
}

// -----------------------------------------------------------------------------
// Array Utilities
// -----------------------------------------------------------------------------

/**
 * Check if value is a non-empty array.
 * Single source of truth for "has data" checks to prevent status/data misalignment.
 */
function hasNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

// -----------------------------------------------------------------------------
// Repair Extraction
// -----------------------------------------------------------------------------

/**
 * Extract RepairRecords from normalisation warnings.
 * Only warnings with a `repair` object are included.
 *
 * @param warnings Normalisation warnings from normaliseGraph()
 * @returns Array of RepairRecords for _meta.repairs_applied
 */
function extractRepairsFromWarnings(warnings: NormalisationWarning[]): RepairRecord[] {
  return warnings
    .filter((w): w is NormalisationWarning & { repair: NonNullable<NormalisationWarning['repair']> } =>
      w.repair !== undefined
    )
    .map((w) => ({
      field: w.repair.field,
      action: w.repair.action,
      from_value: w.repair.from_value,
      to_value: w.repair.to_value,
      reason: w.repair.reason,
    }));
}

/**
 * Transform ISL sensitivity array to edge sensitivity response format.
 * Always returns an array (empty if no data).
 *
 * Edge ID format: `from::to` (double-colon separator)
 * @see docs/UI_Handoff_PLoT_v1.md for format specification
 */
function transformEdgeSensitivity(islSensitivity: unknown): EdgeSensitivityResultV3[] {
  if (!hasNonEmptyArray(islSensitivity)) return [];
  return (islSensitivity as any[]).map((s: any) => ({
    edge_id: `${s.edge_from}::${s.edge_to}`,  // Double-colon separator (canonical format)
    from: s.edge_from,
    to: s.edge_to,
    sensitivity_type: s.sensitivity_type as 'existence' | 'magnitude',
    elasticity: s.elasticity,
    importance_rank: s.importance_rank,
    interpretation: s.interpretation,
  }));
}

/**
 * Transform ISL factor sensitivity array to response format.
 * Returns undefined if input is not a non-empty array.
 */
function transformFactorSensitivity(islFactorSensitivity: unknown): FactorSensitivityResultV3[] | undefined {
  if (!hasNonEmptyArray(islFactorSensitivity)) return undefined;
  return (islFactorSensitivity as any[]).map((f: any) => ({
    factor_id: f.node_id,
    sensitivity_score: f.sensitivity,
    value_of_information: f.value_of_information,
    direction: f.direction as 'positive' | 'negative' | 'mixed' | undefined,
  }));
}

// -----------------------------------------------------------------------------
// Build ID (for deployment verification)
// -----------------------------------------------------------------------------

// Cached build ID to avoid per-request git calls
let cachedBuildId: string | null = null;

function getBuildId(): string {
  if (cachedBuildId !== null) return cachedBuildId;

  // Prefer env vars from CI/CD (set at build/deploy time)
  const envBuildId = process.env.BUILD_ID || process.env.GITHUB_SHA;
  if (envBuildId) {
    cachedBuildId = envBuildId.slice(0, 7);
    return cachedBuildId;
  }

  // Fallback to git (one-time only, typically in dev)
  try {
    const res = spawnSync('git', ['--no-pager', 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    if (res.status === 0) {
      cachedBuildId = res.stdout.trim() || 'unknown';
      return cachedBuildId;
    }
  } catch { /* ignore */ }

  cachedBuildId = 'unknown';
  return cachedBuildId;
}

// -----------------------------------------------------------------------------
// ISL Response Summary (Consolidated Boundary Logging)
// -----------------------------------------------------------------------------

/**
 * ISL Response Summary for consolidated boundary logging.
 * Captures shape information (counts only, not content) for diagnostics.
 *
 * Note: Counts reflect RAW ISL response arrays, not post-normalization.
 * This is intentional for debugging ISL response shapes before normalization.
 */
interface ISLResponseSummary {
  request_id: string;
  seed_used: string;
  isl_success: boolean;
  isl_status_code: number;
  isl_duration_ms: number;
  options_count: number;
  fragile_edges_count: number;
  robust_edges_count: number;
  sensitivity_count: number;
  factor_sensitivity_count: number;
  fallback_executed: boolean;
  analysis_status?: string;
  robustness_label?: string;
}

/**
 * Build ISL response summary for consolidated logging.
 * Only captures counts and metadata - no PII or large payloads.
 */
function buildISLResponseSummary(
  requestId: string,
  seedUsed: string,
  islResult: any,
  islDurationMs: number,
  islSuccess: boolean,
  islStatusCode: number,
  fallbackExecuted: boolean
): ISLResponseSummary {
  // ISL V2 uses 'options' field; V1 uses 'results'. Check both.
  const optionData = islResult?.options ?? islResult?.results;

  return {
    request_id: requestId,
    seed_used: seedUsed,
    isl_success: islSuccess,
    isl_status_code: islStatusCode,
    isl_duration_ms: Math.round(islDurationMs),
    options_count: Array.isArray(optionData) ? optionData.length : 0,
    fragile_edges_count: Array.isArray(islResult?.robustness?.fragile_edges)
      ? islResult.robustness.fragile_edges.length : 0,
    robust_edges_count: Array.isArray(islResult?.robustness?.robust_edges)
      ? islResult.robustness.robust_edges.length : 0,
    sensitivity_count: Array.isArray(islResult?.sensitivity)
      ? islResult.sensitivity.length : 0,
    factor_sensitivity_count: Array.isArray(islResult?.factor_sensitivity)
      ? islResult.factor_sensitivity.length : 0,
    fallback_executed: fallbackExecuted,
    analysis_status: islResult?.analysis_status,
    robustness_label: islResult?.robustness?.label,
  };
}

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

const PREFLIGHT_VERSION_VALUE = '2025-12-26';
const DEFAULT_N_SAMPLES = 1000;
const BODY_LIMIT_BYTES = 10 * 1024 * 1024; // 10MB

// -----------------------------------------------------------------------------
// Seed Handling
// -----------------------------------------------------------------------------

/**
 * Seed Resolution Strategy
 * ========================
 *
 * When caller provides seed:
 *   - Use provided seed directly
 *   - Return in seed_used field
 *   - Guarantees reproducibility
 *
 * When caller omits seed:
 *   - Compute deterministic seed from graph canonical hash
 *   - Same graph → same seed → same results
 *   - Return computed seed in seed_used field
 *
 * This ensures determinism: identical requests (same graph, no seed)
 * always produce identical results and response_hash values.
 *
 * For guaranteed reproducibility across API versions, callers
 * should provide explicit seed and persist seed_used from response.
 */

/**
 * Resolve seed from provided value or derive from graph hash.
 *
 * **Seed Derivation Scope (Design Decision):**
 * When no seed is provided, seed is derived from graph TOPOLOGY + mean edge weights only:
 * - Node: id, kind, observed_state.value
 * - Edge: from, to, strength.mean
 *
 * Intentionally EXCLUDED from seed derivation:
 * - exists_probability (edge uncertainty)
 * - strength.std (edge variance)
 * - Other node/edge metadata
 *
 * Rationale: Seed determines the random sampling stream. Including only topology
 * ensures the same causal structure produces the same seed, while uncertainty
 * parameters affect the distribution shape without changing the sampling sequence.
 * This means two graphs differing only in uncertainty will use the same random
 * stream but produce different outcome distributions.
 *
 * @param providedSeed - Seed from request (string, number, or undefined)
 * @param graph - Normalized graph for hash computation
 * @returns Resolved seed as string (always deterministic)
 */
function resolveSeed(providedSeed: string | number | undefined, graph: EngineGraphV3): string {
  // Explicit seed provided - use as-is
  if (providedSeed !== undefined && providedSeed !== null) {
    return String(providedSeed);
  }

  // No seed provided - derive deterministically from graph topology hash
  // Same graph topology always produces same seed (see docstring for scope)
  const graphForHash = {
    nodes: graph.nodes.map((n) => ({ id: n.id, kind: n.kind, value: n.observed_state?.value })),
    edges: graph.edges.map((e) => ({ from: e.from, to: e.to, weight: e.strength.mean })),
  };
  const graphHash = hashGraph(graphForHash);
  const derivedSeed = deriveSeedFromHash(graphHash);
  return String(derivedSeed);
}

// -----------------------------------------------------------------------------
// Intervention Normalization
// -----------------------------------------------------------------------------

/**
 * Normalize interventions to support both spec-compliant simple numbers
 * and rich object format.
 *
 * Accepts:
 * - Simple: { "factor_price": 10 }
 * - Rich: { "factor_price": { "value": 10, "source": "user" } }
 *
 * Normalizes to:
 * - { "factor_price": { "value": 10, "source": "user_specified" } }
 */
function normalizeInterventions(
  interventions: Record<string, number | { value: number; source?: string }>
): Record<string, { value: number; source: 'user_specified' | 'brief_extraction' | 'cee_hypothesis' }> {
  const result: Record<string, { value: number; source: 'user_specified' | 'brief_extraction' | 'cee_hypothesis' }> = {};

  for (const [nodeId, intervention] of Object.entries(interventions ?? {})) {
    if (typeof intervention === 'number') {
      // Simple number → wrap in object with default source
      result[nodeId] = { value: intervention, source: 'user_specified' };
    } else if (intervention && typeof intervention === 'object' && 'value' in intervention) {
      // Already rich object - normalize source
      const source = intervention.source;
      const validSource = (source === 'brief_extraction' || source === 'cee_hypothesis')
        ? source
        : 'user_specified';
      result[nodeId] = { value: intervention.value, source: validSource };
    }
    // Skip invalid entries (will be caught by validation)
  }

  return result;
}

/**
 * Normalize all options' interventions.
 */
function normalizeOptions(
  options: Array<{ id: string; label: string; interventions: Record<string, any> }>
): OptionV3[] {
  return options.map(opt => ({
    id: opt.id,
    label: opt.label,
    interventions: normalizeInterventions(opt.interventions),
  }));
}

// -----------------------------------------------------------------------------
// Request Validation Schema
// -----------------------------------------------------------------------------

const runV3Schema = {
  body: {
    type: 'object',
    required: ['graph', 'options', 'goal_node_id'],
    properties: {
      graph: {
        type: 'object',
        required: ['nodes', 'edges'],
        properties: {
          nodes: { type: 'array' },
          edges: { type: 'array' },
        },
      },
      options: {
        type: 'array',
        minItems: 2,  // Minimum 2 options for comparison
        items: {
          type: 'object',
          required: ['id', 'label', 'interventions'],
          properties: {
            id: { type: 'string' },
            label: { type: 'string' },
            interventions: { type: 'object' },
          },
        },
      },
      goal_node_id: { type: 'string', minLength: 1 },
      seed: { type: ['string', 'number', 'integer'] },
      n_samples: { type: 'number', minimum: 100, maximum: 10000 },
      detail_level: { type: 'string', enum: ['quick', 'standard', 'deep'] },
      request_id: { type: 'string' },
      idempotency_key: { type: 'string' },
      goal_threshold: { type: ['number', 'null'] },
    },
  },
};

// -----------------------------------------------------------------------------
// Status Mapping
// -----------------------------------------------------------------------------

/**
 * Map ISL status to UI vocabulary per-feature status.
 *
 * Data presence takes precedence: if hasData=false, the feature is unavailable
 * regardless of what ISL claims. This prevents returning "computed" with empty results.
 */
function mapToPerFeatureStatus(islStatus: string | undefined, hasData: boolean): PerFeatureStatus {
  // Data presence is authoritative - if we have data, it's computed
  if (hasData) return 'computed';

  // No data: only trust ISL for explicit skip/fail semantics
  switch (islStatus) {
    case 'failed':
      return 'error';
    case 'skipped':
      return 'skipped';
    default:
      // No data = unavailable, even if ISL says 'computed'
      return 'unavailable';
  }
}

/**
 * Determine top-level analysis status from per-feature statuses.
 *
 * Semantics:
 * - computed: ALL features computed successfully
 * - partial: Options computed with usable outcomes; some secondary features degraded
 * - failed: No usable option outcomes (primary deliverable missing)
 *
 * Key insight: A run is "partial" if options have usable outcomes, even if secondary
 * features error. This preserves value for the user.
 */
function determineTopLevelStatus(
  optionStatus: PerFeatureStatus,
  robustnessStatus: PerFeatureStatus,
  driversStatus: PerFeatureStatus,
  optionOutcomes?: Array<{ option_id: string; expected_outcome?: number }>
): TopLevelAnalysisStatus {
  const statuses = [optionStatus, robustnessStatus, driversStatus];

  // All computed → computed
  if (statuses.every(s => s === 'computed')) {
    return 'computed';
  }

  // Check if options have usable outcomes (primary deliverable)
  const hasUsableOptions = optionStatus === 'computed' &&
    optionOutcomes &&
    optionOutcomes.length > 0 &&
    optionOutcomes.some(o => o.expected_outcome !== undefined && Number.isFinite(o.expected_outcome));

  // Options usable → partial (even if secondary features error)
  if (hasUsableOptions) {
    return 'partial';
  }

  // Mix of computed and unavailable/skipped (without usable options) → partial
  if (statuses.some(s => s === 'computed') && !statuses.some(s => s === 'error')) {
    return 'partial';
  }

  // Options not computed or all features unavailable/error → failed
  return 'failed';
}

// -----------------------------------------------------------------------------
// Response Builders
// -----------------------------------------------------------------------------

interface MetaParams {
  seedUsed: string;
  nSamples: number;
  detailLevel: string;
  latencyMs: number;
  normalizationMs?: number;
  validationMs?: number;
  islMs?: number;
  ceeMs?: number;
  build?: string;
  /** Repair records from normalisation (for _meta.repairs_applied) */
  repairs?: RepairRecord[];
  /** Source path for analysis (for _meta.source_path). Required to ensure auditability. */
  sourcePath: SourcePath;
}

/**
 * CEE results for passing to buildResponse.
 */
interface CeeResultsParams {
  ceeStatus: CeeStatusV3;
  decisionQuality: DecisionQualityV3 | null;
  insights: InsightV3[] | null;
  improvementGuidance: ImprovementGuidanceV3[] | null;
  rationale: RationaleV3 | null;
}

/**
 * Build a 422 blocked response (V2RunError).
 * NOT wrapped in error.v1 envelope.
 */
function buildBlockedResponse(
  statusReason: string,
  critiques: CritiqueV3[]
): V2RunError {
  return {
    analysis_status: 'blocked',
    status_reason: statusReason,
    critiques,
  };
}

// Pre-computed sensitivity data to ensure status/response alignment
interface SensitivityData {
  edgeSensitivity: ReturnType<typeof transformEdgeSensitivity>;
  factorSensitivity: ReturnType<typeof transformFactorSensitivity>;
}

/**
 * Build a success/partial/failed response (HTTP 200).
 */
function buildResponse(
  requestId: string,
  analysisStatus: TopLevelAnalysisStatus,
  statusReason: string | undefined,
  optionComparisonStatus: PerFeatureStatus,
  robustnessStatus: PerFeatureStatus,
  driversStatus: PerFeatureStatus,
  critiques: CritiqueV3[],
  meta: MetaParams,
  responseHash: string | undefined,
  islResult?: any,
  options?: OptionV3[],
  islAnalysisStatus?: string,
  islStatusReason?: string,
  robustnessSynthesis?: RobustnessSynthesisV3 | null,
  ceeResults?: CeeResultsParams,
  ceeTrace?: CeeTrace | null,
  sensitivityData?: SensitivityData
): RunResponseV3 {
  // Map ISL results to response format
  // ISL V2 uses 'options' field; V1 uses 'results'. Check both for compatibility.
  const islOptionData = islResult?.options ?? islResult?.results;
  const optionComparison = islOptionData?.map((r: any) => {
    const optionId = r.option_id ?? r.id;
    const option = options?.find((o) => o.id === optionId);

    // ISL V2 returns outcome as nested object; V1 returns flat fields
    const outcomeData = r.outcome;
    const hasOutcomeObject = outcomeData && typeof outcomeData === 'object';

    // Build full outcome stats from ISL V2 format
    const outcome = hasOutcomeObject
      ? {
          mean: outcomeData.mean,
          std: outcomeData.std,
          p10: outcomeData.p10,
          p50: outcomeData.p50,
          p90: outcomeData.p90,
          n_samples: outcomeData.n_samples,
          n_valid_samples: outcomeData.n_valid_samples,
          validity_ratio: outcomeData.validity_ratio,
        }
      : undefined;

    // Derive legacy fields for backward compatibility
    const expectedOutcome = hasOutcomeObject
      ? outcomeData.mean ?? outcomeData.p50
      : r.expected_outcome;
    const confidenceInterval: [number, number] = hasOutcomeObject
      ? [outcomeData.p10 ?? 0, outcomeData.p90 ?? 0]
      : r.confidence_interval ?? [0, 0];

    // Build result object - only include optional fields if present
    const result: any = {
      option_id: optionId,
      option_label: option?.label ?? r.label ?? optionId,
      // Legacy fields (deprecated but kept for backward compatibility)
      expected_outcome: expectedOutcome,
      confidence_interval: confidenceInterval,
      // Full outcome stats (new V2 format)
      outcome,
      // Status fields
      status: r.status,
      status_reason: r.status_reason,
    };

    // Only include probability_of_goal if ISL returned it (omit when absent, not null)
    if (r.probability_of_goal !== undefined && r.probability_of_goal !== null) {
      result.probability_of_goal = r.probability_of_goal;
    }

    // Only include win_probability if ISL returned it (omit when absent, not null)
    if (r.win_probability !== undefined && r.win_probability !== null) {
      result.win_probability = r.win_probability;
    }

    return result;
  });

  // Use pre-computed sensitivity data if provided (for status/response alignment)
  // Fall back to computing from islResult for backward compatibility
  const edgeSensitivity = sensitivityData?.edgeSensitivity
    ?? transformEdgeSensitivity(islResult?.sensitivity);
  const factorSensitivity = sensitivityData?.factorSensitivity
    ?? transformFactorSensitivity(islResult?.factor_sensitivity);

  // Normalize robustness edges to consistent object format
  // ISL returns fragile_edges as objects, robust_edges as strings - normalize both
  let robustness: RobustnessAssessmentV3 | undefined;

  if (islResult?.robustness) {
    const fragileResult = normalizeFragileEdges(
      islResult.robustness.fragile_edges as unknown[],
      requestId
    );
    const robustResult = normalizeRobustEdges(
      islResult.robustness.robust_edges as unknown[],
      requestId
    );
    const normalizationErrors = [...fragileResult.errors, ...robustResult.errors];

    // Validate and cast label to expected union type
    const rawLabel = islResult.robustness.label;
    const label: 'robust' | 'moderate' | 'fragile' | undefined =
      rawLabel === 'robust' || rawLabel === 'moderate' || rawLabel === 'fragile'
        ? rawLabel
        : undefined;

    // Build option ID → label lookup for alternative_winner_label resolution
    const optionLabelMap = new Map<string, string>();
    if (options) {
      for (const opt of options) {
        optionLabelMap.set(opt.id, opt.label);
      }
    }

    // Enrich fragile edges with alternative_winner_label
    const enrichedFragileEdges: NormalizedEdgeInfoV3[] = fragileResult.edges.map(edge => ({
      ...edge,
      // Resolve alternative_winner_label from option ID
      ...(edge.alternative_winner_id && optionLabelMap.has(edge.alternative_winner_id)
        ? { alternative_winner_label: optionLabelMap.get(edge.alternative_winner_id) }
        : {}),
    }));

    robustness = {
      score: islResult.robustness.score,
      label,
      fragile_edges: enrichedFragileEdges,
      robust_edges: robustResult.edges,
      explanation: islResult.robustness.explanation,
      // Include normalization errors if any occurred (for observability)
      ...(normalizationErrors.length > 0 && { normalization_errors: normalizationErrors }),
    };
  }

  return {
    request_schema_version: 'v3',
    endpoint_version: 'v2/run',
    preflight_version: PREFLIGHT_VERSION_VALUE,
    request_id: requestId,

    analysis_status: analysisStatus,
    status_reason: statusReason,

    option_comparison_status: optionComparisonStatus,
    robustness_status: robustnessStatus,
    drivers_status: driversStatus,

    isl_analysis_status: islAnalysisStatus,
    isl_status_reason: islStatusReason,

    critiques,
    option_comparison: optionComparison,
    edge_sensitivity: edgeSensitivity,
    factor_sensitivity: factorSensitivity,
    robustness,
    robustness_synthesis: robustnessSynthesis,

    // CEE Results Panel fields
    cee_status: ceeResults?.ceeStatus,
    decision_quality: ceeResults?.decisionQuality,
    insights: ceeResults?.insights,
    improvement_guidance: ceeResults?.improvementGuidance,
    rationale: ceeResults?.rationale,

    // CEE trace for observability (includes degraded flag)
    ceeTrace: ceeTrace ?? undefined,

    response_hash: responseHash,

    // Canonical metadata for UI canonicalisation layer (when feature flag enabled)
    // Always included with empty repairs_applied if no repairs - this lets UI distinguish
    // "flag off" from "flag on with zero repairs"
    _meta: isCanonicalMetaEnabled()
      ? {
          source_path: meta.sourcePath,
          repairs_applied: meta.repairs ?? [],
          request_id: requestId,
          plot_build: meta.build ?? 'unknown',
        }
      : undefined,

    // Downstream service calls (ISL, CEE) for debugging and tracing
    downstream_calls: (() => {
      const allCalls = getDownstreamCallsForLog(requestId);
      if (allCalls.length === 0) return undefined;
      const islCalls = allCalls.filter(c => c.service === 'isl');
      const ceeCalls = allCalls.filter(c => c.service === 'cee');
      const result: DownstreamCallsV3 = {};
      if (islCalls.length > 0) result.isl = islCalls;
      if (ceeCalls.length > 0) result.cee = ceeCalls;
      return Object.keys(result).length > 0 ? result : undefined;
    })(),

    meta: {
      seed_used: meta.seedUsed,
      n_samples: meta.nSamples,
      detail_level: meta.detailLevel,
      latency_ms: meta.latencyMs,
      normalization_ms: meta.normalizationMs,
      validation_ms: meta.validationMs,
      isl_ms: meta.islMs,
      cee_ms: meta.ceeMs,
      build: meta.build,
    },
  };
}

// -----------------------------------------------------------------------------
// ISL Critique Mapping
// -----------------------------------------------------------------------------

/**
 * Map ISL critiques to V2 critique format.
 */
function mapISLCritiquesToV2(islCritiques: Array<{
  code: string;
  severity: string;
  message: string;
  suggestion?: string;
  affected_nodes?: string[];
}>): CritiqueV3[] {
  return islCritiques.map((c) => ({
    id: randomUUID(),
    code: c.code,
    severity: c.severity === 'blocker' ? 'blocker' :
              c.severity === 'error' ? 'error' :
              c.severity === 'warning' ? 'warning' : 'info',
    message: c.suggestion ? `${c.message} ${c.suggestion}` : c.message,
    source: 'isl' as const,
    affected_node_ids: c.affected_nodes,
    blocks_analysis: c.severity === 'blocker',
  }));
}

// -----------------------------------------------------------------------------
// CEE Integration
// -----------------------------------------------------------------------------

/**
 * Result of CEE orchestration for V2 response.
 */
interface CeeOrchestrationResult {
  ceeResults: CeeResultsParams;
  robustnessSynthesis: RobustnessSynthesisV3 | null;
  latencyMs: number;
  ceeTrace: CeeTrace | null;
}

/**
 * Get CEE environment configuration.
 */
function getCeeEnv(): { baseUrl?: string; apiKey?: string; timeoutMs?: number } {
  return {
    baseUrl: process.env.CEE_BASE_URL,
    apiKey: process.env.CEE_API_KEY,
    timeoutMs: Number(process.env.CEE_TIMEOUT_MS ?? 60_000),
  };
}

/**
 * Check if CEE integration is enabled.
 */
function isCeeEnabled(): boolean {
  // Prefer CEE_ORCHESTRATOR_ENABLED (matches Render config)
  const enabled = process.env.CEE_ORCHESTRATOR_ENABLED ?? process.env.CEE_ORCHESTRATOR_ENABLE;
  return enabled === '1' || enabled === 'true';
}

/**
 * Build CEE review request from ISL results.
 */
function buildCeeReviewRequest(
  scenarioId: string,
  graph: EngineGraphV3,
  options: OptionV3[],
  islResult: any,
  robustnessData: RobustnessDataForCee | null,
  brief?: string
): CeeReviewRequest {
  // Build ISL robustness summary for CEE
  let islRobustness: CeeReviewRequest['isl_robustness'];
  if (islResult?.robustness) {
    const r = islResult.robustness;
    islRobustness = {
      overall_robustness: r.label as 'robust' | 'moderate' | 'fragile',
      validation_status: islResult.validation_status,
      validation_confidence: islResult.validation_confidence,
      sensitive_parameters: islResult.factor_sensitivity?.slice(0, 5).map((f: any) => ({
        parameter: f.node_id,
        sensitivity: f.sensitivity,
        impact_direction: f.direction ?? 'positive',
      })),
      recommendations: robustnessData?.fragile_edges?.slice(0, 3).map(e =>
        `Review assumption: ${e.from_label} → ${e.to_label}`
      ),
    };
  }

  return {
    scenario_id: scenarioId,
    graph_snapshot: {
      nodes: graph.nodes,
      edges: graph.edges,
    },
    graph_schema_version: '2.2',
    // Include brief for contextualised CEE output (only if provided)
    ...(brief && { brief }),
    inference_results: {
      // ISL V2 uses 'options' field; V1 uses 'results'. Check both for compatibility.
      // Keep quantiles for backward compatibility (first option's quantiles)
      quantiles: (() => {
        const firstOption = (islResult?.options ?? islResult?.results)?.[0];
        return {
          p10: firstOption?.confidence_interval?.[0] ?? 0,
          p50: firstOption?.expected_outcome ?? 0,
          p90: firstOption?.confidence_interval?.[1] ?? 0,
        };
      })(),
      // Per-option outcomes for comparative analysis (all options)
      per_option_outcomes: (() => {
        const islOptions = islResult?.options ?? islResult?.results;
        if (!Array.isArray(islOptions)) return undefined;
        return islOptions.map((opt: any) => ({
          option_id: opt.option_id ?? opt.id,
          p10: opt.confidence_interval?.[0] ?? opt.outcome?.p10 ?? 0,
          p50: opt.expected_outcome ?? opt.outcome?.p50 ?? 0,
          p90: opt.confidence_interval?.[1] ?? opt.outcome?.p90 ?? 0,
        }));
      })(),
      top_edge_drivers: islResult?.sensitivity?.slice(0, 5).map((s: any) => ({
        id: `${s.edge_from}::${s.edge_to}`,
        sensitivity: s.elasticity,
      })),
      ranked_actions: options.map((o, i) => ({
        id: o.id,
        rank: i + 1,
      })),
    },
    intent: 'selection',
    isl_robustness: islRobustness,
  };
}

/**
 * Extract CEE Results Panel fields from CEE response.
 */
function extractCeeResultsFromResponse(ceeReview: any): {
  decisionQuality: DecisionQualityV3 | null;
  insights: InsightV3[] | null;
  improvementGuidance: ImprovementGuidanceV3[] | null;
  rationale: RationaleV3 | null;
} {
  if (!ceeReview) {
    return {
      decisionQuality: null,
      insights: null,
      improvementGuidance: null,
      rationale: null,
    };
  }

  // Extract decision_quality
  const decisionQuality: DecisionQualityV3 | null = ceeReview.decision_quality
    ? {
        level: ceeReview.decision_quality.level,
        summary: ceeReview.decision_quality.summary,
      }
    : null;

  // Extract insights
  const insights: InsightV3[] | null = Array.isArray(ceeReview.insights)
    ? ceeReview.insights.map((i: any) => ({
        type: i.type,
        content: i.content,
        severity: i.severity,
      }))
    : null;

  // Extract improvement_guidance
  const improvementGuidance: ImprovementGuidanceV3[] | null = Array.isArray(ceeReview.improvement_guidance)
    ? ceeReview.improvement_guidance.map((g: any) => ({
        priority: g.priority,
        action: g.action,
        reason: g.reason,
        source: g.source,
      }))
    : null;

  // Extract rationale
  const rationale: RationaleV3 | null = ceeReview.rationale
    ? {
        summary: ceeReview.rationale.summary,
        key_driver: ceeReview.rationale.key_driver,
        goal_alignment: ceeReview.rationale.goal_alignment,
      }
    : null;

  return { decisionQuality, insights, improvementGuidance, rationale };
}

/**
 * Build robustness synthesis from CEE response blocks.
 */
function extractRobustnessSynthesis(ceeReview: any): RobustnessSynthesisV3 | null {
  if (!ceeReview) return null;

  // Look for robustness block in CEE response
  const robustnessBlock = ceeReview.blocks?.find((b: any) => b.id === 'robustness');

  if (!robustnessBlock) return null;

  return {
    headline: robustnessBlock.headline ?? 'Robustness analysis complete',
    assumption_explanations: robustnessBlock.factors?.map((f: string, i: number) => ({
      edge_id: `factor_${i}`,
      explanation: f,
      severity: robustnessBlock.status === 'error' ? 'fragile' as const :
                robustnessBlock.status === 'warning' ? 'moderate' as const : 'robust' as const,
    })),
  };
}

/**
 * Request CEE review with Results Panel fields.
 *
 * Graceful degradation: never throws, returns skipped/unavailable status on failure.
 */
async function requestCeeReview(
  scenarioId: string,
  graph: EngineGraphV3,
  options: OptionV3[],
  islResult: any,
  robustnessData: RobustnessDataForCee | null,
  requestId: string,
  logger?: any,
  brief?: string
): Promise<CeeOrchestrationResult> {
  const startTime = performance.now();

  // Check if CEE is enabled
  if (!isCeeEnabled()) {
    return {
      ceeResults: {
        ceeStatus: 'skipped',
        decisionQuality: null,
        insights: null,
        improvementGuidance: null,
        rationale: null,
      },
      robustnessSynthesis: null,
      latencyMs: 0,
      ceeTrace: {
        requestId: requestId,
        degraded: false,
        timestamp: new Date().toISOString(),
        source: 'orchestrator',
        reason: 'CEE feature disabled',
      },
    };
  }

  const ceeEnv = getCeeEnv();

  // Check if CEE is configured
  if (!ceeEnv.baseUrl || !ceeEnv.apiKey) {
    logger?.warn({ evt: 'cee_not_configured' }, 'CEE not configured, skipping');
    return {
      ceeResults: {
        ceeStatus: 'unavailable',
        decisionQuality: null,
        insights: null,
        improvementGuidance: null,
        rationale: null,
      },
      robustnessSynthesis: null,
      latencyMs: 0,
      ceeTrace: {
        requestId: requestId,
        degraded: true,
        timestamp: new Date().toISOString(),
        source: 'orchestrator',
        reason: 'CEE_BASE_URL or CEE_API_KEY not configured',
      },
    };
  }

  // Check if there's meaningful data to send
  // ISL V2 uses 'options' field; V1 uses 'results'. Check both for compatibility.
  const hasResults = (islResult?.options ?? islResult?.results)?.length > 0;
  if (!hasResults) {
    return {
      ceeResults: {
        ceeStatus: 'skipped',
        decisionQuality: null,
        insights: null,
        improvementGuidance: null,
        rationale: null,
      },
      robustnessSynthesis: null,
      latencyMs: 0,
      ceeTrace: {
        requestId: requestId,
        degraded: false,
        timestamp: new Date().toISOString(),
        source: 'orchestrator',
        reason: 'No ISL results to send to CEE',
      },
    };
  }

  try {
    // Build CEE review request (include brief for contextualised output)
    const ceeRequest = buildCeeReviewRequest(scenarioId, graph, options, islResult, robustnessData, brief);

    // Call CEE orchestrator
    const ceeResult = await orchestrateCeeReview(ceeEnv, ceeRequest, requestId);
    const latencyMs = performance.now() - startTime;

    // Log CEE call
    logger?.info({
      evt: 'cee_review_complete',
      request_id: requestId,
      latency_ms: latencyMs,
      has_review: !!ceeResult.ceeReview,
      has_error: !!ceeResult.ceeError,
    }, 'CEE review completed');

    // Handle CEE error
    if (ceeResult.ceeError) {
      logger?.warn({
        evt: 'cee_review_error',
        error_code: ceeResult.ceeError.code,
        error_message: ceeResult.ceeError.message,
        degraded: ceeResult.ceeTrace?.degraded,
      }, 'CEE review returned error');

      return {
        ceeResults: {
          ceeStatus: 'degraded',
          decisionQuality: null,
          insights: null,
          improvementGuidance: null,
          rationale: null,
        },
        robustnessSynthesis: null,
        latencyMs,
        ceeTrace: ceeResult.ceeTrace,
      };
    }

    // Extract results from CEE response
    const { decisionQuality, insights, improvementGuidance, rationale } =
      extractCeeResultsFromResponse(ceeResult.ceeReview);
    const robustnessSynthesis = extractRobustnessSynthesis(ceeResult.ceeReview);

    return {
      ceeResults: {
        ceeStatus: 'available',
        decisionQuality,
        insights,
        improvementGuidance,
        rationale,
      },
      robustnessSynthesis,
      latencyMs,
      ceeTrace: ceeResult.ceeTrace,
    };
  } catch (err) {
    const latencyMs = performance.now() - startTime;
    logger?.warn({
      evt: 'cee_review_exception',
      error: String(err),
      latency_ms: latencyMs,
    }, 'CEE review threw exception');

    return {
      ceeResults: {
        ceeStatus: 'unavailable',
        decisionQuality: null,
        insights: null,
        improvementGuidance: null,
        rationale: null,
      },
      robustnessSynthesis: null,
      latencyMs,
      ceeTrace: {
        requestId: requestId,
        degraded: true,
        timestamp: new Date().toISOString(),
        source: 'orchestrator',
        reason: `CEE review threw exception: ${String(err)}`,
      },
    };
  }
}

// -----------------------------------------------------------------------------
// Route Registration
// -----------------------------------------------------------------------------

export async function registerRunV2Route(app: FastifyInstance): Promise<void> {
  app.post(
    '/v2/run',
    {
      schema: runV3Schema,
      bodyLimit: BODY_LIMIT_BYTES,
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const startTime = performance.now();
      const body = req.body as RunRequestV3;
      const requestId = body.request_id ?? String(req.id) ?? randomUUID();
      // Note: seedUsed is resolved AFTER graph normalization for determinism
      // When seed is omitted, we derive it from the normalized graph hash
      const providedSeed = body.seed;  // May be undefined - will resolve after normalization
      const nSamples = body.n_samples ?? DEFAULT_N_SAMPLES;
      const detailLevel = body.detail_level ?? 'standard';

      // Normalize goal_threshold: null is treated as absent
      let goalThreshold: number | undefined;
      if (body.goal_threshold === null) {
        // Explicit null - treat as absent with debug log
        req.log.debug({ event: 'goal_threshold_null' });
        goalThreshold = undefined;
      } else if (typeof body.goal_threshold === 'number' && Number.isFinite(body.goal_threshold)) {
        goalThreshold = body.goal_threshold;
      } else {
        goalThreshold = undefined;
      }

      // Timing tracking
      let normalizationMs = 0;
      let validationMs = 0;
      let islMs = 0;

      try {
        // =================================================================
        // Phase 1: Normalization
        // =================================================================
        const normStart = performance.now();

        let normalizedGraph: EngineGraphV3;
        let nodesNormalised = 0;
        let edgesNormalised = 0;
        let normWarnings: NormalisationWarning[] = [];
        let repairs: RepairRecord[] = [];

        // Normalize options (support both simple numbers and rich objects)
        const normalizedOptions = normalizeOptions(body.options);

        try {
          const result = normaliseGraph(body.graph);
          normalizedGraph = result.graph;
          nodesNormalised = result.nodesNormalised;
          edgesNormalised = result.edgesNormalised;
          normWarnings = result.warnings;
          // Extract structured repair records for _meta
          repairs = extractRepairsFromWarnings(normWarnings);
        } catch (err) {
          if (err instanceof NormalisationError) {
            // Return 422 with V2RunError for normalization failures
            return reply.status(422).send(buildBlockedResponse(
              `Normalization failed: ${err.message}`,
              [{
                id: randomUUID(),
                code: 'NORMALIZATION_ERROR',
                severity: 'blocker',
                message: err.message,
                source: 'validation',
                affected_node_ids: err.nodeId ? [err.nodeId] : undefined,
                blocks_analysis: true,
              }]
            ));
          }
          throw err;
        }

        // Filter non-causal nodes (option, decision)
        const filterResult = filterOptionNodes(normalizedGraph);
        const filteredGraph = filterResult.filteredGraph;

        // =================================================================
        // Seed Resolution (after normalization for determinism)
        // =================================================================
        // Resolve seed: use provided value or derive from normalized graph hash
        // This ensures identical requests (same graph, no seed) produce identical results
        const seedUsed = resolveSeed(providedSeed, filteredGraph);

        // Log if option nodes were filtered
        if (filterResult.removedNodeIds.size > 0) {
          req.log.info({
            event: 'non_causal_nodes_filtered',
            removed_count: filterResult.removedNodeIds.size,
            removed_edge_count: filterResult.removedEdgeCount,
            removed_node_ids: Array.from(filterResult.removedNodeIds),
          });
        }

        // =================================================================
        // Phase 1b: Early Goal Validation (before filtering)
        // =================================================================
        // Validate goal in ORIGINAL graph before filtering to give specific errors
        const NON_CAUSAL_NODE_KINDS = ['option', 'decision'];

        if (!body.goal_node_id || body.goal_node_id.trim() === '') {
          return reply.status(422).send(buildBlockedResponse(
            'Goal node is required',
            [{
              id: randomUUID(),
              code: 'MISSING_GOAL_NODE',
              severity: 'blocker',
              message: 'Goal node is required for option comparison. Please select a goal node.',
              source: 'validation',
              blocks_analysis: true,
            }]
          ));
        }

        // Check goal exists in original normalized graph (before filtering)
        const goalNode = normalizedGraph.nodes.find(n => n.id === body.goal_node_id);

        if (!goalNode) {
          return reply.status(422).send(buildBlockedResponse(
            `Goal node "${body.goal_node_id}" not found in graph`,
            [{
              id: randomUUID(),
              code: 'GOAL_NODE_NOT_IN_GRAPH',
              severity: 'blocker',
              message: `Goal node "${body.goal_node_id}" not found in graph. Select an existing node as the goal, or add the goal node to the graph.`,
              source: 'validation',
              affected_node_ids: [body.goal_node_id],
              blocks_analysis: true,
            }]
          ));
        }

        // Check if goal is a non-causal kind (would be filtered out)
        if (NON_CAUSAL_NODE_KINDS.includes(goalNode.kind)) {
          return reply.status(422).send(buildBlockedResponse(
            `Goal node "${body.goal_node_id}" is a ${goalNode.kind} node`,
            [{
              id: randomUUID(),
              code: 'GOAL_NODE_NOT_CAUSAL',
              severity: 'blocker',
              message: `Goal node "${body.goal_node_id}" is a ${goalNode.kind} node, which cannot be used as an analysis target. Select a factor, outcome, risk, or goal node as the analysis target.`,
              source: 'validation',
              affected_node_ids: [body.goal_node_id],
              blocks_analysis: true,
            }]
          ));
        }

        normalizationMs = performance.now() - normStart;

        // =================================================================
        // Phase 2: Preflight Validation
        // =================================================================
        const valStart = performance.now();

        const preflight = runPreflightValidation(
          filteredGraph,
          normalizedOptions,
          body.goal_node_id,
          {
            optionNodesFiltered: filterResult.removedNodeIds.size,
            optionEdgesFiltered: filterResult.removedEdgeCount,
            nodesNormalised,
            edgesNormalised,
          }
        );

        validationMs = performance.now() - valStart;

        // Log preflight result
        const preflightLog = createPreflightLog(
          requestId,
          body.goal_node_id,
          preflight,
          validationMs
        );
        logPreflight(preflightLog);

        // If preflight failed, return 422 with V2RunError
        if (!preflight.passed) {
          return reply.status(422).send(buildBlockedResponse(
            'Preflight validation failed',
            preflight.blockers
          ));
        }

        // =================================================================
        // Phase 3: Compute Response Hash
        // =================================================================
        const responseHash = hashRequest(body, filteredGraph, seedUsed);

        // =================================================================
        // Phase 4: ISL Call
        // =================================================================
        const islStart = performance.now();

        const islService = getISLService();

        if (!islService.isEnabled()) {
          const totalMs = performance.now() - startTime;

          return reply.send(buildResponse(
            requestId,
            'failed',
            'ISL service is not enabled',
            'unavailable',
            'unavailable',
            'unavailable',
            [{
              id: randomUUID(),
              code: 'ISL_NOT_ENABLED',
              severity: 'warning',
              message: 'ISL service is not enabled. Analysis unavailable.',
              source: 'validation',
              blocks_analysis: false,
            }],
            {
              seedUsed,
              nSamples,
              detailLevel,
              latencyMs: totalMs,
              normalizationMs,
              validationMs,
              build: getBuildId(),
              repairs,
              sourcePath: 'graph_fallback',
            },
            responseHash
          ));
        }

        // Build ISL request
        const islRequest = toISLRobustnessRequest(
          filteredGraph,
          normalizedOptions,
          body.goal_node_id,
          requestId,
          nSamples,
          goalThreshold
        );

        // Validate ISL request (should never fail after preflight, but defensive)
        const islValidationErrors = validateISLRequest(islRequest);
        if (islValidationErrors.length > 0) {
          req.log.error({
            event: 'isl_request_validation_failed',
            errors: islValidationErrors,
          });

          return reply.status(422).send(buildBlockedResponse(
            'ISL request validation failed',
            islValidationErrors.map((msg) => ({
              id: randomUUID(),
              code: 'ISL_REQUEST_INVALID',
              severity: 'blocker' as const,
              message: msg,
              source: 'validation' as const,
              blocks_analysis: true,
            }))
          ));
        }

        // Log ISL request
        const islReqLog = createISLRequestLog(
          requestId,
          filteredGraph.nodes.length,
          filteredGraph.edges.length,
          normalizedOptions.length,
          normalizedOptions.map((o) => Object.keys(o.interventions).length),
          body.goal_node_id
        );

        // Call ISL
        let islResult: any;
        let islSuccess = false;
        let islStatusCode = 0;
        let islError: ISLHttpError | undefined;
        let islFallbackExecuted = false;

        try {
          const response = await islService.callAnalysisEndpoint<any>(
            '/api/v1/robustness/analyze/v2',
            islRequest,
            requestId
          );

          if (response.data) {
            islResult = response.data;
            islSuccess = true;
            islStatusCode = 200;

            // Warn if goal_threshold was provided but ISL didn't return probability_of_goal
            if (goalThreshold !== undefined) {
              const optionData = islResult?.options ?? islResult?.results;
              const optionsWithoutProbGoal = optionData?.filter(
                (opt: any) => opt.probability_of_goal === undefined || opt.probability_of_goal === null
              );
              if (optionsWithoutProbGoal && optionsWithoutProbGoal.length > 0) {
                req.log.warn({
                  event: 'goal_threshold_no_probability',
                  goal_threshold: goalThreshold,
                  options_missing_probability: optionsWithoutProbGoal.length,
                });
              }
            }
          } else {
            islStatusCode = 500;
            islFallbackExecuted = true;
            req.log.error({
              event: 'isl_call_failed',
              error: response.error?.message ?? 'Unknown error',
              error_code: response.error?.code,
            });
          }
        } catch (err) {
          islFallbackExecuted = true;
          if (err instanceof ISLHttpError) {
            islError = err;
            islStatusCode = err.status;

            // Handle 422 from ISL with structured critiques (V2, V1, or Pydantic format)
            if (err.is422()) {
              req.log.info({
                event: 'isl_422_received',
                format: err.isV2Format() ? 'v2' : 'legacy',
                message: err.getErrorMessage(),
                critiques_count: err.getCritiques().length,
              });
            }
          } else {
            islStatusCode = 500;
          }

          req.log.error({
            event: 'isl_call_exception',
            error: (err as Error).message,
            status: islStatusCode,
          });
        }

        islMs = performance.now() - islStart;

        // Log ISL response (existing structured log)
        const islRespLog = addISLResponseToLog(
          islReqLog,
          islStatusCode,
          islMs,
          islSuccess,
          islSuccess ? undefined : { code: 'ISL_ERROR' }
        );
        logISLCall(islRespLog);

        // =================================================================
        // CONSOLIDATED ISL BOUNDARY LOG
        // Single structured summary of ISL response shape for diagnostics
        // Gated at debug level - not shown at default production log level
        // =================================================================
        req.log.debug({
          event: 'isl_response_summary',
          isl_response_summary: buildISLResponseSummary(
            requestId,
            seedUsed,
            islResult,
            islMs,
            islSuccess,
            islStatusCode,
            islFallbackExecuted
          ),
        });

        // Build response
        const totalMs = performance.now() - startTime;
        const critiques: CritiqueV3[] = [...preflight.warnings];

        // Log normalization warnings with structured context for telemetry
        if (normWarnings.length > 0) {
          req.log.info({
            event: 'normalisation_warnings',
            warning_count: normWarnings.length,
            warnings: normWarnings,
            graph_stats: {
              node_count: body.graph.nodes?.length ?? 0,
              edge_count: body.graph.edges?.length ?? 0,
              option_count: normalizedOptions.length,
            },
          });
        }

        // Add normalization warnings as info critiques
        for (const warning of normWarnings) {
          critiques.push({
            id: randomUUID(),
            code: 'NORMALIZATION_WARNING',
            severity: 'info',
            message: warning.message,
            source: 'validation',
            blocks_analysis: false,
          });
        }

        // Handle ISL 422 with structured critiques (V2, V1, or Pydantic format)
        if (islError?.is422()) {
          const islCritiques = mapISLCritiquesToV2(islError.getCritiques());
          critiques.push(...islCritiques);

          return reply.status(422).send(buildBlockedResponse(
            islError.getErrorMessage(),
            critiques
          ));
        }

        // Handle ISL failure (non-422)
        if (!islSuccess) {
          critiques.push({
            id: randomUUID(),
            code: 'ISL_CALL_FAILED',
            severity: 'error',
            message: 'ISL analysis failed. Please try again.',
            source: 'isl',
            blocks_analysis: false,
          });

          return reply.send(buildResponse(
            requestId,
            'failed',
            'ISL analysis failed',
            'error',
            'error',
            'error',
            critiques,
            {
              seedUsed,
              nSamples,
              detailLevel,
              latencyMs: totalMs,
              normalizationMs,
              validationMs,
              islMs,
              build: getBuildId(),
              repairs,
              sourcePath: 'isl',
            },
            responseHash
          ));
        }

        // Handle HTTP 200 with analysis_status='failed' from ISL
        const islAnalysisStatus = islResult.analysis_status;
        const islStatusReason = islResult.status_reason;

        if (islAnalysisStatus === 'failed') {
          return reply.send(buildResponse(
            requestId,
            'failed',
            islStatusReason || 'ISL analysis failed',
            'error',
            'error',
            'error',
            critiques,
            {
              seedUsed,
              nSamples,
              detailLevel,
              latencyMs: totalMs,
              normalizationMs,
              validationMs,
              islMs,
              build: getBuildId(),
              repairs,
              sourcePath: 'isl',
            },
            responseHash,
            islResult,
            normalizedOptions,
            islAnalysisStatus,
            islStatusReason
          ));
        }

        // =================================================================
        // Compute per-feature statuses
        // =================================================================
        // Transform sensitivity arrays FIRST - these are the final arrays that will be returned
        // Status check must use the SAME arrays to prevent status/response misalignment
        const edgeSensitivity = transformEdgeSensitivity(islResult.sensitivity);
        const factorSensitivity = transformFactorSensitivity(islResult.factor_sensitivity);
        const sensitivityData: SensitivityData = { edgeSensitivity, factorSensitivity };

        // Use hasNonEmptyArray on the FINAL transformed arrays (single source of truth)
        const hasEdgeSensitivity = hasNonEmptyArray(edgeSensitivity);
        const hasFactorSensitivity = hasNonEmptyArray(factorSensitivity);
        const hasDriversSensitivity = hasEdgeSensitivity || hasFactorSensitivity;

        // ISL V2 response uses 'options' field; V1 uses 'results'. Check both for compatibility.
        const optionComparisonData = islResult.options ?? islResult.results;
        const hasOptionComparison = hasNonEmptyArray(optionComparisonData);
        // Check for meaningful robustness data - support both V1 (score) and V2 (confidence) formats
        const hasRobustness = islResult.robustness?.score !== undefined
          || islResult.robustness?.confidence !== undefined
          || hasNonEmptyArray(islResult.robustness?.fragile_edges)
          || hasNonEmptyArray(islResult.robustness?.robust_edges);

        const optionStatus = mapToPerFeatureStatus(islAnalysisStatus, hasOptionComparison);
        const robustnessStatus = mapToPerFeatureStatus(islAnalysisStatus, hasRobustness);
        const driversStatus = mapToPerFeatureStatus(islAnalysisStatus, hasDriversSensitivity);

        // Debug logging for drivers status decisions (gated at debug level)
        req.log.debug({
          event: 'drivers_status_decision',
          edge_len: edgeSensitivity?.length ?? 0,
          factor_len: factorSensitivity?.length ?? 0,
          hasEdgeSensitivity,
          hasFactorSensitivity,
          hasDriversSensitivity,
          isl_analysis_status: islAnalysisStatus,
          chosen_status: driversStatus,
        });

        // Warn if ISL claims 'computed' but returned no data
        if (islAnalysisStatus === 'computed' && !hasOptionComparison && !hasRobustness && !hasDriversSensitivity) {
          critiques.push({
            id: randomUUID(),
            code: 'ISL_EMPTY_RESULTS',
            severity: 'warning',
            message: 'Analysis completed but no results available. Graph structure may prevent causal inference.',
            source: 'isl',
            blocks_analysis: false,
          });
        }

        // Extract option outcomes for status determination
        // Use optionComparisonData which already handles V1/V2 format fallback
        const optionOutcomes = optionComparisonData?.map((r: any) => ({
          option_id: r.option_id,
          expected_outcome: r.expected_outcome,
        }));

        const topLevelStatus = determineTopLevelStatus(
          optionStatus,
          robustnessStatus,
          driversStatus,  // Uses hasDriversSensitivity which checks both edge AND factor
          optionOutcomes
        );

        // =================================================================
        // Phase 6: CEE Review (optional, non-blocking)
        // =================================================================
        // Build enriched robustness data for CEE
        const robustnessDataForCee = buildRobustnessDataForCee(
          islResult.robustness,
          islResult.factor_sensitivity,
          islResult.recommended_option_id,
          filteredGraph,
          normalizedOptions
        );

        // Request CEE review (graceful degradation - returns null on failure)
        // Pass brief for contextualised CEE output when available
        const ceeOrchestrationResult = await requestCeeReview(
          responseHash ?? requestId, // Use response hash as scenario ID
          filteredGraph,
          normalizedOptions,
          islResult,
          robustnessDataForCee,
          requestId,
          req.log,
          body.brief
        );

        const finalTotalMs = performance.now() - startTime;

        return reply.send(buildResponse(
          requestId,
          topLevelStatus,
          topLevelStatus !== 'computed' ? (islStatusReason || 'Some analyses unavailable') : undefined,
          optionStatus,
          robustnessStatus,
          driversStatus,
          critiques,
          {
            seedUsed,
            nSamples,
            detailLevel,
            latencyMs: finalTotalMs,
            normalizationMs,
            validationMs,
            islMs,
            ceeMs: ceeOrchestrationResult.latencyMs,
            build: getBuildId(),
            repairs,
            sourcePath: 'isl',
          },
          responseHash,
          islResult,
          normalizedOptions,
          islAnalysisStatus,
          islStatusReason,
          ceeOrchestrationResult.robustnessSynthesis,
          ceeOrchestrationResult.ceeResults,
          ceeOrchestrationResult.ceeTrace,
          sensitivityData  // Pre-computed arrays ensure status/response alignment
        ));
      } catch (err) {
        const totalMs = performance.now() - startTime;

        req.log.error({
          event: 'v2_run_error',
          error: (err as Error).message,
          stack: (err as Error).stack,
        });

        // Internal errors return 500 with error.v1 envelope (NOT 422 V2RunError)
        // This distinguishes client validation errors (422) from server errors (500)
        return reply.status(500).send({
          schema: 'error.v1',
          code: 'INTERNAL',
          message: 'Internal server error',
          request_id: requestId,
          retryable: true,
        });
      }
    }
  );

  // HEAD endpoint for probing
  app.head('/v2/run', async (_req, reply) => {
    reply.header('Allow', 'POST, OPTIONS, HEAD');
    return reply.code(405).send();
  });
}
