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

import { randomUUID, createHash } from 'node:crypto';
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
  NearTieInfoV3,
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
  GoalConstraint,
  ConstraintResult,
  ConstraintDiagnostic,
  ConditionalProbability,
  ConstraintFeatureStatus,
  ThresholdsStatus,
  ThresholdResult,
  FactorStabilityEntry,
  StabilityThresholds,
  InferenceWarning,
} from '../../types/engine-v3.js';
import { INFERENCE_WARNING_CODES } from '../../types/engine-v3.js';
import { addUserMessages } from '../../critique-humaniser.js';
import type { GraphForLabels } from '../../critique-humaniser.js';
// Seed derivation: when seed omitted, derive deterministically from graph hash
import { NormalisationError, cleanLabelAnnotation, type NormalisationWarning } from '../../normalisation/graph-normaliser.js';
import { normaliseGraphWithRepairs } from '../../normalisation/normalise-and-repair.js';
import { filterOptionNodes } from '../../normalisation/option-filter.js';
import { hashRequest, HASH_VERSION } from '../../normalisation/canonicalise.js';
import { hashGraph, deriveSeedFromHash } from '../../sampling/graph-hash.js';
import { runPreflightValidation, validateGoalConstraints, filterInvalidBidirectedEdges } from '../../validation/preflight-v2.js';
import { compileConstraintNodes } from '../../normalisation/constraint-compiler.js';
import { filterTemporalConstraints } from '../../normalisation/constraint-filter.js';
import { REPAIR_CODES } from '../../normalisation/repair-codes.js';
import { MAX_CONSTRAINTS } from '../../constants/limits.js';
import type { RawGoalConstraint, FilteredConstraintRecord, InternalMetadata } from '../../types/engine-v3.js';
import type { IslThresholdResponse, ThresholdPoint } from '../v1/types/proxy.types.js';
import { toISLRobustnessRequest, validateISLRequest } from '../../integrations/isl/translator-v3.js';
import { injectConstraintParameterUncertainties } from '../../integrations/isl/constraint-pu-injection.js';
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
import { orchestrateDecisionReview, type DecisionReviewInput, type DecisionReviewConfig } from '../../cee/decision-review-orchestrator.js';
import {
  CEE_TIMEOUT_MS,
  CEE_DECISION_REVIEW_TIMEOUT_MS,
  ISL_THRESHOLDS_TIMEOUT_MS_CAP,
  THRESHOLDS_MIN_REMAINING_BUDGET_MS,
  REQUEST_BUDGET_MS,
} from '../../config/timeouts.js';
import { createISLInferenceFn, resolveFlipValues } from '../../analysis/flip-thresholds.js';
import { computeFlipThresholdData } from '../../coaching/flip-thresholds.js';
import { denormaliseFlipThresholds, type DenormalisedFlipThreshold } from '../../lib/flip-threshold-denormaliser.js';
import type { CeeReviewRequest, CeeTrace, FactorEnrichment } from '../../cee/types.js';
// CIL Phase 1: Shared types from @talchain/schemas
import type { SeedSourceType } from '@talchain/schemas';
import { factorReviewV2, type CEESchemaV2Config } from '../../cee/client.js';
import { FLAGS } from '../../config/flags.js';
import { getAllFeatureFlags } from '../../config/feature-flags.js';
import { generateM1Coaching } from '../../coaching/m1-coaching.js';
import { filterInterventionOverrides } from '../../coaching/sensitivity-filter.js';
import type { M1Review } from '../../cee/validation/m1-review-types.js';
import type { ReviewStatus } from '../../cee/validation/m1-review-constants.js';
import { ReviewSkipReasons, type ReviewSkipReason } from '../../cee/validation/m1-review-constants.js';
import { getDownstreamCallsForLog } from '../../util/downstream-tracker.js';
import { computeFactorSensitivityFromGraph, buildFactorStability, mergeIslConfidenceIntoGraphFactors } from '../../lib/factor-influence.js';
import { NEAR_TIE_THRESHOLD } from '../../trust/result-coherence.js';
import { assessGraphIdentifiability, toIdentifiabilityResponse, detectUnmeasuredConfounding } from '../../trust/identifiability-v2.js';
import type { IdentifiabilityAssessment } from '../../types/engine-v3.js';
import {
  normaliseOptionsForISL,
  denormaliseISLResult,
  needsNormalisation,
  type NormalisationContext,
  type NormalisationDiagnostic,
} from '../../lib/intervention-normaliser.js';
import { assembleBrief } from '../../assembly/decision-brief.js';
import { buildEvidencePriorityCard, type FactorInput } from '../../review-pass/evidence-priority.js';
import type { ProposalCardV1 } from '../../review-pass/types.js';
import { assembleFactObjects, type ISLResponseInput } from '../../facts/index.js';
import type { FactObjectV1, FactLineage } from '../../facts/types.js';

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
// F.6 Data Responsibility — Repair Append Helper
// -----------------------------------------------------------------------------

/**
 * Append a canonical F.5 repair entry to the repairs array.
 *
 * Only appends when `before !== after` (delta exists). Validates required fields.
 * Layer is always 'plot' for PLoT transforms.
 *
 * Ordering convention (enforced at call sites):
 *   1. Compilation-strip entries (STRIP_RAW_CONSTRAINT_FIELDS) — before ISL field pass
 *   2. Temporal-filter entries (FILTER_TEMPORAL_CONSTRAINT) — after compilation
 */
function appendRepair(
  repairs: RepairRecord[],
  entry: {
    code: string;
    field_path: string;
    before: unknown;
    after: unknown;
    reason: string;
    severity: 'info' | 'warn';
  }
): void {
  // Validate required fields
  if (!entry.code || !entry.field_path) return;
  // Only append when a delta exists
  if (JSON.stringify(entry.before) === JSON.stringify(entry.after)) return;
  repairs.push({
    // Legacy RepairRecord fields (required by type)
    field: entry.field_path,
    action: 'removed',
    from_value: typeof entry.before === 'string' || typeof entry.before === 'number' ? entry.before : JSON.stringify(entry.before),
    to_value: entry.after === null ? 'null' : (typeof entry.after === 'string' || typeof entry.after === 'number' ? entry.after : JSON.stringify(entry.after)),
    reason: entry.reason,
    // F.5 canonical fields
    code: entry.code,
    layer: 'plot',
    field_path: entry.field_path,
    before: entry.before,
    after: entry.after,
    severity: entry.severity,
  });
}

// -----------------------------------------------------------------------------
// Repair Extraction
// -----------------------------------------------------------------------------

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
 * Preserves ALL ISL fields including new influence_score and zero_reason fields.
 * Returns undefined if input is not a non-empty array.
 *
 * Field mapping: ISL uses node_id, PLoT uses factor_id.
 * All other fields are preserved verbatim for forward compatibility.
 */
function transformFactorSensitivity(islFactorSensitivity: unknown): FactorSensitivityResultV3[] | undefined {
  if (!hasNonEmptyArray(islFactorSensitivity)) return undefined;
  // Task 2: Filter out intervention_override factors (decision levers, not uncertainty drivers)
  const filtered = filterInterventionOverrides(islFactorSensitivity as any[]);
  return filtered.map((f: any) => {
    // Schema v2.6 canonical field is 'sensitivity_score'; legacy used 'sensitivity'
    // Support both for backward compatibility
    const sensitivityValue = f.sensitivity_score ?? f.sensitivity;

    // Defensive logging: warn if no numeric sensitivity value found
    // This helps identify if ISL is returning incomplete data
    if (sensitivityValue === undefined) {
      console.warn('[FACTOR_SENSITIVITY_MISSING_NUMERIC]', JSON.stringify({
        node_id: f.node_id,
        available_keys: Object.keys(f),
        message: 'ISL did not provide sensitivity_score — UI will show "unavailable"',
      }));
    }

    // IMPORTANT: Do NOT default missing values to 0.
    // Missing data means "we couldn't compute influence" which is semantically
    // different from "this factor has zero influence". Let undefined pass through.
    // Preserve ALL ISL fields - do not silently drop any.
    const entry: FactorSensitivityResultV3 = {
      // Core identification
      factor_id: f.node_id ?? f.factor_id,
      factor_label: f.label ?? null,

      // Influence fields from ISL
      influence_score: f.influence_score ?? null,
      influence_rank: f.influence_rank ?? null,

      // Existing sensitivity fields
      sensitivity_score: sensitivityValue,  // undefined if ISL didn't provide it
      elasticity: f.elasticity ?? null,
      direction: (f.direction as 'positive' | 'negative' | 'mixed' | 'unknown') ?? null,
      importance_rank: f.importance_rank ?? null,
      interpretation: f.interpretation ?? null,
      value_of_information: f.value_of_information ?? null,

      // Confidence: derive from value_of_information if ISL provides it
      confidence: f.confidence ?? f.value_of_information ?? null,

      // Zero reason field (when sensitivity_score = 0)
      zero_reason: f.zero_reason ?? null,

      // Mark source as ISL
      source: 'isl' as const,
    };

    // 3C stability fields — carry through when ISL provides them
    if (f.elasticity_std !== undefined) entry.elasticity_std = f.elasticity_std;
    if (f.attribution_stability !== undefined) entry.attribution_stability = f.attribution_stability;
    if (f.rank_flip_rate !== undefined) entry.rank_flip_rate = f.rank_flip_rate;
    if (f.stability_method !== undefined) entry.stability_method = f.stability_method;

    return entry;
  });
}

/**
 * Validate and extract stability_thresholds from ISL response.
 * Returns undefined if absent or malformed.
 */
