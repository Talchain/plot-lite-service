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
  EnrichedEdgeEValue,
  ConditionalWinner,
  ConditionalProbability,
  ConstraintFeatureStatus,
  ThresholdsStatus,
  ThresholdResult,
  FactorStabilityEntry,
  StabilityThresholds,
  InferenceWarning,
} from '../../types/engine-v3.js';
import { INFERENCE_WARNING_CODES } from '../../types/engine-v3.js';
import { sha8 } from '../../util/pii-redact.js';
import { addUserMessages } from '../../critique-humaniser.js';
import type { GraphForLabels } from '../../critique-humaniser.js';
// Seed derivation: when seed omitted, derive deterministically from graph hash
import { NormalisationError, cleanLabelAnnotation, type NormalisationWarning } from '../../normalisation/graph-normaliser.js';
import { normaliseGraphWithRepairs } from '../../normalisation/normalise-and-repair.js';
import { filterOptionNodes } from '../../normalisation/option-filter.js';
import { hashRequest, HASH_VERSION } from '../../normalisation/canonicalise.js';
import { hashGraph, deriveSeedFromHash } from '../../sampling/graph-hash.js';
import { runPreflightValidation, validateGoalConstraints, filterInvalidBidirectedEdges, validateInboundStrengthSum } from '../../validation/preflight-v2.js';
import {
  detectCategoricalIssues,
  type CategoricalDetectionResult,
} from '../../validation/categorical-detector.js';
import { compileConstraintNodes } from '../../normalisation/constraint-compiler.js';
import { filterTemporalConstraints } from '../../normalisation/constraint-filter.js';
import { REPAIR_CODES } from '../../normalisation/repair-codes.js';
import { MAX_CONSTRAINTS } from '../../constants/limits.js';
import type { RawGoalConstraint, FilteredConstraintRecord, InternalMetadata } from '../../types/engine-v3.js';
import type { IslThresholdResponse, ThresholdPoint } from '../v1/types/proxy.types.js';
import { toISLRobustnessRequest, validateISLRequest, buildParameterUncertaintiesV3 } from '../../integrations/isl/translator-v3.js';
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
import type { ISLCritique } from '../../integrations/isl/errors.js';
import { errorResponse } from '../../errors.js';
import { buildRobustnessDataForCee } from '../../integrations/isl/adapters/robustness-enrichment.js';
import {
  normalizeFragileEdges,
  normalizeRobustEdges,
} from '../../integrations/isl/adapters/robustness-analysis.js';
import { deriveRobustnessDisplayVerdict } from './robustness-display-verdict.js';
import type { RobustnessDataForCee, NormalizedEdgeInfo } from '../../integrations/isl/types/plot-types.js';
import type { ISLConstraintResult, ISLEdgeEValue, ISLConditionalWinner } from '../../integrations/isl/types/isl-types.js';
import { getIslEdgeEValues, getIslEdgeSensitivity, getIslComputedAt, mapIslFactorEvpi } from '../../integrations/isl/v2-envelope.js';
import { assessIslWireGeneration, logIslWireGenerationUnverified } from '../../integrations/isl/wire-generation.js';
import { preflightDuplicateEdges } from '../../integrations/isl/preflight.js';
import { orchestrateCeeReview } from '../../cee/orchestrator.js';
import { orchestrateDecisionReview, type DecisionReviewInput, type DecisionReviewConfig } from '../../cee/decision-review-orchestrator.js';
import {
  CEE_TIMEOUT_MS,
  CEE_DECISION_REVIEW_TIMEOUT_MS,
  ISL_THRESHOLDS_TIMEOUT_MS_CAP,
  THRESHOLDS_MIN_REMAINING_BUDGET_MS,
  resolveRequestBudgetMs,
  ISL_TIMEOUT_MS,
  worstCaseMs,
} from '../../config/timeouts.js';
import { getISLClientConfig } from '../../integrations/isl/client.js';
import { createISLInferenceFn, resolveFlipValues, resolveFlipProbeNSamples, resolveFlipOverallTimeoutMs, resolveFlipPerFactorTimeoutMs } from '../../analysis/flip-thresholds.js';
import { computeFlipThresholdData, getFactorsOverriddenByAllOptions } from '../../coaching/flip-thresholds.js';
import { denormaliseFlipThresholds, type DenormalisedFlipThreshold } from '../../lib/flip-threshold-denormaliser.js';
import { classifyFlipThresholdsStatus } from '../../lib/flip-threshold-status.js';
import {
  classifyFlipThresholdsMarginStatus,
  computeFlipThresholdsMarginCoverage,
} from '../../lib/flip-thresholds-margin-status.js';
import type { CeeReviewRequest, CeeTrace, FactorEnrichment } from '../../cee/types.js';
// CIL Phase 1: Shared types from @talchain/schemas
import type { SeedSourceType } from '@talchain/schemas';
import { factorReviewV2, type CEESchemaV2Config } from '../../cee/client.js';
import { FLAGS } from '../../config/flags.js';
import { getAllFeatureFlags } from '../../config/feature-flags.js';
import { resolveStandardNSamples, ADAPTIVE_N_SAMPLES_FLOOR, planSampleDepth, type DepthPlanInput } from '../../config/sampling.js';
import { getIslComputeAdmission } from '../../integrations/isl/compute-admission.js';
import { generateM1Coaching } from '../../coaching/m1-coaching.js';
import { filterInterventionOverrides } from '../../coaching/sensitivity-filter.js';
import type { M1Review } from '../../cee/validation/m1-review-types.js';
import type { ReviewStatus } from '../../cee/validation/m1-review-constants.js';
import { ReviewSkipReasons, type ReviewSkipReason } from '../../cee/validation/m1-review-constants.js';
import { getDownstreamCallsForLog, getDownstreamCalls } from '../../util/downstream-tracker.js';
import { computeResponseContentHash } from '../../util/response-content-hash.js';
import { computeFactorSensitivityFromGraph, buildFactorStability, mergeIslConfidenceIntoGraphFactors } from '../../lib/factor-influence.js';
import { interventionTargetIdsFromOptions, isOptionControlledLever, factorIdOf, hasFactorIdConflict } from '../../lib/intervention-override.js';
import { buildAutoNoiseProvenance, extractIslAutoNoiseApplied, logAutoNoiseFlagMissingFromIsl } from '../../lib/auto-noise.js';
import { sanitiseIslVoi, computeEvpiPercentagePoints } from '../../lib/evpi-emission.js';
import {
  detectUnreliableConstraintTargets,
  partitionConstraintTargets,
  buildConstraintTargetUnreliableMessage,
  buildConstraintGoalFitModelledMessage,
  isAutoConstraintDirectionSuspect,
  buildConstraintDirectionSuspectMessage,
  GOAL_FIT_SCORED_FROM_MODELLED_OUTCOME,
  type UnreliableConstraintTarget,
} from '../../lib/constraint-reliability.js';
import { NEAR_TIE_THRESHOLD } from '../../trust/result-coherence.js';
import { assessGraphIdentifiability, toIdentifiabilityResponse, detectUnmeasuredConfounding } from '../../trust/identifiability-v2.js';
import { classifyEdgeSeverity } from '../../trust/edge-severity.js';
import { deriveConfidenceTier, reconcileConfidenceTier } from '../../trust/confidence-tier.js';
import { detectDominantFactor } from '../../trust/factor-dominance.js';
import type { IdentifiabilityAssessment } from '../../types/engine-v3.js';
import {
  normaliseOptionsForISL,
  denormaliseISLResult,
  denormaliseValue,
  needsNormalisation,
  normaliseGoalConstraints,
  constraintsNeedNormalisation,
  type NormalisationContext,
  type NormalisationDiagnostic,
  type NormalisationRange,
  type GoalThresholdNodeMeta,
} from '../../lib/intervention-normaliser.js';
import { assembleBrief } from '../../assembly/decision-brief.js';
import { buildEvidencePriorityCard, type FactorInput } from '../../review-pass/evidence-priority.js';
import type { ProposalCardV1 } from '../../review-pass/types.js';
import { assembleFactObjects, type ISLResponseInput } from '../../facts/index.js';
import type { FactObjectV1, FactLineage } from '../../facts/types.js';
import { finiteNum, prob01, nonNeg, nonNegInt, hasAllRequiredOutcomeStats } from './numeric-egress-guards.js';
import {
  assessEnrichmentContract,
  shouldAssessEnrichmentContract,
  buildEnrichmentContractWarning,
  logEnrichmentContractMismatch,
} from './enrichment-egress-guard.js';

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

/**
 * Recognised disable values for the categorical-integrity kill switch.
 * Exported for visibility in tests and operational runbooks. Match is
 * case-insensitive; any value not in this set (including unset and typos)
 * leaves enforcement enabled — fail-closed semantics for the audit C1-A fix.
 */
export const CATEGORICAL_ENFORCEMENT_DISABLE_VALUES = new Set([
  '0',
  'false',
  'off',
  'no',
  'disabled',
]);

/**
 * Check if CATEGORICAL_INTEGRITY_ENFORCEMENT feature flag is enabled.
 *
 * Fail-closed semantics (audit C1-A is a P0 — the fix must apply by default):
 *   - Unset, '1', 'true', any unrecognised value (incl. typos) → ENABLED.
 *   - One of {'0', 'false', 'off', 'no', 'disabled'} (case-insensitive)
 *     → DISABLED (kill switch for ops emergencies).
 *
 * The kill switch lets operations disable enforcement immediately if the new
 * blocker fires unexpectedly on real pilot traffic, without rolling back the
 * deployment. Setting an explicit disable value is a visible decision; the
 * default shipping state is enforcement ON so the C1-A fix is not a dark
 * feature. Typos in the disable value (e.g. "fasle") fall through to the
 * default — enabled — which is the safe state.
 */
function isCategoricalEnforcementEnabled(): boolean {
  const raw = process.env.CATEGORICAL_INTEGRITY_ENFORCEMENT;
  if (raw === undefined) return true;
  return !CATEGORICAL_ENFORCEMENT_DISABLE_VALUES.has(raw.toLowerCase());
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

/**
 * Build range derivation sources when normalisation was skipped.
 * All intervention values are already in [0,1], so each factor's range source
 * is 'default' (the identity range [0,1] was used implicitly).
 */
function buildDefaultRangeDerivationSources(options: OptionV3[]): Record<string, string> | undefined {
  const factorIds = new Set<string>();
  for (const opt of options) {
    for (const factorId of Object.keys(opt.interventions)) {
      factorIds.add(factorId);
    }
  }
  if (factorIds.size === 0) return undefined;
  const result: Record<string, string> = {};
  for (const id of factorIds) {
    result[id] = 'default';
  }
  return result;
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
// Repair Compatibility Adapter
// -----------------------------------------------------------------------------

/**
 * Upcast a mixed RepairRecord[] to uniform F.5 canonical shape.
 *
 * RepairRecord entries created before F.5 (constraint compiler, auto-threshold,
 * goal_threshold conflict, PU injection paths) only carry the legacy fields:
 * { field, action, from_value, to_value, reason }.
 *
 * Entries created via appendRepair() or normaliseGraphWithRepairs() already
 * carry all F.5 fields. This function fills in the missing fields for legacy
 * entries so that _meta.repairs_applied is a uniform array.
 *
 * Mapping rules for legacy entries (those lacking `code`):
 *   code       ← REPAIR_CODES.LEGACY_REPAIR
 *   layer      ← 'plot'
 *   field_path ← entry.field
 *   before     ← entry.from_value
 *   after      ← entry.to_value (null when to_value is the string 'null')
 *   severity   ← 'info'
 *
 * Entries that already have `code` are returned unchanged.
 */
function normaliseRepairsForMeta(repairs: RepairRecord[]): RepairRecord[] {
  return repairs.map((r) => {
    if (r.code) return r; // already F.5 canonical
    return {
      ...r,
      code: REPAIR_CODES.LEGACY_REPAIR,
      layer: 'plot' as const,
      field_path: r.field,
      before: r.from_value,
      after: r.to_value === 'null' ? null : r.to_value,
      severity: 'info' as const,
    };
  });
}

// -----------------------------------------------------------------------------
// Repair Extraction
// -----------------------------------------------------------------------------

/**
 * Transform ISL sensitivity array to edge sensitivity response format.
 * Always returns an array (empty if no data).
 * Enriches with from_label/to_label from graph node labels (same pattern as fragile edge enrichment).
 *
 * Accepts BOTH ISL entry shapes:
 * - live V2 nested `robustness.edge_sensitivity` entries (`from_id`/`to_id`,
 *   ISL build 9a22a1a+ — read via getIslEdgeSensitivity, lane PLoT-W4). The
 *   V2-only `sensitivity_score`/`direction` fields are NOT emitted outward
 *   (direction is the sign of elasticity, already carried; score is a
 *   normalisation of it) — contracts stay frozen.
 * - legacy V1-era top-level `sensitivity` entries (`edge_from`/`edge_to`,
 *   fixtures only — the live V2 wire never emitted them).
 *
 * Edge ID format: `from::to` (double-colon separator)
 * @see docs/UI_Handoff_PLoT_v1.md for format specification
 */
/** @internal Exported for numeric-egress-guard unit tests. */
export function transformEdgeSensitivity(
  islSensitivity: unknown,
  nodeLabelMap?: Map<string, string>,
  normContext?: NormalisationContext,
): EdgeSensitivityResultV3[] {
  if (!hasNonEmptyArray(islSensitivity)) return [];
  const goalRange = normContext?.goal_context?.range;

  return (islSensitivity as any[]).map((s: any) => {
    let elasticity = s.elasticity;
    let elasticityNormalised: boolean | undefined;

    // V2 nested entries carry from_id/to_id; legacy entries carry
    // edge_from/edge_to. Resolve once, prefer the live V2 shape.
    const fromId: string = s.from_id ?? s.edge_from;
    const toId: string = s.to_id ?? s.edge_to;

    // Denormalise elasticity when normalisation was active.
    // Edge elasticity = ∂(goal outcome) / ∂(edge parameter). Edge parameters
    // (strength, exists_probability) are dimensionless [0,1] — they are NOT scaled
    // by intervention normalisation. Only the output (goal outcome) needs rescaling.
    if (normContext && goalRange && typeof elasticity === 'number') {
      const goalWidth = goalRange.max - goalRange.min;
      if (goalWidth > 0) {
        elasticity = elasticity * goalWidth;
      }
    } else if (normContext && typeof elasticity === 'number') {
      // normContext exists (normalisation was active) but goal range unavailable —
      // value remains in normalised space; flag for consumers.
      elasticityNormalised = true;
    }

    return {
      edge_id: `${fromId}::${toId}`,  // Double-colon separator (canonical format)
      from: fromId,
      to: toId,
      from_label: nodeLabelMap?.get(fromId) ?? fromId,
      to_label: nodeLabelMap?.get(toId) ?? toId,
      sensitivity_type: s.sensitivity_type as 'existence' | 'magnitude',
      elasticity,
      ...(elasticityNormalised !== undefined && { _normalised: elasticityNormalised }),
      importance_rank: s.importance_rank,
      interpretation: s.interpretation,
    };
    // Numeric-egress guard (Codex round-2): elasticity/importance_rank are required
    // numbers; a non-finite ISL value (incl. denorm overflow above) would serialise
    // to a fabricated `null`. Drop the whole edge entry (honest absence) rather than
    // emit a null — the array simply carries fewer, all-valid entries. Entries
    // whose node IDs are unresolvable in either shape are dropped for the same
    // reason (a "undefined::undefined" edge_id is a fabricated identifier).
  }).filter((e) =>
    typeof e.from === 'string' && typeof e.to === 'string' &&
    finiteNum(e.elasticity) !== undefined && finiteNum(e.importance_rank) !== undefined);
}

/**
 * NIT 1 (post-#232 review): edge E-value drops have TWO distinct causes and the
 * disclosure must attribute them accurately (never claim a transformation
 * overflow for a benign input null):
 * - `inputNull`: a required numeric was ALREADY non-finite in the ISL INPUT —
 *   the common UNFLIPPABLE case (ISL emits e_value:null when current==flip, so
 *   there is no evidence ratio). Not a defect, not an overflow.
 * - `overflow`: every raw input numeric was finite yet a value became non-finite
 *   AFTER range denormalisation (the pathological F14 case).
 */
export interface EdgeEValueDropSink {
  inputNull: number;
  overflow: number;
}

/**
 * Build the accurate, cause-attributing wire disclosure for dropped edge
 * E-values (NIT 1). Returns undefined when nothing was dropped. Names only the
 * cause(s) actually present — the unflippable/input-null case is NEVER described
 * as an overflow. Severity: info (see EDGE_E_VALUE_NON_FINITE_DROPPED doc).
 */
export function describeEdgeEValueDrop(
  inputNull: number,
  overflow: number,
): InferenceWarning | undefined {
  const total = inputNull + overflow;
  if (total <= 0) return undefined;
  const causes: string[] = [];
  if (inputNull > 0) {
    causes.push(
      `${inputNull} carried no finite E-value from the analysis engine (an unflippable edge, whose current and flip means coincide, has no evidence ratio)`,
    );
  }
  if (overflow > 0) {
    causes.push(`${overflow} became non-finite after range denormalisation`);
  }
  return {
    code: INFERENCE_WARNING_CODES.EDGE_E_VALUE_NON_FINITE_DROPPED,
    // provisional_doctrine_v0 — wording surface (diagnostic disclosure). Count only.
    message:
      `${total} edge E-value ${total === 1 ? 'entry was' : 'entries were'} omitted from ` +
      `edge_e_values: ${causes.join('; ')}. edge_e_values is shorter because those entries ` +
      `could not be represented, not because they were computed empty. All other analyses are unaffected.`,
    severity: 'info',
  };
}

/**
 * Transform ISL edge_e_values to enriched response format with labels.
 * Returns [] when input is empty/absent so consumers see "computed, empty"
 * rather than "not computed".
 * Edge IDs are normalised to double-colon format.
 *
 * `dropSink` (optional, NIT 1): when supplied, entries dropped for
 * non-finiteness are classified by cause (input-null vs post-transform overflow)
 * so the wire disclosure can attribute them accurately.
 */
/** @internal Exported for numeric-egress-guard unit tests. */
export function transformEdgeEValues(
  islEdgeEValues: ISLEdgeEValue[] | undefined,
  nodeLabelMap?: Map<string, string>,
  normContext?: NormalisationContext,
  dropSink?: EdgeEValueDropSink,
): EnrichedEdgeEValue[] {
  if (!islEdgeEValues || islEdgeEValues.length === 0) return [];
  const goalRange = normContext?.goal_context?.range;

  const mapped = islEdgeEValues.map(e => {
    // Parse ISL edge_id ("from->to" or "from::to") to get node IDs.
    // Fallback: if neither separator found, use entire edge_id as both from and to
    // (matches parseEdgeId pattern in robustness-analysis.ts).
    let fromId: string;
    let toId: string;
    if (e.edge_id.includes('::')) {
      [fromId = e.edge_id, toId = e.edge_id] = e.edge_id.split('::');
    } else if (e.edge_id.includes('->')) {
      [fromId = e.edge_id, toId = e.edge_id] = e.edge_id.split('->');
    } else {
      fromId = e.edge_id;
      toId = e.edge_id;
    }

    // current_mean and flip_mean are edge effects in outcome space — denormalise
    // using goal node range when normalisation was active.
    let currentMean = e.current_mean;
    let flipMean = e.flip_mean;
    let stability = e.stability;
    let eValueNormalised: boolean | undefined;
    if (normContext && goalRange) {
      if (typeof currentMean === 'number') {
        currentMean = denormaliseValue(currentMean, goalRange);
      }
      if (typeof flipMean === 'number') {
        flipMean = denormaliseValue(flipMean, goalRange);
      }
      // A3 lane 4 (Paul's 17 Jul ruling): the stability band receives EXACTLY
      // the same map as the sibling flip_mean above — units-coherence
      // invariant: band values are ALWAYS in the same space as flip_mean on
      // the same entry. Counts (n_seeds/n_seeds_flipped) are space-invariant.
      if (stability !== undefined) {
        // F14: finite-check every post-denormalisation band value. A non-finite
        // denorm (an overflow-width range that slipped the source guard) would
        // otherwise ride to the wire as a fabricated `null`; omit the field
        // instead (honest absence), exactly as the sibling e_value filter does.
        const bandMin = typeof stability.band_min === 'number'
          ? finiteNum(denormaliseValue(stability.band_min, goalRange)) : undefined;
        const bandMedian = typeof stability.band_median === 'number'
          ? finiteNum(denormaliseValue(stability.band_median, goalRange)) : undefined;
        const bandMax = typeof stability.band_max === 'number'
          ? finiteNum(denormaliseValue(stability.band_max, goalRange)) : undefined;
        stability = {
          // Spread first so any future additive ISL band field still rides
          // (the named-field-rebuild silent-drop trap this file's lane-3
          // comment documents); mapped fields override below.
          ...stability,
          ...(bandMin !== undefined && { band_min: bandMin }),
          ...(bandMedian !== undefined && { band_median: bandMedian }),
          ...(bandMax !== undefined && { band_max: bandMax }),
          // band_width RECOMPUTED from the MAPPED endpoints (mapped band_max −
          // mapped band_min), NEVER passed through denormaliseValue itself: a
          // width is a difference, and the affine `+ min` offset would corrupt
          // it. Absent endpoints (n_seeds_flipped == 0) ⇒ width stays absent;
          // a degenerate goal range (max − min <= 0) collapses both endpoints
          // to the same constant ⇒ width 0, consistent with flip_mean there.
          ...(bandMin !== undefined && bandMax !== undefined &&
            { band_width: bandMax - bandMin }),
          // Per-seed means: map non-null cells, preserve nulls AS NULL (a
          // null means that seed's background admits no flip — not a value).
          ...(Array.isArray(stability.seed_flip_means) && {
            // F14: a non-finite denorm cell becomes null (a "no value" seed),
            // never a fabricated Infinity → null with lost provenance.
            seed_flip_means: stability.seed_flip_means.map((v) =>
              typeof v === 'number' ? (finiteNum(denormaliseValue(v, goalRange)) ?? null) : v),
          }),
        };
      }
    } else if (normContext) {
      // Normalisation was active but goal range unavailable — flag
      eValueNormalised = true;
    }

    return {
      edge_id: `${fromId}::${toId}`,
      from_id: fromId,
      to_id: toId,
      from_label: nodeLabelMap?.get(fromId) ?? fromId,
      to_label: nodeLabelMap?.get(toId) ?? toId,
      e_value: e.e_value,
      flip_direction: e.flip_direction,
      current_mean: currentMean,
      flip_mean: flipMean,
      // A3 lane 3 + lane 4: seed-sweep flip-stability band (ISL PR #71,
      // DEFAULT-ON since ISL PR #76). Key absent (never null) when ISL omits
      // it (nothing to sweep, or an older pre-#76 build): this
      // field-by-field rebuild used to silently DROP it. UNITS-COHERENCE
      // INVARIANT (Paul's 17 Jul ruling): band values are ALWAYS in the same
      // space as flip_mean on the same entry — mapped above via the same
      // denormaliseValue when flipMean was denormalised (band_width recomputed
      // from mapped endpoints); verbatim on the fallback and _normalised:true
      // paths where flipMean is verbatim too (see ISLFlipStabilityBandV2).
      // ⚠ band_width == 0 is BY CONSTRUCTION when n_seeds_flipped == 1 —
      // consumers must condition on n_seeds_flipped.
      ...(stability !== undefined && { stability }),
      ...(eValueNormalised !== undefined && { _normalised: eValueNormalised }),
    };
  });

  // Numeric-egress guard (Codex round-2): e_value/current_mean/flip_mean are
  // required numbers; drop entries with any non-finite value rather than emit a
  // fabricated `null`. NIT 1: classify each drop by cause (input-null vs
  // post-transform overflow) so the disclosure attributes it accurately. `mapped`
  // is 1:1 with `islEdgeEValues` (map preserves order), so index i pairs the
  // transformed entry with its raw ISL input.
  const kept: EnrichedEdgeEValue[] = [];
  for (let i = 0; i < mapped.length; i++) {
    const out = mapped[i];
    const keep =
      finiteNum(out.e_value) !== undefined &&
      finiteNum(out.current_mean) !== undefined &&
      finiteNum(out.flip_mean) !== undefined;
    if (keep) {
      kept.push(out);
      continue;
    }
    if (dropSink) {
      const raw = islEdgeEValues[i];
      // If any RAW input numeric was already non-finite, the drop is due to the
      // INPUT (unflippable edge: e_value=null) — NOT a transform overflow. Only
      // when every raw input was finite yet a transformed value is non-finite is
      // the cause a range-denormalisation overflow.
      const rawAllFinite =
        finiteNum(raw.e_value) !== undefined &&
        finiteNum(raw.current_mean) !== undefined &&
        finiteNum(raw.flip_mean) !== undefined;
      if (rawAllFinite) dropSink.overflow++;
      else dropSink.inputNull++;
    }
  }
  return kept;
}

/**
 * Transform ISL conditional_winners to enriched response format with labels.
 * Returns [] when input is empty/absent so consumers see "computed, empty"
 * rather than "not computed".
 * Enriches option IDs in buckets with human-readable labels.
 */
/** @internal Exported for numeric-egress-guard unit tests. */
export function transformConditionalWinners(
  islConditionalWinners: ISLConditionalWinner[] | undefined,
  nodeLabelMap?: Map<string, string>,
  optionLabelMap?: Map<string, string>,
  normContext?: NormalisationContext,
): ConditionalWinner[] {
  if (!islConditionalWinners || islConditionalWinners.length === 0) return [];
  const goalRange = normContext?.goal_context?.range;

  const resolveOptionLabel = (id: string): string => optionLabelMap?.get(id) ?? id;
  const resolveNodeLabel = (id: string): string => nodeLabelMap?.get(id) ?? id;

  return islConditionalWinners.map(cw => {
    // split_value is in the factor's units — denormalise using factor range
    let splitValue = cw.split_value;
    let cwNormalised: boolean | undefined;
    if (normContext && typeof splitValue === 'number') {
      const factorRange = normContext.factors.get(cw.factor_id)?.range;
      if (factorRange) {
        splitValue = denormaliseValue(splitValue, factorRange);
      } else {
        // Factor range unavailable — split_value remains normalised
        cwNormalised = true;
      }
    }

    // mean_outcome is in goal node units — denormalise using goal range
    if (normContext && !goalRange) cwNormalised = true; // goal range missing → can't denorm outcomes
    const denormMeanOutcome = (val: number | undefined): number | undefined => {
      if (val === undefined || !goalRange) return val;
      return denormaliseValue(val, goalRange);
    };

    const result: ConditionalWinner = {
      factor_id: cw.factor_id,
      factor_label: cw.factor_label ?? resolveNodeLabel(cw.factor_id),
      split_value: splitValue,
      ...(cw.split_unit !== undefined && { split_unit: cw.split_unit }),
      low_bucket: {
        winner_id: cw.low_bucket.winner_id,
        winner_label: resolveOptionLabel(cw.low_bucket.winner_id),
        ...(cw.low_bucket.runner_up_id !== undefined && {
          runner_up_id: cw.low_bucket.runner_up_id,
          runner_up_label: resolveOptionLabel(cw.low_bucket.runner_up_id!),
        }),
        win_probability: cw.low_bucket.win_probability,
        ...(finiteNum(denormMeanOutcome(cw.low_bucket.mean_outcome)) !== undefined && { mean_outcome: denormMeanOutcome(cw.low_bucket.mean_outcome) }),
      },
      high_bucket: {
        winner_id: cw.high_bucket.winner_id,
        winner_label: resolveOptionLabel(cw.high_bucket.winner_id),
        ...(cw.high_bucket.runner_up_id !== undefined && {
          runner_up_id: cw.high_bucket.runner_up_id,
          runner_up_label: resolveOptionLabel(cw.high_bucket.runner_up_id!),
        }),
        win_probability: cw.high_bucket.win_probability,
        ...(finiteNum(denormMeanOutcome(cw.high_bucket.mean_outcome)) !== undefined && { mean_outcome: denormMeanOutcome(cw.high_bucket.mean_outcome) }),
      },
      winner_flips: cw.winner_flips,
    };
    if (cwNormalised) result._normalised = true;
    return result;
    // Numeric-egress guard (Codex round-2): split_value is a required number and each
    // bucket win_probability is a required [0,1] probability; drop the whole
    // conditional-winner entry when any is non-finite / out-of-range rather than emit
    // a fabricated null or an impossible probability.
  }).filter((cw) =>
    finiteNum(cw.split_value) !== undefined &&
    prob01(cw.low_bucket.win_probability) !== undefined &&
    prob01(cw.high_bucket.win_probability) !== undefined
  );
}

/**
 * Map a single raw ISL factor sensitivity entry to FactorSensitivityResultV3.
 * Shared by both filtered and unfiltered transform paths.
 *
 * Field mapping: ISL uses node_id, PLoT uses factor_id.
 * All other fields are preserved verbatim for forward compatibility.
 */
function mapIslFactorEntry(f: any, normContext?: NormalisationContext): FactorSensitivityResultV3 {
  // Schema v2.6 canonical field is 'sensitivity_score'; legacy used 'sensitivity'
  let sensitivityValue = f.sensitivity_score ?? f.sensitivity;

  // Defensive logging: warn if no numeric sensitivity value found
  if (sensitivityValue === undefined) {
    console.warn('[FACTOR_SENSITIVITY_MISSING_NUMERIC]', JSON.stringify({
      node_id: f.node_id,
      available_keys: Object.keys(f),
      message: 'ISL did not provide sensitivity_score — UI will show "unavailable"',
    }));
  }

  const factorId: string = factorIdOf(f) ?? ''; // F13: one canonical precedence everywhere.

  // Denormalise sensitivity_score and elasticity_std when normalisation was active.
  // sensitivity_score is an elasticity-like measure (Δoutcome / Δfactor); scale by
  // goalRangeWidth / factorRangeWidth. elasticity_std is a spread measure; same scaling.
  let elasticityStd: number | undefined = f.elasticity_std;
  let sensitivityNormalised: boolean | undefined;
  const goalRange = normContext?.goal_context?.range;
  if (normContext && goalRange) {
    const factorRange = normContext.factors.get(factorId)?.range;
    if (factorRange) {
      const goalWidth = goalRange.max - goalRange.min;
      const factorWidth = factorRange.max - factorRange.min;
      if (factorWidth > 0) {
        const scale = goalWidth / factorWidth;
        if (typeof sensitivityValue === 'number') {
          sensitivityValue = sensitivityValue * scale;
        }
        if (typeof elasticityStd === 'number') {
          elasticityStd = elasticityStd * scale;
        }
      } else {
        // Zero-width factor range — cannot denormalise; flag for consumers
        sensitivityNormalised = true;
      }
    } else {
      // normContext exists (normalisation was active) but factor range unavailable —
      // value remains in normalised space; flag for consumers.
      sensitivityNormalised = true;
    }
  } else if (normContext && !goalRange) {
    // Goal range unavailable — cannot denormalise
    sensitivityNormalised = true;
  }

  // IMPORTANT: Do NOT default missing values to 0.
  // Missing data means "we couldn't compute influence" which is semantically
  // different from "this factor has zero influence". Let undefined pass through.
  //
  // Confidence honesty (audit A1-PRIMARY): the `confidence` value emitted here
  // is ISL's own value — it MUST NOT reach the public response as the final
  // displayed confidence. The merge step (`mergeIslConfidenceIntoGraphFactors`
  // in factor-influence.ts) always recomputes the public value:
  //   - Under v3, ISL's `confidence` is consumed as the stability input to a
  //     50/50 blend with the edge component; PLoT's blend + clamp + provenance
  //     tag are what reach the response.
  //   - Under v2, ISL's `confidence` is dropped entirely and the 4-bucket
  //     band of `attribution_stability` is used instead.
  // Either way, ISL's `confidence_source` label (e.g. `"bootstrap_sampling"`)
  // is stripped before merge.
  //
  // `confidence_source` and `confidence_provenance` are TYPE-REQUIRED on the
  // public type. We populate placeholder values here purely so the
  // intermediate satisfies the type contract; the merge unconditionally
  // overwrites them with the honest values on the way out. If anything ever
  // emits `mapIslFactorEntry` output directly to the public response without
  // going through the merge, these placeholders would surface — that's a bug
  // and the integration test in tests/b8-8-3c-field-segregation.test.ts pins
  // the boundary contract.
  //
  // Pre-computed once so the VOI guard logic lives in one place and is
  // reused for both the `value_of_information` field and the `confidence`
  // fallback chain below. See `src/lib/evpi-emission.ts` for the full
  // contract rationale (Howard 1966 non-negativity, MC sampling artefacts).
  //
  // V2 wire truth (verified live 2026-07-06, build f3f5d92):
  // `factor_sensitivity[].value_of_information` is a V1-only field the live
  // V2 envelope NEVER emits — this read is structurally undefined on the live
  // path, so factor VOI always comes from the graph heuristic
  // (computeFactorSensitivityFromGraph). The V2 wire carries true per-factor
  // EVPI at top-level `factor_evpi` instead; wiring it into user-facing VOI is
  // decision P-5 (pending) — see mapIslFactorEvpi in
  // src/integrations/isl/v2-envelope.ts. The read is kept (not deleted) only
  // to tolerate legacy fixtures.
  const sanitisedVoi = sanitiseIslVoi(f.value_of_information);

  const entry: FactorSensitivityResultV3 = {
    factor_id: factorId,
    factor_label: f.label ?? null,
    // Numeric-egress guard (Codex round-3): influence_score is a [0,1] normalised
    // score; ranks are non-negative integers; sensitivity_score/elasticity are signed
    // finite reals. These are OPTIONAL fields — omit when absent, non-finite, or
    // out-of-domain rather than passing a raw NaN (→ fabricated null) or an impossible
    // value through. (The ISL-only merge path spreads these into the public response.)
    influence_score: prob01(f.influence_score),
    influence_rank: nonNegInt(f.influence_rank),
    sensitivity_score: finiteNum(sensitivityValue),
    elasticity: finiteNum(f.elasticity),
    direction: (f.direction as 'positive' | 'negative' | 'mixed' | 'unknown') ?? null,
    importance_rank: nonNegInt(f.importance_rank),
    interpretation: f.interpretation ?? null,
    // VOI is a dimensionless decision-readiness score (EVPI proxy, clamped [0,1]).
    // It does NOT require denormalisation — it measures "how valuable would perfect
    // information about this factor be" as a normalised fraction, not outcome-space units.
    //
    // Boundary guard (Howard 1966 EVPI non-negativity): ISL emits VOI via a
    // Monte Carlo estimator which can drift slightly negative from sampling
    // noise around zero — a well-known artefact, not a real signal. Negative
    // and non-finite values are filtered to null here so downstream
    // `evpi_percentage_points` emission (`run.ts` near line 4060) honours the
    // OpenAPI `minimum: 0` contract and never surfaces "learning more would
    // make the decision worse" to the user. Mirrors the existing convention
    // in the sibling ISL adapter at
    // `src/integrations/isl/adapters/factor-sensitivity.ts:49` which already
    // filters `value_of_information` by `>= 0` on the CEE-facing surface.
    value_of_information: sanitisedVoi,
    // Confidence retains the legacy passthrough fallback chain. Use the
    // already-sanitised VOI so the fallback path can't surface a negative /
    // non-finite value that the boundary guard explicitly rejected for the
    // VOI field itself.
    confidence: f.confidence ?? sanitisedVoi,
    zero_reason: f.zero_reason ?? null,
    source: 'isl' as const,
    // Placeholder — overwritten by mergeIslConfidenceIntoGraphFactors. If this
    // value ever reaches the public response, the merge step was bypassed and
    // the integration boundary test will fail.
    confidence_source: 'plot_unified_from_graph',
    confidence_provenance: {
      computation_source: 'plot_unified_from_graph',
      formula_version: 'plot_unified_v2',
      is_provisional: true,
      calibration_status: 'provisional_pending_pilot_calibration',
      input_quality: 'degenerate_fallback',
    },
  };

  // 3C stability fields — carry through when ISL provides them. Numeric-egress guard
  // (Codex round-2): elasticity_std is a non-negative spread; rank_flip_rate is a
  // [0,1] rate. Omit when absent or out-of-domain (was a bare presence check that
  // let a negative / >1 value through to the public surface).
  const eStd = nonNeg(elasticityStd);
  if (eStd !== undefined) entry.elasticity_std = eStd;
  if (f.attribution_stability !== undefined) entry.attribution_stability = f.attribution_stability;
  const rfr = prob01(f.rank_flip_rate);
  if (rfr !== undefined) entry.rank_flip_rate = rfr;
  if (f.stability_method !== undefined) entry.stability_method = f.stability_method;

  // Track S: ISL factor value provenance — carry through when ISL provides them.
  // Preserve-only-when-present: absent value_defaulted MUST NOT be coerced to
  // false (absent can mean "older ISL response" or "not reported", which is
  // distinct from an explicit false). Mirrors the 3C stability carry above.
  if (f.value_source !== undefined) entry.value_source = f.value_source;
  if (f.value_extraction_type !== undefined) entry.value_extraction_type = f.value_extraction_type;
  if (f.value_defaulted !== undefined) entry.value_defaulted = f.value_defaulted;

  // Flag when normalisation was active but ranges unavailable for denorm
  if (sensitivityNormalised) entry._normalised = true;

  return entry;
}

/**
 * Transform ISL factor sensitivity array to response format.
 * Filters out intervention_override entries (decision levers, not uncertainty drivers).
 * Returns undefined if input is not a non-empty array.
 */
function transformFactorSensitivity(islFactorSensitivity: unknown, normContext?: NormalisationContext): FactorSensitivityResultV3[] | undefined {
  if (!hasNonEmptyArray(islFactorSensitivity)) return undefined;
  const filtered = filterInterventionOverrides(islFactorSensitivity as any[]);
  return filtered.map(f => mapIslFactorEntry(f, normContext));
}

/**
 * Transform ISL factor sensitivity WITHOUT filtering intervention_overrides.
 * Used solely for the confidence merge path: controllable factors with
 * zero_reason='intervention_override' still carry valid attribution_stability
 * from ISL bootstrap that should feed into unified confidence computation.
 */
function transformFactorSensitivityUnfiltered(islFactorSensitivity: unknown, normContext?: NormalisationContext): FactorSensitivityResultV3[] | undefined {
  if (!hasNonEmptyArray(islFactorSensitivity)) return undefined;
  return (islFactorSensitivity as any[]).map(f => mapIslFactorEntry(f, normContext));
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
 *
 * Exported for unit tests only (lane 29 — the sensitivity_count defect was
 * invisible precisely because this diagnostic had no test).
 */
export function buildISLResponseSummary(
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
    // Lane 29 (spec §2.3): count the SAME wire location the response readers
    // use (robustness.edge_sensitivity via the accessor). The former
    // top-level `islResult.sensitivity` read was structurally 0 on every
    // live V2 response, so this diagnostic permanently reported
    // sensitivity_count: 0 even when the wire carried data — exactly the
    // signal an operator checks when diagnosing "empty science".
    sensitivity_count: getIslEdgeSensitivity(islResult)?.length ?? 0,
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
// Track S PR-E: standard base-analysis depth is resolved per-request via
// resolveStandardNSamples() (default 4000, env STANDARD_N_SAMPLES override).
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
  'include_e_values', 'include_voi', 'include_path_decomposition',
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
      include_e_values: { type: 'boolean' },
      include_voi: { type: 'boolean' },
      include_path_decomposition: { type: 'boolean' },
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
  /**
   * ROADMAP 1.54: the originally requested/default depth when nSamples was
   * reduced to fit ISL's complexity budget. Present ONLY on reduced runs —
   * its presence drives the SAMPLES_REDUCED_FOR_COMPLEXITY inference warning.
   * nSamples itself is always the TRUE depth used.
   */
  originalNSamples?: number;
  /** Track S: sample depth used for flip probes (decoupled from nSamples). Omitted when no flip search ran. */
  flipProbeNSamples?: number;
  /**
   * A3 lane 2 (whole-block flip honesty): the JS error NAME (never the
   * message or any value) captured when the ENTIRE flip-threshold block was
   * attempted but threw. Presence drives the FLIP_THRESHOLDS_UNAVAILABLE
   * inference warning. Absent when the block succeeded, produced no
   * candidates, or was never attempted. Per-factor failures do NOT set this —
   * they ride `flip_reason` on each flip_thresholds entry.
   */
  flipThresholdsFailedErrorName?: string;
  /**
   * F14 (Codex deep review) + NIT 1: edge E-value entries dropped from the public
   * array because a required numeric was non-finite, split by CAUSE — `inputNull`
   * (already non-finite in the ISL input, e.g. an unflippable edge) vs `overflow`
   * (finite input that became non-finite after range denormalisation). A non-zero
   * total drives the cause-accurate EDGE_E_VALUE_NON_FINITE_DROPPED inference
   * warning so the drop is attributable on the wire, not only in the server log.
   * Absent = no drop.
   */
  edgeEValuesDropped?: EdgeEValueDropSink;
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
    /**
     * 2.13 gap D (additive): request ID PLoT sent to CEE (null if CEE not
     * called) and CEE's echo. Informational — deliberately NOT part of
     * all_match/chain_complete (Brief 4 header spec back-compat).
     */
    cee: string | null;
    cee_echoed: string | null;
    /** true ONLY when all four ISL-leg fields are non-null AND identical */
    all_match: boolean;
    /** true ONLY when all four ISL-leg fields are non-null */
    chain_complete: boolean;
  };
  /** Filtered constraint records for _meta.filtered_constraints */
  filteredConstraints?: import('../../types/engine-v3.js').FilteredConstraintRecord[];
  /** Per-factor range derivation source (maps factor_id → derivation tier) */
  rangeDerivationSources?: Record<string, string>;
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
    // CIL 0.2: maintain robustness contract on error responses.
    // Lane PLoT-W5 (additive): blocked/failed runs never computed robustness,
    // so the display-safe verdict is 'not_assessed' — never a
    // determinate-looking verdict without computed robustness.
    robustness: {
      fragile_edges: [],
      robust_edges: [],
      ...deriveRobustnessDisplayVerdict(undefined, false),
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
 * Honest per-class failure detail for ISL infrastructure failures
 * (fragility gap 2, FRAGILITY-PAIR-FINDINGS-2026-07-10): the discriminating
 * code computed by callAnalysisEndpoint reaches the wire as a critique
 * instead of being discarded, so consumers can distinguish "service down,
 * retry" from "request rejected, don't retry". Codes not listed here
 * (e.g. ISL_NOT_ENABLED) keep the legacy response byte-identically.
 */
function buildIslFailureDetail(
  error: { code: string; message: string; status?: number } | undefined,
): { statusReason: string; critique?: CritiqueV3 } {
  // user_message copy lives in the critique-humaniser TEMPLATE_MAP (single
  // source, coverage-tested) — callers run the critique through addUserMessages.
  const classStatusReasons: Record<string, string> = {
    ISL_TIMEOUT: 'The analysis service timed out before returning a result.',
    ISL_NETWORK_ERROR: 'The analysis service is unreachable.',
    ISL_ERROR: 'The analysis service returned an error.',
    ISL_REJECTED: 'The analysis service rejected this request.',
  };
  const classStatusReason = error ? classStatusReasons[error.code] : undefined;
  if (!error || !classStatusReason) {
    return { statusReason: 'ISL analysis failed' };
  }
  const statusReason = error.code === 'ISL_ERROR' && error.status
    ? `The analysis service returned an error (HTTP ${error.status}).`
    : classStatusReason;
  return {
    statusReason,
    critique: {
      id: randomUUID(),
      code: error.code,
      severity: 'error',
      // Review [17]: class-safe copy, never the raw ISL error.message — raw
      // detail carries internals (endpoint paths, timeout config) and already
      // goes to the logs (isl_call_failed / isl_analysis_failed events); the
      // wire gets the same claim-safe posture as PLOT_INTERNAL_ERROR.
      message: statusReason,
      source: 'isl',
      blocks_analysis: false,
    },
  };
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
  edgeEValues?: EnrichedEdgeEValue[];
  conditionalWinners?: ConditionalWinner[];
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
 *
 * Reliability gate (lane 27, ROADMAP 1.26a): when any constraint target is
 * suppressed-unreliable (partitionConstraintTargets — the same classification
 * behind the per-option probability suppression), the whole block returns
 * { constraints_status: 'unavailable' } instead of 'computed' with leaked
 * probabilities; raw values go to the constraint_results_suppressed log only.
 */
/**
 * Collect CEE-stamped goal-threshold metadata from the RAW upstream nodes (P0-C1).
 *
 * CEE stamps `goal_threshold` (already normalised to [0,1]) and
 * `goal_threshold_cap` (the scale the raw user target was normalised against,
 * e.g. 100 for '%') on the goal node. The graph normaliser rebuilds nodes into
 * canonical EngineNodeV3 and DROPS these fields, so they must be captured from
 * `body.graph.nodes` before normalisation — same pattern as the
 * auto_constraint_from_threshold fallback, which reads the raw goal node
 * directly. Supports the same direct/data.-nested locations as normaliseNode.
 */
function collectGoalThresholdNodeMeta(
  rawNodes: unknown
): Map<string, GoalThresholdNodeMeta> {
  const meta = new Map<string, GoalThresholdNodeMeta>();
  if (!Array.isArray(rawNodes)) return meta;

  const finiteOrUndefined = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? v : undefined;

  for (const node of rawNodes as any[]) {
    if (!node || typeof node.id !== 'string' || node.id.length === 0) continue;
    const goalThreshold = finiteOrUndefined(node.goal_threshold ?? node.data?.goal_threshold);
    const goalThresholdCap = finiteOrUndefined(node.goal_threshold_cap ?? node.data?.goal_threshold_cap);
    if (goalThreshold === undefined && goalThresholdCap === undefined) continue;
    meta.set(node.id, {
      ...(goalThreshold !== undefined && { goal_threshold: goalThreshold }),
      ...(goalThresholdCap !== undefined && { goal_threshold_cap: goalThresholdCap }),
    });
  }
  return meta;
}

function buildConstraintFields(
  goalConstraints: GoalConstraint[] | undefined,
  islResult: any,
  constraintNormRanges?: Map<string, NormalisationRange>,
  // Producer honesty (lane 27, ROADMAP 1.26a): the suppressed half of the
  // constraint-target partition (partitionConstraintTargets — same
  // classification the per-option suppression keys on). When non-empty, the
  // top-level block is withheld too; doctrine-B modelledBasis targets are NOT
  // passed here — they deliver (lane P0-C2).
  suppressedConstraintTargets?: UnreliableConstraintTarget[],
  logger?: { warn: (obj: object, msg?: string) => void }
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

  // Find first option with NON-EMPTY constraint_analysis.constraints.
  // Honesty guard: a present-but-empty `constraints: []` array means ISL echoed the
  // analysis object but evaluated zero constraints (e.g. it silently dropped every
  // constraint it received). Requiring length > 0 here routes that degenerate case
  // through the `'unavailable'` branch below instead of emitting a misleading
  // `constraints_status: 'computed'` with no constraint_results. (An empty array is
  // truthy in JS, so the previous `r.constraint_analysis?.constraints` predicate
  // matched it and reported a fabricated "computed".)
  const islOptionData = islResult?.options ?? islResult?.results;
  const firstOptionWithConstraints = Array.isArray(islOptionData)
    ? islOptionData.find(
        (r: any) =>
          Array.isArray(r.constraint_analysis?.constraints) &&
          r.constraint_analysis.constraints.length > 0
      )
    : undefined;

  if (!firstOptionWithConstraints?.constraint_analysis) {
    // Constraints sent but ISL returned no usable constraint_analysis (absent, or
    // present with zero evaluated constraints). Honesty (Codex round-4): the COMMON
    // ISL error shape is status:'error' WITH absent/empty constraint_analysis, so an
    // explicit upstream error reaches HERE — no constraint-bearing option was found
    // by the length>0 lookup above, which would otherwise hide the failure as
    // 'unavailable'. Distinguish it and surface the existing 'error' status instead.
    const hasOptionError = Array.isArray(islOptionData)
      && islOptionData.some((r: any) => r?.status === 'error');
    return { constraints_status: hasOptionError ? 'error' : 'unavailable' };
  }

  // Honesty (Codex round-2): also surface 'error' for the rarer shape where the
  // constraint-bearing option itself reports status:'error' (it has a constraint
  // payload but the run errored). The common no-payload error shape is handled in
  // the 'unavailable' branch above. ('error' is an existing ConstraintFeatureStatus.)
  if (firstOptionWithConstraints.status === 'error') {
    return { constraints_status: 'error' };
  }

  const analysis = firstOptionWithConstraints.constraint_analysis;
  const islConstraints: ISLConstraintResult[] = analysis.constraints ?? [];

  // Build an index-position lookup from ISL response ordinal → input constraint_id.
  // ISL preserves insertion order and does not echo constraint_id, so positional
  // mapping is the only stable identity. Value-based matching breaks after normalisation
  // (ISL echoes normalised values; input has raw user-unit values).
  const islIndexToConstraintId: string[] = islConstraints.map((islC, idx) => {
    const byIndex = goalConstraints[idx];
    if (byIndex && byIndex.node_id === islC.node_id && byIndex.operator === islC.operator) {
      return byIndex.constraint_id;
    }
    // Fallback: (node_id, operator) scan — handles ISL reordering edge case
    const byNodeOp = goalConstraints.find(
      gc => gc.node_id === islC.node_id && gc.operator === islC.operator
    );
    return byNodeOp?.constraint_id ?? `${islC.node_id}_${islC.operator}`;
  });
  const resolveConstraintId = (_islC: ISLConstraintResult, idx: number): string =>
    islIndexToConstraintId[idx] ?? `${_islC.node_id}_${_islC.operator}`;

  // Map ISL constraint results to Schema v2.7 ConstraintResult[]
  // F-20: ISL returns both "value" (computed) and "threshold" (primary) — accept both.
  // When constraints were normalised for ISL, echo the original user-unit value
  // (from activeGoalConstraints, which is never mutated) rather than the normalised ISL echo.
  const constraintResults: ConstraintResult[] = islConstraints.map((c, idx) => {
    const constraintId = resolveConstraintId(c, idx);
    const islValue = c.value ?? c.threshold;
    // Prefer original user-unit value from input constraints
    const originalConstraint = goalConstraints!.find(gc => gc.constraint_id === constraintId);
    return {
      constraint_id: constraintId,
      node_id: c.node_id,
      operator: c.operator as '>=' | '<=',
      value: originalConstraint?.value ?? islValue,
      probability: c.prob_satisfied,
    };
  });

  // Honesty guard (WP1/WP5): 'computed' must mean every forwarded constraint has a
  // complete, valid result. Reject to 'unavailable' when ISL returned a malformed
  // result (probability non-finite or outside [0,1]) or did not cover every
  // forwarded constraint (e.g. one result for two forwarded constraints). Otherwise
  // we would report a fabricated 'computed' over partial or garbage data, and a
  // non-finite probability would serialise to a fabricated `null`. `goalConstraints`
  // here is the ACTIVE (post temporal-filter) set actually forwarded to ISL (callers
  // pass activeGoalConstraints), so each one must map to a valid result.
  const allConstraintProbabilitiesValid = constraintResults.every(
    (r) =>
      // Absent probability (ISL echoed the constraint without a prob_satisfied) is
      // ACCEPTABLE ABSENCE — it is omitted (Fastify drops undefined), never fabricated,
      // and must NOT collapse the whole constraint field to 'unavailable'. Only a
      // PRESENT-but-unsafe value (non-finite or outside [0,1]) is rejected, per Track S
      // numeric-safety policy. (Codex round-6: round-3 over-rejected absent probability,
      // which broke the 'computed-empty' contract pinned by
      // tests/enrichment-emission-contract.test.ts.)
      r.probability === undefined ||
      (typeof r.probability === 'number' &&
        Number.isFinite(r.probability) &&
        r.probability >= 0 &&
        r.probability <= 1)
  );
  // Exact one-to-one correspondence with the forwarded active constraints — NOT
  // mere coverage. Round-1 only checked forwarded ⊆ resolved, which accepted
  // duplicate rows (two ISL results collapsing to one constraint_id via the
  // (node_id,operator) resolver) and extraneous rows (ISL returning more than were
  // forwarded). Require: equal cardinality, unique resolved ids (no collapse), and
  // every resolved id is a forwarded constraint (resolved ⊆ forwarded).
  const resolvedConstraintIds = new Set(constraintResults.map((r) => r.constraint_id));
  const forwardedIds = new Set(goalConstraints.map((gc) => gc.constraint_id));
  const exactCorrespondence =
    constraintResults.length === goalConstraints.length &&
    resolvedConstraintIds.size === constraintResults.length &&
    [...resolvedConstraintIds].every((id) => forwardedIds.has(id)) &&
    goalConstraints.every((gc) => resolvedConstraintIds.has(gc.constraint_id));
  if (!allConstraintProbabilitiesValid || !exactCorrespondence) {
    return { constraints_status: 'unavailable' };
  }

  // Extract diagnostics from ISL constraint results
  // When constraints were normalised, denormalise failure_margin_median back to user units.
  // failure_margin_median is a distance (delta), so scale by range width (same as std).
  // Use flatMap to preserve index for stable constraint_id resolution while filtering.
  const constraintDiagnostics: ConstraintDiagnostic[] = islConstraints.flatMap((c, idx) => {
    if (c.failure_margin_median === undefined && c.near_miss_fraction === undefined && c.binding === undefined) {
      return [];
    }
    const constraintId = resolveConstraintId(c, idx);
    let failureMarginMedian = c.failure_margin_median ?? 0;

    if (constraintNormRanges) {
      const range = constraintNormRanges.get(constraintId);
      if (range) {
        const rangeWidth = range.max - range.min;
        if (rangeWidth > 0) {
          failureMarginMedian = failureMarginMedian * rangeWidth;
        }
      }
    }

    const nearMissFraction = c.near_miss_fraction ?? 0;
    // Numeric-egress guard (Codex round-3): drop the whole diagnostic row when a
    // present margin / near-miss is non-finite — a NaN/±Infinity would serialise to a
    // fabricated `null` on these required-number fields. Non-finite ROW filtering only;
    // making the fields optional (to remove the `?? 0` absent-default) is a deferred
    // schema/OpenAPI change.
    if (!Number.isFinite(failureMarginMedian) || !Number.isFinite(nearMissFraction)) {
      return [];
    }
    return [{
      constraint_id: constraintId,
      failure_margin_median: failureMarginMedian,
      near_miss_fraction: nearMissFraction,
      binding: c.binding ?? false,
    }];
  });

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
          given_constraint_id: resolveConstraintId(givenConstraint, cp.given_constraint_index),
          target_constraint_id: resolveConstraintId(targetConstraint, cp.target_constraint_index),
          probability: cp.probability,
          effective_sample_size: cp.effective_sample_size ?? 0,
        };
      })
      // Numeric-egress guard (Codex round-3): drop conditional rows whose probability
      // or effective_sample_size is non-finite (would serialise to a fabricated `null`
      // on these required-number fields). Non-finite ROW filtering only.
      .filter((cp: ConditionalProbability) => Number.isFinite(cp.probability) && Number.isFinite(cp.effective_sample_size));
  }

  // Producer honesty (lane 27, ROADMAP 1.26a — the LANE25 §8 follow-up): the
  // per-option suppression (item A + doctrine B, see buildResponse) withholds
  // probability_of_joint_goal / constraint_probabilities when any constraint
  // target is suppressed-unreliable, but this top-level block previously still
  // emitted constraint_results[].probability (= the first option's
  // prob_satisfied) under constraints_status: 'computed' — the withheld
  // numbers leaked via the top-level surface. Gate it on the SAME partition:
  // when any target suppresses, the whole block is withheld (absence is
  // honest; the WARNING-severity CONSTRAINT_TARGET_UNRELIABLE explains why)
  // and 'unavailable' replaces the fabricated 'computed'. The diagnostics and
  // conditional probabilities derive from the same non-decision-grade
  // evaluation, so they are withheld with it. Raw values stay in the
  // diagnostics log below — never on the wire. Doctrine-B modelledBasis
  // targets deliver unchanged (callers pass only the suppressed partition).
  // Gated AFTER the early returns above so ISL 'error'/'unavailable'
  // outcomes keep their more specific status.
  if (suppressedConstraintTargets && suppressedConstraintTargets.length > 0) {
    logger?.warn({
      event: 'constraint_results_suppressed',
      raw_constraint_results: constraintResults,
      raw_constraint_diagnostics: constraintDiagnostics,
      raw_conditional_probabilities: conditionalProbabilities,
      unreliable_targets: suppressedConstraintTargets,
    });
    return { constraints_status: 'unavailable' };
  }

  return {
    constraints_status: 'computed',
    constraint_results: constraintResults.length > 0 ? constraintResults : undefined,
    constraint_diagnostics: constraintDiagnostics.length > 0 ? constraintDiagnostics : undefined,
    conditional_probabilities: conditionalProbabilities ?? [],
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
  ceeCalled: boolean = false,
  ceeEchoedRequestId: string | null = null,
): NonNullable<MetaParams['requestIdChain']> {
  const ui = hasExplicitRequestId ? requestId : null;
  const plot = requestId;
  const isl = islCalled ? requestId : null;
  const isl_echoed = islEchoedRequestId;
  // all_match/chain_complete stay computed over the ISL four ONLY — the CEE
  // legs (2.13 gap D) are additive/informational so existing consumers of
  // the Brief 4 semantics are unaffected.
  const chain_complete = ui !== null && plot !== null && isl !== null && isl_echoed !== null;
  const all_match = chain_complete && ui === plot && plot === isl && isl === isl_echoed;
  const cee = ceeCalled ? requestId : null;
  const cee_echoed = ceeEchoedRequestId;
  return { ui, plot, isl, isl_echoed, cee, cee_echoed, all_match, chain_complete };
}

/**
 * Build X-Olumi-Request-Id-Chain header JSON from request ID chain.
 * Field names match _meta.request_id_chain (Brief 4 spec — original 6
 * fields; 2.13 adds the additive cee/cee_echoed legs).
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
  constraintNormRanges?: Map<string, NormalisationRange>,
  thresholdsStatus?: ThresholdsStatus,
  thresholdsMeta?: { reason?: string; duration_ms?: number },
  thresholdAnalysis?: ThresholdResult[],
  identifiability?: IdentifiabilityAssessment,
  factorStability?: FactorStabilityEntry[],
  logger?: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void }
): RunResponseV3 {
  // Producer honesty (lane PLoT-H item A): detect goal constraints whose
  // targets are NOT decision-grade — threshold normalisation fell back to the
  // default [0,1] range and/or ISL defaulted the target node's base to 0.0.
  // When any such target exists, probability_of_joint_goal and
  // constraint_probabilities are SUPPRESSED for the run (absence is honest —
  // the UI gates goal-fit on absence) and a WARNING-severity
  // CONSTRAINT_TARGET_UNRELIABLE inference warning names the node + the fix.
  // Raw computed values are logged (diagnostics) but never emitted.
  //
  // Doctrine B (lane P0-C2, ratified 2026-07-07): a target whose ONLY reason
  // is target_base_defaulted AND whose samples are forward-propagated (≥1
  // directed incoming edge) is DELIVERED instead — scored from the modelled
  // outcome distribution — with an additive per-option `goal_fit_basis`
  // annotation and an info-severity CONSTRAINT_GOALFIT_MODELLED_BASIS note.
  // Any other reason combination (default-range normalisation, root-node
  // targets, mixed multi-constraint runs) keeps suppressing exactly as
  // before. See src/lib/constraint-reliability.ts for the classification.
  const unreliableConstraintTargets = detectUnreliableConstraintTargets(
    goalConstraints,
    constraintNormRanges,
    islResult,
  );
  const constraintTargetPartition = partitionConstraintTargets(
    unreliableConstraintTargets,
    graph,
  );
  const suppressConstraintProbabilities = constraintTargetPartition.suppressed.length > 0;
  // Modelled-basis delivery is only active when NOTHING suppresses: on a
  // mixed run the run-level suppression wins (exactly today's behaviour).
  const modelledBasisConstraintTargets = suppressConstraintProbabilities
    ? []
    : constraintTargetPartition.modelledBasis;
  // Sorted + deduplicated node ids for the per-option annotation.
  const modelledBasisNodeIds = [
    ...new Set(modelledBasisConstraintTargets.map((t) => t.node_id)),
  ].sort();

  // Defensive sign-check (lane PLoT-goal-fit-sign-defense) on the Phase 1c+
  // auto-constraint fallback: at most one constraint ever carries this
  // provenance (synthesis only fires when zero constraints were compiled —
  // see run.ts ~3696), so find it once here rather than per-option below.
  const autoDirectionConstraint = goalConstraints?.find(
    (c) => (c as any)._internal?.source === 'auto_from_goal_threshold',
  );
  // Node ids where the sign-mismatch fired for at least one option — used to
  // emit exactly one CONSTRAINT_DIRECTION_SUSPECT warning below, mirroring
  // the unreliable-constraint-target dedup-by-node pattern above.
  const directionSuspectNodeIds = new Set<string>();

  // Map ISL results to response format
  // ISL V2 uses 'options' field; V1 uses 'results'. Check both for compatibility.
  const islOptionData = islResult?.options ?? islResult?.results;
  const optionComparison = islOptionData?.map((r: any) => {
    const optionId = r.option_id ?? r.id;
    const option = options?.find((o) => o.id === optionId);

    // ISL V2 returns outcome as nested object; V1 returns flat fields
    const outcomeData = r.outcome;
    const hasOutcomeObject = outcomeData && typeof outcomeData === 'object';

    // Build full outcome stats from ISL V2 format. Numeric-safety guard (WP5):
    // omit the ENTIRE outcome when a REQUIRED stat (mean/p10/p50/p90 per
    // OutcomeStatsV3) is non-finite — a NaN/±Infinity would otherwise serialise to
    // a fabricated `null` on a declared-number field. Optional stats (std,
    // n_samples, n_valid_samples, validity_ratio) are dropped INDIVIDUALLY when
    // non-finite. `Number.isFinite` is false for non-numbers too, so this also
    // drops missing/garbage values exactly as before. Keys are inserted in the
    // original order so a fully-finite outcome serialises byte-identically (no
    // response_hash drift); only the degenerate non-finite case changes.
    let outcome: Record<string, number> | undefined;
    if (hasOutcomeObject && hasAllRequiredOutcomeStats(outcomeData)) {
      // Required mean/p10/p50/p90 are outcome magnitudes (unbounded) → finite-only.
      // Optional stats carry their true domains: std non-negative, sample counts
      // non-negative integers, validity_ratio a [0,1] rate. Key insertion order is
      // preserved so a valid outcome serialises byte-identically (no golden drift).
      outcome = { mean: outcomeData.mean };
      const stdVal = nonNeg(outcomeData.std);
      if (stdVal !== undefined) outcome.std = stdVal;
      outcome.p10 = outcomeData.p10;
      outcome.p50 = outcomeData.p50;
      outcome.p90 = outcomeData.p90;
      const nSamplesVal = nonNegInt(outcomeData.n_samples);
      if (nSamplesVal !== undefined) outcome.n_samples = nSamplesVal;
      const nValidVal = nonNegInt(outcomeData.n_valid_samples);
      if (nValidVal !== undefined) outcome.n_valid_samples = nValidVal;
      const validityVal = prob01(outcomeData.validity_ratio);
      if (validityVal !== undefined) outcome.validity_ratio = validityVal;
    }

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

    // Include probability_of_goal only if ISL returned a value in [0,1] (omit when
    // absent, non-finite, or out-of-range — never a fabricated `null` or a 150%
    // probability). A non-finite value would otherwise serialise to a fabricated
    // `null` on this declared-numeric probability field; honest absence is correct.
    const probGoal = prob01(r.probability_of_goal);
    if (probGoal !== undefined) {
      result.probability_of_goal = probGoal;
    }

    // Include win_probability only if ISL returned a value in [0,1] (omit when
    // absent, non-finite, or out-of-range). Mirrors the finite guard already used
    // by the recommended-option / near-tie derivations (see deriveRecommendedOption).
    const winProb = prob01(r.win_probability);
    if (winProb !== undefined) {
      result.win_probability = winProb;
    }

    // CIL C1: Pass through per-option constraint analysis from ISL
    // ISL nests this as constraint_analysis per-option when goal_constraints were sent
    const constraintAnalysis = r.constraint_analysis;
    if (!constraintAnalysis && goalConstraints && goalConstraints.length > 0) {
      logger?.info({ event: 'constraint_analysis_absent', option_id: optionId });
    }
    if (constraintAnalysis) {
      // Map ISL's joint_probability to Schema v2.7 probability_of_joint_goal.
      // Numeric-safety guard: omit when non-finite or outside [0,1] (a NaN/±Infinity
      // would otherwise serialise to a fabricated `null`, and a >1 value would render
      // an impossible probability).
      const jointProb = prob01(constraintAnalysis.joint_probability);

      // Map ISL's per-constraint prob_satisfied to constraint_probabilities map
      // Uses index-position mapping (same as buildConstraintFields): ISL preserves insertion
      // order but does NOT echo constraint_id. Value-based matching breaks after normalisation
      // because ISL echoes normalised values while goalConstraints holds raw user-unit values.
      let constraintProbs: Record<string, number> | undefined;
      if (Array.isArray(constraintAnalysis.constraints) && constraintAnalysis.constraints.length > 0) {
        constraintProbs = {};
        const islConstraintsHere = constraintAnalysis.constraints as ISLConstraintResult[];
        const indexToId: string[] = islConstraintsHere.map((islC, idx) => {
          const byIndex = goalConstraints?.[idx];
          if (byIndex && byIndex.node_id === islC.node_id && byIndex.operator === islC.operator) {
            return byIndex.constraint_id;
          }
          const byNodeOp = goalConstraints?.find(
            gc => gc.node_id === islC.node_id && gc.operator === islC.operator
          );
          return byNodeOp?.constraint_id ?? `${islC.node_id}_${islC.operator}`;
        });
        for (let i = 0; i < islConstraintsHere.length; i++) {
          const c = islConstraintsHere[i];
          const constraintId = indexToId[i] ?? `${c.node_id}_${c.operator}`;
          // Numeric-safety guard: omit prob_satisfied unless it is a [0,1] value (a
          // NaN/±Infinity would serialise to a fabricated `null`; a >1 value is an
          // impossible probability).
          const probSat = prob01(c.prob_satisfied);
          if (probSat !== undefined) {
            constraintProbs[constraintId] = probSat;
          }
        }
      }

      // Defensive sign-check (lane PLoT-goal-fit-sign-defense): the auto-
      // constraint fallback guessed '>=' with no visibility into goal-framing
      // text. If the guessed positive threshold can never be reached — this
      // option's modelled outcome for the SAME target node stays negative
      // even at its most favourable sampled percentile (p90) — the ~0% ISL
      // just computed is a mechanical certainty of the sign mismatch, not a
      // signal about the graph. Abstain rather than emit it. Checked BEFORE
      // suppressConstraintProbabilities/modelled-basis so it takes priority
      // over both (this is a stronger, option-specific defect than either).
      const directionSuspect =
        autoDirectionConstraint !== undefined &&
        isAutoConstraintDirectionSuspect(autoDirectionConstraint.value, outcome?.p90);

      if (directionSuspect) {
        directionSuspectNodeIds.add(autoDirectionConstraint!.node_id);
        logger?.warn({
          event: 'constraint_direction_suspect',
          option_id: optionId,
          node_id: autoDirectionConstraint!.node_id,
          auto_threshold: autoDirectionConstraint!.value,
          outcome_p90: outcome?.p90,
          raw_probability_of_joint_goal: constraintAnalysis.joint_probability,
          raw_constraint_probabilities: constraintProbs,
        });
      } else if (suppressConstraintProbabilities) {
        // Producer honesty (item A): the computed values are structurally
        // meaningless (default-range threshold and/or defaulted base). Emit
        // NEITHER field — absence is honest — and keep the raw values in
        // diagnostics logs only. CONSTRAINT_TARGET_UNRELIABLE (warning) is
        // emitted once per affected node further below.
        logger?.warn({
          event: 'constraint_probability_suppressed',
          option_id: optionId,
          raw_probability_of_joint_goal: constraintAnalysis.joint_probability,
          raw_constraint_probabilities: constraintProbs,
          unreliable_targets: unreliableConstraintTargets,
        });
      } else {
        if (jointProb !== undefined) {
          result.probability_of_joint_goal = jointProb;
        }
        if (constraintProbs !== undefined) {
          result.constraint_probabilities = constraintProbs;
          logger?.info({ event: 'constraint_probs_mapped', option_id: optionId, count: Object.keys(constraintProbs).length });
        }
        // Doctrine B (P0-C2): honest provenance for delivered goal-fit scored
        // from the modelled outcome distribution (target base defaulted, no
        // observed baseline). Additive — absent on fully-reliable runs, and
        // only attached when the option actually carries a delivered value.
        if (
          modelledBasisNodeIds.length > 0 &&
          (jointProb !== undefined || constraintProbs !== undefined)
        ) {
          result.goal_fit_basis = {
            scored_from: GOAL_FIT_SCORED_FROM_MODELLED_OUTCOME,
            node_ids: modelledBasisNodeIds,
          };
          logger?.info({
            event: 'constraint_probability_modelled_basis',
            option_id: optionId,
            node_ids: modelledBasisNodeIds,
          });
        }
      }
    }

    return result;
  });

  // Use pre-computed sensitivity data if provided (for status/response alignment)
  // Fall back to computing from islResult for backward compatibility
  // Build fallback label maps from graph/options if pre-computed data not available
  const needsFallback = !sensitivityData?.edgeSensitivity;
  const fallbackNodeLabelMap = (() => {
    if (!needsFallback) return undefined;
    const map = new Map<string, string>();
    if (graph?.nodes) {
      for (const node of graph.nodes) map.set(node.id, node.label);
    }
    return map;
  })();
  const fallbackOptionLabelMap = (() => {
    if (!needsFallback) return undefined;
    const map = new Map<string, string>();
    if (options) {
      for (const opt of options) {
        const cleaned = cleanLabelAnnotation(opt.label);
        map.set(opt.id, cleaned || opt.id);
      }
    }
    return map;
  })();
  // ISL V2 wire truth (lane PLoT-W4, 2026-07-07 — see
  // src/integrations/isl/v2-envelope.ts): the pinned response_version=2
  // envelope NEVER emits top-level `sensitivity`, but as of ISL build
  // 9a22a1a (lane 11 / ISL PR #65) it carries edge-level sensitivity NESTED
  // at `robustness.edge_sensitivity` — read via the accessor. On older
  // deployed ISL builds (e.g. f3f5d92) the nested field is absent too:
  // edge_sensitivity then stays "computed, empty" and is explicitly marked
  // via the EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE inference warning below.
  const edgeSensitivity = sensitivityData?.edgeSensitivity
    ?? transformEdgeSensitivity(getIslEdgeSensitivity(islResult), fallbackNodeLabelMap);
  const factorSensitivity = sensitivityData?.factorSensitivity
    ?? transformFactorSensitivity(islResult?.factor_sensitivity);
  // Fallback transforms for edge_e_values and conditional_winners when sensitivityData not pre-computed.
  // Edge E-values are NESTED at robustness.edge_e_values on the V2 wire (the
  // former top-level read was structurally dead) — read via the accessor.
  const edgeEValues = sensitivityData?.edgeEValues
    ?? transformEdgeEValues(getIslEdgeEValues(islResult), fallbackNodeLabelMap);
  const conditionalWinners = sensitivityData?.conditionalWinners
    ?? transformConditionalWinners(islResult?.conditional_winners, fallbackNodeLabelMap, fallbackOptionLabelMap);

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
    // and severity classification (B1: ported from UI thresholds unchanged)
    const enrichedFragileEdges: NormalizedEdgeInfoV3[] = fragileResult.edges.map(edge => ({
      ...edge,
      // from_label and to_label from graph lookup, fall back to node ID if not found
      from_label: nodeLabelMap.get(edge.from_id) ?? edge.from_id,
      to_label: nodeLabelMap.get(edge.to_id) ?? edge.to_id,
      // Severity classification from switch_probability (B1)
      severity: classifyEdgeSeverity(edge.switch_probability),
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
      // Numeric-egress guard (Codex round-3): omit robustness scalars when non-finite
      // (score) or outside [0,1] (confidence) — these are OPTIONAL fields, so omission
      // is honest absence, never a fabricated `null` or an impossible rate.
      // switch_probability fabrication is NOT addressed here (see the deferred
      // cross-layer note in the PR — it is type-required across consumers).
      ...(finiteNum(islResult.robustness.score) !== undefined && { score: finiteNum(islResult.robustness.score) }),
      label,
      fragile_edges: enrichedFragileEdges,
      robust_edges: enrichedRobustEdges,
      explanation: islResult.robustness.explanation,
      // recommendation_stability is DELIBERATELY NOT EMITTED (lane PLoT-H
      // item B, 2026-07-07). ISL computes it as option_wins[winner]/n_samples
      // (robustness_analyzer_v2.py:_compute_robustness) — the leader's
      // win_probability relabelled, zero independent information. Verified
      // byte-identical to the leader's win_probability in both live manual
      // tests (0.59025 / 0.8541875) and in the live capture fixture
      // (tests/fixtures/isl-v2-live-20260706: robustness.recommendation_stability
      // 0.59025 === max win_probability 0.59025). The UI printed it as
      // "N% stability" — a fabricated second statistic. Omission is honest
      // absence; the UI has an absence path. No genuinely distinct
      // recommendation-level stability signal exists on the V2 wire (the
      // wire's `confidence` is itself derived from this same value).
      // Pass through V2/Option C robustness summary fields from ISL
      ...(islResult.robustness.is_robust !== undefined && {
        is_robust: islResult.robustness.is_robust,
      }),
      ...(islResult.robustness.level !== undefined && {
        level: islResult.robustness.level,
      }),
      ...(prob01(islResult.robustness.confidence) !== undefined && {
        confidence: prob01(islResult.robustness.confidence),
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

  // Display-safe robustness verdict (lane PLoT-W5, roadmap Tier 1.6 —
  // additive). Derived honestly and ONLY from the producer facts
  // is_robust/level as assembled above (confidence is NEVER an input);
  // 'not_assessed' whenever robustness_status is not 'computed' or the
  // verdict-bearing facts are missing — never a determinate-looking verdict
  // without computed robustness. Mapping + wording provisional_doctrine_v0 —
  // see src/routes/v2/robustness-display-verdict.ts.
  const displayVerdictFields = deriveRobustnessDisplayVerdict(
    { is_robust: robustness.is_robust, level: robustness.level },
    robustnessStatus === 'computed',
  );
  robustness.display_verdict = displayVerdictFields.display_verdict;
  robustness.display_verdict_reason = displayVerdictFields.display_verdict_reason;

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

  // F13 (Codex deep review): DISCLOSE ambiguous-identity factor entries. An ISL
  // entry carrying BOTH a node_id AND a factor_id that DIFFER cannot be resolved
  // to a single trusted id, so the publication builders DROP it (factor_stability
  // buildFactorStability, CEE-review extractFactorSensitivity, and the D-U lever
  // predicate resolve identity through the one canonical factorIdOf precedence).
  // The pinned ISL producer emits only node_id, so this cannot fire today — it is
  // schema-evolution hardening that fails LOUD (never silent) if a future
  // producer adds a conflicting factor_id.
  {
    const rawFactors = Array.isArray(islResult?.factor_sensitivity)
      ? islResult.factor_sensitivity
      : [];
    const conflictIds = new Set<string>();
    for (const f of rawFactors) {
      if (hasFactorIdConflict(f)) {
        const id = factorIdOf(f);
        if (id) conflictIds.add(id);
      }
    }
    if (conflictIds.size > 0) {
      inferenceWarnings.push({
        code: INFERENCE_WARNING_CODES.FACTOR_ID_CONFLICT,
        // provisional_doctrine_v0 — wording surface (diagnostic disclosure). Names
        // only structural graph ids (never user values); count disambiguates.
        message:
          `${conflictIds.size} factor entr${conflictIds.size === 1 ? 'y' : 'ies'} carried a ` +
          `conflicting node_id/factor_id and ${conflictIds.size === 1 ? 'was' : 'were'} dropped from ` +
          `factor_sensitivity, factor_stability and decision-review derivation (ambiguous identity): ` +
          `${[...conflictIds].sort().join(', ')}. All other analyses are unaffected.`,
        severity: 'warning',
      });
    }
  }

  // Liveness honesty: edge-level sensitivity is requested on every ISL call
  // (analysis_types always includes 'sensitivity'). ISL builds 9a22a1a+ emit
  // it nested at robustness.edge_sensitivity (consumed above — lane PLoT-W4);
  // OLDER deployed ISL builds (e.g. f3f5d92) do not emit it anywhere on the
  // V2 wire. On those builds an empty edge_sensitivity on a computed analysis
  // would be a SILENT empty array — indistinguishable from "computed and
  // found nothing". Mark it explicitly so consumers (and the liveness fixture
  // tests) can tell wire-gap from absence. SUPPRESSED automatically when the
  // wire carried data (edgeSensitivity non-empty): populated OR marked,
  // never both absent. Factor-level sensitivity is unaffected.
  if (analysisStatus === 'computed' && islResult && !hasNonEmptyArray(edgeSensitivity)) {
    inferenceWarnings.push({
      code: INFERENCE_WARNING_CODES.EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE,
      // provisional_doctrine_v0 — wording surface (diagnostic disclosure)
      message: 'Edge-level sensitivity was requested but this ISL response did not carry it (emitted by ISL builds 9a22a1a+ at robustness.edge_sensitivity) — edge_sensitivity is empty because the deployed ISL wire omitted the field, not by computation failure. Factor-level sensitivity is unaffected.',
      severity: 'info',
    });
  }

  // Wire-location probe honesty (lane 29, spec §2.1): edge E-values are
  // requested on EVERY ISL call (include_e_values: true, translator-v3).
  // When robustness came back but the canonical nested location
  // robustness.edge_e_values is ABSENT — not even an empty array — the
  // deployed ISL wire is an older/rolled-back generation and the empty
  // edge_e_values in this response would be a SILENT computed-empty: the
  // exact "empty science" regression shape this lane exists to prevent.
  // Mark it explicitly. An empty array AT the location is computed-empty
  // (honest — the accessor returns [] and no marker fires); a legacy
  // top-level fallback that carried data also suppresses the marker (the
  // accessor resolves it). Pairs with _meta.evidence.isl_wire_generation_ok.
  if (
    analysisStatus === 'computed' &&
    islResult?.robustness &&
    getIslEdgeEValues(islResult) === undefined
  ) {
    inferenceWarnings.push({
      code: INFERENCE_WARNING_CODES.EDGE_E_VALUES_UNAVAILABLE_V2_WIRE,
      // provisional_doctrine_v0 — wording surface (diagnostic disclosure)
      message: 'Edge E-values were requested but this ISL response carries no robustness.edge_e_values location (emitted by ISL builds f3f5d92+) — edge_e_values is empty because the deployed ISL wire omitted the field, not by computation failure.',
      severity: 'info',
    });
  }

  // Producer honesty (item A): one WARNING per affected constraint-target
  // node when goal-fit probabilities were suppressed above. Open-vocabulary
  // code CONSTRAINT_TARGET_UNRELIABLE; message names the node and the
  // concrete user action (set a value/range) — raw suppressed numbers are
  // never quoted (they live in the constraint_probability_suppressed log).
  if (suppressConstraintProbabilities) {
    const warnedNodeIds = new Set<string>();
    for (const target of unreliableConstraintTargets) {
      if (warnedNodeIds.has(target.node_id)) continue;
      warnedNodeIds.add(target.node_id);
      const nodeLabel = graph?.nodes?.find((n) => n.id === target.node_id)?.label ?? target.node_id;
      inferenceWarnings.push({
        code: INFERENCE_WARNING_CODES.CONSTRAINT_TARGET_UNRELIABLE,
        // provisional_doctrine_v0 — wording surface (see constraint-reliability.ts)
        message: buildConstraintTargetUnreliableMessage(nodeLabel, target.reasons),
        severity: 'warning',
      });
    }
  } else if (modelledBasisConstraintTargets.length > 0) {
    // Doctrine B (P0-C2): goal-fit was DELIVERED, scored from the modelled
    // outcome distribution. The honesty signal is downgraded to an
    // info-severity note — one per affected node — pairing with the
    // per-option `goal_fit_basis` annotation emitted above. Raw numbers are
    // never quoted in the note.
    const notedNodeIds = new Set<string>();
    for (const target of modelledBasisConstraintTargets) {
      if (notedNodeIds.has(target.node_id)) continue;
      notedNodeIds.add(target.node_id);
      const nodeLabel = graph?.nodes?.find((n) => n.id === target.node_id)?.label ?? target.node_id;
      inferenceWarnings.push({
        code: INFERENCE_WARNING_CODES.CONSTRAINT_GOALFIT_MODELLED_BASIS,
        // provisional_doctrine_v0 — wording surface (see constraint-reliability.ts)
        message: buildConstraintGoalFitModelledMessage(nodeLabel),
        severity: 'info',
      });
    }
  }

  // Defensive sign-check (lane PLoT-goal-fit-sign-defense): one WARNING per
  // affected auto-constraint target node when the fallback's guessed '>='
  // direction was structurally unsatisfiable for at least one option (see
  // the per-option check above, next to suppressConstraintProbabilities).
  // Independent of the if/else-if above — it fires alongside whichever of
  // those applies, since it is a stronger, option-specific defect.
  for (const nodeId of directionSuspectNodeIds) {
    const nodeLabel = graph?.nodes?.find((n) => n.id === nodeId)?.label ?? nodeId;
    inferenceWarnings.push({
      code: INFERENCE_WARNING_CODES.CONSTRAINT_DIRECTION_SUSPECT,
      // provisional_doctrine_v0 — wording surface (see constraint-reliability.ts)
      message: buildConstraintDirectionSuspectMessage(nodeLabel),
      severity: 'warning',
    });
  }

  // ROADMAP 1.54 (density wall): the sample depth was reduced before the ISL
  // call so the request fits ISL's complexity budget — disclose it, naming
  // BOTH depths. meta.n_samples (and brief/fact lineage) already report the
  // TRUE reduced depth; this warning is what stops the reduction from being
  // a silent override, including when the caller set n_samples explicitly.
  if (meta.originalNSamples !== undefined && meta.originalNSamples !== meta.nSamples) {
    inferenceWarnings.push({
      code: INFERENCE_WARNING_CODES.SAMPLES_REDUCED_FOR_COMPLEXITY,
      // provisional_doctrine_v0 — wording surface (diagnostic disclosure)
      message: `Monte Carlo sample depth was reduced from ${meta.originalNSamples} to ${meta.nSamples} samples so this graph fits the analysis engine's compute-admission budget. All reported results were computed at ${meta.nSamples} samples; displayed probabilities may be slightly less stable than at the standard depth.`,
      severity: 'warning',
    });
  }

  // A3 lane 2 (ROADMAP 2.31 adjacency — whole-block flip honesty): the entire
  // flip-threshold block was attempted but threw. Without this warning the
  // response ships flip_thresholds: [] + flip_thresholds_status 'unavailable'
  // with only a server-side WARN — indistinguishable on the wire from "nothing
  // to probe". Per-factor failures are NOT this case: they ride flip_reason
  // ('timeout'/'error'/...) on each entry and never set this meta field. The
  // message names the thrown error's NAME only — never its message or values.
  if (meta.flipThresholdsFailedErrorName) {
    inferenceWarnings.push({
      code: INFERENCE_WARNING_CODES.FLIP_THRESHOLDS_UNAVAILABLE,
      // provisional_doctrine_v0 — wording surface (diagnostic disclosure)
      message: `Flip thresholds (tipping points) were attempted for this analysis but the computation failed as a whole (${meta.flipThresholdsFailedErrorName}) — flip_thresholds is empty because computation failed, not because no factor could flip the leading option. All other analyses are unaffected.`,
      severity: 'warning',
    });
  }

  // F14 (Codex deep review) + NIT 1: DISCLOSE edge E-values dropped for
  // non-finiteness, attributing the CAUSE accurately. The transform drops
  // entries whose e_value/current_mean/flip_mean are non-finite (a fabricated
  // `null` would otherwise ship). Without this marker the drop was
  // server-log-only — a short/empty edge_e_values was indistinguishable from a
  // genuinely computed-empty result. describeEdgeEValueDrop names the
  // unflippable/input-null cause and the overflow cause separately, never
  // claiming an overflow for the common benign input-null case. Severity: info
  // (ISL routinely emits null e_value for unflippable edges — expected
  // non-representability, not an alarm; still on the wire + _meta warning_codes).
  if (meta.edgeEValuesDropped) {
    const disclosure = describeEdgeEValueDrop(
      meta.edgeEValuesDropped.inputNull,
      meta.edgeEValuesDropped.overflow,
    );
    if (disclosure) inferenceWarnings.push(disclosure);
  }

  // Merge ISL-originated inference_warnings into the PLoT array.
  // ISL may return warnings like ROOT_NODE_DEFAULT_VALUE that PLoT forwards as-is.
  // Deduplicate by code to prevent equivalent warnings from both sources.
  //
  // F4 (Codex deep review): map ISL's REAL `InferenceWarning` shape
  // `{code, field, detail:{reason, elapsed_ms, message}, severity}` (LIVE from
  // ISL #79) faithfully — read `detail.message` (falling back to `detail.reason`),
  // `detail.elapsed_ms`, preserve `field`, and map `severity` THROUGH (ISL now
  // supplies it: the 4 budget-degradation codes are 'warning', benign codes
  // 'info'/absent → 'info'). Top-level `message`/`elapsed_ms`/`node_id` are still
  // read first for back-compat with older fixtures/captures.
  if (Array.isArray(islResult?.inference_warnings)) {
    // Deduplicate by code+node_id composite key to allow per-node warnings
    // (e.g., multiple ROOT_NODE_DEFAULT_VALUE for different root nodes).
    // Seed with PLoT-originated warnings using code: prefix (no node_id).
    const existingKeys = new Set(inferenceWarnings.map(w => `${w.code}:`));
    for (const w of islResult.inference_warnings) {
      const message = typeof w?.message === 'string'
        ? w.message
        : typeof w?.detail?.message === 'string'
          ? w.detail.message
          : typeof w?.detail?.reason === 'string'
            ? w.detail.reason
            : undefined;
      const nodeId = w?.detail?.node_id ?? w?.node_id ?? '';
      const dedupKey = `${w?.code}:${nodeId}`;
      if (w && typeof w.code === 'string' && typeof message === 'string' && !existingKeys.has(dedupKey)) {
        // Carry a finite elapsed_ms through when the ISL warning supplies one —
        // the budget-degradation family (STABILITY_BANDS_UNAVAILABLE /
        // E_VALUES_UNAVAILABLE / EVPI_UNAVAILABLE / PATH_DECOMPOSITION_UNAVAILABLE)
        // stamps how long the phase ran before degrading, so a slow degrade is
        // diagnosable on the wire, not only in the ISL log. Additive + numeric
        // only (no PII); the egress envelope's warning element is passthrough.
        const rawElapsed = w?.elapsed_ms ?? w?.detail?.elapsed_ms;
        const elapsedMs = typeof rawElapsed === 'number' && Number.isFinite(rawElapsed) ? rawElapsed : undefined;
        // F4: preserve `field` from the real ISL shape (top-level, or detail-nested).
        const rawField = w?.field ?? w?.detail?.field;
        const field = typeof rawField === 'string' && rawField !== '' ? rawField : undefined;
        inferenceWarnings.push({
          code: w.code,
          message,
          // NIT 2: map severity defensively. 'info' (and absent — the F4 benign
          // default) stays 'info'; 'warning' stays 'warning'; anything MORE severe
          // than 'warning' (e.g. 'error') or any unknown value escalates to
          // 'warning' — the most severe level PLoT's InferenceWarning supports —
          // and is NEVER collapsed DOWN to 'info' (which would HIDE it).
          severity: (w.severity == null || w.severity === 'info') ? 'info' : 'warning',
          ...(field !== undefined && { field }),
          ...(elapsedMs !== undefined && { elapsed_ms: elapsedMs }),
        });
        existingKeys.add(dedupKey);
      }
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
    // Lane PLoT-R3: warning_codes echo + DEFAULT-coded disclosures for the
    // brief's claim-safe surfaces (provisional_doctrine_v0 wording).
    inference_warnings: inferenceWarnings,
    response_hash: responseHash,
    // Track S: depth-aware brief lineage (config_version + lineage.n_samples).
    meta: { seed_used: meta.seedUsed, n_samples: meta.nSamples },
  });

  // Review cards: evidence priority card from factor sensitivity data.
  // Gated behind ENABLE_REVIEW_PASS. Excluded from response_hash.
  const assembledReviewCards: ProposalCardV1[] = [];
  if (FLAGS.ENABLE_REVIEW_PASS) {
    // A1b: exclude intervention-controlled levers from the evidence-priority card
    // (ranked by abs(elasticity)) — option-pinned levers are not tunable evidence gaps.
    const epFactors: FactorInput[] = filterInterventionOverrides(factorSensitivity ?? []).map((fs: any) => ({
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
      // Track S: record the sample depth facts were computed at (depth-aware lineage).
      n_samples: meta.nSamples,
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

  // Audit B3 (P0): extract `auto_noise_applied` from ISL's `_metadata`
  // (Pydantic alias) or `metadata` (field-name) sub-object. ISL emits the
  // wire shape `_metadata.auto_noise_applied` per RobustnessResponseV2's
  // `populate_by_name=True` + `by_alias=True` config. The helper returns
  // `{ applied: null, source: 'missing' }` so we can emit observability
  // when ISL omits the flag on a computed/partial response (audit-feedback
  // P1-2) instead of silently falling back to `false`.
  const autoNoiseExtraction =
    analysisStatus === 'computed' || analysisStatus === 'partial'
      ? extractIslAutoNoiseApplied(
          islResult as Parameters<typeof extractIslAutoNoiseApplied>[0],
        )
      : null;
  if (
    autoNoiseExtraction?.applied === null &&
    (analysisStatus === 'computed' || analysisStatus === 'partial')
  ) {
    // Contract drift: a healthy ISL always populates
    // `_metadata.auto_noise_applied` on computed/partial responses. The
    // helper centralises the event name + severity so log-search
    // predicates (Splunk / Grafana) and tests share one source of truth.
    // Provenance still emits with `applied: false` per the brief contract
    // that provenance is present whenever analysis ran.
    logAutoNoiseFlagMissingFromIsl(logger, {
      requestId,
      analysisStatus,
    });
  }

  // Snapshot the downstream call log ONCE — _meta.builds, _meta.payloads,
  // _meta.evidence and downstream_calls below all read it (review [7]: was
  // re-scanned + re-mapped per consumer, copying sanitized ISL bodies each time).
  const downstreamCallsForLog = getDownstreamCallsForLog(requestId);

  const response: RunResponseV3 = {
    request_schema_version: 'v3',
    endpoint_version: 'v2/run',
    preflight_version: PREFLIGHT_VERSION_VALUE,
    request_id: requestId,

    analysis_status: analysisStatus,
    status_reason: statusReason,

    option_comparison_status: optionComparisonStatus,
    robustness_status: robustnessStatus,
    drivers_status: driversStatus,

    // CIL C1: Multi-constraint analysis fields.
    // Lane 27 (ROADMAP 1.26a): gated by the SAME reliability partition as the
    // per-option suppression above — suppressed targets withhold the whole
    // top-level block ('unavailable'); doctrine-B modelledBasis targets and
    // fully-reliable runs deliver it byte-identically.
    ...buildConstraintFields(
      goalConstraints,
      islResult,
      constraintNormRanges,
      constraintTargetPartition.suppressed,
      logger,
    ),

    // Auto-noise disclosure (audit B3, P0). `auto_noise_applied` echoes
    // ISL's flag verbatim (or `null` when ISL's `_metadata` omits the
    // field — see `extractIslAutoNoiseApplied`); `auto_noise_provenance`
    // is the structured metadata carrying the formula, multiplier, and
    // calibration status. Both omitted on `analysis_status: 'failed'`
    // since no analysis ran; `'blocked'` paths use `buildBlockedResponse`
    // and never reach here. When ISL omits the flag the provenance still
    // emits (per brief contract) with `applied: false` and a warning is
    // logged above so contract drift is observable.
    ...(autoNoiseExtraction != null
      ? {
          auto_noise_applied: autoNoiseExtraction.applied,
          auto_noise_provenance: buildAutoNoiseProvenance(
            autoNoiseExtraction.applied === true,
          ),
        }
      : {}),

    isl_analysis_status: islAnalysisStatus,
    isl_status_reason: islStatusReason,

    critiques: addUserMessages(critiques, graph ?? { nodes: [] }, options),
    option_comparison: optionComparison,
    edge_sensitivity: edgeSensitivity,
    // Reference-option disclosure (additive, lane PLoT-W4; ISL build
    // 9a22a1a+): verbatim passthrough of the envelope's
    // sensitivity_reference_option_id. Omitted when the deployed ISL did not
    // disclose it — honest absence, never a PLoT-invented baseline.
    // Excluded from response_hash (hash canonicalises the request).
    ...(typeof islResult?.sensitivity_reference_option_id === 'string' &&
      islResult.sensitivity_reference_option_id.length > 0 && {
        sensitivity_reference_option_id: islResult.sensitivity_reference_option_id,
      }),
    // Structural pathway decomposition (additive, lane PLoT-W4; ISL build
    // 9a22a1a+): verbatim passthrough, inherently request-gated — ISL only
    // emits the section when include_path_decomposition was forwarded, which
    // PLoT does only on explicit /v2/run opt-in. Structural path effects are
    // dimensionless edge-coefficient products (no outcome-space
    // denormalisation applies). Excluded from response_hash.
    ...(islResult?.path_decomposition &&
      typeof islResult.path_decomposition === 'object' &&
      !Array.isArray(islResult.path_decomposition) && {
        path_decomposition: islResult.path_decomposition,
      }),
    // Edge E-values from ISL — enriched with labels. Always emitted ([] when empty
    // or ISL omitted the field) so consumers can distinguish computed-empty from
    // absent; PLoT always requests include_e_values: true. Excluded from response_hash.
    edge_e_values: edgeEValues ?? [],
    // Conditional winners from ISL — enriched with labels. Always emitted ([] when
    // empty or absent). Excluded from response_hash.
    conditional_winners: conditionalWinners ?? [],
    // Enrich factor_sensitivity with range_derivation_source from _meta (Task 7)
    factor_sensitivity: factorSensitivity && meta.rangeDerivationSources
      ? factorSensitivity.map(f => {
          const rds = meta.rangeDerivationSources![f.factor_id];
          return rds ? { ...f, range_derivation_source: rds } : f;
        })
      : factorSensitivity,
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

    // Confidence tier derived from M1 coaching readiness (B1), then reconciled
    // against the robustness assessment carried in this SAME response:
    // never emit 'strong' alongside robustness.is_robust === false or
    // level 'low'/'very_low' — cap at the provisional 'fair' tier.
    // (Producer-side honesty: confidence_tier is PLoT-assembled enrichment.)
    // NOTE: Deterministic. Excluded from response_hash (derived from coaching).
    ...(m1Coaching?.readiness && {
      confidence_tier: reconcileConfidenceTier(deriveConfidenceTier(m1Coaching.readiness), robustness),
    }),

    // Dominant factor detection (B1) — computed from factor_sensitivity
    // NOTE: Deterministic. Excluded from response_hash.
    ...(() => {
      const df = detectDominantFactor(factorSensitivity);
      return df ? { dominant_factor: df } : {};
    })(),

    // Flip thresholds (tipping points) for UI Results Panel.
    // Always emitted ([] when empty or absent) so consumers can distinguish
    // computed-empty from absent. Excluded from canonical hash.
    flip_thresholds: flipThresholds ?? [],

    // Display-honesty: high-level classification of the post-denormalised
    // flip_thresholds[] array. Always emitted alongside flip_thresholds so
    // UI consumers can render the all-no-effect / partial / unresolved
    // cases honestly without re-deriving from individual flip_reason strings.
    // Excluded from canonical hash (display-only enrichment).
    ...(() => {
      const result = classifyFlipThresholdsStatus(flipThresholds);
      return {
        flip_thresholds_status: result.status,
        ...(result.status_reason && { flip_thresholds_status_reason: result.status_reason }),
      };
    })(),

    // Additive margin-sensitivity classification + coverage counters.
    // Separate from flip_thresholds_status (PR #167). Diagnostic only;
    // excluded from response_hash by normaliseReport(). Surfaces lead-
    // margin movement (weakened / strengthened / flipped) without
    // changing PR #167's strict-flip semantics.
    ...(() => {
      const marginStatus = classifyFlipThresholdsMarginStatus(flipThresholds);
      const marginCoverage = computeFlipThresholdsMarginCoverage(flipThresholds);
      return {
        flip_thresholds_margin_status: marginStatus.status,
        flip_thresholds_margin_coverage: marginCoverage,
      };
    })(),

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
      // Base _meta: always include repairs_applied and source_path.
      // Normalise to uniform F.5 canonical shape before exposing to consumers.
      const baseMeta: CanonicalMeta = {
        source_path: meta.sourcePath,
        repairs_applied: normaliseRepairsForMeta(meta.repairs ?? []),
        request_id: requestId,
        plot_build: meta.build ?? 'unknown',
        hash_version: HASH_VERSION,
        response_hash: responseHash,
      };

      // Extended _meta fields only when feature flag enabled
      if (isCanonicalMetaEnabled()) {
        const allCalls = downstreamCallsForLog;
        const islCall = allCalls.find(c => c.service === 'isl');

        // Build versions for all services in the pipeline.
        // Wave1-L1: downstream bodies are sha8-redacted, but the structural
        // `build` key is allow-listed verbatim in pii-redact.ts — this read
        // still sees the real ISL build string.
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

      // Per-factor range derivation sources (diagnostic — shows which tier each factor used)
      if (meta.rangeDerivationSources && Object.keys(meta.rangeDerivationSources).length > 0) {
        baseMeta.range_derivation_sources = meta.rangeDerivationSources;
      }

      // Lane PLoT-R3 (roadmap 2.13): diligence-grade evidence capture — ALWAYS
      // present (deliberately NOT gated behind UI_CANONICAL_META, which stays
      // off in staging and left the UI debug bundle reporting plot/isl payloads
      // unavailable). Digests of the primary ISL exchange (sha256 + byte
      // length + key manifest — never full bodies) + deployed builds. The
      // primary exchange is the first robustness/analyze call; flip probes and
      // follow-ups remain visible in downstream_calls when captured.
      baseMeta.evidence = (() => {
        const calls = downstreamCallsForLog;
        const primaryIslCall =
          calls.find((c) => c.service === 'isl' && c.endpoint.includes('/robustness/analyze')) ??
          calls.find((c) => c.service === 'isl');
        return {
          plot_build: meta.build ?? 'unknown',
          // Passthrough of ISL's `build` response field; never invented.
          isl_build: typeof islResult?.build === 'string' ? islResult.build : null,
          isl_request_digest: primaryIslCall?.request_digest ?? null,
          isl_response_digest: primaryIslCall?.response_digest ?? null,
          // Lane 29 (spec §2.1): wire-generation assertion result. Pure
          // re-assessment of the same envelope the boundary warning used
          // (denormalisation only rewrites option outcomes — the markers and
          // nested locations are untouched). False also covers "ISL never
          // returned a usable envelope" — unverified is unverified.
          isl_wire_generation_ok: assessIslWireGeneration(islResult).ok,
        };
      })();

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

    // Downstream service calls (ISL, CEE) for debugging and tracing.
    // Wave1-L1 (Codex F8 + review 3): echoed bodies are shape-preserving sha8
    // digests — no raw factor labels / node ids / decision values leave the
    // service. Review 3 refuted the original form of this claim: digesting
    // only VALUES left the node-id KEYS of `options[].interventions` verbatim.
    // redactPayloadShape now digests data-derived KEYS too (see pii-redact.ts);
    // only contract-declared key names survive.
    downstream_calls: (() => {
      const allCalls = downstreamCallsForLog;
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
      // Track S: probe depth, surfaced only when a flip search ran and it differs
      // from base depth (decoupled control). Excluded from response_hash (meta).
      ...(meta.flipProbeNSamples !== undefined && meta.flipProbeNSamples !== meta.nSamples
        ? { flip_probe_n_samples: meta.flipProbeNSamples }
        : {}),
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

  // A3 lane 1 (enrichment producer guard): validate the fully-assembled
  // outgoing body against the typed PLoT→CEE enrichment envelope
  // (AnalysisEnrichmentSchema, vendored @talchain/schemas — byte-identical
  // to the copy CEE's shadow validator runs). At the OWNER layer, like the
  // content-hash attach below, so every run-body send site — main computed
  // path AND the ISL_NOT_ENABLED early return — inherits it. FAIL-OPEN:
  // never blocks or mutates delivery; a mismatch is DISCLOSED via
  // `_meta.evidence.enrichment_contract_ok: false` + one
  // ENRICHMENT_CONTRACT_MISMATCH inference warning + one
  // `enrichment_contract_mismatch` log event (zod issue paths only — never
  // payload values). Ordering: the warning is appended BEFORE the content
  // hash is computed, so the disclosure sits INSIDE the hashed content; the
  // evidence stamp lives in _meta, which the hash excludes by construction.
  // The appended warning `{code, message, severity}` conforms to the
  // envelope's inference_warnings element schema by construction, so the
  // disclosure can never itself create a contract violation.
  // A3 remediation item 8: sample the guard (1-in-N in production, every
  // request otherwise). A skipped request leaves enrichment_contract_ok ABSENT
  // (= unassessed — the same honest non-claim as the guard-error path below),
  // never a fabricated `true`. A deterministic envelope break still surfaces
  // within N, and CEE's shadow parse remains the independent backstop.
  try {
    if (shouldAssessEnrichmentContract()) {
      const enrichmentAssessment = assessEnrichmentContract(response);
      if (response._meta?.evidence) {
        response._meta.evidence.enrichment_contract_ok = enrichmentAssessment.ok;
      }
      if (!enrichmentAssessment.ok) {
        response.inference_warnings = [
          ...(response.inference_warnings ?? []),
          buildEnrichmentContractWarning(enrichmentAssessment),
        ];
        if (logger) logEnrichmentContractMismatch(logger, enrichmentAssessment, requestId);
      }
    }
  } catch (err) {
    // A guard bug is NOT a contract mismatch: stamp NOTHING (absence =
    // unassessed — never a false claim in either direction) and log the
    // error NAME only (error messages can embed payload values).
    logger?.warn({
      event: 'enrichment_contract_guard_error',
      request_id: requestId,
      error_name: err instanceof Error ? err.name : typeof err,
    });
  }

  // 2.13 gap A (review [10]: attach at the OWNER layer, not per send site):
  // buildResponse owns _meta, so every caller — main computed path AND the
  // ISL_NOT_ENABLED early return — carries the deterministic content hash.
  // Attached after assembly so it never hashes itself (_meta is excluded
  // from the hash by construction). response_hash (request-canonical
  // determinism token) is deliberately untouched.
  if (response._meta) {
    response._meta.response_content_hash = computeResponseContentHash(response);
  }

  return response;
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
    const structuralLeverIds = interventionTargetIdsFromOptions(options);
    islRobustness = {
      overall_robustness: r.label as 'robust' | 'moderate' | 'fragile',
      // validation_status / validation_confidence reads removed: the live V2
      // wire never emits them (verified 2026-07-06, build f3f5d92) so both
      // were structurally undefined here — the CEE request carried no such
      // keys. Omitting the reads is behaviour-identical on the /v2 path
      // (the legacy /v1 route is a declared behaviour change — see orchestrator.ts).
      // D-U union filter (review fixup, PR #219): option-controlled levers —
      // ISL-stamped OR structural-union members — never egress as sensitive
      // parameters, mirroring the M2 decision-review request filter. Filter
      // BEFORE the slice so a lever never consumes one of the 5 slots.
      // (Hygiene: this legacy path is dead while DECISION_REVIEW_ENABLE is on.)
      sensitive_parameters: islResult.factor_sensitivity
        ?.filter((f: any) => !isOptionControlledLever(f, structuralLeverIds))
        .slice(0, 5).map((f: any) => ({
        parameter: f.node_id,
        // Schema v2.6 canonical field is 'sensitivity_score'; the bare
        // 'sensitivity' key is V1-era and dead on the live V2 wire.
        sensitivity: f.sensitivity_score ?? f.sensitivity,
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
      // top_edge_drivers read removed: it consumed top-level `sensitivity`,
      // which the live V2 wire never emits (verified 2026-07-06) — the key was
      // structurally absent from every live CEE request. No substitute is
      // invented (edge-level sensitivity is an ISL contract followup).
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
            // Fragility gap 6: this was the ONE /v2/run error path emitting the
            // bare Fastify shape (no schema, no stable code). Normalised into
            // the error.v1 envelope every other lifecycle error uses.
            const preValidationRequestId =
              (req.headers['x-request-id'] as string | undefined)?.trim()
              || (body as { request_id?: string }).request_id
              || String(req.id);
            return reply.status(400).send(errorResponse(
              'BAD_INPUT',
              `Unknown field: ${unknown[0]}. /v2/run does not accept additional properties.`,
              `Remove '${unknown[0]}' or check spelling`,
              undefined,
              preValidationRequestId,
            ));
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
      // Track S PR-E: standard base-analysis depth (default 4000, env-overridable
      // to 1000 via STANDARD_N_SAMPLES). An explicit request n_samples always wins.
      // ROADMAP 1.54: this is the REQUESTED depth — the depth actually used
      // (`nSamples`) is finalised after preflight by applyComplexityBudget(),
      // which may reduce it (never below ADAPTIVE_N_SAMPLES_FLOOR) so the ISL
      // call fits ISL's complexity cap instead of drawing a raw 422.
      const requestedNSamples = body.n_samples ?? resolveStandardNSamples();
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
        // Phase 0: Categorical Integrity Detection (audit C1-A)
        //
        // Runs BEFORE normalisation and BEFORE any ISL call. Reads raw
        // body.options (still carrying value_type, raw_value, encoding_map
        // metadata that normalizeInterventions() strips). Either:
        //   (a) raises NOMINAL_INTERVENTION_NOT_SUPPORTED (or
        //       ONE_HOT_MUTEX_VIOLATION) and returns 422 — no normalisation,
        //       no preflight, no ISL; or
        //   (b) accumulates info CATEGORICAL_DECOMPOSED / warning
        //       STRIPPED_FIELD_WARNING critiques into preDetectionCritiques
        //       which merge into the success-path response at the
        //       critiques aggregation site (~line 3580).
        //
        // Gated by CATEGORICAL_INTEGRITY_ENFORCEMENT env flag. Fail-closed:
        // default-enabled when unset; explicit disable values (0/false/off/no/
        // disabled, case-insensitive) are the kill switch for ops emergencies.
        // =================================================================
        const preDetectionCritiques: CritiqueV3[] = [];
        if (isCategoricalEnforcementEnabled()) {
          const detection: CategoricalDetectionResult = detectCategoricalIssues(body.options ?? []);

          // Telemetry: structural log emitted ONLY when detection produced a
          // categorical signal (a blocker, warning, or info critique). Clean
          // numeric/binary requests produce no log — keeps rollout signal
          // high and avoids per-request noise on the dominant code path.
          //
          // Lets us verify post-deploy the fix is doing what we expect AND
          // detect over-blocking quickly. No PII: only counts and internal
          // enum values (trigger, violation_kind, inconsistency_kind). All
          // user-controlled identifiers (factor_id, option_id, group_id)
          // are intentionally OMITTED.
          //
          // Severity-bucket counts (blocker_count/warning_count/info_count)
          // are the primary ops query targets; the trigger/kind arrays
          // provide drill-down detail for the same record.
          const blockerCount =
            detection.blocked_factors.length +
            detection.one_hot_mutex_violations.length +
            detection.one_hot_grouping_inconsistencies.length;
          const warningCount = detection.stripped_meaningful_fields.length;
          const infoCount = detection.one_hot_validated_groups.length;
          if (blockerCount + warningCount + infoCount > 0) {
            req.log.info({
              event: 'categorical_integrity_detection',
              request_id: requestId,
              outcome: blockerCount > 0 ? 'blocked' : 'passed_with_signal',
              blocker_count: blockerCount,
              warning_count: warningCount,
              info_count: infoCount,
              blocked_factor_count: detection.blocked_factors.length,
              mutex_violation_count: detection.one_hot_mutex_violations.length,
              grouping_inconsistency_count: detection.one_hot_grouping_inconsistencies.length,
              validated_group_count: detection.one_hot_validated_groups.length,
              stripped_field_count: detection.stripped_meaningful_fields.length,
              triggers: detection.blocked_factors.map((b) => b.trigger),
              mutex_violation_kinds: detection.one_hot_mutex_violations.map((v) => v.kind),
              inconsistency_kinds: detection.one_hot_grouping_inconsistencies.map((i) => i.kind),
              stripped_fields: detection.stripped_meaningful_fields.map((s) => s.field),
              option_count: Array.isArray(body.options) ? body.options.length : 0,
            });
          }

          // Build critiques from detection result.
          //
          // Critique `message` fields are kept generic: structural counts and
          // internal trigger/kind enums only. User-controlled identifiers
          // (factor_id, option_id, group_id) are carried in
          // `affected_node_ids`/`affected_option_ids` (structured) and never
          // interpolated into the message text — telemetry, debug-bundle
          // exports, and downstream consumers all read the message field.
          const detectionBlockers: CritiqueV3[] = [];
          for (const blocked of detection.blocked_factors) {
            detectionBlockers.push({
              id: randomUUID(),
              code: 'NOMINAL_INTERVENTION_NOT_SUPPORTED',
              severity: 'blocker',
              message: `Nominal categorical detected (trigger=${blocked.trigger}; distinct_values=${blocked.distinct_value_count}; options=${blocked.options_referencing_factor.length}).`,
              source: 'validation',
              affected_node_ids: [blocked.factor_id],
              affected_option_ids: [...blocked.options_referencing_factor],
              blocks_analysis: true,
            });
          }
          for (const violation of detection.one_hot_mutex_violations) {
            detectionBlockers.push({
              id: randomUUID(),
              code: 'ONE_HOT_MUTEX_VIOLATION',
              severity: 'blocker',
              message: `One-hot mutex violation (kind=${violation.kind}).`,
              source: 'validation',
              affected_option_ids: [violation.option_id],
              blocks_analysis: true,
            });
          }
          for (const inconsistency of detection.one_hot_grouping_inconsistencies) {
            detectionBlockers.push({
              id: randomUUID(),
              code: 'ONE_HOT_GROUPING_INCONSISTENT',
              severity: 'blocker',
              message: `One-hot grouping is inconsistent across options (kind=${inconsistency.kind}).`,
              source: 'validation',
              affected_node_ids: [inconsistency.factor_id],
              affected_option_ids: [...inconsistency.options_referencing_factor],
              blocks_analysis: true,
            });
          }
          if (detectionBlockers.length > 0) {
            // Extract id+label pairs from raw options for label resolution.
            // Untyped pass — narrow inline. Empty array is fine; humaniser
            // falls back to humaniseId(option_id).
            const optionLabels: Array<{ id: string; label: string }> = [];
            if (Array.isArray(body.options)) {
              for (const o of body.options) {
                if (typeof o === 'object' && o !== null) {
                  const opt = o as { id?: unknown; label?: unknown };
                  if (typeof opt.id === 'string') {
                    optionLabels.push({
                      id: opt.id,
                      label: typeof opt.label === 'string' ? opt.label : opt.id,
                    });
                  }
                }
              }
            }
            return reply.status(422).send(buildBlockedResponse(
              'Categorical integrity check failed',
              detectionBlockers,
              body.graph,
              optionLabels,
              requestId,
              requestComputedAt,
            ));
          }
          // Non-blocker critiques accumulate for the success-path response.
          // Messages are generic; structural data lives in affected_*_ids.
          for (const group of detection.one_hot_validated_groups) {
            preDetectionCritiques.push({
              id: randomUUID(),
              code: 'CATEGORICAL_DECOMPOSED',
              severity: 'info',
              message: `One-hot categorical group validated (indicators=${group.factor_ids.length}).`,
              source: 'validation',
              affected_node_ids: [...group.factor_ids],
              blocks_analysis: false,
            });
          }
          // STRIPPED_FIELD_WARNING — dedupe per (factor_id, field) so a multi-
          // option request emits at most one warning per (factor, field) pair.
          // Bounded linear-time per the brief's perf rule.
          const seenStripped = new Set<string>();
          for (const stripped of detection.stripped_meaningful_fields) {
            const key = `${stripped.factor_id}::${stripped.field}`;
            if (seenStripped.has(key)) continue;
            seenStripped.add(key);
            preDetectionCritiques.push({
              id: randomUUID(),
              code: 'STRIPPED_FIELD_WARNING',
              severity: 'warning',
              // Generic message — internal field names (`raw_value`,
              // `value_type`, `encoding_map`) must not appear in `message`
              // per the brief's no-raw-user-input rule. The specific
              // stripped field is on the structured telemetry record at
              // line ~2613 (`stripped_fields` array) for operator query.
              message: 'Meaningful intervention metadata was stripped during normalisation on a passed-through factor.',
              source: 'validation',
              affected_node_ids: [stripped.factor_id],
              blocks_analysis: false,
            });
          }
        }

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

        req.log.info(
          {
            event: 'constraint-trace.received',
            goal_constraints_count: body.goal_constraints?.length ?? 0,
            goal_threshold_present: body.goal_threshold !== undefined,
            constraint_ids: body.goal_constraints?.map((c) => c.constraint_id) ?? [],
          },
          'Constraint trace: request received',
        );

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
        let autoSynthesisFired = false;
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
            autoSynthesisFired = true;
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

        const clientConstraintCount = body.goal_constraints?.length ?? 0;
        const compiledSource = autoSynthesisFired
          ? 'auto_synthesis'
          : clientConstraintCount > 0
            ? 'client'
            : constraintCompilation.constraints.length > 0
              ? 'graph_node'
              : 'none';
        req.log.info(
          {
            event: 'constraint-trace.compiled',
            source: compiledSource,
            compiled_count: constraintCompilation.constraints.length,
            client_supplied_count: clientConstraintCount,
            constraint_ids: constraintCompilation.constraints.map((c) => c.constraint_id),
            auto_synthesis_fired: autoSynthesisFired,
          },
          'Constraint trace: compilation complete',
        );

        // =================================================================
        // P0-C1: capture producer-declared constraint scales BEFORE they
        // disappear from the pipeline.
        // =================================================================
        // - CEE stamps goal_threshold (already normalised) + goal_threshold_cap
        //   on the RAW upstream node; the canonical EngineNodeV3 drops them.
        // - The temporal filter strips the constraint's `unit` at the ISL
        //   boundary.
        // Both signals feed the out-of-domain gate below and the Phase 4b
        // constraint normaliser — without them a raw "20 (%)" target falls to
        // the default [0,1] range and is clamped to 1.0 (the live 2026-07-07
        // silent-nullification defect).
        const goalThresholdMetaByNodeId = collectGoalThresholdNodeMeta(body.graph?.nodes);
        const constraintUnitsByConstraintId = new Map<string, string>();
        for (const c of constraintCompilation.constraints as RawGoalConstraint[]) {
          if (typeof c.unit === 'string' && c.unit.length > 0) {
            constraintUnitsByConstraintId.set(c.constraint_id, c.unit);
          }
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
          req.log,
          goalThresholdMetaByNodeId
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
        // Phase 2a+: Compute-admission — adaptive n_samples (Codex F8 handshake)
        // =================================================================
        // ISL rejects any robustness request whose WEIGHTED compute cost exceeds
        // its live admission ceiling. Fit the depth to that ceiling BEFORE
        // calling ISL, using the causal counts ISL will receive: filteredGraph
        // nodes (options/decision already filtered) and its directed edges (the
        // translator drops bidirected edges — see toISLRobustnessRequest).
        // Exact-duplicate edges may still be coalesced later, which only SHRINKS
        // the edge count — so this bound is conservative, never permissive.
        //
        // DERIVE-DON'T-MIRROR: PLoT reads ISL's live ceiling + weights from
        // /health (cached; getIslComputeAdmission) instead of hand-copying a
        // scalar number, and prices the request with the ADVERTISED weights via
        // the version-keyed estimator. If the handshake is unavailable or the
        // formula version is unknown, planSampleDepth FAILS LOUD onto the
        // conservative legacy scalar bound (base depth capped) and the resolver
        // has already emitted the isl_admission_version_skew warning + metric.
        //
        // Every later consumer of the depth — the base response hash, the ISL
        // request, flip-probe depth resolution, meta.n_samples, and brief/fact
        // lineage — sees the SAME post-plan value, so anything that reports
        // n_samples reports the depth genuinely used.
        const causalNodeCount = filteredGraph.nodes.length;
        const causalDirectedEdgeCount = filteredGraph.edges.filter(
          (e) => e.edge_type !== 'bidirected',
        ).length;
        const causalOptionCount = normalizedOptions.length;
        const uniqueParamUncertainties = new Set(
          (buildParameterUncertaintiesV3(filteredGraph.nodes) ?? []).map((pu) => pu.node_id),
        ).size;

        const admissionResolution = getIslComputeAdmission();
        const depthPlanInput: DepthPlanInput = {
          nSamples: requestedNSamples,
          nSamplesExplicit: body.n_samples !== undefined,
          nodeCount: causalNodeCount,
          edgeCount: causalDirectedEdgeCount,
          optionCount: causalOptionCount,
          uniqueParamUncertainties,
          // The base /v2/run request always sends these phases (see
          // toISLRobustnessRequest); path decomposition is a request-gated opt-in.
          includeVoi: true,
          includeSensitivity: true,
          includeEValues: true,
          includePathDecomposition: body.include_path_decomposition === true,
        };
        // conservative (fail-loud: cap the depth-raise + tighten the scalar
        // bound) ONLY on a genuine skew — ISL configured but its capability is
        // unreadable / an unknown formula version. A benign no-gate state (ISL
        // not configured, or the cold warm-up before the first /health read) is
        // NOT skew and keeps the standard depth + historical scalar budget.
        const complexityDecision = planSampleDepth(depthPlanInput, admissionResolution.admission, {
          conservative: admissionResolution.skew,
        });

        if (complexityDecision.kind === 'refused') {
          // Honest structured refusal — never forward a request ISL is
          // guaranteed to reject, and never pass that raw rejection through.
          req.log.warn({
            event: 'graph_too_complex_refused',
            request_id: requestId,
            node_count: causalNodeCount,
            edge_count: causalDirectedEdgeCount,
            option_count: causalOptionCount,
            plan_mode: complexityDecision.mode,
            cost_at_floor: complexityDecision.costAtFloor,
            admission_ceiling: complexityDecision.ceiling,
            requested_n_samples: complexityDecision.originalNSamples,
            n_samples_floor: ADAPTIVE_N_SAMPLES_FLOOR,
            admission_status: admissionResolution.status,
          });
          return reply.status(422).send(buildBlockedResponse(
            'Graph too complex to analyse',
            [{
              id: randomUUID(),
              code: 'GRAPH_TOO_COMPLEX',
              severity: 'blocker' as const,
              message: `This graph is too complex to analyse: ${causalNodeCount} causal nodes and ${causalDirectedEdgeCount} causal edges across ${causalOptionCount} option(s) exceed the analysis engine's compute-admission budget even at its minimum reliable sample depth (${ADAPTIVE_N_SAMPLES_FLOOR} samples). Reduce the number of nodes, edges, or options — e.g. remove weaker or duplicate influences — and re-run.`,
              source: 'validation' as const,
              blocks_analysis: true,
            }],
            filteredGraph,
            normalizedOptions,
            requestId,
            requestComputedAt,
          ));
        }

        // Depth actually used everywhere below. When reduced, originalNSamples
        // travels via meta so the response carries a SAMPLES_REDUCED_FOR_COMPLEXITY
        // warning naming both depths (explicit caller depths are never silently
        // overridden).
        const nSamples = complexityDecision.nSamples;
        const originalNSamples =
          complexityDecision.kind === 'reduced' ? complexityDecision.originalNSamples : undefined;

        if (complexityDecision.kind === 'reduced') {
          req.log.info({
            event: 'n_samples_reduced_for_complexity',
            request_id: requestId,
            node_count: causalNodeCount,
            edge_count: causalDirectedEdgeCount,
            option_count: causalOptionCount,
            plan_mode: complexityDecision.mode,
            original_n_samples: complexityDecision.originalNSamples,
            reduced_n_samples: complexityDecision.nSamples,
            original_cost: complexityDecision.cost,
            reduced_cost: complexityDecision.reducedCost,
            admission_ceiling: complexityDecision.ceiling,
            admission_status: admissionResolution.status,
            n_samples_explicit: body.n_samples !== undefined,
          });
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
        let responseHash = hashRequest(body, filteredGraph, plotSeedUsed, toIdentifiabilityResponse(identifiabilityResult), undefined, nSamples);

        // =================================================================
        // Phase 4: ISL Call
        // =================================================================
        const islStart = performance.now();

        const islService = getISLService();

        if (!islService.isEnabled()) {
          const totalMs = performance.now() - startTime;

          // Include preflight warnings (e.g., scale mismatch) and any Phase 0
          // categorical-detection critiques alongside ISL_NOT_ENABLED.
          const islNotEnabledCritiques: CritiqueV3[] = [
            ...preDetectionCritiques,
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
              originalNSamples,
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
            undefined, // constraintNormRanges (no ISL call on this path)
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
        let constraintNormalisationRanges: Map<string, NormalisationRange> | undefined;

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

        // Mixed range derivation tier warning:
        // If factors used different derivation tiers, surface this so users
        // and the coaching layer know the normalisation quality is uneven.
        if (normalisationContext && normalisationContext.factors.size > 0) {
          const distinctSources = new Set<string>();
          const affectedFactorIds: string[] = [];
          for (const [factorId, ctx] of normalisationContext.factors) {
            distinctSources.add(ctx.range.source);
            affectedFactorIds.push(factorId);
          }
          if (distinctSources.size >= 2) {
            preflight.warnings.push({
              id: randomUUID(),
              code: 'MIXED_RANGE_DERIVATION',
              severity: 'info',
              message: `Factors use ${distinctSources.size} different range derivation tiers. Normalisation quality may vary.`,
              source: 'validation',
              affected_node_ids: affectedFactorIds.sort(),
              blocks_analysis: false,
            });
          }
        }

        // =================================================================
        // Phase 4b: Constraint Normalisation
        // =================================================================
        // ISL operates in normalised [0,1] space (Phase 4a normalises interventions).
        // Constraint values must also be normalised so ISL compares normalised
        // samples against normalised thresholds.
        let constraintsForISL: GoalConstraint[] | undefined;

        if (activeGoalConstraints && activeGoalConstraints.length > 0) {
          if (constraintsNeedNormalisation(activeGoalConstraints)) {
            const constraintNormResult = normaliseGoalConstraints(
              activeGoalConstraints,
              filteredGraph.nodes,
              // P0-C1: producer-declared scales (constraint '%' unit, node
              // goal_threshold_cap / goal_threshold) captured before the
              // temporal filter stripped them — see Phase 1c++ above.
              {
                unitsByConstraintId: constraintUnitsByConstraintId,
                goalThresholdMetaByNodeId,
              }
            );
            constraintsForISL = constraintNormResult.constraints;

            // Store ranges for denormalisation of failure_margin_median in response
            constraintNormalisationRanges = new Map(
              constraintNormResult.diagnostics.map(d => [d.constraint_id, d.range])
            );

            // Add constraint normalisation repairs to repairs_applied[]
            repairs = repairs.concat(constraintNormResult.repairs);

            req.log.info({
              event: 'constraint_normalisation',
              normalised: true,
              diagnostics_count: constraintNormResult.diagnostics.length,
              repairs_count: constraintNormResult.repairs.length,
              sample: constraintNormResult.diagnostics.slice(0, 3).map(d => ({
                constraint_id: d.constraint_id,
                node_id: d.node_id,
                original: d.original_value,
                normalised: d.normalised_value,
                range_source: d.range.source,
              })),
            });
          } else {
            constraintsForISL = activeGoalConstraints;
            req.log.debug({
              event: 'constraint_normalisation',
              normalised: false,
              reason: 'All constraint values already in [0,1] range',
              constraint_count: activeGoalConstraints.length,
            });
          }
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

        // Range discipline: warn when inbound |strength.mean| sum > 1.0
        // Runs on normalized graph so edge strengths are in canonical form.
        preflight.warnings.push(...validateInboundStrengthSum(filteredGraph));

        // =================================================================
        // Duplicate-edge preflight (ISL now 422s duplicate (from,to,type) edges)
        // =================================================================
        // EXACT identical duplicates are coalesced (logged via repairs_applied);
        // NON-identical duplicates (differing weight/belief/label) are a typed
        // actionable blocker — PLoT must not silently pick one of the user's
        // contradictory claims.
        {
          const dupResult = preflightDuplicateEdges(filteredGraph.edges);
          if (dupResult.conflicts.length > 0) {
            req.log.warn({
              event: 'duplicate_edge_conflict',
              request_id: requestId,
              conflicts: dupResult.conflicts,
            });
            return reply.status(422).send(buildBlockedResponse(
              'Conflicting duplicate edges',
              dupResult.conflicts.map((c) => ({
                id: randomUUID(),
                code: 'DUPLICATE_EDGE_CONFLICT',
                severity: 'blocker' as const,
                message: `Edges ${c.from} -> ${c.to} (${c.edge_type}) appear ${c.count} times with different values (${c.divergent_fields.join(', ')}). Keep one edge per relationship, or merge the beliefs into a single edge.`,
                source: 'validation' as const,
                affected_node_ids: [c.from, c.to],
                blocks_analysis: true,
              })),
              filteredGraph,
              normalizedOptions,
              requestId,
              requestComputedAt,
            ));
          }
          if (dupResult.coalesced.length > 0) {
            filteredGraph.edges = dupResult.edges as typeof filteredGraph.edges;
            for (const c of dupResult.coalesced) {
              repairs.push({
                field: `edges[${c.from}->${c.to}]`,
                action: 'removed',
                from_value: c.count,
                to_value: 1,
                reason: `COALESCE_DUPLICATE_EDGE: ${c.count} exact-identical ${c.edge_type} edges ${c.from} -> ${c.to} coalesced to one before ISL call (ISL rejects duplicate (from,to,type) edges)`,
              });
            }
            req.log.info({
              event: 'duplicate_edges_coalesced',
              request_id: requestId,
              groups: dupResult.coalesced,
            });
          }
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
          constraintsForISL,       // Normalised constraint values (undefined if not using multi-constraint)
          plotSeedUsed,  // Always forward PLoT's seed (PLoT is seed authority)
          body.include_path_decomposition === true  // Lane PLoT-W4: request-gated opt-in, forwarded only on explicit true
        );

        req.log.info(
          {
            event: 'constraint-trace.isl-forward',
            constraint_count: islRequest.goal_constraints?.length ?? 0,
            has_value_field: islRequest.goal_constraints?.every(
              (c) => 'value' in c,
            ) ?? true,
            constraint_ids: islRequest.goal_constraints?.map((c) => c.constraint_id) ?? [],
          },
          'Constraint trace: forwarded to ISL',
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
        // This helps diagnose why ISL may return empty factor_sensitivity.
        // Decision-input minimiser (F1): node_id is a decision-domain identifier
        // and mean/std are raw factor values — HASH the id and DROP the raw
        // values. Counts + a std>0 signal preserve the diagnostic value (empty
        // factor_sensitivity correlates with degenerate/zero-std PU) without
        // leaking decision inputs into INFO logs.
        const paramUncertainties = islRequest.parameter_uncertainties ?? [];
        req.log.info({
          event: 'isl_request_parameter_uncertainties',
          count: paramUncertainties.length,
          sample: paramUncertainties.slice(0, 3).map((p) => ({
            node_id_hash: createHash('sha256').update(String(p.node_id)).digest('hex').slice(0, 12),
            has_std: typeof p.std === 'number' && Number.isFinite(p.std) && p.std > 0,
          })),
          factor_nodes_in_graph: filteredGraph.nodes.filter((n) => n.kind === 'factor').length,
          factors_with_observed_value: filteredGraph.nodes.filter(
            (n) => n.kind === 'factor' && n.observed_state?.value !== undefined && Number.isFinite(n.observed_state.value)
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
        // Full error object from callAnalysisEndpoint's no-throw contract —
        // carries the discriminating code (+ status/critiques for HTTP-level
        // rejections). Fragility gaps 2/3: previously only `retryable` was
        // kept and the code was discarded.
        let islCallError: { code: string; message: string; retryable: boolean; status?: number; critiques?: ISLCritique[] } | undefined;
        let islFallbackExecuted = false;
        let computedAt: string | undefined;
        let islEchoedRequestId: string | null = null;
        // Retryability from ISL response (service-computed, status-aware)
        let islResponseRetryable: boolean | undefined;

        try {
          // A3 remediation item 4: clamp the base ISL robustness call to the
          // REMAINING request budget so its retries cannot outlive the caller.
          // Unclamped this call is ISL_TIMEOUT_MS per attempt × ISL_MAX_RETRIES
          // (default 60s × 3 ≈ 180s worst case) — past the UI's 120s client
          // timeout, which loses the WHOLE analysis. Mirror of the flip block's
          // remaining-budget clamp (below): allow ONE generous attempt up to the
          // remaining budget, then cap the retry COUNT to what still fits — so a
          // slow-but-successful call is NOT truncated (per-attempt stays near
          // ISL_TIMEOUT_MS), yet the total is bounded by the budget. The base
          // call runs early, so remaining ≈ REQUEST_BUDGET_MS (70s) → one 60s
          // attempt; the clamp only bites the pathological retry storm.
          const baseCallRemainingMs = resolveRequestBudgetMs() - (performance.now() - startTime);
          const baseCallSafetyMarginMs = 1_000;
          const BASE_CALL_MIN_TIMEOUT_MS = 1_000;
          const baseCallTimeoutMs = Math.min(
            ISL_TIMEOUT_MS,
            Math.max(BASE_CALL_MIN_TIMEOUT_MS, Math.floor(baseCallRemainingMs - baseCallSafetyMarginMs)),
          );
          const configuredMaxRetries = Math.max(1, getISLClientConfig().maxRetries);
          // Largest attempt count whose HONEST worst case (attempts × per-attempt
          // + the 1s+2s… backoff the client sleeps between them) still fits the
          // remaining budget — never < 1, never > the configured cap. The prior
          // `floor(remaining / timeout)` counted bare timeout slices and omitted
          // the backoff; worstCaseMs is the single source now shared with the
          // telemetry below, the startup budget warn, and their tests. At the 70s
          // default this still resolves to 1 attempt (no behaviour change) — it
          // only stops the accounting from lying.
          let baseCallMaxRetries = 1;
          while (
            baseCallMaxRetries < configuredMaxRetries &&
            worstCaseMs(baseCallMaxRetries + 1, baseCallTimeoutMs) <= baseCallRemainingMs
          ) {
            baseCallMaxRetries++;
          }
          if (baseCallTimeoutMs < ISL_TIMEOUT_MS || baseCallMaxRetries < configuredMaxRetries) {
            req.log.info({
              event: 'base_isl_call_budget_clamped',
              request_id: requestId,
              isl_timeout_ms: ISL_TIMEOUT_MS,
              clamped_timeout_ms: baseCallTimeoutMs,
              configured_max_retries: configuredMaxRetries,
              clamped_max_retries: baseCallMaxRetries,
              remaining_budget_ms: Math.round(baseCallRemainingMs),
              worst_case_total_ms: worstCaseMs(baseCallMaxRetries, baseCallTimeoutMs),
            });
          }
          const response = await islService.callAnalysisEndpoint<any>(
            '/api/v1/robustness/analyze/v2',
            islRequest,
            requestId,
            baseCallTimeoutMs,
            baseCallMaxRetries
          );

          if (response.data) {
            islResult = response.data;
            islSuccess = true;
            islStatusCode = 200;
            islEchoedRequestId = response.isl_echoed_request_id ?? null;
            // Capture timestamp when ISL response received (before any PLoT processing).
            // The V2 wire carries this as top-level `timestamp` (the V1-era
            // `computed_at` is never emitted on V2 — verified live 2026-07-06,
            // build f3f5d92); fall back to PLoT's own clock when absent.
            computedAt = getIslComputedAt(islResult) ?? new Date().toISOString();

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

            // === Wire-generation assertion (lane 29, spec §2.1) ===
            // PLoT pins response_version=2 on the REQUEST; this verifies the
            // RESPONSE actually is the generation the readers assume
            // (version markers declared + nested wire locations present).
            // ONE structured warning on mismatch/absence; NEVER a hard fail
            // — absence of enrichment is degraded-but-usable, and the
            // honest per-feature degradation (EDGE_*_UNAVAILABLE_V2_WIRE
            // markers) happens where the response is assembled. Surfaced to
            // consumers as _meta.evidence.isl_wire_generation_ok.
            logIslWireGenerationUnverified(
              req.log,
              assessIslWireGeneration(islResult),
              requestId,
            );

            // === INTERNAL (flag-gated, default OFF): V2 factor_evpi arrival proof ===
            // The V2 wire carries per-factor counterfactual EVPI at top-level
            // `factor_evpi` (verified live 2026-07-06). Decision P-5 (pending):
            // it MUST NOT feed any user-facing VOI/EVPI surface yet. Behind the
            // flag we log a sanitised summary ONLY — negative/below-resolution
            // raw values are never logged as emittable numbers (see
            // mapIslFactorEvpi hygiene). The public response is byte-identical
            // whether this flag is on or off.
            if (FLAGS.ISL_FACTOR_EVPI_INTERNAL) {
              const factorEvpiMapping = mapIslFactorEvpi(islResult);
              req.log.info({
                event: 'isl_factor_evpi_internal',
                request_id: requestId,
                count: factorEvpiMapping.entries.length,
                dropped_invalid: factorEvpiMapping.dropped_invalid,
                below_resolution_count: factorEvpiMapping.entries.filter((e) => e.below_resolution).length,
                entries: factorEvpiMapping.entries.map((e) => ({
                  factor_id: e.factor_id,
                  emit_pp: e.emit_pp ?? null,
                  below_resolution: e.below_resolution,
                  raw_evpi_percentage_points: e.raw_evpi_percentage_points,
                  metric_type: e.metric_type,
                  n_evpi_samples: e.n_evpi_samples,
                })),
              });
            }
          } else {
            islStatusCode = response.error?.status ?? 500;
            islFallbackExecuted = true;
            islEchoedRequestId = response.isl_echoed_request_id ?? null;
            islResponseRetryable = response.error?.retryable;
            islCallError = response.error;
            req.log.error({
              event: 'isl_call_failed',
              error: response.error?.message ?? 'Unknown error',
              error_code: response.error?.code,
            });
          }
        } catch (err) {
          // Defensive only: the real callAnalysisEndpoint has a no-throw
          // contract (it catches ISLHttpError/timeouts/network internally and
          // RETURNS the error object — handled via islCallError below).
          // Review [9] removed the dead ISLHttpError 422 belt that duplicated
          // the live islCallError branch, but a thrown ISLHttpError (swapped
          // service implementation, test double) keeps its status semantics —
          // retryableFromIslStatus(401/404) = false is pinned by
          // v2-run-error-shapes.test.ts.
          islFallbackExecuted = true;
          islStatusCode = err instanceof ISLHttpError ? err.status : 500;

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

        // Build response.
        // Phase 0 pre-detection critiques (audit C1-A) merge first so they
        // appear before preflight warnings in the response — they describe
        // request-shape issues that preceded all other validation.
        const critiques: CritiqueV3[] = [...preDetectionCritiques, ...preflight.warnings];

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

        // Fragility gap 3: ISL 422 with structured critiques. callAnalysisEndpoint
        // catches ISLHttpError and RETURNS the error object (no-throw contract),
        // so ISL's structured 422 critiques arrive here. ISL blockers go FIRST
        // (review [0]: CEE plot-client renders critiques[0].message — an info
        // NORMALIZATION_WARNING must not displace the blocking ISL critique).
        if (islCallError?.status === 422 && islCallError.critiques && islCallError.critiques.length > 0) {
          const islCritiques = mapISLCritiquesToV2(islCallError.critiques);

          return reply.status(422).send(buildBlockedResponse(
            islCallError.message || 'ISL validation failed',
            [...islCritiques, ...critiques],
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
          // Fragility gap 2: carry the discriminating failure class (timeout /
          // unreachable / HTTP error / rejected) alongside the legacy
          // ISL_CALL_FAILED critique, which stays for existing consumers.
          const islFailure = buildIslFailureDetail(islCallError);
          return reply.send(buildV2RunError({
            analysisStatus: 'failed',
            statusReason: islFailure.statusReason,
            retryable: islRetryable,
            requestId,
            computedAt: computedAt ?? requestComputedAt,
            // addUserMessages on the whole array matches the blocked-path
            // behaviour (buildBlockedResponse) — the spec requires
            // user_message on every critique; the failed path never set it.
            critiques: addUserMessages(
              [
                ...critiques,
                ...(islFailure.critique ? [islFailure.critique] : []),
                {
                  id: randomUUID(),
                  code: 'ISL_CALL_FAILED',
                  severity: 'error' as const,
                  message: 'ISL analysis failed. Please try again.',
                  source: 'isl' as const,
                  blocks_analysis: false,
                },
              ],
              filteredGraph,
              normalizedOptions,
            ),
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
        // Build label maps for enrichment (reused by edge sensitivity, E-values, conditional winners)
        const earlyNodeLabelMap = new Map<string, string>();
        if (filteredGraph?.nodes) {
          for (const node of filteredGraph.nodes) {
            earlyNodeLabelMap.set(node.id, node.label);
          }
        }
        const earlyOptionLabelMap = new Map<string, string>();
        if (body.options) {
          for (const opt of body.options) {
            const cleaned = cleanLabelAnnotation(opt.label);
            earlyOptionLabelMap.set(opt.id, cleaned || opt.id);
          }
        }

        // Transform sensitivity arrays FIRST - these are the final arrays that will be returned
        // Status check must use the SAME arrays to prevent status/response misalignment
        //
        // V2 wire truth (lane PLoT-W4, 2026-07-07 — see
        // src/integrations/isl/v2-envelope.ts): the pinned response_version=2
        // envelope NEVER emits top-level `sensitivity`, but as of ISL build
        // 9a22a1a (lane 11 / ISL PR #65, verified against the live capture
        // tests/fixtures/isl-v2-live-20260707) edge-level sensitivity is
        // NESTED at `robustness.edge_sensitivity` — read via the accessor.
        // On older deployed ISL builds the nested field is absent too:
        // edge_sensitivity is then "computed, empty" and explicitly marked
        // via the EDGE_SENSITIVITY_UNAVAILABLE_V2_WIRE inference warning
        // (suppressed automatically when the wire carries data — the warning
        // only fires on an empty final array).
        const edgeSensitivity = transformEdgeSensitivity(getIslEdgeSensitivity(islResult), earlyNodeLabelMap, normalisationContext);

        // Transform ISL edge_e_values with label enrichment. NESTED at
        // robustness.edge_e_values on the V2 wire (the former top-level read
        // was structurally dead — every live response came back "empty").
        const islEdgeEValuesRaw = getIslEdgeEValues(islResult);
        // F14 + NIT 1: classify drops by cause (input-null vs overflow) and thread
        // to buildResponse's meta so the wire disclosure attributes them accurately.
        let edgeEValuesDropped: EdgeEValueDropSink | undefined;
        const edgeEValueDropSink: EdgeEValueDropSink = { inputNull: 0, overflow: 0 };
        const edgeEValues = transformEdgeEValues(islEdgeEValuesRaw, earlyNodeLabelMap, normalisationContext, edgeEValueDropSink);

        // Transform ISL conditional_winners (when present) with label enrichment
        const conditionalWinners = transformConditionalWinners(
          islResult.conditional_winners,
          earlyNodeLabelMap,
          earlyOptionLabelMap,
          normalisationContext,
        );

        // Observability (Codex round-3 #4): the transforms above DROP entries with
        // non-finite / out-of-range numerics. These surfaces have no per-feature status
        // to degrade, so emit a warning when entries are silently removed rather than
        // hiding the upstream defect. (Counts only — no payload.)
        const eValuesDropped = edgeEValueDropSink.inputNull + edgeEValueDropSink.overflow;
        if (eValuesDropped > 0) {
          edgeEValuesDropped = edgeEValueDropSink; // F14 + NIT 1: cause-attributed wire disclosure via meta.
          req.log.warn({ event: 'edge_e_values_dropped_nonfinite', request_id: requestId, dropped: eValuesDropped, input_null: edgeEValueDropSink.inputNull, overflow: edgeEValueDropSink.overflow, kept: edgeEValues.length });
        }
        const condWinnersDropped = (islResult.conditional_winners?.length ?? 0) - conditionalWinners.length;
        if (condWinnersDropped > 0) {
          req.log.warn({ event: 'conditional_winners_dropped_invalid', request_id: requestId, dropped: condWinnersDropped, kept: conditionalWinners.length });
        }

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
        const islFactorSensitivity = transformFactorSensitivity(islResult.factor_sensitivity, normalisationContext);

        // Transform ISL entries WITHOUT filtering intervention_overrides, so that
        // attribution_stability data from controllable factors is available for the
        // confidence merge even though those factors are excluded from sensitivity output.
        // (Confidence honesty A1-SECONDARY: under formula_version plot_unified_v2, the
        // band table distinguishes low and negligible — the previous "low/negligible
        // collapse to 0.25" behaviour is fixed at the band table itself.)
        const islFactorSensitivityUnfiltered = transformFactorSensitivityUnfiltered(islResult.factor_sensitivity, normalisationContext);

        // D-U structural lever union (ROADMAP 2.20/2.40, adopted 13 Jul): every
        // factor id any option's `interventions` targets is a LEVER, whether or
        // not ISL stamped it (ISL stamps only elasticity≈0 first-option pins).
        // Same derivation + same input (body.options) as the coaching layer's
        // normaliseCoachingInputs — ONE union definition, shared via
        // src/lib/intervention-override.ts. Threaded into the merge below and
        // the EVPI enrichment guards so a union lever never publishes
        // sensitivity/elasticity/VOI/EVPI (live fac_salary_cost case: sens
        // −0.19 + top EVPI 7.8pp published while coaching suppressed it).
        const structuralLeverIds = interventionTargetIdsFromOptions(body.options);

        // Graph-based is primary for influence/sensitivity scores.
        // When graph results exist, merge ISL attribution_stability into graph entries
        // and recompute unified confidence (0.5 × band_score + 0.5 × mean(incoming edges)).
        // Use UNFILTERED ISL entries so confidence data from intervention_override factors
        // is available for the merge (they have valid attribution_stability from ISL bootstrap).
        let factorSensitivity: FactorSensitivityResultV3[] | undefined;
        let factorSensitivitySource: string;
        if (graphBasedFactorSensitivity) {
          factorSensitivity = mergeIslConfidenceIntoGraphFactors(
            graphBasedFactorSensitivity,
            islFactorSensitivityUnfiltered,
            filteredGraph.edges,
            structuralLeverIds,
          );
          factorSensitivitySource = 'graph+isl_merge';
        } else {
          // ISL-only fallback: still apply unified confidence recomputation.
          // Pass empty graph array so all ISL factors go through the ISL-only
          // append path, which computes unified confidence + confidence_components.
          // Use filtered entries here since ISL-only factors ARE the sensitivity output.
          // The structural union still applies: an UNSTAMPED union lever survives
          // transformFactorSensitivity's zero_reason filter, so the append path's
          // union check is what keeps it off the sensitivity output.
          factorSensitivity = mergeIslConfidenceIntoGraphFactors(
            [],
            islFactorSensitivity,
            filteredGraph.edges,
            structuralLeverIds,
          );
          factorSensitivitySource = 'isl';
        }

        // Enrich factor sensitivity with EVPI percentage points.
        //
        // P-5 (provisional_doctrine_v0, lane PLoT-H item C): when ISL supplied
        // per-factor counterfactual EVPI (V2 wire `factor_evpi[]`) AND
        // FLAGS.ISL_FACTOR_EVPI_INTERNAL is on (default ON for staging/test,
        // OFF for prod), the sanitised ISL values are used IN PLACE of the
        // heuristic for the "worth checking next" ranking surface. Hygiene via
        // mapIslFactorEvpi: negatives are NEVER emitted; below-resolution
        // estimates (including all MC-noise negatives, honouring ISL's
        // `evpi_status` wire field where present) are labelled
        // `evpi_status: 'below_resolution'` with evpi_percentage_points ABSENT
        // — never a clamped 0. Live motivation (scenario 327bc417,
        // 2026-07-07): the heuristic |sens|×(1−conf)×max(marginal) flattened
        // to 0 for ALL factors because marginal_switch_probability was
        // uniformly 0, so the ranking carried no information.
        //
        // Fallback (factor_evpi absent or flag off): the existing heuristic
        // VOI × win-probability-spread × 100, clamped ≥ 0. Not true
        // counterfactual EVPI. See `src/lib/evpi-emission.ts` for the
        // non-negative contract rationale (Howard 1966; OpenAPI
        // `evpi_percentage_points.minimum: 0`). The golden pricing-canary
        // fixture has no factor_evpi → always takes this path (byte-identical).
        if (factorSensitivity) {
          const factorEvpiMapping = FLAGS.ISL_FACTOR_EVPI_INTERNAL
            ? mapIslFactorEvpi(islResult)
            : { entries: [], dropped_invalid: 0 };
          const islEvpiByFactor = new Map(
            factorEvpiMapping.entries.map((e) => [e.factor_id, e]),
          );

          if (islEvpiByFactor.size > 0) {
            for (const f of factorSensitivity) {
              // P0a + D-U: never emit EVPI for an option-controlled lever —
              // ISL-stamped (zero_reason === 'intervention_override') OR a
              // structural union member (any option intervenes on it; ISL's
              // stamp misses non-first-option pins with nonzero elasticity).
              // Resolving knowledge of a value the user sets is not an
              // information gain. Applies to the ISL counterfactual path
              // exactly as to the heuristic path. The merge upstream already
              // stamps union members, so this is belt-and-braces against any
              // path that bypasses the merge.
              if (isOptionControlledLever(f, structuralLeverIds)) continue;
              const entry = islEvpiByFactor.get(f.factor_id);
              if (!entry) continue; // no ISL estimate for this factor → honest absence
              if (entry.emit_pp !== undefined) {
                f.evpi_percentage_points = entry.emit_pp;
                f.evpi_method = 'counterfactual';
              } else if (entry.below_resolution) {
                // "Too small to measure at this sampling depth" — labelled,
                // never a fabricated 0 and never the raw negative.
                f.evpi_status = 'below_resolution';
              }
            }
            req.log.info({
              event: 'factor_evpi_promoted',
              request_id: requestId,
              source: 'isl_counterfactual',
              entries: factorEvpiMapping.entries.length,
              dropped_invalid: factorEvpiMapping.dropped_invalid,
              below_resolution_count: factorEvpiMapping.entries.filter((e) => e.below_resolution).length,
            });
          } else {
            const islOptions = processedIslResult?.options ?? processedIslResult?.results ?? [];
            const winProbs = (islOptions as any[])
              .map((o: any) => o.win_probability as number | undefined)
              .filter((wp): wp is number => wp != null)
              .sort((a, b) => b - a);
            const winProbSpread = winProbs.length >= 2 ? winProbs[0] - winProbs[1] : 0;
            if (winProbSpread > 0) {
              for (const f of factorSensitivity) {
                // P0a + D-U: never emit EVPI for an option-controlled lever —
                // ISL-stamped OR structural union member (see the counterfactual
                // loop above). A lever's VOI is forced to 0 in
                // mergeIslConfidenceIntoGraphFactors, and computeEvpiPercentagePoints(0, …)
                // returns a confident 0 (not undefined) — which would still render an
                // EVPI chip and rank the lever as an "investigation priority". Skip it
                // entirely so evpi_percentage_points is ABSENT (preserving the
                // missing-vs-zero contract), not 0. Belt-and-braces with the
                // producer-side VOI zeroing; suppression only, no EVPI rename/redefine.
                if (isOptionControlledLever(f, structuralLeverIds)) continue;
                const evpiPp = computeEvpiPercentagePoints(f.value_of_information, winProbSpread);
                if (evpiPp !== undefined) {
                  f.evpi_percentage_points = evpiPp;
                  f.evpi_method = 'heuristic';
                }
              }
            }
          }
        }

        // Log which source was used for factor sensitivity
        req.log.info({
          event: 'factor_sensitivity_source',
          source: factorSensitivitySource,
          graph_based_count: graphBasedFactorSensitivity?.length ?? 0,
          isl_count: islFactorSensitivity?.length ?? 0,
          final_count: factorSensitivity?.length ?? 0,
          // Wave1-L1 (PII, review 3): factor_id is a raw label-derived node id
          // and this log site is NOT debug-gated — it reached production logs
          // verbatim. Digest it; the score/provenance fields are structural.
          sample: factorSensitivity?.slice(0, 2).map((f) => ({
            factor_id: sha8(String(f.factor_id)),
            sensitivity_score: f.sensitivity_score,
            confidence: f.confidence,
            confidence_source: f.confidence_source,
            confidence_provenance_computation_source: f.confidence_provenance?.computation_source,
            confidence_provenance_input_quality: f.confidence_provenance?.input_quality,
            direction: f.direction,
            source: f.source,
          })),
        });

        // Telemetry: count how many factors hit the degenerate confidence branch.
        // When the degenerate branch fires, the returned confidence is the uniform
        // 0.5 × band_default + 0.5 × exists_prob default — not differentiating.
        // Detected via confidence_provenance.input_quality (the legacy
        // `confidence_source: 'fallback_degenerate'` tag has been replaced by
        // honest source labels — see audit row A1-PRIMARY).
        if (Array.isArray(factorSensitivity) && factorSensitivity.length > 0) {
          const degenerate = factorSensitivity.filter(
            f => f.confidence_provenance?.input_quality === 'degenerate_fallback',
          );
          if (degenerate.length > 0) {
            req.log.info({
              event: 'plot.confidence_fallback_degenerate',
              factor_count: degenerate.length,
              total_factors: factorSensitivity.length,
              confidence_value: degenerate[0].confidence,
              // Wave1-L1 (PII, review 3): raw factor ids, not debug-gated.
              sample_factor_ids: degenerate.slice(0, 3).map(f => sha8(String(f.factor_id))),
              msg: 'Confidence fallback produced degenerate uniform value',
            });
          }
        }

        // Build factor_stability from ISL's raw factor_sensitivity (3C bootstrap fields).
        // Independent of factor_sensitivity source — always derived from ISL when available.
        // A3 lane 2 fixup: thread the D-U lever union so this RAW-input surface
        // cannot republish a suppressed lever's elasticity_std (r2 residual R1
        // saw the live leak on BOTH factor_sensitivity AND factor_stability).
        const factorStability = buildFactorStability(islResult.factor_sensitivity, filteredGraph, structuralLeverIds);

        // Recompute response hash (v6: ISL-derived fields excluded — identifiability
        // and factor_stability are passed for API backwards compat but ignored by
        // canonicaliseRequest; see canonicalise.ts BREAKING CHANGE v6).
        responseHash = hashRequest(body, filteredGraph, plotSeedUsed, toIdentifiabilityResponse(identifiabilityResult), factorStability, nSamples);

        const sensitivityData: SensitivityData = { edgeSensitivity, factorSensitivity, edgeEValues, conditionalWinners };

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

        // Honesty (Codex round-2): option_comparison_status must reflect USABLE
        // output, not just a non-empty raw array. An option is usable ONLY when its
        // public `outcome` would actually be emitted — i.e. ALL required outcome
        // stats (mean/p10/p50/p90) are finite, via the SAME predicate the outcome
        // serialiser uses (Codex round-3 #2). The legacy `expected_outcome` is NOT
        // emitted in V2, so it must not count toward usability. Require at least one
        // usable option AND that every option not explicitly skipped/errored is
        // usable — so 'computed' cannot be reported when a computed option's outcome
        // was omitted. (Transitively gates top-level 'computed' via determineTopLevelStatus.)
        const isOptionUsable = (r: any): boolean => hasAllRequiredOutcomeStats(r?.outcome);
        const usableOptionData = optionComparisonData ?? [];
        const hasUsableOptionComparison = hasOptionComparison &&
          usableOptionData.some(isOptionUsable) &&
          usableOptionData.every((r: any) =>
            r?.status === 'skipped' || r?.status === 'error' || isOptionUsable(r)
          );

        const optionStatus = mapToPerFeatureStatus(islAnalysisStatus, hasUsableOptionComparison);
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

          // Producer honesty (item A): mirror buildResponse's detection so the
          // coaching joint-probability gate never reads placeholder-derived
          // joint probabilities (same inputs → same verdict as the public
          // suppression).
          //
          // Doctrine B (P0-C2) note — DELIBERATELY stricter than the wire:
          // even when the base-defaulted-only case now DELIVERS goal-fit
          // probabilities (with a modelled-basis disclosure), coaching keeps
          // skipping the GOAL_FEASIBILITY_LOW gate for them. A feasibility
          // claim ("may not achieve the target") derived from a
          // modelled-baseline number would need its own caveated wording;
          // silence is the claim-safe default until that wording is ratified.
          const coachingConstraintTargetsUnreliable = detectUnreliableConstraintTargets(
            activeGoalConstraints,
            constraintNormalisationRanges,
            processedIslResult,
          ).length > 0;

          m1Coaching = generateM1Coaching(
            filteredGraph,
            body.options,
            processedIslResult,
            req.log,
            repairsForCoaching,  // Phase 3: normaliser repairs for assumptions ledger
            [],                  // Phase 3: CEE critiques (empty for now, can be extended)
            activeGoalConstraints,  // Task 1+3: goal constraints for joint-prob gate & grounding check
            factorSensitivity,   // Provenance fix: coaching consumes the same enriched
                                 // factor_sensitivity array we publish, so evidence_gaps
                                 // confidence/influence match the public payload (audit
                                 // A1-PRIMARY: no raw-ISL signal under coaching field names).
            coachingConstraintTargetsUnreliable,  // Item A: skip joint-prob gate on unreliable targets
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
        // Track S: depth actually used for flip probes (decoupled from base nSamples).
        // Set when a flip search runs; surfaced in response meta for transparency.
        let flipProbeNSamples: number | undefined;
        // A3 lane 2: error NAME captured when the ENTIRE flip block throws —
        // drives the FLIP_THRESHOLDS_UNAVAILABLE inference warning (wire
        // disclosure of the previously server-log-only degradation).
        let flipThresholdsFailedErrorName: string | undefined;

        if (islSuccess && factorSensitivity && optionComparisonData && optionComparisonData.length >= 2) {
          try {
            // Selection guard: exclude factors overridden by EVERY compared option.
            // The flip probe varies a factor's prior mean (parameter_uncertainties),
            // but a do()-intervention on every option severs that factor from its
            // prior, so probing it can only ever return no_effect_within_bounds.
            // Factors intervened by only some options, or by none, stay eligible.
            const overriddenByAllOptions = getFactorsOverriddenByAllOptions(normalizedOptions);
            if (overriddenByAllOptions.size > 0) {
              req.log.info({
                event: 'flip_thresholds_overridden_excluded',
                request_id: requestId,
                excluded_count: overriddenByAllOptions.size,
                // Wave1-L1 (PII, review 3): raw factor ids, not debug-gated.
                excluded_factor_ids: [...overriddenByAllOptions].slice(0, 10).map((id) => sha8(String(id))),
              });
            }

            // Step 1: Compute heuristic candidates (top 5 by |elasticity|),
            // skipping the overridden-by-all factors above.
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
              filteredGraph,
              overriddenByAllOptions
            );

            if (flipCandidates.length > 0) {
              // Step 2: Resolve exact flip values via ISL binary search
              const topWinnerOption = [...optionComparisonData]
                .sort((a: any, b: any) => (b.win_probability ?? 0) - (a.win_probability ?? 0))[0];
              const winnerId = topWinnerOption?.option_id ?? topWinnerOption?.id ?? '';

              if (winnerId) {
                // Track S (revised 2026-07-17): flip probes now INHERIT the base
                // analysis depth up to the 10k cap (resolveFlipProbeNSamples =
                // min(cap, nSamples)), so flip values carry the precision of the
                // probabilities displayed beside them. Raising the base therefore
                // DOES deepen probes (toward the flip timeout) — which is why the
                // flip time budgets were raised in step and a slow search now
                // DISCLOSES a per-factor 'timeout' rather than silently shipping
                // low-precision values. The FLIP_PROBE_N_SAMPLES env override still
                // decouples probe depth from the base on demand.
                flipProbeNSamples = resolveFlipProbeNSamples(nSamples);
                // Paul-ruled lenient defaults 2026-07-17: each probe's ISL call is
                // capped at the per-factor budget — a probe has no use for time its
                // factor no longer has. (Without this cap a single in-flight probe
                // could add a full ISL_TIMEOUT_MS tail past the flip deadline.)
                const flipProbeIslTimeoutMs = resolveFlipPerFactorTimeoutMs();
                const flipInferenceFn = createISLInferenceFn(
                  // F3 (Codex): maxRetries=1 — each probe is optional, so a
                  // transient failure discloses per-factor instead of adding ~3×
                  // per-attempt tails past the flip deadline. The 4th arg is the
                  // per-probe AbortSignal threaded from the flip search: forwarding
                  // it lets an in-flight probe cancel the moment the factor/overall
                  // deadline trips (the client folds it into its per-attempt timeout).
                  (endpoint, body, rid, signal) =>
                    islService.callAnalysisEndpoint(endpoint, body, rid, flipProbeIslTimeoutMs, 1, signal),
                  islRequest,
                  requestId,
                  flipProbeNSamples
                );

                // Envelope guard (Paul-ruled lenient defaults 2026-07-17): the raised
                // flip budget is clamped to the REMAINING request budget. Before the
                // raises, base ISL (30s) + flip (10s) could never exceed the 60s
                // request budget; after them (60s + 60s) it could — and an internal
                // budget that outlives the caller's timeout delivers nothing. The
                // clamp is DISCLOSED, never silent: a clamped/exhausted search trips
                // per-entry flip_reason 'timeout' with elapsed_ms, and the clamp
                // itself is logged below.
                const flipStartMs = performance.now();
                const flipConfiguredOverallMs = resolveFlipOverallTimeoutMs();
                const flipRequestBudgetMs = resolveRequestBudgetMs();
                const flipRemainingBudgetMs = flipRequestBudgetMs - (flipStartMs - startTime);
                const flipSafetyMarginMs = 1_000;
                const flipOverallTimeoutMs = Math.min(
                  flipConfiguredOverallMs,
                  Math.max(0, flipRemainingBudgetMs - flipSafetyMarginMs)
                );
                if (flipOverallTimeoutMs < flipConfiguredOverallMs) {
                  req.log.info({
                    event: 'flip_thresholds_budget_clamped',
                    request_id: requestId,
                    configured_overall_timeout_ms: flipConfiguredOverallMs,
                    clamped_overall_timeout_ms: Math.round(flipOverallTimeoutMs),
                    remaining_budget_ms: Math.round(flipRemainingBudgetMs),
                    request_budget_ms: flipRequestBudgetMs,
                  });
                }

                const flipResult = await resolveFlipValues(
                  flipCandidates,
                  flipInferenceFn,
                  winnerId,
                  { overallTimeoutMs: flipOverallTimeoutMs }
                );
                resolvedFlipData = flipResult.results;

                req.log.info({
                  event: 'flip_thresholds_resolved',
                  request_id: requestId,
                  count: resolvedFlipData.length,
                  // Paul-ruled lenient defaults 2026-07-17: slowness visible — block
                  // wall-time + probe depth alongside per-factor elapsed_ms in factors.
                  elapsed_ms: Math.round(performance.now() - flipStartMs),
                  flip_probe_n_samples: flipProbeNSamples,
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
            // A3 lane 2 (ROADMAP 2.31 adjacency): wire-disclose the
            // whole-block failure. Capture the error NAME only (never the
            // message or any value) — buildResponse turns its presence into a
            // FLIP_THRESHOLDS_UNAVAILABLE inference warning so the absent
            // flip_thresholds field is attributable on the wire, not just in
            // this server-side WARN. Per-factor failures never reach this
            // catch (resolveFlipValues handles them per entry via flip_reason).
            flipThresholdsFailedErrorName = (err as Error)?.name || 'Error';
            req.log.warn({
              event: 'flip_thresholds_error',
              request_id: requestId,
              error: (err as Error).message,
              // Paul-ruled lenient defaults 2026-07-17: failures carry their
              // wall-time too — a crash after 55s and a crash after 50ms are
              // different diagnoses.
              elapsed_ms: Math.round(performance.now() - startTime),
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
          const requestBudgetMs = resolveRequestBudgetMs();
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

              // F9 (Codex): pass maxRetries=1 for this OPTIONAL phase. Omitting it
              // inherited the config default (ISL_MAX_RETRIES=3), so a "30s cap"
              // was really ~3× the per-attempt timeout + the 1s+2s backoff (~93s)
              // — and this call is synchronously awaited AFTER the base science, so
              // a retry storm here discards a completed base result. A transient
              // failure now degrades-and-discloses (thresholds_status
              // 'timeout'/'error') rather than retrying past the budget. The
              // per-attempt timeout stays clamped to the remaining budget
              // (thresholdsTimeoutMs above).
              const thresholdsResult = await islService.callAnalysisEndpoint<IslThresholdResponse>(
                '/api/v1/analysis/thresholds',
                thresholdsPayload,
                requestId,
                Math.round(thresholdsTimeoutMs),
                1
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
                  // Numeric-egress guard (Codex round-2): threshold_value comes from the
                  // remote ISL endpoint cast-without-runtime-validation; a non-finite
                  // value would serialise to a fabricated `null` while thresholds_status
                  // is 'computed'. Guard margin here and drop non-finite entries below.
                  const margin = (Number.isFinite(thresholdValue) && currentValue !== undefined)
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
                })
                .filter((t) => Number.isFinite(t.threshold_value));
                // Stable order: factor_id → threshold_value → crossing_direction
                thresholdAnalysis.sort((a, b) =>
                  a.factor_id.localeCompare(b.factor_id)
                  || a.threshold_value - b.threshold_value
                  || a.crossing_direction.localeCompare(b.crossing_direction)
                );

                // Honest status on filtering (Codex round-3 #4): entries with a
                // non-finite threshold_value were dropped above. If EVERY input
                // threshold was invalid, do NOT claim 'computed' — surface 'error'
                // (an existing ThresholdsStatus). If only some were dropped, keep the
                // valid entries but emit an observable warning so the silent loss is
                // reported, not hidden. ('partial' is not a ThresholdsStatus value; a
                // dedicated partial state would be a schema change.)
                const thresholdsDropped = islThresholds.length - thresholdAnalysis.length;
                thresholdsStatus = (islThresholds.length > 0 && thresholdAnalysis.length === 0)
                  ? 'error'
                  : 'computed';
                if (thresholdsDropped > 0) {
                  req.log.warn({
                    event: 'threshold_entries_dropped_nonfinite',
                    request_id: requestId,
                    dropped: thresholdsDropped,
                    kept: thresholdAnalysis.length,
                  });
                  critiques.push({
                    id: randomUUID(),
                    code: 'THRESHOLD_NONFINITE_DROPPED',
                    severity: 'warning',
                    message: `${thresholdsDropped} threshold result(s) omitted: ISL returned a non-finite threshold value.`,
                    source: 'isl',
                    blocks_analysis: false,
                  });
                }
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
          // Skip M2 review when brief is missing — review needs context to be useful.
          // Analysis and M1 coaching still proceed; the user just won't get M2 narrative.
          if (!body.brief) {
            req.log.warn({
              event: 'decision_review_brief_missing',
              request_id: requestId,
              message: 'Skipping M2 decision review: brief not provided in request',
            });
            m2DecisionReview = {
              m1_review: null,
              review_status: 'skipped',
              review_skip_reason: ReviewSkipReasons.BRIEF_MISSING,
            };
          } else try {
            const decisionReviewInput: DecisionReviewInput = {
              brief: body.brief,
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

        // 2.13 gap D: derive the PLoT→CEE chain legs from the downstream
        // tracker (CEE calls are made inside orchestration; the tracker is
        // the single record of whether/what CEE echoed).
        const ceeDownstreamCalls = getDownstreamCalls(requestId).filter((c) => c.service === 'cee');
        const ceeEchoedRequestId = ceeDownstreamCalls.find((c) => c.echoedRequestId)?.echoedRequestId ?? null;
        const chain = buildRequestIdChain(
          hasExplicitRequestId,
          requestId,
          true,
          islEchoedRequestId,
          ceeDownstreamCalls.length > 0,
          ceeEchoedRequestId,
        );
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
            originalNSamples,
            flipProbeNSamples,
            flipThresholdsFailedErrorName,
            edgeEValuesDropped,
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
            rangeDerivationSources: normalisationContext
              ? Object.fromEntries([...normalisationContext.factors].map(([id, ctx]) => [id, ctx.range.source]))
              : buildDefaultRangeDerivationSources(normalizedOptions),
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
          constraintNormalisationRanges,  // Per-constraint ranges for failure_margin_median denorm
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
        // Fragility gap 1: the most severe failure class no longer returns an
        // EMPTY critiques[] — it carries a typed PLOT_INTERNAL_ERROR critique.
        // Copy is deliberately generic: the raw exception goes to the log
        // above, never to the wire.
        return reply.send(buildV2RunError({
          analysisStatus: 'failed',
          statusReason: 'Internal server error',
          retryable: true,
          requestId,
          computedAt: requestComputedAt,
          critiques: addUserMessages([{
            id: randomUUID(),
            code: 'PLOT_INTERNAL_ERROR',
            severity: 'error',
            message: 'Unexpected internal error while assembling the analysis response.',
            source: 'engine',
            blocks_analysis: false,
          }]),
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