function extractStabilityThresholds(islResult: any): StabilityThresholds | undefined {
  const st = islResult?.stability_thresholds;
  if (!st || typeof st !== 'object') return undefined;
  if (
    !Number.isFinite(st.high_moderate_boundary) ||
    !Number.isFinite(st.moderate_low_boundary) ||
    typeof st.version !== 'string' || st.version === '' ||
    typeof st.provisional !== 'boolean'
  ) return undefined;
  return {
    high_moderate_boundary: st.high_moderate_boundary,
    moderate_low_boundary: st.moderate_low_boundary,
    version: st.version,
    provisional: st.provisional,
  };
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

// CIL Phase 0: Validation rejects unknown TOP-LEVEL keys only.
// Nested objects (graph.nodes[], graph.edges[], options[].interventions)
// intentionally allow unknown keys for forward compatibility with UI/CEE
// additive fields. Unknown nested fields are silently dropped during
// normalisation/translation — they do not reach ISL or the response.
// CIL Phase 1: This allowlist will be derived from @olumi/schemas V2RunRequestSchema.shape keys. Do not manually update — coordinate via schema package.
const V2_RUN_ALLOWED_KEYS = new Set([
  'graph', 'options', 'goal_node_id',
  'seed', 'n_samples', 'detail_level', 'request_id', 'idempotency_key',
  'goal_threshold', 'brief', 'goal_constraints', 'include_thresholds',
]);

const runV3Schema = {
  body: {
    type: 'object',
    required: ['graph', 'options', 'goal_node_id'],
    additionalProperties: false,
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
      brief: { type: 'string', maxLength: 10000 },
      goal_constraints: {
        type: 'array',
        items: { type: 'object' },
      },
      include_thresholds: { type: 'boolean' },
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
  /** CIL Phase 1: Seed origin — type from @talchain/schemas SeedSource */
  seedSource: SeedSourceType;
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
  /** UI build version from x-olumi-client-build header */
  uiBuild?: string;
  /** CEE build version from CEE response */
  ceeBuild?: string;
  /**
   * ISO 8601 timestamp when analysis computation completed.
   * Captured when ISL response is received.
   */
  computedAt?: string;
  /** Request ID chain for end-to-end tracing (Brief 4 spec) */
  requestIdChain?: {
    /** Request ID from incoming request (null if auto-generated) */
    ui: string | null;
    /** PLoT's own request ID */
    plot: string | null;
    /** Request ID PLoT sent to ISL (null if ISL not called) */
    isl: string | null;
    /** Request ID ISL echoed back (null if ISL didn't echo) */
    isl_echoed: string | null;
    /** true ONLY when all four are non-null AND identical */
    all_match: boolean;
    /** true ONLY when all four are non-null */
    chain_complete: boolean;
  };
  /** Filtered constraint records for _meta.filtered_constraints */
  filteredConstraints?: import('../../types/engine-v3.js').FilteredConstraintRecord[];
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
 * Canonical builder for all V2RunError responses.
 * Ensures field consistency across blocked (422) and failed error shapes.
 */
function buildV2RunError({
  analysisStatus,
  statusReason,
  retryable,
  requestId,
  computedAt,
  critiques = [],
}: {
  analysisStatus: 'blocked' | 'failed';
  statusReason: string;
  retryable: boolean;
  requestId: string;
  computedAt: string;
  critiques?: CritiqueV3[];
}): V2RunError {
  return {
    analysis_status: analysisStatus,
    status_reason: statusReason,
    critiques,
    // CIL 0.2: maintain robustness contract on error responses
    robustness: {
      fragile_edges: [],
      robust_edges: [],
    },
    retryable,
    meta: {
      request_id: requestId,
      computed_at: computedAt,
    },
  };
}

/**
 * Build a 422 blocked response (V2RunError).
 * V2 contract: blocked = 422, communicates failure via analysis_status.
 * NOT wrapped in error.v1 envelope.
 */
function buildBlockedResponse(
  statusReason: string,
  critiques: CritiqueV3[],
  graph: GraphForLabels | undefined,
  options: ReadonlyArray<{ id: string; label: string }> | undefined,
  requestId: string,
  computedAt: string,
): V2RunError {
  // V2 contract: blocked = 422, communicates failure via analysis_status
  return buildV2RunError({
    analysisStatus: 'blocked',
    statusReason,
    retryable: false,
    requestId,
    computedAt,
    critiques: addUserMessages(critiques, graph, options),
  });
}

/**
 * Determine retryability from ISL HTTP status code.
 * V2 contract: failed = 200, communicates failure via analysis_status.
 */
function retryableFromIslStatus(status?: number): boolean {
  if (!status) return true;          // network/timeout/no response
  if (status === 401) return false;  // auth failure — client must fix credentials
  if (status === 429) return true;   // rate-limited — retry after back-off
  if (status >= 400 && status < 500) return false;  // other client errors
  return true;                       // 5xx, unknown → retry
}

// Pre-computed sensitivity data to ensure status/response alignment
interface SensitivityData {
  edgeSensitivity: ReturnType<typeof transformEdgeSensitivity>;
  factorSensitivity: ReturnType<typeof transformFactorSensitivity>;
  factorEnrichments?: FactorEnrichment[];
}

/**
 * Compute near-tie detection from option comparison results.
 *
 * A near-tie is detected when the gap between the top two options
 * is less than NEAR_TIE_THRESHOLD (10%).
 *
 * @param optionComparison Array of option comparison results
 * @returns Near-tie info object
 */
export function computeNearTie(
  optionComparison: Array<{ option_id: string; win_probability?: number; status?: string }> | undefined
): NearTieInfoV3 | undefined {
  if (!optionComparison || optionComparison.length === 0) {
    return undefined;
  }

  // Filter to options where status === 'computed' and win_probability is valid
  const validOptions = optionComparison.filter(
    (o) =>
      (o.status === undefined || o.status === 'computed') &&
      o.win_probability !== undefined &&
      o.win_probability !== null &&
      Number.isFinite(o.win_probability)
  );

  if (validOptions.length === 0) {
    return undefined;
  }

  // Sort descending by win_probability
  const sorted = [...validOptions].sort((a, b) => b.win_probability! - a.win_probability!);

  const topOption = sorted[0];
  const topWinProb = topOption.win_probability!;

  // Single valid option case
  if (sorted.length === 1) {
    return {
      is_tie: false,
      top_option_id: topOption.option_id,
      second_option_id: null,
      tied_option_ids: [],
      gap: 1.0, // No comparison possible
      threshold: NEAR_TIE_THRESHOLD,
    };
  }

  // Two or more valid options
  const secondOption = sorted[1];
  const secondWinProb = secondOption.win_probability!;
  const gap = topWinProb - secondWinProb;
  const isTie = gap < NEAR_TIE_THRESHOLD;

  // Find all options within threshold of top performer
  const tiedOptionIds = sorted
    .filter((o) => (topWinProb - o.win_probability!) < NEAR_TIE_THRESHOLD)
    .map((o) => o.option_id);

  return {
    is_tie: isTie,
    top_option_id: topOption.option_id,
    second_option_id: secondOption.option_id,
    tied_option_ids: tiedOptionIds,
    gap,
    threshold: NEAR_TIE_THRESHOLD,
  };
}

/**
 * Derive recommended option from win_probability values.
 *
 * Winner definition: argmax(option_comparison[].win_probability)
 *
 * Tie-break rules (for determinism):
 * - If multiple options have win_probability within epsilon (1e-9), use lexicographic sort on option_id
 *
 * @param optionComparison Array of option comparison results with win_probability
 * @param options Original options array for label lookup
 * @returns Recommended option ID and label, or undefined if no valid winner
 *
 * @public Exported for unit testing
 */
export function deriveRecommendedOption(
  optionComparison: Array<{ option_id: string; option_label?: string; win_probability?: number }> | undefined,
  options: OptionV3[] | undefined
): { recommended_option_id: string; recommended_option_label: string } | undefined {
  if (!optionComparison || optionComparison.length === 0) {
    return undefined;
  }

  // Filter to options with valid win_probability
  const validOptions = optionComparison.filter(
    (o) => o.win_probability !== undefined && o.win_probability !== null && Number.isFinite(o.win_probability)
  );

  if (validOptions.length === 0) {
    return undefined;
  }

  // Find max win_probability
  const maxWinProbability = Math.max(...validOptions.map((o) => o.win_probability!));

  // Epsilon for floating point comparison (1e-9 as specified)
  const EPSILON = 1e-9;

  // Find all options within epsilon of max (potential ties)
  const topOptions = validOptions.filter(
    (o) => Math.abs(o.win_probability! - maxWinProbability) < EPSILON
  );

  // Tie-breaker: lexicographic sort on option_id
  topOptions.sort((a, b) => a.option_id.localeCompare(b.option_id));

  const winner = topOptions[0];
  const winnerId = winner.option_id;

  // Label fallback chain:
  // 1. Graph node label where node.id === winner_option_id (preferred)
  // 2. option_comparison[].label or option_comparison[].option_label if present
  // 3. option_id as final fallback
  const graphOption = options?.find((o) => o.id === winnerId);
  const winnerLabel = graphOption?.label ?? winner.option_label ?? winnerId;

  return {
    recommended_option_id: winnerId,
    recommended_option_label: winnerLabel,
  };
}

/**
 * CIL C1: Extract top-level constraint fields from ISL response.
 *
 * ISL nests constraint_analysis per-option. For the top-level response we need:
 * - constraints_status: 'computed' | 'unavailable' | omitted
 * - constraint_results: merged from first option's constraint_analysis.constraints
 * - constraint_diagnostics: extracted from constraint_analysis.constraints diagnostic fields
 * - conditional_probabilities: from first option's constraint_analysis.conditional_probabilities
 *
 * We use the first option's constraint_analysis as the canonical source for top-level
 * constraint metadata (diagnostics and conditional probabilities are per-graph, not per-option).
 */
function buildConstraintFields(
  goalConstraints: GoalConstraint[] | undefined,
  islResult: any
): {
  constraints_status?: ConstraintFeatureStatus;
  constraint_results?: ConstraintResult[];
  constraint_diagnostics?: ConstraintDiagnostic[];
  conditional_probabilities?: ConditionalProbability[];
} {
  // No constraints sent → omit all constraint fields
  if (!goalConstraints || goalConstraints.length === 0) {
    return {};
  }

  // Find first option with constraint_analysis data
  const islOptionData = islResult?.options ?? islResult?.results;
  const firstOptionWithConstraints = Array.isArray(islOptionData)
    ? islOptionData.find((r: any) => r.constraint_analysis?.constraints)
    : undefined;

  if (!firstOptionWithConstraints?.constraint_analysis) {
    // Constraints sent but ISL returned no constraint_analysis
    return { constraints_status: 'unavailable' };
  }

  const analysis = firstOptionWithConstraints.constraint_analysis;
  const islConstraints: any[] = analysis.constraints ?? [];

  // Resolve a constraint_id from ISL's echoed result back to the input constraint.
  // Match on (node_id, operator, value) to handle duplicate-target edge cases.
  // F-20: ISL may return canonical "value" or legacy "threshold" — accept both.
  const resolveConstraintId = (islC: any): string => {
    const islValue = islC.value ?? islC.threshold;
    const match = goalConstraints.find(
      gc => gc.node_id === islC.node_id && gc.operator === islC.operator && gc.value === islValue
    ) ?? goalConstraints.find(
      gc => gc.node_id === islC.node_id && gc.operator === islC.operator
    );
    return match?.constraint_id ?? `${islC.node_id}_${islC.operator}`;
  };

  // Map ISL constraint results to Schema v2.7 ConstraintResult[]
  // F-20: ISL may return canonical "value" or legacy "threshold" — accept both.
  const constraintResults: ConstraintResult[] = islConstraints.map((c: any) => ({
    constraint_id: resolveConstraintId(c),
    node_id: c.node_id,
    operator: c.operator as '>=' | '<=',
    value: c.value ?? c.threshold,
    probability: c.prob_satisfied,
  }));

  // Extract diagnostics from ISL constraint results
  const constraintDiagnostics: ConstraintDiagnostic[] = islConstraints
    .filter((c: any) => c.failure_margin_median !== undefined || c.near_miss_fraction !== undefined || c.binding !== undefined)
    .map((c: any) => ({
      constraint_id: resolveConstraintId(c),
      failure_margin_median: c.failure_margin_median ?? 0,
      near_miss_fraction: c.near_miss_fraction ?? 0,
      binding: c.binding ?? false,
    }));

  // Map ISL conditional probabilities (index-based → constraint_id-based)
  let conditionalProbabilities: ConditionalProbability[] | undefined;
  if (Array.isArray(analysis.conditional_probabilities) && analysis.conditional_probabilities.length > 0) {
    conditionalProbabilities = analysis.conditional_probabilities
      .filter((cp: any) =>
        cp.given_constraint_index < islConstraints.length &&
        cp.target_constraint_index < islConstraints.length
      )
      .map((cp: any) => {
        const givenConstraint = islConstraints[cp.given_constraint_index];
        const targetConstraint = islConstraints[cp.target_constraint_index];
        return {
          given_constraint_id: resolveConstraintId(givenConstraint),
          target_constraint_id: resolveConstraintId(targetConstraint),
          probability: cp.probability,
          effective_sample_size: cp.effective_sample_size ?? 0,
        };
      });
  }

  return {
    constraints_status: 'computed',
    constraint_results: constraintResults.length > 0 ? constraintResults : undefined,
    constraint_diagnostics: constraintDiagnostics.length > 0 ? constraintDiagnostics : undefined,
    conditional_probabilities: conditionalProbabilities,
  };
}

/**
 * Build a 6-field request_id_chain per Brief 4 spec.
 *
 * @internal Exported for testing only.
 * @param hasExplicitRequestId - true when request ID came from header/body (not auto-generated)
 * @param requestId - PLoT's resolved request ID
 * @param islCalled - true when ISL was actually called (requestId was forwarded)
 * @param islEchoedRequestId - request ID ISL returned, or null
 */
export function buildRequestIdChain(
  hasExplicitRequestId: boolean,
  requestId: string,
  islCalled: boolean,
  islEchoedRequestId: string | null,
): NonNullable<MetaParams['requestIdChain']> {
  const ui = hasExplicitRequestId ? requestId : null;
  const plot = requestId;
  const isl = islCalled ? requestId : null;
  const isl_echoed = islEchoedRequestId;
  const chain_complete = ui !== null && plot !== null && isl !== null && isl_echoed !== null;
  const all_match = chain_complete && ui === plot && plot === isl && isl === isl_echoed;
  return { ui, plot, isl, isl_echoed, all_match, chain_complete };
}

/**
 * Build X-Olumi-Request-Id-Chain header JSON from request ID chain.
 * Field names match _meta.request_id_chain (Brief 4 spec — 6 fields).
 */
function buildRequestIdChainHeader(chain: MetaParams['requestIdChain']): string | null {
  if (!chain) return null;
  return JSON.stringify(chain);
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
  graph?: EngineGraphV3, // Added for fragile edge label enrichment (Schema v2.6)
  islAnalysisStatus?: string,
  islStatusReason?: string,
  robustnessSynthesis?: RobustnessSynthesisV3 | null,
  ceeResults?: CeeResultsParams,
  ceeTrace?: CeeTrace | null,
  sensitivityData?: SensitivityData,
  m1Coaching?: any,
  m2DecisionReview?: {
    m1_review: M1Review | null;
    review_status: ReviewStatus;
    review_meta?: { model?: string; latency_ms?: number; tokens?: number };
    review_failure_codes?: string[];
    review_warnings?: string[];
    review_skip_reason?: ReviewSkipReason;
  },
  flipThresholds?: DenormalisedFlipThreshold[],
  goalConstraints?: GoalConstraint[],
  thresholdsStatus?: ThresholdsStatus,
  thresholdsMeta?: { reason?: string; duration_ms?: number },
  thresholdAnalysis?: ThresholdResult[],
  identifiability?: IdentifiabilityAssessment,
  factorStability?: FactorStabilityEntry[],
  logger?: { info: (obj: object, msg?: string) => void }
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

    const resolvedOptionLabel = option?.label ?? r.label ?? optionId;

    // Build result object - only include optional fields if present
    // NOTE: expected_outcome and confidence_interval (V1 legacy) removed from V2 response.
    // Use outcome.mean and [outcome.p10, outcome.p90] instead.
    const result: any = {
      option_id: optionId,
      option_label: resolvedOptionLabel,
      // CIL 0.1: populate id/label from option_id/option_label for UI consumers
      id: r.id ?? optionId,
      label: r.label ?? resolvedOptionLabel,
      // Full outcome stats (V2 format)
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

    // CIL C1: Pass through per-option constraint analysis from ISL
    // ISL nests this as constraint_analysis per-option when goal_constraints were sent
    const constraintAnalysis = r.constraint_analysis;
    if (constraintAnalysis) {
      // Map ISL's joint_probability to Schema v2.7 probability_of_joint_goal
      if (constraintAnalysis.joint_probability !== undefined) {
        result.probability_of_joint_goal = constraintAnalysis.joint_probability;
      }

      // Map ISL's per-constraint prob_satisfied to constraint_probabilities map
      // Uses goal_constraints input to resolve constraint_id from index position
      if (Array.isArray(constraintAnalysis.constraints) && constraintAnalysis.constraints.length > 0) {
        const constraintProbs: Record<string, number> = {};
        for (let i = 0; i < constraintAnalysis.constraints.length; i++) {
          const c = constraintAnalysis.constraints[i];
          // Resolve constraint_id: match by (node_id, operator, value)
          // F-20: ISL may return canonical "value" or legacy "threshold" — accept both.
          const islValue = c.value ?? c.threshold;
          const match = goalConstraints?.find(
            gc => gc.node_id === c.node_id && gc.operator === c.operator && gc.value === islValue
          ) ?? goalConstraints?.find(
            gc => gc.node_id === c.node_id && gc.operator === c.operator
          );
          const constraintId = match?.constraint_id ?? `${c.node_id}_${c.operator}`;
          constraintProbs[constraintId] = c.prob_satisfied;
        }
        result.constraint_probabilities = constraintProbs;
      }
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

    // Build node ID → label lookup for from_label/to_label resolution (Schema v2.6)
    const nodeLabelMap = new Map<string, string>();
    if (graph?.nodes) {
      for (const node of graph.nodes) {
        nodeLabelMap.set(node.id, node.label);
      }
    }

    // Build option ID → label lookup for alternative_winner_label resolution
    // Options are organisational nodes not in graph.nodes (Schema v2.6 §A.1)
    // Apply cleanLabelAnnotation to ensure consistency with cleaned node labels
    const optionLabelMap = new Map<string, string>();
    if (options) {
      for (const opt of options) {
        const cleanedLabel = cleanLabelAnnotation(opt.label);
        optionLabelMap.set(opt.id, cleanedLabel || opt.id);
      }
    }

    // Enrich fragile edges with labels (Schema v2.6: from_label, to_label, alternative_winner_label)
    const enrichedFragileEdges: NormalizedEdgeInfoV3[] = fragileResult.edges.map(edge => ({
      ...edge,
      // from_label and to_label from graph lookup, fall back to node ID if not found
      from_label: nodeLabelMap.get(edge.from_id) ?? edge.from_id,
      to_label: nodeLabelMap.get(edge.to_id) ?? edge.to_id,
      // Resolve alternative_winner_label from option ID (null when no alternative winner)
      alternative_winner_id: edge.alternative_winner_id ?? null,
      alternative_winner_label: edge.alternative_winner_id
        ? (optionLabelMap.get(edge.alternative_winner_id) ?? edge.alternative_winner_id)
        : null,
    }));

    // Enrich robust edges with labels (Schema v2.6)
    const enrichedRobustEdges: NormalizedEdgeInfoV3[] = robustResult.edges.map(edge => ({
      ...edge,
      from_label: nodeLabelMap.get(edge.from_id) ?? edge.from_id,
      to_label: nodeLabelMap.get(edge.to_id) ?? edge.to_id,
      // Robust edges don't have alternative_winner, explicitly set to null
      alternative_winner_id: null,
      alternative_winner_label: null,
    }));

    robustness = {
      score: islResult.robustness.score,
      label,
      fragile_edges: enrichedFragileEdges,
      robust_edges: enrichedRobustEdges,
      explanation: islResult.robustness.explanation,
      // Pass through recommendation_stability from ISL if present
      ...(islResult.robustness.recommendation_stability !== undefined && {
        recommendation_stability: islResult.robustness.recommendation_stability,
      }),
      // Pass through V2/Option C robustness summary fields from ISL
      ...(islResult.robustness.is_robust !== undefined && {
        is_robust: islResult.robustness.is_robust,
      }),
      ...(islResult.robustness.level !== undefined && {
        level: islResult.robustness.level,
      }),
      ...(islResult.robustness.confidence !== undefined && {
        confidence: islResult.robustness.confidence,
      }),
      // Include normalization errors if any occurred (for observability)
      ...(normalizationErrors.length > 0 && { normalization_errors: normalizationErrors }),
    };
  }

  // CIL Phase 0: Guarantee robustness object always exists with fragile_edges/robust_edges
  // as arrays (never undefined/null/absent). Eliminates polymorphism for downstream consumers.
  if (!robustness) {
    robustness = {
      fragile_edges: [],
      robust_edges: [],
    };
  }

  // Derive recommended option from win_probability (after optionComparison is built)
  const recommendedOption = deriveRecommendedOption(optionComparison, options);

  // Add recommended_option_id and recommended_option_label to robustness if derived
  if (recommendedOption) {
    robustness.recommended_option_id = recommendedOption.recommended_option_id;
    robustness.recommended_option_label = recommendedOption.recommended_option_label;
  }

  // Compute near-tie detection (after optionComparison is built)
  const nearTie = computeNearTie(optionComparison);
  if (nearTie) {
    robustness.near_tie = nearTie;
  }

  // Extract factor_enrichments from sensitivityData (if present)
  const factorEnrichments = sensitivityData?.factorEnrichments;

  // Extract stability_thresholds and detect diagnostic warnings
  const stabilityThresholdsExtracted = extractStabilityThresholds(islResult);
  const inferenceWarnings: InferenceWarning[] = [];

  // Emit warning when ISL returned factor-level 3C fields but stability_thresholds
  // was absent or malformed — helps diagnose missing threshold classification context.
  if (!stabilityThresholdsExtracted) {
    const factors = Array.isArray(islResult?.factor_sensitivity)
      ? islResult.factor_sensitivity
      : [];
    const has3CFields = factors.some(
      (f: any) => f.stability_method || f.attribution_stability,
    );
    if (has3CFields) {
      inferenceWarnings.push({
        code: INFERENCE_WARNING_CODES.STABILITY_THRESHOLDS_MISSING,
        message: 'ISL returned factor-level stability fields but stability_thresholds metadata was absent or malformed — threshold classification context unavailable',
        severity: 'info',
      });
    }
  }

  // Pre-compute decision_brief and review_cards so _meta can reference them.
  const assembledBrief = assembleBrief({
    analysis_status: analysisStatus,
    critiques,
    option_comparison: optionComparison,
    factor_sensitivity: factorSensitivity,
    robustness,
    m1_coaching: m1Coaching,
    m1_review: m2DecisionReview?.m1_review ?? undefined,
    response_hash: responseHash,
    meta: { seed_used: meta.seedUsed },
  });

  // Review cards: evidence priority card from factor sensitivity data.
  // Gated behind ENABLE_REVIEW_PASS. Excluded from response_hash.
  const assembledReviewCards: ProposalCardV1[] = [];
  if (FLAGS.ENABLE_REVIEW_PASS) {
    const epFactors: FactorInput[] = (factorSensitivity ?? []).map((fs: any) => ({
      factor_id: fs.factor_id,
      factor_label: fs.factor_label ?? fs.factor_id,
      elasticity: fs.elasticity ?? fs.sensitivity_score ?? 0,
      confidence: fs.confidence ?? undefined,
      attribution_stability: fs.attribution_stability ?? undefined,
      incoming_edges: graph
        ? graph.edges.filter((e) => e.to === fs.factor_id).map((e) => ({ exists_probability: e.exists_probability }))
        : undefined,
    }));
    const epCard = buildEvidencePriorityCard(epFactors);
    if (epCard) assembledReviewCards.push(epCard);
  }

  // Stream D: FactObjectV1 assembly (F.7) — mirrors /v1/run_bundle pattern.
  // Gated behind ENABLE_FACTS_ASSEMBLY. Excluded from response_hash.
  let assembledFactObjects: FactObjectV1[] | undefined;
  if (FLAGS.ENABLE_FACTS_ASSEMBLY) {
    const graphForHash = graph ?? { nodes: [], edges: [] };
    const graphHashForLineage = createHash('sha256')
      .update(JSON.stringify({ nodes: graphForHash.nodes, edges: graphForHash.edges }))
      .digest('hex')
      .slice(0, 16);

    const lineage: FactLineage = {
      graph_hash: graphHashForLineage,
      seed: Number(meta.seedUsed) || 0,
      config_version: '1',
      isl_request_id: requestId,
    };

    // Map V2 analysis data to ISLResponseInput shape
    const islInput: ISLResponseInput = {
      analysis_status: analysisStatus === 'blocked' ? 'failed' : analysisStatus,
      options: optionComparison?.map((oc: Record<string, unknown>) => ({
        option_id: oc.option_id as string,
        label: oc.label as string | undefined,
        outcome: oc.outcome as { p10?: number; p50?: number; p90?: number; mean?: number } | undefined,
      })),
      factor_sensitivity: factorSensitivity?.map((fs, idx) => ({
        node_id: fs.factor_id,
        label: fs.factor_label ?? undefined,
        sensitivity_score: fs.elasticity ?? 0,
        importance_rank: idx + 1,
        elasticity: fs.elasticity,
        direction: fs.direction === 'unknown' ? undefined : fs.direction,
        confidence: fs.confidence,
        attribution_stability: fs.attribution_stability,
      })),
      critiques: critiques?.map((c) => ({
        id: c.id ?? c.code,
        code: c.code,
        severity: c.severity,
        message: c.message ?? '',
        suggestion: c.suggestion,
        affected_option_ids: c.affected_option_ids,
        affected_node_ids: c.affected_node_ids,
      })),
      robustness: robustness ? {
        label: robustness.label,
        score: robustness.score,
      } : undefined,
    };

    const envelope = assembleFactObjects(islInput, lineage);
    assembledFactObjects = envelope.facts;
    // Log fact_objects.length at assembly time to spot payload explosions early in staging.
    logger?.info({ evt: 'fact_objects_assembled', count: assembledFactObjects.length, request_id: requestId }, 'fact_objects assembled');
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

    // CIL C1: Multi-constraint analysis fields
    ...buildConstraintFields(goalConstraints, islResult),

    isl_analysis_status: islAnalysisStatus,
    isl_status_reason: islStatusReason,

    critiques: addUserMessages(critiques, graph ?? { nodes: [] }, options),
    option_comparison: optionComparison,
    edge_sensitivity: edgeSensitivity,
    factor_sensitivity: factorSensitivity,
    // ISL stability assessment per factor (3C bootstrap analysis)
    // NOTE: Deterministic ISL output. Excluded from response_hash since v6.
    factor_stability: factorStability ?? [],
    // ISL stability threshold configuration (boundaries for attribution_stability categories)
    // NOTE: Configuration metadata, NOT in response_hash. The categorical labels it
    // influences (attribution_stability in factor_stability) are already in the hash.
    ...(stabilityThresholdsExtracted ? { stability_thresholds: stabilityThresholdsExtracted } : {}),
    // Sentinel contract: inference_warnings is ALWAYS present ([] when empty, never absent).
    // Consumers can distinguish "no warnings assessed" (field absent on old builds)
    // from "warnings assessed, none found" (empty array).
    inference_warnings: inferenceWarnings,
    // Factor enrichments from CEE /assist/v1/review (undefined when unavailable)
    // NOTE: Non-deterministic (LLM-derived), excluded from canonical hash
    ...(factorEnrichments && { factor_enrichments: factorEnrichments }),
    // M1 Coaching (Phase 2 deterministic coaching layer)
    // NOTE: Deterministic (no LLM), but excluded from canonical hash as non-semantic metadata
    ...(m1Coaching && { m1_coaching: m1Coaching }),

    // Flip thresholds (tipping points) for UI Results Panel
    // NOTE: Deterministic (no LLM), excluded from canonical hash as non-semantic metadata
    ...(flipThresholds && flipThresholds.length > 0 && { flip_thresholds: flipThresholds }),

    // Threshold analysis (B10.3) — ISL native threshold endpoint
    // NOTE: Non-semantic post-analysis enrichment, excluded from response_hash.
    ...(thresholdsStatus && thresholdsStatus !== 'not_requested' && {
      thresholds_status: thresholdsStatus,
      ...(thresholdsMeta && { thresholds_meta: thresholdsMeta }),
      ...(thresholdAnalysis && thresholdAnalysis.length > 0 && { threshold_analysis: thresholdAnalysis }),
    }),

    // Identifiability assessment (B1.5/B1.5a) — always present.
    // NOTE: Deterministic function of graph structure. Excluded from response_hash since v6.
    identifiability: identifiability ?? { status: 'unknown', method: 'backdoor', pairs_checked: 0, pairs_identifiable: 0 },

    // M2 Decision Review (LLM-generated from CEE /assist/v1/decision-review)
    // NOTE: LLM-derived, non-deterministic. Excluded from canonical hash.
    ...(m2DecisionReview && {
      m1_review: m2DecisionReview.m1_review,
      review_status: m2DecisionReview.review_status,
      ...(m2DecisionReview.review_meta && { review_meta: m2DecisionReview.review_meta }),
      ...(m2DecisionReview.review_failure_codes && m2DecisionReview.review_failure_codes.length > 0 && {
        review_failure_codes: m2DecisionReview.review_failure_codes,
      }),
      ...(m2DecisionReview.review_warnings && m2DecisionReview.review_warnings.length > 0 && {
        review_warnings: m2DecisionReview.review_warnings,
      }),
      ...(m2DecisionReview.review_skip_reason && {
        review_skip_reason: m2DecisionReview.review_skip_reason,
      }),
    }),

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

    // Contract-compliant alias for meta.latency_ms
    processing_time_ms: meta.latencyMs,

    response_hash: responseHash,

    // Decision Brief — assembled from analysis results for stakeholder sharing.
    // Contains non-deterministic fields (brief_id, created_at) — excluded from response_hash
    // by design (hash is computed from request inputs only via hashRequest).
    decision_brief: assembledBrief,

    // Review cards — evidence priority card from factor sensitivity data.
    // Excluded from response_hash. Required field: always [] when flag OFF, populated when ON.
    // Semantics: review_cards: [] + feature_flags.review_pass: false → feature was off
    //            review_cards: [] + feature_flags.review_pass: true  → feature ran, nothing to emit
    //            review_cards: [...]  + feature_flags.review_pass: true  → cards produced
    review_cards: assembledReviewCards,

    // Stream D: FactObjectV1 assembly (F.7). Excluded from response_hash.
    // Required field: always [] when flag OFF, populated when ON.
    fact_objects: assembledFactObjects ?? [],

    // CIL M4: repairs_applied always included for CIL observability.
    // Other _meta fields (builds, payloads) gated behind UI_CANONICAL_META feature flag.
    _meta: (() => {
      // Base _meta: always include repairs_applied and source_path
      const baseMeta: CanonicalMeta = {
        source_path: meta.sourcePath,
        repairs_applied: meta.repairs ?? [],
        request_id: requestId,
        plot_build: meta.build ?? 'unknown',
        hash_version: HASH_VERSION,
      };

      // Extended _meta fields only when feature flag enabled
      if (isCanonicalMetaEnabled()) {
        const allCalls = getDownstreamCallsForLog(requestId);
        const islCall = allCalls.find(c => c.service === 'isl');

        // Build versions for all services in the pipeline
        (baseMeta as any).builds = {
          ui: meta.uiBuild ?? null,
          cee: meta.ceeBuild ?? null,
          plot: meta.build ?? null,
          isl: (islCall?.response_payload as any)?.build ?? islResult?.build ?? null,
        };

        // Debug payloads for ISL request/response
        if (islCall) {
          (baseMeta as any).payloads = {
            isl_request: islCall.request_payload ?? null,
            isl_response: islCall.response_payload ?? null,
          };
        }
      }

      // Request ID chain (Brief 4 spec — 6 fields, passthrough from MetaParams)
      if (meta.requestIdChain) {
        baseMeta.request_id_chain = { ...meta.requestIdChain };
      }

      // Surface auto-constraint source metadata so UI can differentiate copy:
      // "Success target: X%" (auto-generated) vs "Meeting all targets: X%" (CEE-extracted)
      // Uses the _internal namespace (set during Phase 1c+ synthesis) rather than
      // matching on constraint_id, so user-supplied constraints with the same ID
      // are never misclassified as auto-generated.
      if (goalConstraints?.length) {
        const sources: Record<string, string> = {};
        for (const c of goalConstraints) {
          const internal = (c as any)._internal as InternalMetadata | undefined;
          if (internal?.source) {
            sources[c.constraint_id] = internal.source;
          }
        }
        if (Object.keys(sources).length > 0) {
          (baseMeta as any).constraint_sources = sources;
        }
      }

      // Surface filtered constraints (non-evaluable temporal constraints dropped before ISL)
      if (meta.filteredConstraints && meta.filteredConstraints.length > 0) {
        baseMeta.filtered_constraints = meta.filteredConstraints;
      }

      // Diagnostic fields — lightweight metadata for debug panel / developer inspection.
      // NOT consumed by UI display logic. NOT included in response_hash.
      baseMeta.feature_flags_snapshot = getAllFeatureFlags();
      baseMeta.decision_brief_assembled = assembledBrief !== null;
      baseMeta.review_cards_count = assembledReviewCards.length;
      baseMeta.evidence_priority_card_present = assembledReviewCards.some(
        (c) => c.card_type === 'evidence_priority',
      );

      // NOTE: _meta is response-only metadata; response_hash is computed from
      // request inputs only (hashRequest in canonicalise.ts). Additions to _meta
      // do NOT affect the hash.
      return baseMeta;
    })(),

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

    // V3 Platform Contract §3.3.6 (ResponseMetaFull): public `meta` object.
    // feature_flags is configuration metadata — excluded from response_hash.
    meta: {
      seed_used: meta.seedUsed,
      // CIL Phase 1: seed_source tells consumers seed origin
      //             (client_generated or server_generated)
      seed_source: meta.seedSource,
      n_samples: meta.nSamples,
      detail_level: meta.detailLevel,
      latency_ms: meta.latencyMs,
      normalization_ms: meta.normalizationMs,
      validation_ms: meta.validationMs,
      isl_ms: meta.islMs,
      cee_ms: meta.ceeMs,
      build: meta.build,
      computed_at: meta.computedAt,
      ...(meta.requestIdChain && { request_id_chain: meta.requestIdChain }),
      feature_flags: {
        ...getAllFeatureFlags(),
        // Named booleans for UI consumers (mirrors /v1/run_bundle meta.feature_flags shape).
        // UI uses facts_assembly to gate FactCard rendering.
        facts_assembly: FLAGS.ENABLE_FACTS_ASSEMBLY,
        review_pass: FLAGS.ENABLE_REVIEW_PASS,
      },
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
    message: c.message,
    suggestion: c.suggestion,
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
    timeoutMs: CEE_TIMEOUT_MS,
  };
}

/**
 * Check if CEE integration is enabled.
 */
function isCeeEnabled(): boolean {
  const enabled = process.env.CEE_ORCHESTRATOR_ENABLED;
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
      // CIL Phase 0: Explicit unknown-key rejection before Fastify schema validation.
      // Fastify's default Ajv uses removeAdditional:true which silently strips unknown keys.
      // This preValidation hook mirrors the V1 createValidator allowlist guard pattern.
      preValidation: async (req: FastifyRequest, reply: FastifyReply) => {
        const body = req.body;
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          const keys = Object.keys(body);
          const unknown = keys.filter(k => !V2_RUN_ALLOWED_KEYS.has(k));
          if (unknown.length > 0) {
            return reply.status(400).send({
              statusCode: 400,
              error: 'Bad Request',
              message: `Unknown field: ${unknown[0]}. /v2/run does not accept additional properties.`,
            });
          }
        }
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const startTime = performance.now();
      const body = req.body as RunRequestV3;
      // Priority: X-Request-Id header (captured by Fastify genReqId into req.id)
      // → body.request_id → generated UUID (genReqId fallback).
      // Header is preferred because the UI sends X-Request-Id for chain tracing.
      const incomingHeaderId = (req.headers['x-request-id'] as string | undefined)?.trim();
      const requestId = incomingHeaderId || body.request_id || String(req.id);
      // Log when both sources are present but differ — helps trace chain mismatches
      if (incomingHeaderId && body.request_id && incomingHeaderId !== body.request_id) {
        req.log.warn({
          evt: 'request_id_mismatch',
          header_id: incomingHeaderId,
          body_id: body.request_id,
          resolved: requestId,
        });
      }
      // Track whether an explicit request ID was provided (header or body)
      // vs auto-generated by Fastify. Used for request_id_chain semantics.
      const hasExplicitRequestId = !!(incomingHeaderId || body.request_id);
      // Ensure the global onSend hook echoes the resolved requestId (not genReqId's
      // fallback UUID) when body.request_id was used as the source.
      if (requestId !== String(req.id)) {
        (req as any).id = requestId;
      }
      // Note: plotSeedUsed is resolved AFTER graph normalization for determinism
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

      // Capture UI build version from request header for debug bundle
      const uiBuild = (req.headers['x-olumi-client-build'] as string) ?? undefined;

      // Timing tracking
      let normalizationMs = 0;
      let validationMs = 0;
      let islMs = 0;
      // Single timestamp for this request — used in all error/blocked responses
      // so every response for the same request shares the same computed_at value.
      const requestComputedAt = new Date().toISOString();

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
        let normalizedOptions = normalizeOptions(body.options);

        try {
          const normResult = normaliseGraphWithRepairs(body.graph);
          normalizedGraph = normResult.graph;
          nodesNormalised = normResult.nodesNormalised;
          edgesNormalised = normResult.edgesNormalised;
          normWarnings = normResult.warnings;
          // Convert canonical RepairEntry[] → RepairRecord[] for _meta compatibility
          repairs = normResult.repairs.map(r => ({
            field: r.field_path,
            action: r.action,
            from_value: r.before as number | string | null,
            to_value: r.after as number | string,
            reason: r.reason,
          }));
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
              }],
              body.graph,
              undefined,
              requestId,
              requestComputedAt,
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
        // PLoT is seed authority — plotSeedUsed is never overridden by ISL's seed_used.
        const plotSeedUsed = resolveSeed(providedSeed, filteredGraph);

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
            }],
            normalizedGraph,
            undefined,
            requestId,
            requestComputedAt,
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
            }],
            normalizedGraph,
            undefined,
            requestId,
            requestComputedAt,
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
            }],
            normalizedGraph,
            undefined,
            requestId,
            requestComputedAt,
          ));
        }

        // =================================================================
        // Phase 1b+: Constraint Count Guard (DoS protection)
        // =================================================================
        // MAX_CONSTRAINTS enforced on raw input count. Temporal filtering may reduce
        // the count further, but the limit applies before any compilation or filtering.
        // ISL evaluates each constraint via Monte Carlo — unbounded arrays are a DoS vector.
        if (Array.isArray(body.goal_constraints) && body.goal_constraints.length > MAX_CONSTRAINTS) {
          return reply.status(422).send(buildBlockedResponse(
            `Too many constraints: ${body.goal_constraints.length} (max ${MAX_CONSTRAINTS})`,
            [{
              id: randomUUID(),
              code: 'TOO_MANY_CONSTRAINTS',
              severity: 'error',
              message: `Maximum ${MAX_CONSTRAINTS} constraints per request (received ${body.goal_constraints.length})`,
              source: 'validation',
              blocks_analysis: true,
            }],
            normalizedGraph,
            normalizedOptions,
            requestId,
            requestComputedAt,
          ));
        }

        // =================================================================
        // Phase 1c: Constraint Node Compilation
        // =================================================================
        // Compile any constraint nodes from the graph into GoalConstraint entries
        // This runs BEFORE constraint validation to allow graph-defined constraints
        // Note: CEE is responsible for NLP extraction; PLoT operates on structured graph data

        // Strip _internal from client-supplied constraints — this namespace is
        // server-private (set only by Phase 1c+ auto-synthesis). Prevents clients
        // from spoofing provenance metadata in _meta.constraint_sources.
        if (body.goal_constraints?.length) {
          for (const c of body.goal_constraints) {
            delete (c as any)._internal;
          }
        }

        const constraintCompilation = compileConstraintNodes(
          normalizedGraph,  // Use normalizedGraph (before filtering) to access constraint nodes
          body.goal_constraints
        );

        // Add compilation repairs to repairs_applied
        repairs = repairs.concat(constraintCompilation.repairs);

        // F.6: Log non-canonical field stripping (STRIP_RAW_CONSTRAINT_FIELDS).
        // Ordering: compilation-strip entries appear before temporal-filter entries.
        // Checks each compiled constraint for CEE-specific fields that will be
        // stripped before the ISL boundary. Only logs when a delta exists.
        for (const c of constraintCompilation.constraints as RawGoalConstraint[]) {
          const strippedFields: Record<string, unknown> = {};
          if ((c as RawGoalConstraint).unit !== undefined) strippedFields.unit = c.unit;
          if ((c as RawGoalConstraint).confidence !== undefined) strippedFields.confidence = c.confidence;
          if ((c as RawGoalConstraint).source_quote !== undefined) strippedFields.source_quote = c.source_quote;
          if ((c as RawGoalConstraint).deadline_metadata !== undefined) strippedFields.deadline_metadata = c.deadline_metadata;
          if (Object.keys(strippedFields).length > 0) {
            appendRepair(repairs, {
              code: REPAIR_CODES.STRIP_RAW_CONSTRAINT_FIELDS,
              field_path: `goal_constraints[constraint_id=${c.constraint_id}]`,
              before: strippedFields,
              after: null,
              reason: `Non-canonical fields stripped before ISL: ${Object.keys(strippedFields).join(', ')}`,
              severity: 'info',
            });
          }
        }

        // Log skipped constraint nodes
        if (constraintCompilation.skipped.length > 0) {
          req.log.info({
            event: 'constraint_nodes_skipped',
            skipped_count: constraintCompilation.skipped.length,
            skipped: constraintCompilation.skipped,
          });
        }

        // =================================================================
        // Phase 1c+: Auto-constraint fallback from goal_threshold
        // =================================================================
        // When no constraints were extracted (neither explicit goal_constraints
        // nor graph constraint nodes), but a goal_threshold exists, synthesise
        // a single constraint so ISL produces constraint_analysis output.
        // This is a deterministic computation — no LLM call (F.6: PLoT = compute).
        if (constraintCompilation.constraints.length === 0) {
          // Resolve threshold: prefer request-level goal_threshold (already parsed),
          // fall back to goal_threshold on the raw upstream goal node (CEE may set
          // it on the node even if the request root field is absent).
          const nodeGoalThreshold = (() => {
            const rawGoalNode = (body.graph?.nodes as any[])?.find(
              (n: any) => n.id === body.goal_node_id
            );
            const v = rawGoalNode?.goal_threshold;
            return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
          })();
          const autoThreshold = goalThreshold ?? nodeGoalThreshold;

          if (autoThreshold !== undefined && Number.isFinite(autoThreshold)) {
            // Synthesise a single >= constraint from goal_threshold.
            // The _internal namespace carries PLoT metadata through the pipeline
            // (filter, validation, merge) and is stripped at wire boundaries
            // (ISL translator). For UI consumers, the canonical provenance signal
            // is _meta.constraint_sources.
            const autoConstraint: GoalConstraint & { _internal: InternalMetadata } = {
              constraint_id: 'auto_goal_threshold',
              node_id: body.goal_node_id,
              operator: '>=',
              value: autoThreshold,
              label: 'Goal target',
              _internal: { source: 'auto_from_goal_threshold' },
            };
            constraintCompilation.constraints.push(autoConstraint as GoalConstraint);
            repairs.push({
              field: 'goal_constraints',
              action: 'derived',
              from_value: `goal_threshold=${autoThreshold}`,
              to_value: 'auto_goal_threshold',
              reason: 'No goal_constraints provided; auto-generated single constraint from goal_threshold',
            });
            req.log.info({
              event: 'plot.auto_constraint_from_threshold',
              goal_node_id: body.goal_node_id,
              threshold: autoThreshold,
              threshold_source: goalThreshold !== undefined ? 'request' : 'goal_node',
              action: 'synthesised',
            });
          } else {
            req.log.info({
              event: 'plot.auto_constraint_from_threshold',
              goal_node_id: body.goal_node_id,
              action: 'skipped',
              reason: 'no_goal_threshold',
            });
          }
        } else {
          req.log.info({
            event: 'plot.auto_constraint_from_threshold',
            goal_node_id: body.goal_node_id,
            action: 'skipped',
            reason: 'constraints_present',
            constraint_count: constraintCompilation.constraints.length,
          });
        }

        // =================================================================
        // Phase 1c++: Temporal Constraint Filter
        // =================================================================
        // Drop non-evaluable temporal constraints before ISL.
        // ISL evaluates constraints via Monte Carlo on static causal graphs;
        // temporal constraints ("achieve X within 6 months") cannot be evaluated
        // because time is not a modelled dimension.
        const temporalFilterResult = filterTemporalConstraints(
          constraintCompilation.constraints as RawGoalConstraint[],
          filteredGraph.nodes,
          req.log
        );

        // Replace constraint list with filtered set
        constraintCompilation.constraints = temporalFilterResult.passed;

        // Stash filtered records for _meta
        const filteredConstraintRecords = temporalFilterResult.filtered;

        if (filteredConstraintRecords.length > 0) {
          req.log.info({
            event: 'plot.temporal_constraints_filtered',
            filtered_count: filteredConstraintRecords.length,
            remaining_count: constraintCompilation.constraints.length,
            filtered: filteredConstraintRecords,
          });
        }

        // F.6: Log temporal constraint filtering (FILTER_TEMPORAL_CONSTRAINT).
        // Ordering: temporal-filter entries appear after compilation-strip entries.
        // _meta.filtered_constraints is unchanged — it still stores the full records.
        for (const record of filteredConstraintRecords) {
          appendRepair(repairs, {
            code: REPAIR_CODES.FILTER_TEMPORAL_CONSTRAINT,
            field_path: `goal_constraints[constraint_id=${record.constraint_id}]`,
            before: { constraint_id: record.constraint_id, reason: record.reason },
            after: null,
            reason: 'Temporal constraint filtered: deadline-based constraints not supported by ISL',
            severity: 'info',
          });
        }

        // =================================================================
        // Phase 1d: Constraint Validation
        // =================================================================
        // Validate compiled + explicit constraints against the filtered graph
        const constraintValidation = validateGoalConstraints(
          constraintCompilation.constraints,
          filteredGraph
        );

        // Check for blocker-severity constraint critiques
        if (constraintValidation.blockers.length > 0) {
          return reply.status(422).send(buildBlockedResponse(
            'Constraint validation failed',
            constraintValidation.blockers,
            filteredGraph,
            normalizedOptions,
            requestId,
            requestComputedAt,
          ));
        }

        // =================================================================
        // Phase 1e: Precedence Routing (goal_constraints vs goal_threshold)
        // =================================================================
        // Determine which goal mechanism to use:
        // - If goal_constraints present and non-empty: use multi-constraint path
        // - Otherwise: use existing goal_threshold path (unchanged)
        let activeGoalConstraints: GoalConstraint[] | undefined;
        let effectiveGoalThreshold: number | undefined = goalThreshold;

        if (constraintCompilation.constraints.length > 0) {
          // Multi-constraint path activated
          activeGoalConstraints = constraintCompilation.constraints;

          // Check for conflict with goal_threshold
          if (goalThreshold !== undefined) {
            const goalNodeConstraint = activeGoalConstraints.find(
              c => c.node_id === body.goal_node_id
            );
            const isConflicting = goalNodeConstraint && (
              goalNodeConstraint.value !== goalThreshold ||
              goalNodeConstraint.operator === '<='
            );

            if (isConflicting) {
              repairs.push({
                field: 'goal_threshold',
                action: 'inferred',
                from_value: goalThreshold,
                to_value: 'ignored',
                reason: `goal_constraints present and contains conflicting constraint on goal_node_id="${body.goal_node_id}". goal_threshold=${goalThreshold} ignored in favor of constraint ${goalNodeConstraint!.constraint_id} (${goalNodeConstraint!.operator} ${goalNodeConstraint!.value})`,
              });
              req.log.warn({
                event: 'goal_threshold_conflict',
                goal_threshold: goalThreshold,
                conflicting_constraint: goalNodeConstraint,
              });
            } else {
              repairs.push({
                field: 'goal_threshold',
                action: 'inferred',
                from_value: goalThreshold,
                to_value: 'ignored',
                reason: `goal_constraints present. goal_threshold=${goalThreshold} ignored (goal_constraints take precedence)`,
              });
            }
          }

          // Clear goal_threshold when using multi-constraint path
          effectiveGoalThreshold = undefined;

          req.log.info({
            event: 'multi_constraint_path_activated',
            constraint_count: activeGoalConstraints.length,
            constraint_ids: activeGoalConstraints.map(c => c.constraint_id),
          });
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
            [...preflight.blockers, ...preflight.warnings],
            filteredGraph,
            normalizedOptions,
            requestId,
            requestComputedAt,
          ));
        }

        // Apply deduplication if preflight produced deduplicated options
        if (preflight.deduplicated_options) {
          normalizedOptions = preflight.deduplicated_options;
        }

        // =================================================================
        // Phase 2b: Identifiability Assessment (B1.5)
        // =================================================================
        // WARNING only — never blocks. Silent degradation on error (returns undefined).
        // Included in response hash (v4+) — deterministic function of graph structure.
        //
        // 3A-trust: Only valid bidirected edges (factor↔factor) participate in
        // identifiability. Invalid bidirected edges (e.g., factor↔goal) were
        // warned in preflight and are excluded here via filterInvalidBidirectedEdges.
        const identGraph = filterInvalidBidirectedEdges(filteredGraph);
        const identifiabilityResult = assessGraphIdentifiability(
          identGraph,
          normalizedOptions,
          body.goal_node_id
        );

        // Emit IDENTIFIABILITY_WARNING critique when any pair is not identifiable
        if (identifiabilityResult && !identifiabilityResult.all_identifiable) {
          const nonIdPairs = identifiabilityResult.pairs.filter((p) => !p.identifiable);
          const pairDescs = nonIdPairs
            .map((p) => `${p.treatment_node_id} → ${p.outcome_node_id}`)
            .join(', ');
          preflight.warnings.push({
            id: randomUUID(),
            code: 'IDENTIFIABILITY_WARNING',
            severity: 'warning',
            message: `${nonIdPairs.length} causal pair(s) may not be identifiable via the backdoor criterion: ${pairDescs}. Results should be interpreted with caution.`,
            source: 'validation',
            blocks_analysis: false,
          });

          // 3A-trust: Emit UNMEASURED_CONFOUNDING_WARNING when bidirected edges
          // caused pairs to become non-identifiable
          const hasBidirectedEdges = identGraph.edges.some((e) => e.edge_type === 'bidirected');
          if (hasBidirectedEdges) {
            const affectedCount = detectUnmeasuredConfounding(
              identifiabilityResult, identGraph, normalizedOptions, body.goal_node_id
            );
            if (affectedCount > 0) {
              preflight.warnings.push({
                id: randomUUID(),
                code: 'UNMEASURED_CONFOUNDING_WARNING',
                severity: 'warning',
                message: `${affectedCount} treatment-outcome pair(s) may be affected by unmeasured confounding (represented by bidirected edges). The causal effect cannot be fully isolated using observed factors alone. Treat results for affected options with additional caution.`,
                source: 'validation',
                blocks_analysis: false,
              });
            }
          }
        }

        // =================================================================
        // Phase 3: Compute Response Hash (base — without ISL-derived fields)
        // =================================================================
        // Base hash used for early-return paths (ISL not enabled, ISL error).
        // On the success path, this is recomputed after ISL returns (v6: ISL-derived
        // fields are excluded from the hash — see canonicalise.ts BREAKING CHANGE v6).
        let responseHash = hashRequest(body, filteredGraph, plotSeedUsed, toIdentifiabilityResponse(identifiabilityResult));

        // =================================================================
        // Phase 4: ISL Call
        // =================================================================
        const islStart = performance.now();

        const islService = getISLService();

        if (!islService.isEnabled()) {
          const totalMs = performance.now() - startTime;

          // Include preflight warnings (e.g., scale mismatch) alongside ISL_NOT_ENABLED
          const islNotEnabledCritiques: CritiqueV3[] = [
            ...preflight.warnings,
            {
              id: randomUUID(),
              code: 'ISL_NOT_ENABLED',
              severity: 'warning',
              message: 'ISL service is not enabled. Analysis unavailable.',
              source: 'validation',
              blocks_analysis: false,
            },
          ];

          // M2: Set status for early return (disabled or skipped)
          const m2EarlyReturn = {
            m1_review: null as M1Review | null,
            review_status: (FLAGS.DECISION_REVIEW_ENABLE ? 'skipped' : 'disabled') as ReviewStatus,
            review_skip_reason: FLAGS.DECISION_REVIEW_ENABLE ? ReviewSkipReasons.ISL_NOT_ENABLED : undefined,
          };

          const chain = buildRequestIdChain(hasExplicitRequestId, requestId, false, null);
          reply.header('X-Olumi-Request-Id-Chain', buildRequestIdChainHeader(chain)!);

          return reply.send(buildResponse(
            requestId,
            'failed',
            'ISL service is not enabled',
            'unavailable',
            'unavailable',
            'unavailable',
            islNotEnabledCritiques,
            {
              seedUsed: plotSeedUsed,
              seedSource: providedSeed !== undefined ? 'client_generated' : 'server_generated',
              nSamples,
              detailLevel,
              latencyMs: totalMs,
              normalizationMs,
              validationMs,
              build: getBuildId(),
              repairs,
              sourcePath: 'graph_fallback',
              uiBuild,
              computedAt: requestComputedAt,
              requestIdChain: chain,
              filteredConstraints: filteredConstraintRecords,
            },
            responseHash,
            undefined, // islResult
            undefined, // options
            undefined, // graph
            undefined, // islAnalysisStatus
            undefined, // islStatusReason
            undefined, // robustnessSynthesis
            undefined, // ceeResults
            undefined, // ceeTrace
            undefined, // sensitivityData
            undefined, // m1Coaching
            m2EarlyReturn,  // M2 Decision Review status
            undefined, // flipThresholds
            activeGoalConstraints,  // CIL C1: goal_constraints for constraint result passthrough
            undefined, // thresholdsStatus
            undefined, // thresholdsMeta
            undefined, // thresholdAnalysis
            toIdentifiabilityResponse(identifiabilityResult),  // B1.5a: always-present mapped response
            undefined,  // factorStability
            req.log  // logger for fact_objects assembly logging
          ));
        }

        // =================================================================
        // Phase 4a: Intervention Normalisation
        // =================================================================
        // Normalise intervention values to [0,1] for ISL
        // ISL expects normalised inputs; raw values (e.g., $180,000) cause catastrophic outcomes
        let optionsForISL = normalizedOptions;
        let normalisationContext: NormalisationContext | undefined;
        let normalisationDiagnostics: NormalisationDiagnostic[] = [];

        if (needsNormalisation(normalizedOptions)) {
          const normResult = normaliseOptionsForISL(
            normalizedOptions,
            filteredGraph.nodes,
            body.goal_node_id
          );
          optionsForISL = normResult.options;
          normalisationContext = normResult.context;
          normalisationDiagnostics = normResult.diagnostics;

          // Add intervention transform repairs to repairs_applied[]
          repairs = repairs.concat(normResult.repairs);

          // Log normalisation diagnostics
          req.log.info({
            event: 'intervention_normalisation',
            normalised: true,
            diagnostics_count: normalisationDiagnostics.length,
            repairs_count: normResult.repairs.length,
            sample: normalisationDiagnostics.slice(0, 3).map(d => ({
              factor_id: d.factor_id,
              original: d.original_value,
              normalised: d.normalised_value,
              range_source: d.range.source,
              clamped: d.clamped,
            })),
            goal_range: normalisationContext.goal_context?.range,
          });
        } else {
          req.log.debug({
            event: 'intervention_normalisation',
            normalised: false,
            reason: 'All intervention values already in [0,1] range',
          });
        }

        // =================================================================
        // Phase 4b: Constraint pass-through (no normalisation)
        // =================================================================
        // ISL compares raw sampled values against raw constraint values.
        // Normalising the constraint but not the samples produces wrong
        // probabilities. Pass constraints through as-is, matching
        // goal_threshold behaviour.
        let constraintsForISL: GoalConstraint[] | undefined;

        if (activeGoalConstraints && activeGoalConstraints.length > 0) {
          constraintsForISL = activeGoalConstraints;
          req.log.debug({
            event: 'constraint_passthrough',
            constraint_count: activeGoalConstraints.length,
            sample: activeGoalConstraints.slice(0, 3).map(c => ({
              constraint_id: c.constraint_id,
              node_id: c.node_id,
              operator: c.operator,
              value: c.value,
            })),
          });
        }

        // Add constraint validation warnings to preflight warnings
        // These don't block analysis but inform the user
        if (constraintValidation.warnings.length > 0) {
          preflight.warnings.push(...constraintValidation.warnings);
        }

        // Surface temporal filter warnings as critiques (out-of-domain safety gate)
        for (const w of temporalFilterResult.warnings) {
          preflight.warnings.push({
            id: randomUUID(),
            code: 'CONSTRAINT_OUT_OF_DOMAIN',
            severity: 'warning',
            message: w.message,
            source: 'validation',
            affected_node_ids: [w.node_id],
            blocks_analysis: false,
          });
        }

        // Surface filtered constraints as info critiques so API consumers
        // know temporal constraints were dropped (not silently ignored)
        if (filteredConstraintRecords.length > 0) {
          const ids = filteredConstraintRecords.map(f => f.constraint_id).join(', ');
          preflight.warnings.push({
            id: randomUUID(),
            code: 'CONSTRAINT_FILTERED_TEMPORAL',
            severity: 'info',
            message: `${filteredConstraintRecords.length} temporal constraint(s) filtered before analysis: [${ids}]. Temporal constraints cannot be evaluated on a static causal graph.`,
            source: 'validation',
            affected_node_ids: filteredConstraintRecords.map(f => f.node_id),
            blocks_analysis: false,
          });
        }

        // Build ISL request (using normalised options and constraints)
        // CIL Phase 1: ALWAYS forward seed to ISL for deterministic Monte Carlo runs.
        // Derived seeds must be forwarded to ensure end-to-end determinism: if only computed
        // in PLoT but not sent to ISL, ISL could derive a different seed (e.g., if graph
        // normalisation differs between PLoT and ISL), making runs harder to reproduce.
        const islRequest = toISLRobustnessRequest(
          filteredGraph,
          optionsForISL,
          body.goal_node_id,
          requestId,
          nSamples,
          effectiveGoalThreshold,  // Use effective threshold (undefined if multi-constraint)
          constraintsForISL,       // Raw constraint values (undefined if not using multi-constraint)
          plotSeedUsed  // Always forward PLoT's seed (PLoT is seed authority)
        );

        // CIL Phase 0: Invariant check — ISL request must always include seed for determinism
        if (islRequest.seed === undefined || islRequest.seed === null) {
          req.log.error({
            event: 'seed_determinism_invariant_violation',
            request_id: requestId,
            seed_used: plotSeedUsed,
            seed_source: providedSeed !== undefined ? 'client_generated' : 'server_generated',
            message: 'INVARIANT VIOLATION: ISL request missing seed',
          });
        }

        // =================================================================
        // Phase 4b+: Auto-generate ParameterUncertainty for constrained nodes
        // =================================================================
        // Extracted to injectConstraintParameterUncertainties() — see
        // src/integrations/isl/constraint-pu-injection.ts for full docs.
        const puResult = injectConstraintParameterUncertainties(
          islRequest,
          constraintsForISL ?? [],
          filteredGraph.nodes,
          body.goal_node_id,
          req.log,
        );
        for (const entry of puResult.injected) {
          repairs.push({
            field: `parameter_uncertainties[${entry.node_id}]`,
            action: 'derived',
            from_value: null,
            to_value: String(entry.mean),
            reason: `CONSTRAINT_PU_INJECTED: Injected pinned PU (std=${entry.std}) from observed_state.value=${entry.mean}`,
          });
        }

        // === DIAGNOSTIC: Log parameter_uncertainties sent to ISL ===
        // This helps diagnose why ISL may return empty factor_sensitivity
        const paramUncertainties = islRequest.parameter_uncertainties ?? [];
        req.log.info({
          event: 'isl_request_parameter_uncertainties',
          count: paramUncertainties.length,
          sample: paramUncertainties.slice(0, 3).map((p) => ({
            node_id: p.node_id,
            mean: p.mean,
            std: p.std,
          })),
          factor_nodes_in_graph: filteredGraph.nodes.filter((n) => n.kind === 'factor').length,
          factors_with_observed_value: filteredGraph.nodes.filter(
            (n) => n.kind === 'factor' && n.observed_state?.value !== undefined
          ).length,
        });

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
            })),
            filteredGraph,
            normalizedOptions,
            requestId,
            requestComputedAt,
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
        let computedAt: string | undefined;
        let islEchoedRequestId: string | null = null;
        // Retryability from ISL response (service-computed, status-aware)
        let islResponseRetryable: boolean | undefined;

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
            islEchoedRequestId = response.isl_echoed_request_id ?? null;
            // Capture timestamp when ISL response received (before any PLoT processing)
            // Use ISL's computed_at if provided, otherwise capture now
            computedAt = islResult?.computed_at ?? new Date().toISOString();

            // PLoT is seed authority: ignore ISL's returned seed_used.
            // Log mismatch at DEBUG level for observability (no side effects).
            if (islResult?.seed_used !== undefined && islResult?.seed_used !== null
                && String(islResult.seed_used) !== plotSeedUsed) {
              req.log.debug({
                event: 'isl_seed_mismatch',
                plot_seed: plotSeedUsed,
                isl_seed: String(islResult.seed_used),
                request_id: requestId,
              });
            }

            // Warn if goal_threshold is active but ISL didn't return probability_of_goal.
            // Gate on effectiveGoalThreshold (not original goalThreshold) because
            // multi-constraint precedence routing intentionally clears the threshold.
            if (effectiveGoalThreshold !== undefined) {
              const optionData = islResult?.options ?? islResult?.results;
              const optionsWithoutProbGoal = optionData?.filter(
                (opt: any) => opt.probability_of_goal === undefined || opt.probability_of_goal === null
              );
              if (optionsWithoutProbGoal && optionsWithoutProbGoal.length > 0) {
                req.log.warn({
                  event: 'goal_threshold_no_probability',
                  goal_threshold: effectiveGoalThreshold,
                  options_missing_probability: optionsWithoutProbGoal.length,
                });
              }
            }

            // === DIAGNOSTIC: Log factor_sensitivity from ISL response ===
            const islFactorSensitivity = islResult?.factor_sensitivity ?? [];
            req.log.info({
              event: 'isl_response_factor_sensitivity',
              count: islFactorSensitivity.length,
              has_any_nonzero_sensitivity: islFactorSensitivity.some(
                (f: any) => (f.sensitivity_score ?? f.sensitivity ?? 0) !== 0
              ),
              has_any_nonzero_influence: islFactorSensitivity.some(
                (f: any) => (f.influence_score ?? 0) > 0
              ),
              sample: islFactorSensitivity.slice(0, 3).map((f: any) => ({
                node_id: f.node_id,
                influence_score: f.influence_score,
                influence_rank: f.influence_rank,
                sensitivity_score: f.sensitivity_score ?? f.sensitivity,
                direction: f.direction,
                zero_reason: f.zero_reason,
              })),
              // Capture ISL build version if present
              isl_build: islResult?.build ?? null,
            });
          } else {
            islStatusCode = 500;
            islFallbackExecuted = true;
            islEchoedRequestId = response.isl_echoed_request_id ?? null;
            islResponseRetryable = response.error?.retryable;
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
            islEchoedRequestId = (err as any).islEchoedRequestId ?? null;

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
            plotSeedUsed,
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
            critiques,
            filteredGraph,
            normalizedOptions,
            requestId,
            computedAt ?? requestComputedAt,
          ));
        }

        // Handle ISL failure (non-422)
        if (!islSuccess) {
          const chain = buildRequestIdChain(hasExplicitRequestId, requestId, true, islEchoedRequestId);
          reply.header('X-Olumi-Request-Id-Chain', buildRequestIdChainHeader(chain)!);

          // V2 contract: failed = 200, communicates failure via analysis_status
          // Use service-computed retryable if available; fall back to status-based logic.
          const islRetryable = islResponseRetryable ?? retryableFromIslStatus(islStatusCode || undefined);
          return reply.send(buildV2RunError({
            analysisStatus: 'failed',
            statusReason: 'ISL analysis failed',
            retryable: islRetryable,
            requestId,
            computedAt: computedAt ?? requestComputedAt,
            critiques: [...critiques, {
              id: randomUUID(),
              code: 'ISL_CALL_FAILED',
              severity: 'error' as const,
              message: 'ISL analysis failed. Please try again.',
              source: 'isl' as const,
              blocks_analysis: false,
            }],
          }));
        }

        // =================================================================
        // Phase 5a: Outcome Denormalisation
        // =================================================================
        // If we normalised interventions, denormalise ISL outcomes back to user units
        let processedIslResult = islResult;
        if (normalisationContext) {
          processedIslResult = denormaliseISLResult(islResult, normalisationContext);

          req.log.info({
            event: 'outcome_denormalisation',
            goal_range: normalisationContext.goal_context?.range,
            options_processed: (processedIslResult.options ?? processedIslResult.results)?.length ?? 0,
          });
        }

        // Handle HTTP 200 with analysis_status='failed' from ISL
        const islAnalysisStatus = processedIslResult.analysis_status;
        const islStatusReason = processedIslResult.status_reason;

        if (islAnalysisStatus === 'failed') {
          const chain = buildRequestIdChain(hasExplicitRequestId, requestId, true, islEchoedRequestId);
          reply.header('X-Olumi-Request-Id-Chain', buildRequestIdChainHeader(chain)!);

          // V2 contract: failed = 200, communicates failure via analysis_status
          return reply.send(buildV2RunError({
            analysisStatus: 'failed',
            statusReason: islStatusReason || 'ISL analysis failed',
            retryable: true, // ISL HTTP 200 with failed analysis_status → transient; retry
            requestId,
            computedAt: computedAt ?? requestComputedAt,
            critiques,
          }));
        }

        // =================================================================
        // Compute per-feature statuses
        // =================================================================
        // Transform sensitivity arrays FIRST - these are the final arrays that will be returned
        // Status check must use the SAME arrays to prevent status/response misalignment
        const edgeSensitivity = transformEdgeSensitivity(islResult.sensitivity);

        // Factor sensitivity: Graph-based is PRIMARY, ISL is FALLBACK
        // Graph-based uses edge path analysis (Schema D.5) - no dependency on parameter_uncertainties
        // Normalize fragile edges for VOI computation in factor sensitivity
        const fragileEdgesForVoi = islResult.robustness?.fragile_edges
          ? normalizeFragileEdges(islResult.robustness.fragile_edges as unknown[], requestId).edges
          : undefined;
        const graphBasedFactorSensitivity = computeFactorSensitivityFromGraph(
          filteredGraph,
          body.goal_node_id,
          fragileEdgesForVoi
        );
        const islFactorSensitivity = transformFactorSensitivity(islResult.factor_sensitivity);

        // Graph-based is primary for influence/sensitivity scores.
        // When graph results exist, merge ISL attribution_stability into graph entries
        // and recompute unified confidence (0.5 × band_score + 0.5 × mean(incoming edges)).
        let factorSensitivity: FactorSensitivityResultV3[] | undefined;
        let factorSensitivitySource: string;
        if (graphBasedFactorSensitivity) {
          factorSensitivity = mergeIslConfidenceIntoGraphFactors(
            graphBasedFactorSensitivity,
            islFactorSensitivity,
            filteredGraph.edges,
          );
          factorSensitivitySource = 'graph+isl_merge';
        } else {
          // ISL-only fallback: still apply unified confidence recomputation.
          // Pass empty graph array so all ISL factors go through the ISL-only
          // append path, which computes unified confidence + confidence_components.
          factorSensitivity = mergeIslConfidenceIntoGraphFactors(
            [],
            islFactorSensitivity,
            filteredGraph.edges,
          );
          factorSensitivitySource = 'isl';
        }

        // Log which source was used for factor sensitivity
        req.log.info({
          event: 'factor_sensitivity_source',
          source: factorSensitivitySource,
          graph_based_count: graphBasedFactorSensitivity?.length ?? 0,
          isl_count: islFactorSensitivity?.length ?? 0,
          final_count: factorSensitivity?.length ?? 0,
          sample: factorSensitivity?.slice(0, 2).map((f) => ({
            factor_id: f.factor_id,
            sensitivity_score: f.sensitivity_score,
            confidence: f.confidence,
            confidence_source: f.confidence_source,
            direction: f.direction,
            source: f.source,
          })),
        });

        // Build factor_stability from ISL's raw factor_sensitivity (3C bootstrap fields).
        // Independent of factor_sensitivity source — always derived from ISL when available.
        const factorStability = buildFactorStability(islResult.factor_sensitivity, filteredGraph);

        // Recompute response hash (v6: ISL-derived fields excluded — identifiability
        // and factor_stability are passed for API backwards compat but ignored by
        // canonicaliseRequest; see canonicalise.ts BREAKING CHANGE v6).
        responseHash = hashRequest(body, filteredGraph, plotSeedUsed, toIdentifiabilityResponse(identifiabilityResult), factorStability);

        const sensitivityData: SensitivityData = { edgeSensitivity, factorSensitivity };

        // Use hasNonEmptyArray on the FINAL transformed arrays (single source of truth)
        const hasEdgeSensitivity = hasNonEmptyArray(edgeSensitivity);
        const hasFactorSensitivity = hasNonEmptyArray(factorSensitivity);
        const hasDriversSensitivity = hasEdgeSensitivity || hasFactorSensitivity;

        // ISL V2 response uses 'options' field; V1 uses 'results'. Check both for compatibility.
        // Use processedIslResult for denormalised outcome data
        const optionComparisonData = processedIslResult.options ?? processedIslResult.results;
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
        //
        // Run CEE factor review in parallel with decision review for efficiency
        // Factor review has silent fallback on error/timeout
        const ceeConfig: CEESchemaV2Config | undefined = process.env.CEE_BASE_URL && process.env.CEE_API_KEY
          ? {
              baseUrl: process.env.CEE_BASE_URL,
              apiKey: process.env.CEE_API_KEY,
            }
          : undefined;

        // Run CEE calls in parallel
        // M2 decision-review replaces legacy /review + /options calls when enabled
        const legacyCeeSkipped: CeeOrchestrationResult = {
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
            reason: 'Legacy CEE calls skipped (M2 decision-review enabled)',
          },
        };

        // Diagnostic: log factor review guard inputs
        req.log.info({
          event: 'factor_review_guard',
          request_id: requestId,
          cee_config_present: !!ceeConfig,
          brief_present: !!body.brief,
          brief_length: body.brief?.length ?? 0,
          analysis_status: topLevelStatus,
        });

        const [ceeOrchestrationResult, factorEnrichments] = await Promise.all([
          // Skip legacy CEE /review + /options when M2 decision-review is enabled
          FLAGS.DECISION_REVIEW_ENABLE
            ? Promise.resolve(legacyCeeSkipped)
            : requestCeeReview(
                responseHash ?? requestId, // Use response hash as scenario ID
                filteredGraph,
                normalizedOptions,
                islResult,
                robustnessDataForCee,
                requestId,
                req.log,
                body.brief
              ),
          // CEE factor review - returns undefined on error/timeout (silent fallback)
          ceeConfig && body.brief
            ? factorReviewV2(ceeConfig, body.brief, filteredGraph, requestId)
            : (() => {
                if (ceeConfig && !body.brief) {
                  req.log.info({ event: 'cee_factor_review_skipped', request_id: requestId, reason: 'no_brief' });
                }
                return Promise.resolve(undefined);
              })(),
        ]);

        // Update sensitivityData with factor enrichments (if available)
        const enrichedSensitivityData: SensitivityData = {
          ...sensitivityData,
          factorEnrichments,
        };

        // Generate M1 coaching (Phase 2+3+4 deterministic coaching layer)
        let m1Coaching: any = null;
        try {
          // Map repairs to format expected by assumptions ledger
          const repairsForCoaching = (repairs ?? []).map((r) => ({
            field: r.field,
            action: r.action,
            from_value: r.from_value ?? null,
            to_value: r.to_value,
            reason: r.reason,
          }));

          m1Coaching = generateM1Coaching(
            filteredGraph,
            body.options,
            processedIslResult,
            req.log,
            repairsForCoaching,  // Phase 3: normaliser repairs for assumptions ledger
            [],                  // Phase 3: CEE critiques (empty for now, can be extended)
            activeGoalConstraints  // Task 1+3: goal constraints for joint-prob gate & grounding check
          );
        } catch (err) {
          req.log.warn({
            event: 'm1_coaching_generation_failed',
            error: (err as Error).message,
            request_id: requestId,
          });
          // Continue without coaching (graceful degradation)
        }

        // =================================================================
        // Flip Threshold Computation (for UI Results Panel)
        // Independent of DECISION_REVIEW_ENABLE — always computed when data available
        // =================================================================
        let resolvedFlipData: import('../../cee/validation/m1-review-types.js').FlipThresholdInputData[] | undefined;
        let flipThresholds: DenormalisedFlipThreshold[] | undefined;

        if (islSuccess && factorSensitivity && optionComparisonData && optionComparisonData.length >= 2) {
          try {
            // Step 1: Compute heuristic candidates (top 5 by |elasticity|)
            const flipCandidates = computeFlipThresholdData(
              factorSensitivity.map((f: any) => ({
                factor_id: f.factor_id,
                factor_label: f.factor_label,
                elasticity: f.elasticity ?? f.sensitivity_score,
                direction: f.direction,
              })),
              optionComparisonData.map((o: any) => ({
                option_id: o.option_id ?? o.id,
                option_label: o.option_label ?? o.label,
                win_probability: o.win_probability ?? 0,
                expected_outcome: o.expected_outcome,
              })),
              filteredGraph
            );

            if (flipCandidates.length > 0) {
              // Step 2: Resolve exact flip values via ISL binary search
              const topWinnerOption = [...optionComparisonData]
                .sort((a: any, b: any) => (b.win_probability ?? 0) - (a.win_probability ?? 0))[0];
              const winnerId = topWinnerOption?.option_id ?? topWinnerOption?.id ?? '';

              if (winnerId) {
                const flipInferenceFn = createISLInferenceFn(
                  (endpoint, body, rid) => islService.callAnalysisEndpoint(endpoint, body, rid),
                  islRequest,
                  requestId
                );

                const flipResult = await resolveFlipValues(
                  flipCandidates,
                  flipInferenceFn,
                  winnerId
                );
                resolvedFlipData = flipResult.results;

                req.log.info({
                  event: 'flip_thresholds_resolved',
                  request_id: requestId,
                  count: resolvedFlipData.length,
                  factors: flipResult.diagnostics,
                });
              } else {
                resolvedFlipData = flipCandidates;
              }

              // Step 3: Denormalise to user units
              flipThresholds = denormaliseFlipThresholds(
                resolvedFlipData,
                normalisationContext,
                normalizedOptions
              );
            }
          } catch (err) {
            req.log.warn({
              event: 'flip_thresholds_error',
              request_id: requestId,
              error: (err as Error).message,
            });
            // Continue without flip thresholds — non-blocking
          }
        }

        // =================================================================
        // Phase 6b: Threshold Analysis (B10.3, optional, non-blocking)
        // Calls ISL's /api/v1/analysis/thresholds if include_thresholds=true
        // and sufficient request budget remains after main ISL call.
        // =================================================================
        let thresholdsStatus: ThresholdsStatus = 'not_requested';
        let thresholdsMeta: { reason?: string; duration_ms?: number } | undefined;
        let thresholdAnalysis: ThresholdResult[] | undefined;

        if (body.include_thresholds) {
          const elapsedMs = performance.now() - startTime;
          // Read budget dynamically to support test-time env overrides
          const requestBudgetMs = Number(process.env.REQUEST_BUDGET_MS) || REQUEST_BUDGET_MS;
          const remainingBudgetMs = requestBudgetMs - elapsedMs;

          if (remainingBudgetMs < THRESHOLDS_MIN_REMAINING_BUDGET_MS) {
            thresholdsStatus = 'skipped_budget';
            thresholdsMeta = {
              reason: `remaining_budget_ms=${Math.round(remainingBudgetMs)} < min=${THRESHOLDS_MIN_REMAINING_BUDGET_MS}`,
            };
            req.log.info({
              event: 'threshold_analysis_skipped_budget',
              request_id: requestId,
              elapsed_ms: Math.round(elapsedMs),
              remaining_budget_ms: Math.round(remainingBudgetMs),
              min_required_ms: THRESHOLDS_MIN_REMAINING_BUDGET_MS,
            });
          } else {
            const safetyMarginMs = 1_000;
            const thresholdsTimeoutMs = Math.min(
              Math.max(0, remainingBudgetMs - safetyMarginMs),
              ISL_THRESHOLDS_TIMEOUT_MS_CAP
            );

            const thresholdsStart = performance.now();
            try {
              // B10.3: Native single-call threshold analysis.
              // NOTE: The existing V1 route (analysis-thresholds.ts) calls the same
              // ISL endpoint with { plot_request_id, sweep_results } (pre-computed sweeps).
              // This payload shape (graph+options+seed) is prescribed by the B10.3 brief
              // for ISL's native threshold computation mode.
              // Bidirected edges are trust-layer only (identifiability + warnings).
              // ISL operates on directed edges only. Phase 3A-inference will add inference semantics.
              const thresholdsPayload = {
                graph: { nodes: filteredGraph.nodes, edges: filteredGraph.edges.filter(e => e.edge_type !== 'bidirected') },
                options: normalizedOptions.map(o => ({
                  id: o.id,
                  label: o.label,
                  interventions: o.interventions,
                })),
                seed: plotSeedUsed,
                goal_node_id: body.goal_node_id,
                request_id: requestId,
              };

              req.log.info({
                event: 'threshold_analysis_call',
                request_id: requestId,
                timeout_ms: Math.round(thresholdsTimeoutMs),
                remaining_budget_ms: Math.round(remainingBudgetMs),
              });

              const thresholdsResult = await islService.callAnalysisEndpoint<IslThresholdResponse>(
                '/api/v1/analysis/thresholds',
                thresholdsPayload,
                requestId,
                Math.round(thresholdsTimeoutMs)
              );

              const thresholdsDurationMs = performance.now() - thresholdsStart;

              if (thresholdsResult.data) {
                // Transform ISL ThresholdPoints to ThresholdResult[]
                const islThresholds = thresholdsResult.data.thresholds ?? [];
                thresholdAnalysis = islThresholds.map((tp: ThresholdPoint) => {
                  // Enrich factor label from graph
                  const factorNode = filteredGraph.nodes.find(n => n.id === tp.node_id);
                  const factorLabel = factorNode?.label ?? tp.node_id;

                  // Enrich current_value from observed_state
                  const currentValue = factorNode?.observed_state?.value;

                  // Enrich affected options with labels
                  const affectedOptions = (tp.options_affected ?? []).map(optId => {
                    const opt = normalizedOptions.find(o => o.id === optId);
                    return {
                      option_id: optId,
                      option_label: opt?.label ?? optId,
                      becomes_winner: false, // ISL does not provide winner info; set conservatively
                    };
                  });
                  // Stable order by option_id
                  affectedOptions.sort((a, b) => a.option_id.localeCompare(b.option_id));

                  const thresholdValue = tp.threshold_value;
                  const margin = currentValue !== undefined
                    ? Math.abs(thresholdValue - currentValue)
                    : undefined;

                  return {
                    factor_id: tp.node_id,
                    factor_label: factorLabel,
                    threshold_value: thresholdValue,
                    current_value: currentValue,
                    crossing_direction: tp.crossing_type === 'rising' ? 'above' as const : 'below' as const,
                    affected_options: affectedOptions,
                    margin,
                  };
                });
                // Stable order: factor_id → threshold_value → crossing_direction
                thresholdAnalysis.sort((a, b) =>
                  a.factor_id.localeCompare(b.factor_id)
                  || a.threshold_value - b.threshold_value
                  || a.crossing_direction.localeCompare(b.crossing_direction)
                );

                thresholdsStatus = 'computed';
                thresholdsMeta = { duration_ms: Math.round(thresholdsDurationMs) };

                req.log.info({
                  event: 'threshold_analysis_computed',
                  request_id: requestId,
                  thresholds_count: thresholdAnalysis.length,
                  duration_ms: Math.round(thresholdsDurationMs),
                });
              } else if (thresholdsResult.error?.code === 'ISL_TIMEOUT') {
                thresholdsStatus = 'timeout';
                thresholdsMeta = {
                  reason: thresholdsResult.error.message,
                  duration_ms: Math.round(thresholdsDurationMs),
                };
                req.log.warn({
                  event: 'threshold_analysis_timeout',
                  request_id: requestId,
                  duration_ms: Math.round(thresholdsDurationMs),
                });
              } else {
                thresholdsStatus = 'error';
                thresholdsMeta = {
                  reason: thresholdsResult.error?.message ?? 'ISL threshold analysis failed',
                  duration_ms: Math.round(thresholdsDurationMs),
                };
                req.log.warn({
                  event: 'threshold_analysis_error',
                  request_id: requestId,
                  error_code: thresholdsResult.error?.code,
                  error_message: thresholdsResult.error?.message,
                  duration_ms: Math.round(thresholdsDurationMs),
                });
              }
            } catch (err) {
              const thresholdsDurationMs = performance.now() - thresholdsStart;
              thresholdsStatus = 'error';
              thresholdsMeta = {
                reason: (err as Error).message,
                duration_ms: Math.round(thresholdsDurationMs),
              };
              req.log.warn({
                event: 'threshold_analysis_exception',
                request_id: requestId,
                error: (err as Error).message,
                duration_ms: Math.round(thresholdsDurationMs),
              });
              // Continue — threshold analysis is non-blocking
            }
          }
        }

        // M2 Decision Review (LLM-generated review from CEE)
        // Gate on DECISION_REVIEW_ENABLE flag; runs independently of legacy CEE
        let m2DecisionReview: {
          m1_review: M1Review | null;
          review_status: ReviewStatus;
          review_meta?: { model?: string; latency_ms?: number; tokens?: number };
          review_failure_codes?: string[];
          review_warnings?: string[];
          review_skip_reason?: ReviewSkipReason;
        } | undefined;

        if (FLAGS.DECISION_REVIEW_ENABLE && m1Coaching) {
          try {
            const decisionReviewInput: DecisionReviewInput = {
              brief: body.brief ?? '',
              graph: filteredGraph,
              options: normalizedOptions,
              islResult: processedIslResult,
              m1Coaching,
              responseHash: responseHash ?? requestId,
              requestId,
              // Pass pre-resolved flip data so orchestrator skips redundant ISL calls
              preResolvedFlipData: resolvedFlipData,
            };

            const ceeBaseUrl = process.env.CEE_BASE_URL?.trim() ?? '';
            const ceeApiKey = process.env.CEE_API_KEY?.trim() ?? '';

            if (ceeBaseUrl && ceeApiKey) {
              const decisionReviewConfig: DecisionReviewConfig = {
                baseUrl: ceeBaseUrl,
                apiKey: ceeApiKey,
                timeoutMs: CEE_DECISION_REVIEW_TIMEOUT_MS,
              };

              const decisionReviewResult = await orchestrateDecisionReview(
                decisionReviewInput,
                decisionReviewConfig,
                req.log
              );

              m2DecisionReview = {
                m1_review: decisionReviewResult.m1_review,
                review_status: decisionReviewResult.review_status,
                review_meta: decisionReviewResult.review_meta,
                review_failure_codes: decisionReviewResult.review_failure_codes,
                review_warnings: decisionReviewResult.review_warnings,
                review_skip_reason: decisionReviewResult.review_skip_reason,
              };
            } else {
              // CEE not configured
              m2DecisionReview = {
                m1_review: null,
                review_status: 'skipped',
                review_skip_reason: ReviewSkipReasons.CEE_NOT_CONFIGURED,
              };
              req.log.info({
                event: 'm2_decision_review_skipped',
                reason: 'cee_not_configured',
                request_id: requestId,
              });
            }
          } catch (err) {
            req.log.warn({
              event: 'm2_decision_review_error',
              error: (err as Error).message,
              request_id: requestId,
            });
            m2DecisionReview = {
              m1_review: null,
              review_status: 'failed',
              review_failure_codes: ['ORCHESTRATION_ERROR'],
            };
          }
        } else if (!FLAGS.DECISION_REVIEW_ENABLE) {
          // Flag disabled - include in response for transparency
          m2DecisionReview = {
            m1_review: null,
            review_status: 'disabled',
          };
        } else if (FLAGS.DECISION_REVIEW_ENABLE && !m1Coaching) {
          // Flag enabled but no M1 coaching data (e.g., ISL failed) - skip review
          m2DecisionReview = {
            m1_review: null,
            review_status: 'skipped',
            review_skip_reason: ReviewSkipReasons.NO_M1_COACHING,
          };
        }

        const finalTotalMs = performance.now() - startTime;

        const chain = buildRequestIdChain(hasExplicitRequestId, requestId, true, islEchoedRequestId);
        reply.header('X-Olumi-Request-Id-Chain', buildRequestIdChainHeader(chain)!);

        return reply.send(buildResponse(
          requestId,
          topLevelStatus,
          topLevelStatus !== 'computed' ? (islStatusReason || 'Some analyses unavailable') : undefined,
          optionStatus,
          robustnessStatus,
          driversStatus,
          critiques,
          {
            seedUsed: plotSeedUsed,
            seedSource: providedSeed !== undefined ? 'client_generated' : 'server_generated',
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
            uiBuild,
            ceeBuild: ceeOrchestrationResult.ceeTrace?.source ?? undefined,
            computedAt,
            requestIdChain: chain,
            filteredConstraints: filteredConstraintRecords,
          },
          responseHash,
          processedIslResult,
          normalizedOptions,
          filteredGraph, // For fragile/robust edge label enrichment (Schema v2.6)
          islAnalysisStatus,
          islStatusReason,
          ceeOrchestrationResult.robustnessSynthesis,
          ceeOrchestrationResult.ceeResults,
          ceeOrchestrationResult.ceeTrace,
          enrichedSensitivityData,  // Pre-computed arrays + factor enrichments
          m1Coaching,  // M1 coaching (Phase 2)
          m2DecisionReview,  // M2 Decision Review (LLM-generated)
          flipThresholds,  // Flip thresholds (tipping points) for UI
          activeGoalConstraints,  // CIL C1: goal_constraints for constraint result passthrough
          thresholdsStatus,  // B10.3: Threshold analysis status
          thresholdsMeta,    // B10.3: Threshold analysis metadata
          thresholdAnalysis, // B10.3: Threshold analysis results
          toIdentifiabilityResponse(identifiabilityResult),  // B1.5a: always-present mapped response
          factorStability,  // 3C: ISL stability assessment per factor
          req.log  // logger for fact_objects assembly logging
        ));
      } catch (err) {
        req.log.error({
          event: 'v2_run_error',
          error: (err as Error).message,
          stack: (err as Error).stack,
        });

        // Outermost safety net: guarantee V2RunError on any unexpected throw.
        // error.v1 must never leak from this endpoint.
        // V2 contract: failed = 200, communicates failure via analysis_status
        return reply.send(buildV2RunError({
          analysisStatus: 'failed',
          statusReason: 'Internal server error',
          retryable: true,
          requestId,
          computedAt: requestComputedAt,
        }));
      }
    }
  );

  // HEAD endpoint for probing
  app.head('/v2/run', async (_req, reply) => {
    reply.header('Allow', 'POST, OPTIONS, HEAD');
    return reply.code(405).send();
  });
}
