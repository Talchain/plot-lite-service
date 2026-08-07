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
  ConstraintScaleProvenance,
  ConstraintDiagnostic,
  ConstraintMargin,
  EnrichedEdgeEValue,
  ConditionalWinner,
  ConditionalProbability,
  ConstraintFeatureStatus,
  ThresholdsStatus,
  ThresholdResult,
  FactorStabilityEntry,
  StabilityThresholds,
  InferenceWarning,
  OutcomeStatsV3,
} from '../../types/engine-v3.js';
import { INFERENCE_WARNING_CODES } from '../../types/engine-v3.js';
import { sha8 } from '../../util/pii-redact.js';
import { getBuildId } from '../../util/build-id.js';
import { addUserMessages } from '../../critique-humaniser.js';
import type { GraphForLabels } from '../../critique-humaniser.js';
import { normalisationWarningToCritique } from '../../lib/normalisation-critiques.js';
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
import type { RawGoalConstraint, InternalMetadata } from '../../types/engine-v3.js';
import type { IslThresholdResponse, ThresholdPoint } from '../v1/types/proxy.types.js';
import { toISLRobustnessRequest, validateISLRequest, buildParameterUncertaintiesV3, parseGoalThresholdFrame } from '../../integrations/isl/translator-v3.js';
import { injectConstraintParameterUncertainties, selectConstraintInjectedPuNodeIds } from '../../integrations/isl/constraint-pu-injection.js';
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
import type { RobustnessDataForCee } from '../../integrations/isl/types/plot-types.js';
import type { ISLConstraintResult, ISLEdgeEValue, ISLConditionalWinner } from '../../integrations/isl/types/isl-types.js';
import { getIslEdgeEValues, getIslEdgeSensitivity, getIslComputedAt, getIslRangeFitDisclosures } from '../../integrations/isl/v2-envelope.js';
import { V2_RUN_ALLOWED_KEYS, islEnrichmentPassthrough } from './run-contract-keys.js';
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
  OPTIONAL_PHASE_MAX_RETRIES,
  BASE_CALL_MIN_TIMEOUT_MS,
} from '../../config/timeouts.js';
import { getISLClientConfig } from '../../integrations/isl/client.js';
// ROADMAP 2.228-F3: the bisection-probe imports that used to sit here
// (createISLInferenceFn / resolveFlipValues / resolveFlipProbeNSamples /
// resolveFlipOverallTimeoutMs / resolveFlipPerFactorTimeoutMs from
// analysis/flip-thresholds.js, and computeFlipThresholdData /
// getFactorsOverriddenByAllOptions from coaching/flip-thresholds.js) are gone
// with the probe. Flip values now arrive closed-form on the ISL envelope.
import { mapIslFactorFlipValues } from '../../integrations/isl/adapters/factor-flip-values.js';
import { denormaliseFlipThresholds, type DenormalisedFlipThreshold } from '../../lib/flip-threshold-denormaliser.js';
// ROADMAP 2.676: the ONE conversion from denormalised rows to decision_review
// prompt input, so the numbers the prompt quotes and the numbers the response
// publishes cannot drift apart again.
import { toPromptFlipThresholdData } from '../../lib/flip-threshold-prompt-input.js';
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
import { resolveStandardNSamples, ADAPTIVE_N_SAMPLES_FLOOR, planSampleDepth, checkAdmissionCaps, type DepthPlanInput, type AdmissionCapsDecision, type AdmissionCapDimension, type DepthReductionReason } from '../../config/sampling.js';
import { LIMITS_MAX_NODES, LIMITS_MAX_EDGES, LIMITS_MAX_OPTIONS } from '../../config/constants.js';
import { resolveAdmissionForPlanning } from '../../integrations/isl/compute-admission.js';
import { generateM1Coaching } from '../../coaching/m1-coaching.js';
import { filterInterventionOverrides } from '../../coaching/sensitivity-filter.js';
import type { M1Review } from '../../cee/validation/m1-review-types.js';
import type { ReviewStatus } from '../../cee/validation/m1-review-constants.js';
import { ReviewSkipReasons, type ReviewSkipReason } from '../../cee/validation/m1-review-constants.js';
import { getDownstreamCallsForLog, getDownstreamCalls, adoptResolvedRequestId } from '../../util/downstream-tracker.js';
import { computeResponseContentHash } from '../../util/response-content-hash.js';
import { computeFactorSensitivityFromGraph, buildFactorStability, mergeIslConfidenceIntoGraphFactors } from '../../lib/factor-influence.js';
import { interventionTargetIdsFromOptions, isOptionControlledLever, factorIdOf, hasFactorIdConflict } from '../../lib/intervention-override.js';
import { buildAutoNoiseProvenance, extractIslAutoNoiseApplied, logAutoNoiseFlagMissingFromIsl } from '../../lib/auto-noise.js';
import { sanitiseIslVoi, computeEvpiPercentagePoints, deriveEvidenceHint } from '../../lib/evpi-emission.js';
import { deriveDriverLabel, indexOfCanonicalTopDriver } from '../../lib/driver-label.js';
import {
  applyLeverAwareImportanceOrder,
  IMPORTANCE_BASIS_GRAPH,
  IMPORTANCE_BASIS_ISL,
} from '../../lib/importance-authority.js';
import { buildDriverOrder, readIslSuppressedAttributions } from '../../lib/driver-order.js';
import {
  detectUnreliableConstraintTargets,
  detectUnanchoredSampleFrameTargets,
  detectUnitMismatchedConstraintTargets,
  mergeUnreliableConstraintTargets,
  collectDirectedEdgeTargets,
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
import { classifyEdgeSeverity, deriveFragileEdgeVisible } from '../../trust/edge-severity.js';
import { deriveMarginPrecision } from '../../trust/margin-precision.js';
import { deriveConfidenceTier, reconcileConfidenceTier } from '../../trust/confidence-tier.js';
import { detectDominantFactor } from '../../trust/factor-dominance.js';
import type { IdentifiabilityAssessment } from '../../types/engine-v3.js';
import { readInterventionValue } from '../../lib/intervention-value.js';
import {
  normaliseOptionsForISL,
  denormaliseISLResult,
  denormaliseValue,
  needsNormalisation,
  normaliseGoalConstraints,
  constraintsNeedNormalisation,
  isIdentityRange,
  type NormalisationContext,
  type NormalisationDiagnostic,
  type NormalisationRange,
  type RangeSource,
  type GoalThresholdNodeMeta,
  type ConstraintUnitMismatch,
} from '../../lib/intervention-normaliser.js';
import { assembleBrief } from '../../assembly/decision-brief.js';
import { buildEvidencePriorityCard, type FactorInput } from '../../review-pass/evidence-priority.js';
import type { ProposalCardV1 } from '../../review-pass/types.js';
import { assembleFactObjects, type ISLResponseInput, type FactorSensitivityInput } from '../../facts/index.js';
import type { FactObjectV1, FactLineage } from '../../facts/types.js';
import { finiteNum, prob01, nonNeg, nonNegInt, hasAllRequiredOutcomeStats, buildDownside } from './numeric-egress-guards.js';
import { resolveConstraintIds } from './constraint-identity.js';
import { resolveConfidenceBasis } from '../../integrations/isl/confidence-basis.js';
import {
  assessEnrichmentContract,
  shouldAssessEnrichmentContract,
  applyEnrichmentWithholding,
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
    // ROADMAP 1.277: `number | undefined` because denormaliseValue is now
    // absence-in ⇒ absence-out. An absent/non-finite mean is carried as
    // `undefined` to the numeric-egress guard below, which DROPS the whole entry
    // and attributes the drop — it is never emitted as a fabricated number.
    let currentMean: number | undefined = e.current_mean;
    let flipMean: number | undefined = e.flip_mean;
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
    // ROADMAP 1.277: bind the CHECKED values and re-emit them, so the field that
    // rides the wire is by construction the one the guard validated. (Previously
    // the guard was a boolean and `out` was pushed unnarrowed — correct, but it
    // relied on a `number` declaration that was a fiction over `as`-cast wire data.)
    const eValue = finiteNum(out.e_value);
    const currentMeanChecked = finiteNum(out.current_mean);
    const flipMeanChecked = finiteNum(out.flip_mean);
    if (eValue !== undefined && currentMeanChecked !== undefined && flipMeanChecked !== undefined) {
      // Spread-then-override preserves key ORDER and every additive field.
      kept.push({ ...out, e_value: eValue, current_mean: currentMeanChecked, flip_mean: flipMeanChecked });
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
/**
 * ROADMAP 1.277: the in-flight shape, before the numeric-egress filter runs.
 * `split_value` is REQUIRED (`number`) on the outbound `ConditionalWinner`, so an
 * absent one cannot simply be omitted — the honest disposal is to DROP the whole
 * entry, which the type-predicate filter at the end of the map does. This draft
 * type is what makes that drop compiler-enforced rather than remembered: the
 * unfiltered value is not assignable to `ConditionalWinner`.
 */
type ConditionalWinnerDraft = Omit<ConditionalWinner, 'split_value'> & { split_value: number | undefined };

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
    // ROADMAP 1.277: `number | undefined` — an absent/non-finite split_value is
    // carried as `undefined` to the drop filter below, never emitted.
    let splitValue: number | undefined = cw.split_value;
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
    /**
     * ROADMAP 1.277 — THIS WAS THE LIVE FABRICATION SITE.
     *
     * `val` was typed `number | undefined` and the guard tested `=== undefined`
     * ONLY. But `ISLConditionalBucket.mean_outcome` is declared `number | undefined`
     * over an `as`-cast wire payload (`JSON.parse(text) as T`,
     * src/integrations/isl/client.ts:245 — no runtime validation), and ISL emits
     * `null` for an absent nested numeric. `null === undefined` is **false**, so
     * null reached the arithmetic and `null * width + min` produced the GOAL-RANGE
     * FLOOR — published as a confident measured mean_outcome meaning "in this
     * bucket the winner achieves the worst possible result".
     *
     * The `finiteNum(...)` spread guards below were structurally blind to it: the
     * fabricated value IS finite, so no post-hoc finiteness check could ever
     * distinguish it from a real measurement. Fixing it required moving the guard
     * BEFORE the arithmetic, which is what the primitive now does.
     *
     * `unknown` in, `number | undefined` out ⇒ an absent mean_outcome now OMITS the
     * field. That is contract-legal without any change: `mean_outcome?: number` is
     * optional on both ISLConditionalBucket and the outbound ConditionalBucket.
     */
    const denormMeanOutcome = (val: unknown): number | undefined => {
      // No goal range ⇒ cannot map; keep the value in normalised space (the entry
      // is flagged `_normalised: true` above). Still finite-checked, so an absent
      // value stays absent on this path too.
      if (!goalRange) return finiteNum(val);
      return denormaliseValue(val, goalRange);
    };

    // Compute each bucket's mapped outcome ONCE, so the value that is CHECKED is
    // by construction the value that is EMITTED. (These lines each used to call
    // denormMeanOutcome twice — once inside the guard, once in the payload.)
    // `finiteNum` still wraps the result: it now guards the OUTPUT (an
    // overflow-width range can map a valid input to ±Infinity), whereas the
    // primitive guards the INPUT. Both are needed; neither replaces the other.
    const lowMeanOutcome = finiteNum(denormMeanOutcome(cw.low_bucket.mean_outcome));
    const highMeanOutcome = finiteNum(denormMeanOutcome(cw.high_bucket.mean_outcome));

    const result: ConditionalWinnerDraft = {
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
        ...(lowMeanOutcome !== undefined && { mean_outcome: lowMeanOutcome }),
      },
      high_bucket: {
        winner_id: cw.high_bucket.winner_id,
        winner_label: resolveOptionLabel(cw.high_bucket.winner_id),
        ...(cw.high_bucket.runner_up_id !== undefined && {
          runner_up_id: cw.high_bucket.runner_up_id,
          runner_up_label: resolveOptionLabel(cw.high_bucket.runner_up_id!),
        }),
        win_probability: cw.high_bucket.win_probability,
        ...(highMeanOutcome !== undefined && { mean_outcome: highMeanOutcome }),
      },
      winner_flips: cw.winner_flips,
    };
    if (cwNormalised) result._normalised = true;
    return result;
    // Numeric-egress guard (Codex round-2): split_value is a required number and each
    // bucket win_probability is a required [0,1] probability; drop the whole
    // conditional-winner entry when any is non-finite / out-of-range rather than emit
    // a fabricated null or an impossible probability.
  }).filter((cw): cw is ConditionalWinner =>
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
  // (computeFactorSensitivityFromGraph). ISL's honest outcome-unit successor,
  // top-level `factor_evppi` (F3 / ISL #103; the earlier win-probability
  // `factor_evpi[]` was removed), rides the raw top-level passthrough only and
  // is deliberately NOT wired into this user-facing VOI/EVPI surface yet —
  // outcome-units vs win-probability points need the S5 typed-surface
  // reconciliation (D-23.8). The read is kept (not deleted) only to tolerate
  // legacy fixtures.
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
  // Repointed from the phantom `robustness_label` (RobustnessResultV2 has no
  // `label` on the V2 wire) to the real `robustness.level` field.
  robustness_level?: string;
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
    // Repointed from the phantom `robustness.label` (never on the V2 wire —
    // RobustnessResultV2 has no `label`, so this always logged undefined) to
    // the real field `robustness.level`, so the diagnostic is actually useful.
    robustness_level: islResult?.robustness?.level,
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
 *
 * TOTAL OR LOUD. Every entry must carry a finite value; one that does not
 * THROWS rather than being dropped. The route guarantees that by rejecting the
 * same entries at the Phase 1a++ ingress guard, which runs above this
 * function's only call site — see the in-body comment for the derivation.
 */
function normalizeInterventions(
  interventions: Record<string, number | { value: number; source?: string }>
): Record<string, { value: number; source: 'user_specified' | 'brief_extraction' | 'cee_hypothesis' }> {
  const result: Record<string, { value: number; source: 'user_specified' | 'brief_extraction' | 'cee_hypothesis' }> = {};

  for (const [nodeId, intervention] of Object.entries(interventions ?? {})) {
    // ROADMAP 1.278: inclusion is decided by the SHARED reader, the same
    // predicate the Phase 1a++ ingress guard rejects on — so "what survives
    // normalisation" and "what the boundary accepts" cannot drift apart.
    //
    // The comment that used to sit on the else-branch here read "Skip invalid
    // entries (will be caught by validation)". That was FALSE, and it was the
    // defect: preflight's INVALID_INTERVENTION_VALUE check runs against the
    // ALREADY-NORMALISED options, so an entry dropped here is an entry
    // preflight can no longer see. `{"f": null, "g": 60}` lost `f` silently
    // and passed preflight as a one-intervention option.
    //
    // There is no longer a drop at all — a rejected entry throws.
    //
    // REACHABILITY of that throw, derived rather than asserted. This function
    // has exactly one caller (normalizeOptions), which in turn has exactly one
    // call site: the first statement of the Phase 1 block in the POST /v2/run
    // handler. The Phase 1a++ ingress guard sits ABOVE that statement and 422s
    // every entry THIS SAME READER rejects, reading the raw body. So a
    // malformed entry cannot reach this loop from the wire.
    //   · The one shape the guard skips rather than scans is an `interventions`
    //     value that is not a plain object; the Ajv body schema types it
    //     `{ type: 'object' }`, and an array or string body is rejected 400
    //     BAD_INPUT before this handler runs (measured, not assumed).
    //
    // An EARLIER revision of this comment claimed the *drop* was "UNREACHABLE
    // on the route" while the guard still ran ~160 lines further down, i.e.
    // AFTER this function. That was false: the drop executed on every malformed
    // request (measured — replacing it with a throw produced a stack through
    // normalizeOptions from the handler). The guard was nonetheless correct,
    // because it reads the RAW body and the drop cannot blind it; what was
    // wrong was the reachability claim, and the fact that "no consumer sees the
    // edited set" depended on nobody adding a `normalizedOptions` reader into
    // the gap. The guard was hoisted above the call site so the claim above is
    // structural. Read that placement comment before moving either one.
    //
    // WHY THROW rather than skip. `OptionV3.interventions[].value` is a required
    // number, so absence cannot be represented here: skipping silently changes
    // WHAT WAS ANALYSED while still returning a confident answer, and any
    // substituted number fabricates. Refusing is the only non-fabricating
    // disposal, and it converts an undetectable edit into a logged, named
    // failure. Same disposal, same reason, as normaliseOptions() and
    // normaliseGoalConstraints() in lib/intervention-normaliser.ts.
    const value = readInterventionValue(intervention);
    if (value === undefined) {
      throw new Error(
        `normalizeInterventions: non-finite intervention value for node '${nodeId}' ` +
        `(received ${JSON.stringify(intervention) ?? 'undefined'}). ` +
        `Intervention values must be validated at the request boundary before normalisation.`,
      );
    }

    const source = (intervention && typeof intervention === 'object')
      ? (intervention as { source?: string }).source
      : undefined;
    const validSource = (source === 'brief_extraction' || source === 'cee_hypothesis')
      ? source
      : 'user_specified';
    result[nodeId] = { value, source: validSource };
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
// The set lives in ./run-contract-keys so the OpenAPI↔runtime drift gate can
// read the SAME source of truth (F9 / D-23.15); it MUST equal
// contracts/openapi.yaml runRequestV3.properties.

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
      // Capability #100 (doctrine D-23.4): client-supplied pairwise factor
      // correlations. LIGHT STRUCTURAL validation only — shape is an array of
      // { factor_a: string, factor_b: string, rho: number }. Items intentionally
      // do NOT set additionalProperties:false (forward-compat, matching the
      // nodes/options/edges convention above). DEEP SEMANTICS (unknown-factor /
      // |rho|>1 / self-pair / duplicate) are ISL's single source of truth and
      // surface as a 422 through PLoT — PLoT does not re-implement them.
      factor_correlations: {
        type: 'array',
        items: {
          type: 'object',
          required: ['factor_a', 'factor_b', 'rho'],
          properties: {
            factor_a: { type: 'string' },
            factor_b: { type: 'string' },
            rho: { type: 'number' },
          },
        },
      },
      // ⭐ ROADMAP 2.720 (pillar P4): the user's own stated ranges for factor
      // values, forwarded to ISL's interquartile range→distribution converter.
      //
      // LIGHT STRUCTURAL validation only, and the shape is DERIVED from ISL's
      // `UserStatedRange` rather than invented: `node_id` + `domain` are the
      // only REQUIRED members there too, and `domain`'s two-member enum is
      // ISL's own — it selects the fitted family and is never inferred.
      //
      // ⚠ `lower`/`upper` are DELIBERATELY NOT required, and PLoT must not
      // default them. Their absence is what makes ISL refuse RANGE_OPEN_ENDED
      // loudly instead of fitting an interval the user never stated.
      //
      // DEEP SEMANTICS (zero width, inverted order, out of domain, at domain
      // edge, non-convergent) are ISL's single source of truth and come back as
      // TYPED refusals on `range_fit_disclosures` — PLoT does not re-implement
      // them, and must not "repair" a range into something the user did not say.
      // Items do NOT set additionalProperties:false (forward-compat, matching
      // the nodes/options/edges convention above); the translator PROJECTS onto
      // ISL's declared members, so an undeclared key cannot reach the wire.
      user_stated_ranges: {
        type: 'array',
        items: {
          type: 'object',
          required: ['node_id', 'domain'],
          properties: {
            node_id: { type: 'string', minLength: 1 },
            lower: { type: 'number' },
            upper: { type: 'number' },
            domain: { type: 'string', enum: ['unit_interval', 'unbounded'] },
            source: { type: 'string' },
            stated_at: { type: 'string' },
            method_version: { type: 'string' },
          },
        },
      },
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
 *
 * Codex F3: `partial` REQUIRES usable option outcomes. The old fallback
 * returned 'partial' whenever any secondary feature computed and none
 * errored, even with zero usable options — so a run with no usable answer
 * read "usable but degraded" (and `approximate: true`). Usability is now an
 * EXPLICIT input: the caller derives it from the V2 nested `outcome` stats
 * (hasUsableOptionComparison at the call site — the same predicate that
 * gates option_comparison_status), replacing a stale V1 read of
 * `expected_outcome`, a field the V2 wire never carries.
 */
function determineTopLevelStatus(
  optionStatus: PerFeatureStatus,
  robustnessStatus: PerFeatureStatus,
  driversStatus: PerFeatureStatus,
  hasUsableOptionComparison: boolean,
  islAnalysisStatus?: string
): TopLevelAnalysisStatus {
  // No usable option outcomes → the primary deliverable is missing → failed,
  // regardless of how many secondary features computed.
  if (!hasUsableOptionComparison) {
    return 'failed';
  }

  const statuses = [optionStatus, robustnessStatus, driversStatus];

  // Everything computed → computed
  if (statuses.every(s => s === 'computed')) {
    // ROADMAP 2.744 — CEILING: PLoT must never report a run in better health
    // than ISL declared it.
    //
    // ISL's own _determine_analysis_status() (src/utils/response_builder.py)
    // returns 'partial' when SOME BUT NOT ALL options computed, with
    // status_reason "Some options could not be computed". Before 2.744 that
    // verdict was unreachable here: one failed option zeroed
    // hasUsableOptionComparison and this function returned 'failed' at the
    // guard above. Fixing the exemption list alone would have swung it to the
    // OPPOSITE error — 'computed', silently discarding ISL's declared
    // degradation, because mapToPerFeatureStatus treats data presence as
    // authoritative and reports 'computed' whenever data is present.
    //
    // So the honest verdict for "one option failed, others computed" is
    // 'partial', and it is not this layer's invention — it is the producer's,
    // read off the wire. `approximate: true` follows via isApproximateAnalysis,
    // which is what tells the user the comparison is missing an option.
    //
    // ISL 'failed' never reaches here (short-circuited to buildV2RunError
    // upstream), and an absent status means the legacy V1 envelope, which
    // carries no such verdict — so both leave this untouched.
    if (islAnalysisStatus === 'partial') {
      return 'partial';
    }
    return 'computed';
  }

  // Usable options + some degraded secondary feature → partial
  return 'partial';
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
   *
   * ROADMAP 2.260: also present when the CONSERVATIVE fallback disabled the
   * depth-raise because ISL's admission capability was unreadable. That cut
   * (10,000 → 4,000 on every defaulted analysis) used to reach here as
   * `undefined`, so the warning below never fired and a 60% loss of Monte Carlo
   * depth was invisible on the wire.
   */
  originalNSamples?: number;
  /**
   * ROADMAP 2.260: WHY the depth was reduced. Set alongside originalNSamples on
   * every reduced run; selects the disclosure wording so a seam failure is never
   * reported to the user as a property of their graph.
   */
  nSamplesReducedReason?: DepthReductionReason;
  /**
   * Track S: sample depth used for flip probes (decoupled from nSamples).
   *
   * ⚠ NO LONGER PRODUCED ON THE /v2/run PATH since ROADMAP 2.228-F3. The
   * bisection probe that consumed a sample depth is retired; ISL's closed-form
   * factor flips run zero Monte Carlo, so there is no probe depth to disclose
   * and `flip_probe_n_samples` is now permanently absent from response meta.
   * The field is retained (rather than deleted mid-lane) so the emission site
   * below stays a single, reviewable deletion in the rowed probe retirement.
   */
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
 * User-facing GRAPH_TOO_COMPLEX message for a structural admission-cap breach
 * (the CAPS half of the /health handshake — checkAdmissionCaps). Names the
 * breached dimension plus the observed count and enforced limit so the caller
 * knows exactly what to reduce, matching the tone of the cost-ceiling refusal.
 */
function capsRefusalMessage(
  decision: Extract<AdmissionCapsDecision, { kind: 'exceeded' }>,
): string {
  const noun: Record<AdmissionCapDimension, string> = {
    parameter_uncertainties: 'factors with parameter uncertainty',
    nodes: 'causal nodes',
    edges: 'causal edges',
    options: 'options',
  };
  const what = noun[decision.dimension];
  return `This graph is too complex to analyse: it has ${decision.observed} ${what}, but the analysis engine admits at most ${decision.limit}. Reduce the number of ${what} — e.g. remove weaker or duplicate influences — and re-run.`;
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

  // ── Family-4 S1: the INPUTS to the canonical driver order + attestation ──
  // Carried (not the built object) so `driver_order` has exactly ONE
  // construction site, AT the emission point in buildResponse. Two
  // construction sites would be the hand-maintained mirror this programme
  // keeps paying for; and building it here would re-introduce the conditional
  // emission that made the existing per-row `importance_basis` absence
  // ambiguous (old payload vs non-ISL branch vs dropped key).
  /**
   * D-U structural lever union derived from the request's options.
   *
   * REQUIRED (S1b): every construction site already knows it, and a `?? new
   * Set()` fallback would silently attest `lever_ids: []` — "this order contains
   * no levers" — on a payload that has them.
   */
  structuralLeverIds: ReadonlySet<string>;
  /**
   * `'isl'` on the ISL-only fallback; `'graph+isl_merge'` on the primary path.
   *
   * ⚠ REQUIRED (S1b, S1 review LOW). This was optional, and the emission site
   * coalesced it with `?? 'isl'`. That default is CORRECT for the raw-ISL
   * fallback path — where there is no `sensitivityData` at all and the rows
   * genuinely are ISL's — but it was LATENT: a future path that supplied a
   * `sensitivityData` without this member would have had its order attested
   * `basis: 'isl_uncertainty'` with no signal. Making it required moves that
   * from a silent wrong answer to a compile error.
   */
  factorSensitivitySource: string;
  /** ISL's `correlation_model.suppressed_attributions`, when ISL declared any. */
  islSuppressedAttributions?: string[];
}

/**
 * Codex F2: THE single crowning/near-tie candidate predicate.
 *
 * An option is a valid win-probability candidate ONLY when its ISL status is
 * 'computed' (absent status = legacy shape, treated as computed) AND
 * win_probability is a present, finite number. `deriveRecommendedOption` and
 * `computeNearTie` MUST share this one predicate so their eligibility can
 * never drift apart again — the drift is exactly how an errored option
 * (status 'error', win_probability 0.9) got crowned while near-tie correctly
 * excluded it.
 */
function isCrownableCandidate(o: { win_probability?: number; status?: string }): boolean {
  return (
    (o.status === undefined || o.status === 'computed') &&
    o.win_probability !== undefined &&
    o.win_probability !== null &&
    Number.isFinite(o.win_probability)
  );
}

/**
 * ROADMAP 2.744 — THE single predicate for "ISL says this option genuinely failed".
 *
 * PRODUCER SEMANTICS (derived from ISL's determine_option_status(n_valid,
 * n_total), src/utils/response_builder.py — NOT from what the enum member
 * sounds like):
 *
 *   'failed'   ⇔ n_valid === 0. ZERO finite Monte Carlo samples. There is no
 *                distribution, so nothing downstream of it can be trusted.
 *   'partial'  ⇔ 0 < n_valid/n_total < MIN_VALID_RATIO (0.8). Samples EXIST;
 *                ISL emits a full `outcome` block and raises a
 *                LOW_EFFECTIVE_SAMPLES critique. It is a DISCLOSURE, not a
 *                failure, and must NOT be treated as one — doing so discards
 *                results ISL honestly computed.
 *   'computed' ⇔ ratio >= 0.8.
 *
 * `undefined` means the legacy V1 shape (ISL's V1 `OptionResult` has no
 * `status` field at all), which is treated as computed, matching
 * isCrownableCandidate above.
 *
 * Callers must share THIS predicate so the two constraint guards can never
 * drift apart again — the same reasoning that gave isCrownableCandidate its
 * existence.
 */
function isFailedIslOption(o: { status?: string } | null | undefined): boolean {
  return o?.status === 'failed';
}

/**
 * ROADMAP 2.744 — options ISL explicitly declined to compute in full.
 *
 * These are EXEMPT from the per-option usability requirement that gates
 * `option_comparison_status`: ISL already told us they are not fully computed,
 * so their missing/short outcome stats are disclosed rather than anomalous, and
 * must not condemn the options that DID compute. Everything not in this set —
 * including the legacy V1 `undefined` — must be usable.
 */
function isNotFullyComputedIslOption(o: { status?: string } | null | undefined): boolean {
  return o?.status === 'partial' || o?.status === 'failed';
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
/**
 * ⭐ Map the emitted `factor_sensitivity[]` onto the facts-assembly input
 * (family-4 S1b, surface 5 of 5).
 *
 * ## What changed: a POSITION became a RANK
 *
 * This mapping used to emit `importance_rank: idx + 1` — the row's INDEX in the
 * array. Because the emitted array is the canonical order (Rule S3), that value
 * is right on every live payload, and S1's residual table said so precisely:
 * *"a POSITION, not a rank — mirrors the array, so agrees by accident."*
 *
 * An accident is not a projection. `fact_objects[].data.importance_rank` now
 * READS PLoT's one canonical rank, so the facts path and
 * `driver_order.ranked_factor_ids` cannot diverge if anything upstream ever
 * emits the array in a different order from the rank it publishes.
 *
 * ⚠ The `?? idx + 1` fallback is retained deliberately and is NOT a second
 * ranking: `importance_rank` is optional on `FactorSensitivityResultV3`, and the
 * only order available when it is absent is the producer's own emitted order —
 * the same array. It never introduces a quantity the canonical order was not
 * made on.
 *
 * ⚠ Extracted from the inline `islInput` literal specifically so the claim is
 * CHECKABLE: with position and rank always equal on live payloads, no
 * end-to-end fixture can distinguish the two derivations. The separating input
 * lives in `tests/driver-surface-projection.unit.test.ts`.
 *
 * Also unchanged from family-4 slice 0, and load-bearing: `sensitivity_score`
 * forwards the REAL `sensitivity_score` (not `elasticity`, which was published
 * under this name at −0.175 vs +0.497 on one response), with no `?? 0` — absent
 * means "unavailable", NOT "least important".
 */
export function mapFactorSensitivityToFactsInput(
  factorSensitivity: ReadonlyArray<FactorSensitivityResultV3> | undefined,
): FactorSensitivityInput[] | undefined {
  return factorSensitivity?.map((fs, idx) => ({
    node_id: fs.factor_id,
    label: fs.factor_label ?? undefined,
    sensitivity_score: fs.sensitivity_score,
    importance_rank: fs.importance_rank ?? idx + 1,
    elasticity: fs.elasticity,
    direction: fs.direction === 'unknown' ? undefined : fs.direction,
    confidence: fs.confidence,
    attribution_stability: fs.attribution_stability,
  }));
}

export function computeNearTie(
  optionComparison: Array<{ option_id: string; win_probability?: number; status?: string }> | undefined
): NearTieInfoV3 | undefined {
  if (!optionComparison || optionComparison.length === 0) {
    return undefined;
  }

  // Filter via the SHARED candidate predicate (status 'computed' + finite win_probability)
  const validOptions = optionComparison.filter(isCrownableCandidate);

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
 * Codex F2: candidacy uses the SAME predicate as computeNearTie
 * (isCrownableCandidate) — an option whose ISL status is not 'computed'
 * (errored/skipped) is never crowned, exactly as it is never counted in a
 * near-tie. When NO option qualifies the function returns undefined (the
 * existing no-valid-candidates result), same as the no-finite-win_probability
 * path.
 *
 * @param optionComparison Array of option comparison results with win_probability
 * @param options Original options array for label lookup
 * @returns Recommended option ID and label, or undefined if no valid winner
 *
 * @public Exported for unit testing
 */
export function deriveRecommendedOption(
  optionComparison: Array<{ option_id: string; option_label?: string; win_probability?: number; status?: string }> | undefined,
  options: OptionV3[] | undefined
): { recommended_option_id: string; recommended_option_label: string } | undefined {
  if (!optionComparison || optionComparison.length === 0) {
    return undefined;
  }

  // Filter via the SHARED candidate predicate (status 'computed' + finite win_probability)
  const validOptions = optionComparison.filter(isCrownableCandidate);

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

/**
 * Producer-owned constraint trust marker (A3, ruling
 * A3-DOCTRINE-DECISIONS-2026-07-21 D-2/D-5).
 *
 * Builds `scale_provenance` per ACTIVE constraint from the SAME #239 machinery
 * the range-unify fix produced — the constraint normalisation diagnostics
 * (`range.source`, per-constraint), the F2a threshold-clamp map, the per-node
 * intervention scale, and the producer-declared metadata (goal_threshold_cap /
 * '%' unit). No parallel structure; no new suppression (D-5) — this only
 * discloses.
 *
 * `decision_grade` is a WHITELIST membership, NOT a blacklist (adversarial-round
 * F-A1 amendment, on Paul's delegation to A3). Only a source in
 * `DECISION_GRADE_SOURCES` — AND a unified range, AND no threshold clamp — earns
 * the trust bit. Whitelist-not-blacklist is deliberate: any source not listed
 * (incl. `inferred_value`, `default`, `inferred_baseline`, `extracted`, and ANY
 * FUTURE `RangeSource` member) FAILS CLOSED until deliberately promoted here.
 * That is derive-don't-mirror applied to the TRUST direction — a new range
 * source cannot silently inherit decision-grade by omission.
 *
 * Member vocabulary:
 *   - inferred_spread  — a MEASURED intervention spread; the threshold shares the
 *                        samples' own scale (D-2 sameness). Grade-worthy only when
 *                        range_unified (a producer declaration it overrode with a
 *                        NUMERICALLY DIFFERENT scale makes range_unified false ⇒
 *                        fails the AND, correctly; an equal-bounds producer scale
 *                        is the SAME scale ⇒ still unified, A3 R1).
 *   - explicit         — a node-level `state_space.range` declaration.
 *   - explicit_cap     — a node-level `observed_state.cap` declaration.
 *   - goal_threshold_cap / unit_percent — the constraint's own producer scale.
 *
 * WHY the earlier OR-disjunct was dropped: the frozen derivation graded TRUE on
 * `(range_unified OR producer-declared-source)`. That OR-disjunct was proven
 * (MARKER-ADVERSARIAL.md F-A1, truth table) to be decision-relevant in EXACTLY
 * ONE cell — the WRONG-TRUE cell: a node-level `explicit`/`explicit_cap` range
 * inherited via the ladder's branch-1 adoption while the constraint's own
 * producer declaration ('%'/goal_threshold_cap) was overridden. There
 * range_unified is (correctly) FALSE yet the disjunct re-granted TRUE on the
 * inherited producer source, certifying a catastrophically mis-scaled threshold.
 * Requiring `range_unified AND source ∈ DECISION_GRADE_SOURCES` kills that cell
 * and (per the table) changes NO other cell's verdict.
 *
 * NOTE: the `RangeSource` vocabulary has no literal `state_space` member —
 * `deriveRange` emits `'explicit'` for a `state_space.range` declaration (and
 * `'explicit_cap'` for `observed_state.cap`), so the spec's `state_space` is read
 * as its vocab string `'explicit'`. `inferred_baseline` and `extracted` are
 * EXCLUDED pending Neil (MARKER-ADVERSARIAL.md O-2 — one-line promotions if
 * ratified). The frozen field shapes are unaffected; this is the internal
 * decision-grade source membership only.
 *
 * A3 R1 (range_unified is PROJECTED, not re-derived): the scale-unity decision is
 * made once, at ladder-decision time in `normaliseGoalConstraints` (which holds
 * BOTH the resolved range and the node's intervention scale), recorded on the
 * per-constraint diagnostic, and threaded here as `rangeUnifiedByCid`. Divergence
 * is a NUMERIC inequality (a measured spread adopted as the threshold scale while
 * a producer declared a DIFFERENT scale) — equal bounds are the SAME scale, so an
 * intervention spread `[0,cap]` matching a producer cap `[0,cap]` is unified, not
 * diverged (the false-divergence fix). A never-normalised constraint (no
 * diagnostic) has no intervention scale ⇒ nothing to diverge from ⇒ unified.
 * `decision_grade`'s derivation (the whitelist AND) is unchanged — only its
 * `range_unified` input is now correct + projected.
 */
const DECISION_GRADE_SOURCES: ReadonlySet<RangeSource> = new Set<RangeSource>([
  'inferred_spread',
  'explicit', // = state_space.range (spec: "state_space")
  'explicit_cap',
  'goal_threshold_cap',
  'unit_percent',
]);

export function buildConstraintScaleProvenance(
  activeConstraints: GoalConstraint[],
  // Per-constraint normalisation range (carries the resolved `source`), keyed by
  // constraint_id. Undefined/absent entry ⇒ the constraint underwent NO
  // normalisation (forwarded-raw / already in [0,1], no diagnostic).
  constraintNormRanges: Map<string, NormalisationRange> | undefined,
  thresholdClampByCid: Map<string, 'low' | 'high'> | undefined,
  // A3 R1: the range-unity decision RECORDED by normaliseGoalConstraints at
  // ladder-decision time (from the SAME diagnostics as the maps above), keyed by
  // constraint_id. Present iff the constraint was normalised. This marker PROJECTS
  // it — no re-derivation of nonIdentitySpread/producerDeclaration from raw inputs
  // 700 lines away (derive-don't-mirror). See the diagnostic's `range_unified`
  // field for the numeric-equality divergence rule.
  rangeUnifiedByCid: Map<string, boolean> | undefined,
  // THE UNIT COLLISION (the goal-fit unit defect). Per-constraint, recorded by
  // normaliseGoalConstraints at ladder-decision time — the only place holding
  // BOTH the constraint's declared unit and the resolved scale — and PROJECTED
  // here, exactly as rangeUnifiedByCid is. Entry present ONLY on a genuine
  // mismatch. Absent map (never-normalised constraints) ⇒ no mismatch, which is
  // correct: nothing was scaled, so nothing collided.
  unitMismatchByCid: Map<string, ConstraintUnitMismatch> | undefined,
): Map<string, ConstraintScaleProvenance> {
  const out = new Map<string, ConstraintScaleProvenance>();
  for (const c of activeConstraints) {
    // A constraint that underwent NO normalisation (forwarded-raw / already in
    // [0,1], no range) has no derived scale — the raw user [0,1] with no
    // producer/unification evidence, disclosed conservatively as 'default'
    // (⇒ decision_grade false, fail-closed, D-5).
    const source: RangeSource = constraintNormRanges?.get(c.constraint_id)?.source ?? 'default';
    const thresholdClamp = thresholdClampByCid?.get(c.constraint_id);

    // range_unified is a PURE PROJECTION of the normalisation diagnostic (A3 R1).
    // A normalised constraint carries its recorded decision; a NEVER-normalised
    // constraint (no diagnostic ⇒ no intervention scale ⇒ nothing to diverge from)
    // is unified by construction.
    const rangeUnified = rangeUnifiedByCid?.get(c.constraint_id) ?? true;

    // THE UNIT CONJUNCT — a SECOND, SEPARABLE invariant, not a refinement of
    // the whitelist. Every existing conjunct answers "WHICH SCALE was used, and
    // was the resolution self-consistent?"; none of them asks "IS THE THRESHOLD
    // ABOUT THE SAME QUANTITY AS THAT SCALE?" — a whitelist cannot catch a
    // question it does not ask. On the witnessed capture all three original
    // conjuncts held (`explicit_cap` ∈ DECISION_GRADE_SOURCES, range_unified
    // true, no clamp) and `decision_grade: true` shipped on a `count` threshold
    // that had been divided by a `%` cap. `decision_grade` is a claim about
    // confidence; a threshold whose units were never reconciled has none.
    const unitMismatch = unitMismatchByCid?.get(c.constraint_id);

    // F-A1 whitelist derivation: range must be unified, unclamped, units
    // reconciled, AND its source must be an explicitly-trusted member. A
    // non-member (inferred_value, default, inferred_baseline, extracted, any
    // future source) fails closed.
    const decisionGrade =
      rangeUnified &&
      thresholdClamp === undefined &&
      unitMismatch === undefined &&
      DECISION_GRADE_SOURCES.has(source);

    out.set(c.constraint_id, {
      source,
      range_unified: rangeUnified,
      ...(thresholdClamp !== undefined && { threshold_clamped: thresholdClamp }),
      ...(unitMismatch !== undefined && { unit_mismatch: unitMismatch }),
      decision_grade: decisionGrade,
    });
  }
  return out;
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
  logger?: { warn: (obj: object, msg?: string) => void },
  // A3 trust marker: per-constraint scale provenance to attach to each
  // constraint_result. Additive; keyed by constraint_id.
  scaleProvenanceByConstraintId?: Map<string, ConstraintScaleProvenance>,
  // A3 adjacent-hunt FIX #1: the node ids where the auto-constraint's guessed
  // '>=' direction was found structurally unsatisfiable for at least one option
  // (isAutoConstraintDirectionSuspect fired — see the per-option gate in
  // buildResponse, which withholds probability_of_joint_goal /
  // constraint_probabilities and populates this set). The top-level block below
  // must withhold on the SAME suspicion; otherwise it re-emits the near-0
  // prob_satisfied the per-option gate suppressed, under a fabricated
  // 'computed'. Symmetric with suppressedConstraintTargets.
  directionSuspectNodeIds?: ReadonlySet<string>
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
    // present with zero evaluated constraints). Honesty (Codex round-4): an
    // explicit upstream option failure reaches HERE — no constraint-bearing
    // option was found by the length>0 lookup above, which would otherwise hide
    // the failure as 'unavailable'. Distinguish it and surface 'error' instead.
    //
    // ⚠ ROADMAP 2.744 — THIS COMMENT USED TO ASSERT A WIRE THAT DOES NOT EXIST.
    // It read "the COMMON ISL error shape is status:'error'". ISL's per-option
    // status is Literal["computed","partial","failed"]; 'error' is an
    // ENVELOPE-level value (and one of PLoT's own egress PerFeatureStatus
    // values). So this guard tested for something the producer cannot emit and
    // was PERMANENTLY FALSE — every genuine upstream failure was reported as
    // the softer 'unavailable', which reads as "nothing to say" rather than
    // "the upstream broke". A dead guard that read as protection.
    //
    // WHY `failed` AND NOT `partial` (derived from the producer, not chosen):
    // ISL's determine_option_status(n_valid, n_total) in
    // src/utils/response_builder.py returns 'failed' ONLY when n_valid === 0 —
    // no finite Monte Carlo samples at all, so no constraint probability could
    // have been computed. 'partial' means 0 < ratio < 0.8: samples DO exist,
    // ISL computes constraint probabilities from them and raises
    // LOW_EFFECTIVE_SAMPLES as a disclosure. Treating 'partial' as an error
    // here would blame the option for an absence it did not cause.
    const hasOptionError = Array.isArray(islOptionData)
      && islOptionData.some((r: any) => isFailedIslOption(r));
    return { constraints_status: hasOptionError ? 'error' : 'unavailable' };
  }

  // Honesty (Codex round-2): also surface 'error' for the rarer shape where the
  // constraint-bearing option itself FAILED (it has a constraint payload but its
  // own analysis produced zero valid samples, so those probabilities rest on
  // nothing). The common no-payload shape is handled in the branch above.
  // ('error' is an existing ConstraintFeatureStatus.)
  //
  // Same producer-derived distinction as above: a 'partial' option's constraint
  // payload is REAL — computed from the samples that were valid — so it is
  // served normally rather than discarded. (2.744: was `=== 'error'`, dead.)
  if (isFailedIslOption(firstOptionWithConstraints)) {
    return { constraints_status: 'error' };
  }

  const analysis = firstOptionWithConstraints.constraint_analysis;
  const islConstraints: ISLConstraintResult[] = analysis.constraints ?? [];

  // F5 disclosure (ruling D-4): the top-level constraint block derives from the
  // FIRST option carrying a non-empty constraint_analysis (found above). Name
  // that option on every emitted result so the first-option derivation is honest
  // and labelled, not silent. Additive; keep the derivation, disclose it.
  const derivedFromOptionId: string | undefined =
    firstOptionWithConstraints.option_id ?? firstOptionWithConstraints.id;

  // Resolve ISL response ordinal → constraint_id. Contract step-2 slice 6b:
  // ISL now ECHOES constraint_id (deployed @0316098b), so the ratified identity
  // is read straight off the result and the positional reconstruction below it
  // is only a fallback for the overlap window. Value-based matching is never
  // used: ISL echoes NORMALISED values while goalConstraints holds raw
  // user-unit ones. Ladder + the measured wire shape: constraint-identity.ts.
  const islIndexToConstraintId: string[] = resolveConstraintIds(islConstraints, goalConstraints);
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
    const scaleProvenance = scaleProvenanceByConstraintId?.get(constraintId);
    return {
      constraint_id: constraintId,
      node_id: c.node_id,
      operator: c.operator as '>=' | '<=',
      value: originalConstraint?.value ?? islValue,
      probability: c.prob_satisfied,
      // F5 disclosure (D-4): the option this result was derived from.
      ...(derivedFromOptionId !== undefined && { option_id: derivedFromOptionId }),
      // A3 trust marker (additive): disclose how this threshold's scale was
      // resolved so consumers can gate on trust (D-2/D-5).
      ...(scaleProvenance !== undefined && { scale_provenance: scaleProvenance }),
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
    // Absence test must be NULL-AWARE. ISL sends `failure_margin_median: null`
    // / `near_miss_fraction: null` (measured — see ISLConstraintResult), and
    // `null === undefined` is false, so an all-absent row used to survive this
    // guard and emit with a fabricated `binding: false`.
    if (c.failure_margin_median == null && c.near_miss_fraction == null && c.binding === undefined) {
      return [];
    }
    const constraintId = resolveConstraintId(c, idx);
    // Absent ≠ zero — and on this wire "absent" is spelled `null`, not
    // `undefined`. VALIDATE BEFORE DENORMALISING: the guard used to run AFTER
    // the multiply, so `null * rangeWidth` had already collapsed to 0 and
    // nonNeg(0) then blessed it as a measured zero-margin breach. nonNeg()
    // rejects null/undefined/NaN/±Infinity/negatives up front, so only a real
    // measurement ever reaches the arithmetic.
    let failureMarginMedian = nonNeg(c.failure_margin_median);

    if (failureMarginMedian !== undefined && constraintNormRanges) {
      const range = constraintNormRanges.get(constraintId);
      if (range) {
        const rangeWidth = range.max - range.min;
        if (rangeWidth > 0) {
          failureMarginMedian = failureMarginMedian * rangeWidth;
        }
      }
    }

    // Numeric-egress guard (tightened by Codex F5): a PRESENT-but-invalid
    // margin/near-miss is dropped to undefined; genuine absence stays honest
    // omission. failure_margin_median is a breach DISTANCE — it must be a
    // finite non-negative real (a negative value is upstream garbage, and a
    // NaN/±Infinity would serialise to a fabricated `null`);
    // near_miss_fraction is a rate in [0,1]. Same bounds as the per-option
    // constraint_margins path. The fields are optional on
    // ConstraintDiagnostic, so a spread omits them when undefined.
    //
    // near_miss_fraction was never exposed to the null defect: prob01() runs
    // BEFORE any arithmetic touches it, and prob01 rejects null. That ordering
    // is now what the margin does too — this second nonNeg only re-checks the
    // DENORMALISED product (a finite × finite can still overflow to Infinity).
    const nearMissFraction = prob01(c.near_miss_fraction);
    failureMarginMedian = nonNeg(failureMarginMedian);
    return [{
      constraint_id: constraintId,
      ...(failureMarginMedian !== undefined && { failure_margin_median: failureMarginMedian }),
      ...(nearMissFraction !== undefined && { near_miss_fraction: nearMissFraction }),
      binding: c.binding ?? false,
    }];
  });

  // Map ISL conditional probabilities (index-based → constraint_id-based)
  let conditionalProbabilities: ConditionalProbability[] | undefined;
  if (Array.isArray(analysis.conditional_probabilities) && analysis.conditional_probabilities.length > 0) {
    conditionalProbabilities = analysis.conditional_probabilities
      .filter((cp: any) =>
        // A3 adjacent-hunt FIX #3 (crash hardening): an ISL index must be a
        // valid array position for BOTH legs. The prior `< length` check alone
        // let a negative or fractional index through — `islConstraints[idx]`
        // was then `undefined` and `resolveConstraintId(undefined, idx)` threw,
        // 500-ing (degrading to analysis_status:'failed') the whole /v2/run
        // instead of dropping the one bad row. Require a non-negative integer
        // in [0, length) — a bad row is DROPPED (honest omission), consistent
        // with this file's untrusted-ISL numeric-egress posture.
        Number.isInteger(cp.given_constraint_index) &&
        cp.given_constraint_index >= 0 &&
        cp.given_constraint_index < islConstraints.length &&
        Number.isInteger(cp.target_constraint_index) &&
        cp.target_constraint_index >= 0 &&
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

  // A3 adjacent-hunt FIX #1 (honesty leak): mirror the suppressed-target gate
  // above for the DIRECTION-SUSPECT partition. The per-option gate already
  // withholds probability_of_joint_goal / constraint_probabilities when the
  // auto-constraint's guessed '>=' is structurally unsatisfiable (positive
  // threshold, strictly-negative modelled outcome) — but this top-level block
  // otherwise re-emits the SAME near-0 prob_satisfied under 'computed', leaking
  // the exact number the per-option path suppressed. A direction-suspect run can
  // have an EMPTY suppressed partition (decision-grade target: real base +
  // non-default range), so the earlier gate does not cover it. Withhold the
  // whole block when any FORWARDED constraint targets a direction-suspect node —
  // absence is honest; the WARNING-severity CONSTRAINT_DIRECTION_SUSPECT (emitted
  // by the per-option path) explains why. Raw values stay in the diagnostics log.
  if (
    directionSuspectNodeIds &&
    directionSuspectNodeIds.size > 0 &&
    goalConstraints.some((gc) => directionSuspectNodeIds.has(gc.node_id))
  ) {
    logger?.warn({
      event: 'constraint_results_suppressed',
      reason: 'direction_suspect',
      raw_constraint_results: constraintResults,
      raw_constraint_diagnostics: constraintDiagnostics,
      raw_conditional_probabilities: conditionalProbabilities,
      direction_suspect_node_ids: [...directionSuspectNodeIds],
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
 * `approximate` (sub-item 2) = the run produced USABLE results that are
 * degraded/rough. ONLY `partial` qualifies (options usable, some secondary
 * feature degraded). `computed` is clean; `failed`/`blocked` carry NO usable
 * answer (a `failed` body is emitted on 200, e.g. the ISL-disabled path), so an
 * "approximate results" signal must NOT cover them or it inverts the meaning.
 * Single-sourced from analysis_status (derive-don't-mirror). Exported so a unit
 * test pins all four states (mutation-checkable — the earlier `!== 'computed'`
 * formula wrongly folded failed/blocked into true).
 */
export function isApproximateAnalysis(status: TopLevelAnalysisStatus): boolean {
  return status === 'partial';
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
  logger?: { info: (obj: object, msg?: string) => void; warn: (obj: object, msg?: string) => void },
  // Sub-item 1d + Codex F1 (a): per-option clamp DIRECTION map
  // Map<optionId, Map<factorId, 'high' | 'low'>> derived from the RECORDED
  // NormalisationDiagnostics (NOT recomputed from the already-normalised
  // per-option interventions, which always read "not clamped"). An entry is
  // present ONLY when the intervention clamped; the direction comes from the
  // recorded normalised_value (>= 1 → 'high', <= 0 → 'low'). Feeds
  // constraint_margins margin_precision.
  optionClampDirectionByFactor?: Map<string, Map<string, 'high' | 'low'>>,
  // Codex F1 (c) companion: which factors carry a normalisation diagnostic at
  // all, per option. The direction map alone cannot distinguish "diagnosed
  // and not clamped" (margin is exact) from "never diagnosed" (clamp state
  // unknown → no precision claim may be made).
  optionDiagnosedFactors?: Map<string, Set<string>>,
  // A3 trust marker: per-constraint scale provenance (keyed by constraint_id).
  // Feeds BOTH the top-level constraint_results[].scale_provenance and the
  // per-option constraints_decision_grade aggregate below. Also the sole source
  // of the Codex F2a per-constraint THRESHOLD clamp direction: each entry's
  // `threshold_clamped` ('low' = clamped at the range floor, 'high' = at the
  // ceiling; absent = threshold sat inside the range) is read at the
  // constraint_margins margin_precision site below — independent of the
  // per-option intervention clamp (a threshold can clamp while every
  // intervention sits inside the range: the response-1 defect).
  constraintScaleProvenanceByConstraintId?: Map<string, ConstraintScaleProvenance>,
  // L63: the producer's per-node `goal_threshold_frame` stamps, read off the RAW
  // upstream nodes (the canonical EngineNodeV3 drops them, so `graph` above
  // cannot carry them). Appended rather than inserted for the same reason 2.258
  // gave: the call sites pass these positionally. Feeds the ONE limb of the
  // sample-frame gate that a producer can open — an attested 'delta' target.
  goalThresholdFrameByNodeId?: ReadonlyMap<string, string>
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
  //
  // L63 (the constraint SAMPLE-FRAME hole): a SECOND, DERIVED detection runs
  // beside the ISL-warning-driven one above. The detector above reads ISL's
  // emitted CONSTRAINT_NODE_DEFAULT_BASE list — it mirrors an upstream list and
  // inherits its gaps. This one is computed from the graph and options PLoT is
  // sending on THIS request, and asks the question that actually decides
  // whether the comparison is well-posed: do the target node's samples carry an
  // absolute anchor at all? A non-root, un-pinned target's samples are
  // `intercept + SUM(parent * strength)` with base 0.0 — anchored to nothing —
  // so no absolute threshold can be compared against them, and the near-zero
  // that comes back is arithmetic, not a finding. Derivation + the measured
  // 2.286 counter-example: src/lib/constraint-reliability.ts.
  //
  // THE UNIT COLLISION: a THIRD, DERIVED detection, and neither sibling can
  // reach it. The witnessed capture (`l60-artefacts/scenario-people.json` +
  // `runfact-7fe412ba-run3.json`) sent `risk_ae_attrition <= 2` with unit
  // 'count' against `observed_state {cap: 100, unit: '%'}` — PLoT normalised
  // 2/100 = 0.02, turning "lose at most 2 account executives" into "attrition at
  // or below 2%". The scale source was `explicit_cap`, a real producer
  // declaration, so `threshold_normalisation_defaulted` never fires; and the
  // L63 anchor limb `root_observed_level` PROVES a frame for any root target
  // carrying an observed value while proving nothing about the unit, so the
  // sample-frame gate does not close it either. This one asks the question they
  // do not: is the threshold about the SAME QUANTITY as the scale it was
  // divided by? Derivation: `lib/constraint-units.ts`.
  const unreliableConstraintTargets = mergeUnreliableConstraintTargets(
    detectUnreliableConstraintTargets(goalConstraints, constraintNormRanges, islResult),
    detectUnanchoredSampleFrameTargets(
      goalConstraints,
      graph?.nodes,
      collectDirectedEdgeTargets(graph?.edges),
      options,
      goalThresholdFrameByNodeId,
    ),
    detectUnitMismatchedConstraintTargets(
      goalConstraints,
      constraintScaleProvenanceByConstraintId,
    ),
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
  // Loop-invariant: the active constraint ids (the scale-provenance map's keys)
  // do NOT vary per option — materialise once rather than per .map iteration.
  const activeConstraintIds = constraintScaleProvenanceByConstraintId
    ? [...constraintScaleProvenanceByConstraintId.keys()]
    : undefined;
  const optionComparison = islOptionData?.map((r: any) => {
    const optionId = r.option_id ?? r.id;
    const option = options?.find((o) => o.id === optionId);

    // ISL V2 returns outcome as nested object; V1 returns flat fields
    const outcomeData = r.outcome;
    const hasOutcomeObject = outcomeData && typeof outcomeData === 'object';

    // Build full outcome stats from ISL V2 format. Numeric-safety guard (WP5):
    // EVERY stat is validated INDIVIDUALLY and an invalid one is OMITTED — a
    // NaN/±Infinity/null would otherwise serialise to a fabricated `null` on a
    // declared-number field. `Number.isFinite` is false for non-numbers too, so
    // this also drops missing/garbage values. Keys are inserted in the original
    // order so a fully-finite outcome serialises byte-identically apart from the
    // appended provenance key; `response_hash` canonicalises the REQUEST and is
    // unaffected either way.
    //
    // ⚠ 2.581: this used to be ALL-OR-NOTHING — a single non-finite required stat
    // deleted the WHOLE outcome object. That threw away the very fields that
    // EXPLAIN the degeneracy. On ISL's degenerate run (`OutcomeDistributionV2`
    // with `percentiles_source: 'unavailable'`) `mean`/`std` are absent and
    // p10/p50/p90 are null, but `n_samples`, `n_valid_samples` and
    // `validity_ratio` are REQUIRED fields at the producer and are present and
    // honest — `n_valid_samples: 0`, `validity_ratio: 0.0` is a MEASUREMENT that
    // says "we sampled and got nothing usable". Deleting it left the option
    // indistinguishable from one that was never analysed at all. The block is now
    // carried PARTIALLY: what is honest survives, what was not measured stays
    // ABSENT — never `0`, never `null`. (A fabricated 0 `mean` does not read as
    // "unknown", it reads as "this option is worth nothing".)
    // Typed as OutcomeStatsV3 rather than a loose Record so the appended string
    // provenance key cannot silently widen the numeric stats at their read sites
    // (the first draft used `Record<string, number | string>` and the typecheck
    // correctly rejected `outcome?.p90` being handed to a number-only guard).
    let outcome: OutcomeStatsV3 | undefined;
    if (hasOutcomeObject) {
      // mean/p10/p50/p90 are outcome magnitudes (unbounded) → finite-only.
      // Optional stats carry their true domains: std non-negative, sample counts
      // non-negative integers, validity_ratio a [0,1] rate.
      const built: OutcomeStatsV3 = {};
      const meanVal = finiteNum(outcomeData.mean);
      if (meanVal !== undefined) built.mean = meanVal;
      const stdVal = nonNeg(outcomeData.std);
      if (stdVal !== undefined) built.std = stdVal;
      const p10Val = finiteNum(outcomeData.p10);
      if (p10Val !== undefined) built.p10 = p10Val;
      const p50Val = finiteNum(outcomeData.p50);
      if (p50Val !== undefined) built.p50 = p50Val;
      const p90Val = finiteNum(outcomeData.p90);
      if (p90Val !== undefined) built.p90 = p90Val;
      const nSamplesVal = nonNegInt(outcomeData.n_samples);
      if (nSamplesVal !== undefined) built.n_samples = nSamplesVal;
      const nValidVal = nonNegInt(outcomeData.n_valid_samples);
      if (nValidVal !== undefined) built.n_valid_samples = nValidVal;
      const validityVal = prob01(outcomeData.validity_ratio);
      if (validityVal !== undefined) built.validity_ratio = validityVal;
      // 2.581 — PERCENTILES PROVENANCE, appended last (ISL's own declaration
      // order on OutcomeDistributionV2). This is the discriminator that
      // separates "ISL had no usable sample population" from "ISL had samples
      // but a tail statistic was not finite": without it both present downstream
      // as a missing `downside` and nothing else.
      //
      // NEVER DEFAULTED. ISL declares `Literal["samples","unavailable"]` with a
      // Python-side `default="samples"`, so a V2 wire always carries it — but
      // PLoT must not re-apply that default. Substituting 'samples' for a build
      // that sent nothing would manufacture a provenance claim PLoT never
      // received, which is the `?? 0` fabrication class wearing a string. An
      // absent or out-of-domain value leaves the key ABSENT.
      const percentilesSource = outcomeData.percentiles_source;
      if (percentilesSource === 'samples' || percentilesSource === 'unavailable') {
        built.percentiles_source = percentilesSource;
      }
      // An outcome with nothing honest in it is not an outcome: emit no key
      // rather than an empty object a consumer could mistake for a result.
      if (Object.keys(built).length > 0) outcome = built;
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

    // 2.449 — DOWNSIDE / TAIL-RISK passthrough. ISL has emitted
    // `options[].downside{cvar_10, p05, expected_regret}` since #91/#92, and
    // this builder — an explicit field selection — was where it died, one hop
    // after the engine that computed it and three hops before any user could
    // ask "and if this goes badly, how badly?". Additive and faithful:
    // present-in ⇒ present-out verbatim, absent ⇒ key omitted (every existing
    // golden byte-identical), and a component ISL could not compute honestly
    // omits the WHOLE block rather than fabricating a zero — see buildDownside.
    //
    // Gated on the PERCENTILE POPULATION because ISL enforces `downside ⟹
    // outcome.percentiles_source == 'samples'`: a tail statistic that outlived
    // the distribution it is the tail OF would be unreadable.
    //
    // ⚠ 2.581: this gate read `outcome !== undefined`, which was equivalent ONLY
    // because a degraded outcome was deleted entirely. Now that a partial
    // outcome IS emitted, that form would have silently let a downside ride
    // alongside a block with no percentiles at all — the partial-carry change
    // loosening a guard it never mentioned. Binding to
    // `hasAllRequiredOutcomeStats` restores the producer's own invariant and
    // keeps downside behaviour byte-identical to before this change.
    const downside = hasAllRequiredOutcomeStats(outcomeData)
      ? buildDownside(r.downside)
      : undefined;
    if (downside !== undefined) {
      result.downside = downside;
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

      // Map ISL's per-constraint prob_satisfied to constraint_probabilities map.
      // Same resolver as buildConstraintFields (slice 6b): ISL's echoed
      // constraint_id first, positional reconstruction only as the overlap
      // fallback. Both sites MUST share one implementation — a response whose
      // top-level block is keyed by ratified id while these per-option blocks
      // are keyed by ordinal would be internally inconsistent.
      let constraintProbs: Record<string, number> | undefined;
      // Sub-item 1c: per-option graded breach margins. One entry per constraint
      // ISL evaluated for THIS option; margin fields are OMITTED (never
      // fabricated as 0) when ISL sent none — so a satisfying option carries a
      // bare entry while a breaching option carries its (denormalised) margin.
      // A missing margin is therefore DISTINGUISHABLE from a measured zero.
      let constraintMargins: ConstraintMargin[] | undefined;
      if (Array.isArray(constraintAnalysis.constraints) && constraintAnalysis.constraints.length > 0) {
        constraintProbs = {};
        const islConstraintsHere = constraintAnalysis.constraints as ISLConstraintResult[];
        const indexToId: string[] = resolveConstraintIds(islConstraintsHere, goalConstraints);
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
        // Build the per-option margin entries alongside the probabilities,
        // reusing the same index→constraint_id resolver.
        constraintMargins = islConstraintsHere.map((c, i) => {
          const cid = indexToId[i] ?? `${c.node_id}_${c.operator}`;
          // Denormalise the failure margin (a distance) back to user units by
          // the constraint's range width — same convention as the top-level
          // constraint_diagnostics path. Denormalisation stays gated on the
          // recorded ranges; clamp-precision (below) deliberately does NOT
          // (Codex F1: the ranges map is absent whenever the constraint value
          // was already in [0,1], but the intervention can still have clamped).
          // VALIDATE BEFORE DENORMALISING — identical ordering fix to the
          // top-level constraint_diagnostics path above. ISL sends `null` for
          // an absent margin; the old `!== undefined` guard let it through and
          // `null * rangeWidth` became a fabricated measured 0, which then also
          // unlocked the margin_precision block below and shipped a precision
          // claim ('exact') about a margin that was never computed.
          let fmm = nonNeg(c.failure_margin_median);
          if (fmm !== undefined && constraintNormRanges) {
            const range = constraintNormRanges.get(cid);
            if (range) {
              const rangeWidth = range.max - range.min;
              if (rangeWidth > 0) {
                fmm = fmm * rangeWidth;
              }
            }
          }
          // Codex F5 trust boundary: a breach DISTANCE must be a finite
          // non-negative real (negative = upstream garbage; non-finite would
          // serialise to a fabricated `null`), and near_miss_fraction is a
          // rate in [0,1]. Invalid present values drop to honest absence.
          fmm = nonNeg(fmm);
          const nmf = prob01(c.near_miss_fraction);
          const entry: ConstraintMargin = { constraint_id: cid };
          if (fmm !== undefined) {
            entry.failure_margin_median = fmm;
            // Codex F1 (b)+(c) + F2a: consult BOTH recorded clamp states — the
            // per-option INTERVENTION clamp (a clamped sample) and the
            // constraint THRESHOLD clamp (a threshold pushed outside the shared
            // range) — independently of constraintNormRanges, and only claim
            // what the evidence supports. The truth table over
            // {operator, interventionClamp, thresholdClamp, diagnosed} and its
            // understatement/overstatement case analysis + precedence live in
            // deriveMarginPrecision (src/trust/margin-precision.ts).
            const clampDir = optionClampDirectionByFactor?.get(optionId)?.get(c.node_id);
            const hasDiagnostic = optionDiagnosedFactors?.get(optionId)?.has(c.node_id) ?? false;
            // F2a threshold-clamp direction, derived from the scale-provenance map
            // (its `threshold_clamped` is built from the SAME F2a clamp map, so
            // this is byte-identical to the former dedicated param).
            const thresholdClamp = constraintScaleProvenanceByConstraintId?.get(cid)?.threshold_clamped;

            const mp = deriveMarginPrecision({
              operator: c.operator,
              interventionClamp: clampDir,
              thresholdClamp,
              diagnosed: hasDiagnostic,
            });
            if (mp !== undefined) {
              entry.margin_precision = mp;
            }
          }
          if (nmf !== undefined) {
            entry.near_miss_fraction = nmf;
          }
          return entry;
        });
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
        // A3 trust marker: constraints_decision_grade for this option.
        //   - Zero participating ⇒ field ABSENT (fail-closed — never a vacuous
        //     true).
        //   - FULL participation (every ACTIVE constraint present in this
        //     option's constraint_probabilities) ⇒ AND over their decision_grade.
        //   - PARTIAL participation (F-A2 amendment): the option's participating
        //     set is a PROPER SUBSET of the active set — ISL dropped a constraint,
        //     or the prob01 guard removed a NaN'd one. A MISSING verdict is itself
        //     a trust failure: a dropped FAILING constraint must NOT let the
        //     aggregate read clean, so emit `false` rather than ANDing over the
        //     survivors. (Run-level honesty suppression is orthogonal — it removes
        //     constraint_probabilities for EVERY option, so the aggregate goes
        //     absent, not partial.)
        // A participating constraint with no provenance entry is still treated
        // non-decision-grade by the `=== true` check.
        if (result.constraint_probabilities && constraintScaleProvenanceByConstraintId) {
          const probs = result.constraint_probabilities;
          const participating = Object.keys(probs);
          if (participating.length > 0) {
            const coversAllActiveConstraints = (activeConstraintIds ?? []).every((cid) => cid in probs);
            result.constraints_decision_grade =
              coversAllActiveConstraints &&
              participating.every(
                (cid) => constraintScaleProvenanceByConstraintId.get(cid)?.decision_grade === true,
              );
          }
        }
        // Sub-item 1c: attach the per-option graded breach margins under the
        // SAME honesty gate as the probabilities (never on a suppressed /
        // direction-suspect target). Absent-margin entries are still carried
        // (missing ≠ zero) with their margin fields omitted.
        if (constraintMargins !== undefined && constraintMargins.length > 0) {
          result.constraint_margins = constraintMargins;
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

  // ── Family-4 S1: the ONE canonical driver order + its attestation ────────
  //
  // Built HERE, at the single emission point, from the SAME `factorSensitivity`
  // binding the response publishes — so `ranked_factor_ids` cannot describe a
  // different array from the one on the wire, and so the object is emitted on
  // EVERY path that emits `factor_sensitivity`, not only inside the ISL branch.
  // (The existing per-row `importance_basis` is emitted only inside that branch,
  // which is precisely why its absence is ambiguous today — old payload,
  // non-ISL branch, or dropped key are indistinguishable.)
  //
  // Every input falls back to a value derivable HERE, so the pre-computed
  // `sensitivityData` path and the raw-ISL fallback path attest identically:
  //   · lever identity ← `interventionTargetIdsFromOptions(options)`, the ONE
  //     canonical D-U source, same call the pre-compute makes;
  //   · basis ← the pre-computed source; on the RAW-ISL FALLBACK path (no
  //     `sensitivityData` at all) `factorSensitivity` is
  //     `transformFactorSensitivity(islResult.factor_sensitivity)`, i.e. ISL's
  //     own rows untouched by the graph merge, so `'isl'` is a DERIVED fact
  //     about that branch and not a default (S1 review LOW: the member is now
  //     required on `SensitivityData`, so this branch is the only place the
  //     value can be absent);
  //   · ISL's own suppression disclosure ← read defensively off `islResult`.
  const driverOrder = buildDriverOrder({
    factors: factorSensitivity,
    structuralLeverIds:
      sensitivityData?.structuralLeverIds ?? interventionTargetIdsFromOptions(options),
    factorSensitivitySource:
      sensitivityData === undefined ? 'isl' : sensitivityData.factorSensitivitySource,
    islSuppressedAttributions:
      sensitivityData?.islSuppressedAttributions ?? readIslSuppressedAttributions(islResult),
  });

  // Fallback transforms for edge_e_values and conditional_winners when sensitivityData not pre-computed.
  // Edge E-values are NESTED at robustness.edge_e_values on the V2 wire (the
  // former top-level read was structurally dead) — read via the accessor.
  const edgeEValues = sensitivityData?.edgeEValues
    ?? transformEdgeEValues(getIslEdgeEValues(islResult), fallbackNodeLabelMap);
  const conditionalWinners = sensitivityData?.conditionalWinners
    ?? transformConditionalWinners(islResult?.conditional_winners, fallbackNodeLabelMap, fallbackOptionLabelMap);

  // ROADMAP 2.720 (P4). Read through the envelope accessor, which fixes the
  // wire LOCATION in one place and degrades a non-array to absent. Forwarded
  // VERBATIM — no transform, no relabelling, and above all no substitution of a
  // default for a refused fit: ISL's refusal is TYPED and carries the reason,
  // and inventing a distribution where it refused would be a fabricated value
  // wearing real provenance.
  const rangeFitDisclosures = getIslRangeFitDisclosures(islResult);

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

    // Sub-item 3: the `robustness.label` / `robustness.score` reads are PHANTOM —
    // RobustnessResultV2 (the raw V2 wire, islResult.robustness) has neither
    // field, so they resolved to undefined on every live response and Fastify
    // omitted the output `label`/`score` unconditionally. The dead reads are
    // removed here; wire output is byte-identical (verified). The real verdict
    // is carried by is_robust/level below and display_verdict.

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
    const enrichedFragileEdges: NormalizedEdgeInfoV3[] = fragileResult.edges.map(edge => {
      // Severity classification (B1) and the doctrine-013 producer-DISCLOSED
      // `visible` gate (> 0.15) are each a pure function of switch_probability —
      // compute ONCE. Both are emitted ONLY when switch_probability is finite —
      // omitted (spread-out) when absent/non-finite (honesty: absent ≠
      // 'warning'/false). PLoT discloses `visible` but does NOT filter the array
      // (the UI decides render).
      const severity = classifyEdgeSeverity(edge.switch_probability);
      const visible = deriveFragileEdgeVisible(edge.switch_probability);
      return {
        ...edge,
        // from_label and to_label from graph lookup, fall back to node ID if not found
        from_label: nodeLabelMap.get(edge.from_id) ?? edge.from_id,
        to_label: nodeLabelMap.get(edge.to_id) ?? edge.to_id,
        ...(severity !== undefined && { severity }),
        ...(visible !== undefined && { visible }),
        // Resolve alternative_winner_label from option ID (null when no alternative winner)
        alternative_winner_id: edge.alternative_winner_id ?? null,
        alternative_winner_label: edge.alternative_winner_id
          ? (optionLabelMap.get(edge.alternative_winner_id) ?? edge.alternative_winner_id)
          : null,
      };
    });

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
      // Sub-item 3: the phantom `score` (finiteNum(islResult.robustness.score))
      // and `label` reads are removed — RobustnessResultV2 has neither field, so
      // both were always undefined and omitted by Fastify. Wire is byte-identical.
      // Numeric-egress guard note retained for `confidence` (still guarded below).
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
      // `confidence` + its BASIS, always together (ROADMAP 1.211).
      //
      // ISL PR #114 changed what this slot means without changing its name,
      // type or range: it was min(0.99, stability * (1 - 1/sqrt(n_samples)))
      // and is now the bare recommendation-stability fraction. So the value
      // rises, becomes reachable at exactly 1.0, and — critically — a bare
      // number on the wire is ambiguous between the two quantities. The basis
      // marker is what removes that ambiguity, so it is emitted beside the
      // value rather than as an optional extra, and resolved through an
      // allow-list so an unrecognised future basis reads as 'unknown_legacy'
      // instead of being passed off as understood.
      //
      // COLLISION WORTH KNOWING ABOUT — see the DROPPED entry for
      // `robustness.recommendation_stability` in contracts/isl-to-ui.contract.ts.
      // That field is deliberately withheld above because ISL derives it as
      // option_wins[winner]/n_samples, i.e. the leader's win_probability
      // relabelled. Post-#114 `confidence` IS that same number. PLoT therefore
      // withholds the quantity under its honest name while forwarding it under
      // a name that implies calibration — which ISL's own field description now
      // denies ("NOT A CONFIDENCE LEVEL"). Disclosure, not suppression, is the
      // doctrine here (D-5) and ISL kept the slot because three repos read it,
      // so the basis marker is the fix available to this lane. Whether the slot
      // should survive at all is a cross-repo contract decision, raised
      // separately rather than settled unilaterally here.
      ...(prob01(islResult.robustness.confidence) !== undefined && {
        confidence: prob01(islResult.robustness.confidence),
        confidence_basis: resolveConfidenceBasis(islResult.robustness),
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
    // ROADMAP 2.278: the SAME run's flip evidence. `flipThresholds` is a
    // parameter of this function, so this is the array that ships on the wire
    // at `flip_thresholds` below — the verdict and the evidence it cites can
    // never be taken from two different runs.
    flipThresholds,
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
        message: buildConstraintTargetUnreliableMessage(
          nodeLabel,
          target.reasons,
          // Name the colliding units when that is the reason. The mismatch is
          // read from the SAME projected provenance the detector fired on, so
          // the message and the verdict can never disagree.
          constraintScaleProvenanceByConstraintId?.get(target.constraint_id)?.unit_mismatch,
        ),
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
  //
  // ROADMAP 2.260: the same disclosure now also covers the CONSERVATIVE
  // fallback's depth-raise cut, which previously reached the wire as silence.
  // The CODE is deliberately reused rather than minted fresh: this family's
  // transport to the response and into decision_brief.warning_codes is proven,
  // and the user-facing fact ("you got fewer samples than the standard depth")
  // is identical. Only the CAUSE differs, so only the MESSAGE branches — an
  // admission-seam failure must never be reported as a property of the caller's
  // graph, which would send them optimising a graph that is not the problem.
  if (meta.originalNSamples !== undefined && meta.originalNSamples !== meta.nSamples) {
    const reducedForSeam = meta.nSamplesReducedReason === 'admission_unavailable';
    inferenceWarnings.push({
      code: INFERENCE_WARNING_CODES.SAMPLES_REDUCED_FOR_COMPLEXITY,
      // provisional_doctrine_v0 — wording surface (diagnostic disclosure)
      message: reducedForSeam
        ? `Monte Carlo sample depth was reduced from ${meta.originalNSamples} to ${meta.nSamples} samples because the analysis engine's compute-admission capability could not be confirmed, so this run was planned conservatively. All reported results were computed at ${meta.nSamples} samples; displayed probabilities may be slightly less stable than at the standard depth. This is a service condition, not a property of your decision model — the same analysis runs at full depth once the engines agree.`
        : `Monte Carlo sample depth was reduced from ${meta.originalNSamples} to ${meta.nSamples} samples so this graph fits the analysis engine's compute-admission budget. All reported results were computed at ${meta.nSamples} samples; displayed probabilities may be slightly less stable than at the standard depth.`,
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
  // non-representability, not an alarm; still on the wire in inference_warnings).
  // NB: it is deliberately NOT in decision_brief.warning_codes — buildWarningCodes
  // (assembly/decision-brief.ts:729-737) echoes severity 'warning' only. The
  // earlier text here named `_meta.warning_codes`, a field that does not exist
  // anywhere in this repo.
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
    // Family-4 S1b: the SAME object the response publishes, so
    // decision_brief.top_drivers[0] and driver_order.ranked_factor_ids[0]
    // cannot describe different orders.
    driver_order: driverOrder,
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
      factor_sensitivity: mapFactorSensitivityToFactsInput(factorSensitivity),
      critiques: critiques?.map((c) => ({
        id: c.id ?? c.code,
        code: c.code,
        severity: c.severity,
        message: c.message ?? '',
        suggestion: c.suggestion,
        affected_option_ids: c.affected_option_ids,
        affected_node_ids: c.affected_node_ids,
      })),
      // Sub-item 3: `robustness.label`/`.score` on the OUTPUT robustness object
      // were always undefined (phantom — never populated from the V2 wire), so
      // mapRobustness already fell back to its 'moderate'/0.5 defaults. Passing
      // an empty object keeps the assembled FactObject byte-identical.
      robustness: robustness ? {} : undefined,
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
    // Sub-item 2: canonical `approximate` boolean, single-sourced from
    // analysis_status via isApproximateAnalysis (see its doc for the semantics +
    // why only 'partial' qualifies). Distinct name from the CEE-trace `degraded`.
    approximate: isApproximateAnalysis(analysisStatus),

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
      constraintScaleProvenanceByConstraintId,
      // A3 adjacent-hunt FIX #1: populated by the per-option direction-suspect
      // gate above; withholds the top-level block on the SAME suspicion.
      directionSuspectNodeIds,
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
    // Correlated-factors capability outputs (capability #100 + VOI slices
    // D-23.8): VERBATIM additive passthrough of ISL top-level envelope fields
    // (correlation_model / decision_evpi / factor_evppi / p_win_sensitivity).
    // Present-in ⇒ present-out; ABSENT ⇒ omitted (no default payload growth,
    // every existing golden byte-identical). "PLoT passthrough-forwards
    // meanwhile" (D-23.4) — the raw passthrough only; the richer outcome-unit
    // reconciliation + method-tagging is a separate gated lane (D-23.8 S5) and
    // firm wire typing rides the @talchain/schemas batch. Without this block
    // buildResponse's field-by-field rebuild would silently DROP them (the
    // transformEdgeEValues-class hazard). Excluded from response_hash (these are
    // computed enrichment; response_hash canonicalises the request). The key set
    // + emission order derive from ISL_TOPLEVEL_ENRICHMENT_KEYS so the OpenAPI
    // drift gate stays in lockstep (F9). Guard is `!== undefined` so an explicit
    // null/0/false from ISL still passes through.
    ...islEnrichmentPassthrough(islResult),
    // ⭐ ROADMAP 2.720 (pillar P4) — per-range interquartile-fit disclosures for
    // the request's `user_stated_ranges`. Additive VERBATIM passthrough, read
    // through the envelope accessor so the wire LOCATION is fixed in one place
    // (src/integrations/isl/v2-envelope.ts), inherently request-gated: ISL emits
    // the key only when ranges were stated, so absence here means "none stated"
    // and is NOT the same fact as a refused fit — a refused fit arrives as a
    // TYPED refusal inside a PRESENT row. Without this block buildResponse's
    // field-by-field rebuild would silently DROP the whole disclosure (the
    // transformEdgeEValues-class hazard), which is how a computed capability
    // ends up dark. `!== undefined` rather than truthiness so a computed-EMPTY
    // array survives — `[]` means "ranges were stated, no rows", which is a
    // different fact from absence. Excluded from response_hash (response_hash
    // canonicalises the REQUEST).
    ...(rangeFitDisclosures !== undefined && { range_fit_disclosures: rangeFitDisclosures }),
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
    // ⭐ Family-4 S1 — THE canonical driver order + attestation, emitted as a
    // top-level sibling of factor_sensitivity[] (amendment §4.3). ADDITIVE:
    // nothing above or below changed shape or meaning. Present whenever
    // factor_sensitivity is present — including empty, as basis 'none' rather
    // than omission — so absence is unambiguous. Excluded from response_hash
    // (hashRequest canonicalises the REQUEST). See src/lib/driver-order.ts.
    ...(driverOrder !== undefined && { driver_order: driverOrder }),
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
      //
      // The map is emitted WHENEVER constraints exist, INCLUDING when it is empty.
      // The two absence states are different claims and only this producer can tell
      // them apart:
      //   present + EMPTY  → the constraint machinery ran and none of the constraints
      //                      is auto-derived (they came from the request or the graph)
      //   ABSENT           → there were no constraints at all
      // Guarding the assignment on `Object.keys(sources).length > 0` collapsed those
      // two into one byte-identical silence, leaving a consumer to either fabricate a
      // provenance from that silence or fail closed on every legitimate user-constraint
      // run. Per-ENTRY absence remains the "not auto-generated" signal, and is now a
      // positive statement made inside a map that exists. Tests T11/T12,
      // tests/auto-constraint-fallback.test.ts.
      if (goalConstraints?.length) {
        const sources: Record<string, string> = {};
        for (const c of goalConstraints) {
          const internal = (c as any)._internal as InternalMetadata | undefined;
          if (internal?.source) {
            sources[c.constraint_id] = internal.source;
          }
        }
        (baseMeta as any).constraint_sources = sources;
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
  // A3 remediation item 8 / ROADMAP 1.210: sampling is PER-ARM, because the
  // guard's two arms fail in different ways.
  //
  // The schema parse is sampled (1-in-N in production, every request
  // otherwise) — its faults are deterministic properties of the code, so a
  // break still surfaces within N and CEE's shadow parse remains the
  // independent backstop.
  //
  // The stability-band sweep runs on EVERY response and is no longer gated by
  // the sampler. It validates per-response ISL DATA, so a skipped response is
  // not a detection deferred by a few requests — it is a malformed band shipped
  // undetected. At N=16 roughly 15 in 16 got through. It costs ~0.0015-0.025 ms,
  // measured; see the sampling note in enrichment-egress-guard.ts.
  //
  // The guard therefore now runs on every request, so enrichment_contract_ok is
  // always present rather than ABSENT on skipped requests. When only the band
  // arm ran, `true` means "no malformed band" and NOT "the full envelope was
  // parsed" — the narrower claim is the honest one, and `enrichment_contract_
  // schema_parsed` records which arms actually ran so a reader can tell.
  try {
    {
      const runSchemaParse = shouldAssessEnrichmentContract();
      const enrichmentAssessment = assessEnrichmentContract(response, { runSchemaParse });
      if (response._meta?.evidence) {
        response._meta.evidence.enrichment_contract_schema_parsed = runSchemaParse;
      }
      if (response._meta?.evidence) {
        response._meta.evidence.enrichment_contract_ok = enrichmentAssessment.ok;
      }
      if (!enrichmentAssessment.ok) {
        // ROADMAP 2.726 — PRESENCE-shaped violations are REFUSED, not shipped.
        // Applied BEFORE the disclosure warning and before the content hash, so
        // the hash covers the body as actually delivered and the warning can
        // name what was removed. Absence-shaped violations withhold nothing, so
        // this is a no-op on the two historical false-alarm shapes.
        const withheld = applyEnrichmentWithholding(response, enrichmentAssessment);
        if (response._meta?.evidence) {
          response._meta.evidence.enrichment_contract_withheld = withheld;
        }
        response.inference_warnings = [
          ...(response.inference_warnings ?? []),
          buildEnrichmentContractWarning(enrichmentAssessment, withheld),
        ];
        if (logger) logEnrichmentContractMismatch(logger, enrichmentAssessment, requestId);
      } else if (response._meta?.evidence) {
        response._meta.evidence.enrichment_contract_withheld = [];
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
 * Map ISL critiques to V2 critique format. ONE mapper for BOTH paths
 * (ROADMAP 2.410): the 422 branch (structured validation critiques) and the
 * 200 branch (success-body coverage disclosures such as
 * MARGINAL_SWITCH_TRUNCATED — ISL "publishes what it computed and names what
 * it did not", critique.py:357, and PLoT dropped that disclosure on every
 * successful response until this fix).
 *
 * Field fix (2.394(a)): ISL's CritiqueV2 serialises `affected_node_ids` /
 * `affected_option_ids` and has never emitted `affected_nodes` — reading
 * only the legacy name silently dropped node identity for every v2-format
 * critique. Prefer the producer's field, tolerate the legacy one.
 * ISL's deterministic critique id is carried when present (cross-service
 * identity); a local UUID is minted only when the producer sent none.
 */
function mapISLCritiquesToV2(islCritiques: Array<{
  id?: string;
  code: string;
  severity: string;
  message: string;
  suggestion?: string;
  affected_node_ids?: string[];
  affected_option_ids?: string[];
  affected_nodes?: string[];
}>): CritiqueV3[] {
  return islCritiques.map((c) => ({
    id: typeof c.id === 'string' && c.id.length > 0 ? c.id : randomUUID(),
    code: c.code,
    severity: c.severity === 'blocker' ? 'blocker' :
              c.severity === 'error' ? 'error' :
              c.severity === 'warning' ? 'warning' : 'info',
    message: c.message,
    suggestion: c.suggestion,
    source: 'isl' as const,
    affected_node_ids: c.affected_node_ids ?? c.affected_nodes,
    ...(c.affected_option_ids ? { affected_option_ids: c.affected_option_ids } : {}),
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
      //
      // ROADMAP 2.510: this MUST go through adoptResolvedRequestId, which moves
      // the downstream-call tracking store to the resolved id in the same
      // operation. Mutating `req.id` directly here (as this site used to) left
      // the store keyed on Fastify's original id while every recordDownstreamCall
      // used the resolved one, and every downstream record was silently dropped.
      adoptResolvedRequestId(req as { id: unknown }, requestId);
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
        // Phase 1a++: Intervention Ingress-Shape Guard (ROADMAP 1.278)
        // =================================================================
        // Same defect class as the Phase 1b++ constraint guard below, on the
        // sibling field: the runV3 body JSON-schema types `interventions` as
        // `{ type: 'object' }` — the container only, the VALUES entirely
        // unvalidated — so every shape decision was made by hand downstream.
        //
        // Two hand-written answers existed and they disagreed:
        //   - normalizeInterventions() DROPPED any entry that was neither a
        //     number nor an object with a `value` key;
        //   - preflight's INVALID_INTERVENTION_VALUE then validated the
        //     ALREADY-NORMALISED options — the view the drop had edited.
        // So preflight structurally could not see the entries the drop removed.
        // MEASURED on the pristine tip: `{"f": null, "g": 60}` lost `f`
        // silently, passed preflight as a one-intervention option, and then
        // threw inside canonicaliseOption() on the RAW body — surfacing as
        // HTTP 200 + analysis_status:"failed" + PLOT_INTERNAL_ERROR. A
        // malformed request must get a malformed-request answer, not a masked
        // internal error and not an analysis of a set the caller never sent.
        //
        // This guard reads the RAW body (the only view that still contains the
        // dropped entries), rejects on the SHARED readInterventionValue()
        // predicate that normalizeInterventions() now also uses, and names the
        // offending option id AND factor key.
        //
        // WHY IT SITS HERE, ABOVE PHASE 1 (corrected in a follow-up slice).
        // The sole call site of normalizeOptions() — and therefore of the
        // silent drop inside normalizeInterventions() — is the first statement
        // of the Phase 1 block immediately below. This guard originally sat
        // ~160 lines BELOW that call, and the comment on the drop claimed the
        // drop was "UNREACHABLE on the route". That claim was FALSE: measured
        // on the pristine tip by replacing the drop with a throw, `{f: null,
        // g: 60}` produced a stack `normalizeInterventions -> normalizeOptions
        // -> <this handler>` on every malformed request. The guard was still
        // CORRECT below (it reads the raw body, so the earlier drop cannot
        // blind it, and the 422 was measured green) — but the safety property
        // "no consumer ever sees the silently-edited option set" was POSITIONAL:
        // it held only because nobody had yet added a `normalizedOptions` reader
        // into the gap. That is a hand-maintained invariant — the exact defect
        // class this fix exists to close. Above the call site the property is
        // structural instead, and that is what lets normalizeInterventions()
        // refuse LOUDLY instead of dropping silently (see its comment).
        //
        // It still runs before preflight, before hashRequest() and before
        // normaliseOptionsForISL(), so no consumer downstream can see a
        // non-finite intervention value.
        //
        // Preflight's own INVALID_INTERVENTION_VALUE check is deliberately
        // LEFT IN PLACE as defence-in-depth (the same disposal ROADMAP 1.277
        // gave #278's caller-side guard) and keeps covering direct in-process
        // callers of runPreflightValidation().
        if (Array.isArray(body.options)) {
          for (const option of body.options) {
            const interventions = (option as { interventions?: unknown })?.interventions;
            if (!interventions || typeof interventions !== 'object' || Array.isArray(interventions)) continue;
            for (const [factorKey, raw] of Object.entries(interventions as Record<string, unknown>)) {
              if (readInterventionValue(raw) !== undefined) continue;
              const optionId = String((option as { id?: unknown })?.id ?? '');
              return reply.status(422).send(buildBlockedResponse(
                `Invalid intervention value: options[id=${optionId}].interventions['${factorKey}'] must be a finite number`,
                [{
                  id: randomUUID(),
                  code: 'INVALID_INTERVENTION_VALUE',
                  severity: 'blocker',
                  // Message names the offending option id AND factor key (the
                  // CritiqueV3 shape has no field_path; the path goes in the
                  // text, matching INVALID_CONSTRAINT_SHAPE below). The ids are
                  // ALSO carried structurally in affected_option_ids /
                  // affected_node_ids so a consumer need not parse prose.
                  message: `Option '${optionId}' has an invalid intervention value for node '${factorKey}'. Value must be a finite number, either as options[].interventions['${factorKey}'] or as options[].interventions['${factorKey}'].value.`,
                  source: 'validation',
                  affected_option_ids: [optionId],
                  affected_node_ids: [factorKey],
                  blocks_analysis: true,
                }],
                body.graph,
                body.options,
                requestId,
                requestComputedAt,
              ));
            }
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
        // Phase 1b++: Constraint Ingress-Shape Guard (sub-item 4)
        // =================================================================
        // The runV3 body JSON-schema types goal_constraints only as an array of
        // objects — the inner fields are UNVALIDATED. PLoT reads c.constraint_id
        // and c.node_id everywhere downstream (constraint-trace log, id resolver,
        // constraint mapping), so a constraint missing either as a non-empty
        // string silently corrupts identity/targeting. Reject it at the boundary
        // with a 422 blocked response (same path as TOO_MANY_CONSTRAINTS).
        //
        // Codex F4 — the guard is COMPLETE at this boundary:
        //  - constraint_id / node_id must be TRIMMED non-empty strings
        //    (whitespace-only previously passed and corrupted identity);
        //  - operator must be a CLOSED comparison '>=' | '<=' (rejected here
        //    with a shape error rather than deep in preflight);
        //  - value must be a FINITE number. The former claim that value is
        //    "downstream-validated" was FALSE: preflight only range-COMPARES
        //    it (a warning), so a missing/non-finite value (JSON.parse
        //    accepts 1e999 → Infinity) transited to normalisation and ISL.
        if (Array.isArray(body.goal_constraints)) {
          const isTrimmedNonEmptyString = (v: unknown): v is string =>
            typeof v === 'string' && v.trim().length > 0;
          for (let i = 0; i < body.goal_constraints.length; i++) {
            const c = body.goal_constraints[i] as {
              constraint_id?: unknown; node_id?: unknown; operator?: unknown; value?: unknown;
            };
            let badField: string | undefined;
            let requirement: string | undefined;
            if (!isTrimmedNonEmptyString(c?.constraint_id)) {
              badField = 'constraint_id';
              requirement = 'must be a non-empty string';
            } else if (!isTrimmedNonEmptyString(c?.node_id)) {
              badField = 'node_id';
              requirement = 'must be a non-empty string';
            } else if (c?.operator !== '>=' && c?.operator !== '<=') {
              badField = 'operator';
              requirement = `must be '>=' or '<='`;
            } else if (typeof c?.value !== 'number' || !Number.isFinite(c.value)) {
              badField = 'value';
              requirement = 'must be a finite number';
            }
            if (badField) {
              return reply.status(422).send(buildBlockedResponse(
                `Invalid constraint shape: goal_constraints[${i}].${badField} ${requirement}`,
                [{
                  id: randomUUID(),
                  code: 'INVALID_CONSTRAINT_SHAPE',
                  severity: 'error',
                  // message names the offending field + index (field_path is not
                  // a CritiqueV3 field; the path is carried in the message text).
                  message: `goal_constraints[${i}].${badField} ${requirement}`,
                  source: 'validation',
                  blocks_analysis: true,
                }],
                normalizedGraph,
                normalizedOptions,
                requestId,
                requestComputedAt,
              ));
            }
          }
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
        // ROADMAP 2.239: goal-target inputs, resolved ONCE, before the filter
        // =================================================================
        // A goal target can arrive three ways: the request root field, or the
        // raw upstream goal node's normalised `goal_threshold` / raw
        // `goal_threshold_raw` (CEE stamps both on the node; the canonical
        // EngineNodeV3 drops them, which is why they are read off `body.graph`).
        // Resolved here because two later consumers need them:
        //   - the auto-synthesis fallback (Phase 1c+, now AFTER the filter)
        //   - the goal_threshold_no_probability alarm (Phase 3)
        // Unlike `effectiveGoalThreshold`, these are INPUT facts: nothing
        // downstream clears them.
        const rawGoalNode = (body.graph?.nodes as any[])?.find(
          (n: any) => n.id === body.goal_node_id
        );
        const asFiniteNumber = (v: unknown): number | undefined =>
          typeof v === 'number' && Number.isFinite(v) ? v : undefined;
        const nodeGoalThreshold = asFiniteNumber(rawGoalNode?.goal_threshold);
        const nodeGoalThresholdRaw = asFiniteNumber(rawGoalNode?.goal_threshold_raw);
        /**
         * ROADMAP 2.258 — the producer's FRAME attestation for the goal target.
         *
         * Read from the SAME raw goal node as `goal_threshold` above, and for
         * the same reason: CEE stamps it on the node, and the canonical
         * EngineNodeV3 the normaliser rebuilds does not carry it, so reading it
         * off `filteredGraph` would find nothing. `@talchain/schemas` 0.31.0
         * types it as `NodeV3.goal_threshold_frame` (`dist/graph.js:194`), and
         * `.data`-nesting is supported here because `normaliseNode` accepts
         * both spellings for every other CEE-stamped field.
         *
         * ⚠ FORWARD-IF-PRESENT, AND PLoT NEVER MINTS ONE. CEE is expected to
         * stamp this as a code constant, but that had NOT landed when this was
         * written — so the common case today is legitimately ABSENT, and absent
         * must stay absent all the way to ISL. Defaulting it would be PLoT
         * asserting a frame it has no standing to assert: 'delta' silently
         * restores the pre-2.258 structural zero (the "< 1% chance" untruth this
         * row exists to kill) and 'level' claims a domain PLoT never checked.
         *
         * `parseGoalThresholdFrame` validates against the CONTRACT's own enum,
         * so a junk value degrades to ABSENT rather than being forwarded — an
         * unrecognised token would fail ISL's Pydantic validation and turn a
         * producer typo into a failed analysis instead of a disclosed gap.
         */
        const nodeGoalThresholdFrame = parseGoalThresholdFrame(
          rawGoalNode?.goal_threshold_frame ?? rawGoalNode?.data?.goal_threshold_frame
        );
        /**
         * "The user stated a success target somewhere in this request."
         *
         * This is the alarm's gate (Phase 3). The alarm used to be gated on
         * `effectiveGoalThreshold`, which precedence routing clears — so in
         * every case the alarm exists to catch, it was silent BY CONSTRUCTION.
         * That is why the goal-probability gap survived to a live walk under
         * green CI. Gate on the input, which nothing downstream can clear.
         */
        const goalTargetStated =
          goalThreshold !== undefined ||
          nodeGoalThreshold !== undefined ||
          nodeGoalThresholdRaw !== undefined;

        // Auto-synthesis state — populated by Phase 1c+ below (AFTER the
        // temporal filter). Declared here so the precedence routing and the
        // ISL request build can read it.
        let autoSynthesisFired = false;
        let autoThreshold: number | undefined;
        /**
         * ROADMAP 2.266 — set when a goal target WAS resolved but the
         * auto-synthesis was refused because the target's frame does not match
         * the frame ISL evaluates constraints in. Read once, at the 2.239
         * threshold carry, to keep the target itself on the wire (see there).
         * Values are the diagnostic cause, never a frame PLoT asserts.
         */
        let autoSynthesisFrameRefusal:
          | 'unattested'
          | 'level'
          | 'attestation_mismatch'
          | undefined;
        const clientConstraintCount = body.goal_constraints?.length ?? 0;

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
        // L63: the same capture, for the FRAME stamp. Collected for EVERY raw
        // node rather than just the goal node — a constraint can target any
        // node, and the stamp means the same thing wherever a producer puts it.
        // `parseGoalThresholdFrame` validates against the contract's own enum,
        // so a junk token degrades to ABSENT (⇒ refused) rather than opening the
        // gate. PLoT never mints one: an unstamped node stays unstamped.
        const goalThresholdFrameByNodeId = new Map<string, string>();
        for (const rawNode of (body.graph?.nodes as any[]) ?? []) {
          if (!rawNode || typeof rawNode.id !== 'string' || rawNode.id.length === 0) continue;
          const frame = parseGoalThresholdFrame(
            rawNode.goal_threshold_frame ?? rawNode.data?.goal_threshold_frame
          );
          if (frame !== undefined) goalThresholdFrameByNodeId.set(rawNode.id, frame);
        }
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
        // Phase 1c+: Auto-constraint fallback from goal_threshold
        // =================================================================
        // When no constraints SURVIVE to the ISL boundary (neither explicit
        // goal_constraints nor graph constraint nodes), but a goal_threshold
        // exists, synthesise a single constraint so ISL produces
        // constraint_analysis output.
        // This is a deterministic computation — no LLM call (F.6: PLoT = compute).
        //
        // ⚠ ROADMAP 2.239 — THIS BLOCK USED TO RUN *BEFORE* THE TEMPORAL FILTER,
        // and that ordering was the defect. It asked "are there any constraints?"
        // before the filter had removed the ones ISL cannot evaluate, so a
        // deadline-bearing constraint that was about to be DELETED still
        // suppressed the fallback that would have replaced it. Measured live
        // (2026-08-01 walk, S1): a user who stated "£6M ARR within 12 months"
        // reached ISL with ZERO constraints AND no threshold — strictly worse
        // than a user who stated the target with no deadline. The two suites
        // either side of the hole (tests/auto-constraint-fallback.test.ts,
        // tests/golden/temporal-filter-e2e.test.ts) never crossed it, which is
        // how it reached production under green CI.
        //
        // Reading the POST-filter set fires in a strict superset of the previous
        // cases (post-filter-empty ⊇ pre-filter-empty): the only new case is
        // "non-empty before the filter, empty after" — exactly the defect.
        if (constraintCompilation.constraints.length === 0) {
          // Resolve threshold: prefer request-level goal_threshold (already parsed),
          // fall back to goal_threshold on the raw upstream goal node (CEE may set
          // it on the node even if the request root field is absent).
          autoThreshold = goalThreshold ?? nodeGoalThreshold;

          // =============================================================
          // ROADMAP 2.266 — SYNTHESISE ONLY IN THE FRAME ISL EVALUATES IN
          // =============================================================
          // ISL evaluates a goal_constraint by comparing its `value` against
          // the goal node's Monte-Carlo samples, and those samples are a
          // CHANGE FROM BASELINE (an uplift), not an absolute level. So the
          // synthesised constraint is only meaningful when the goal target is
          // itself stated as a change — i.e. frame `'delta'`.
          //
          // WITNESSED CONSEQUENCE OF NOT CHECKING (evidence
          // `witness-2258-goal-probability-live.md`, three live runs): a target
          // of 0.8 meaning "£6,000,000 of a £7,500,000 cap" — a LEVEL — was
          // synthesised verbatim and compared against uplift samples whose
          // median was ~£2,200,000. ISL answered the question actually asked,
          // "is the UPLIFT >= £6,000,000?", and returned 0.0054. The question
          // the user asked, "is £4,000,000 + uplift >= £6,000,000?", answers
          // ~0.55. The surface showed "< 1%" — a ~100x understatement biased
          // toward "hopeless".
          //
          // ⚠ WHY THE GATE IS `=== 'delta'` AND NOT MERELY "a frame is
          // present". The witnessed runs carried NO frame, so gating on mere
          // presence would fix today's live surface — and would REINTRODUCE
          // the exact ~100x error the moment the producer starts stamping,
          // because the frame it will stamp for that decision is `'level'`.
          // A gate that passes today and breaks on the next upstream landing
          // is not a fix. Only `'delta'` is provably in the sample frame.
          //
          // ⚠ WHY `'level'` IS NOT CONVERTED HERE INSTEAD. The decisive reason
          // is structural, not circumstantial: `ISLGoalConstraint` carries NO
          // frame field at all (`integrations/isl/translator-v3.ts:124-132`).
          // ISL therefore reads every constraint `value` in one fixed frame and
          // cannot be told otherwise, so a converted value would have to be
          // PLoT unilaterally reproducing ISL's own normalisation arithmetic
          // and hoping the two stay in step — with no field on the wire for
          // either side to declare what it did, and so no way for a test here
          // to prove the two agree. Constraint-frame attestation is a schemas
          // train, deliberately out of scope for this row.
          //
          // The missing baseline is a second, weaker obstacle and is stated
          // narrowly on purpose: a graph CAN carry `observed_state.baseline` on
          // the goal node (test fixtures do). What the WITNESS establishes is
          // that the live producer did not write one on any of the three
          // captured runs, which is also why ISL's own main-path converter
          // never executed there. ROADMAP 2.281 is the row that changes that.
          // Minting the arithmetic here anyway would replace a wrong number
          // with a differently-wrong number — the defect class this row
          // exists to close. So `'level'` is REFUSED, not guessed.
          //
          // The refusal is honest absence, not a silent zero: with no
          // constraint sent, `buildResponse` omits the whole constraint block
          // (`run.ts:2095-2098`), so `constraint_probabilities`,
          // `probability_of_joint_goal`, `goal_fit` and `goal_fit_basis` are
          // all ABSENT from the wire rather than shipping 0. The user's target
          // still reaches ISL's main path (see the 2.239 carry below), which
          // discloses its own refusal by name.
          //
          // SCOPE: this gate governs ONLY the auto-synthesised constraint.
          // User-authored `goal_constraints` are untouched — they never reach
          // this branch, which runs only when the compiled set is empty.
          const frameIsSampleFrame = nodeGoalThresholdFrame === 'delta';

          // =============================================================
          // 2.266 AMENDMENT — THE ATTESTATION MUST BE ABOUT THE NUMBER WE
          // ARE ACTUALLY SENDING (adversarial review of #304, probe-proven)
          // =============================================================
          // `autoThreshold` resolves REQUEST-ROOT first (`goalThreshold ??
          // nodeGoalThreshold`), but the frame is read off the NODE. So a
          // producer that sends root `goal_threshold: 0.9` while the node
          // carries `{goal_threshold: 0.8, goal_threshold_frame: 'delta'}`
          // would ship `value: 0.9` under an attestation made about 0.8 —
          // the gate satisfied by a stamp describing a different number.
          //
          // Reachability, stated honestly: this needs a producer-inconsistent
          // caller, and CEE stamps node-only today, so it is not the live
          // shape. It is closed anyway because the whole point of this row is
          // that an attestation is only worth what it is attached to.
          //
          // ⚠ WHY REFUSE RATHER THAN SYNTHESISE THE NODE'S OWN VALUE (the
          // other option the review offered). Precedence routing leaves
          // `effectiveGoalThreshold` at the ROOT value, and the 2.239 carry
          // below only re-derives it from the constraint when synthesis
          // fired. Synthesising 0.8 while the root ships 0.9 would put BOTH
          // numbers on one wire and make ISL answer "P(goal >= 0.9)" and
          // "P(constraint goal >= 0.8)" in the same response — precisely the
          // divergence the "derive, never mirror" carry exists to prevent.
          // Refusing keeps the invariant that the target and the constraint
          // describe the same number, or there is no constraint.
          //
          // A node frame WITHOUT a node threshold is NOT a mismatch: the
          // frame describes what this goal node's samples mean, so it
          // legitimately covers a root-supplied target. Only two PRESENT and
          // UNEQUAL numbers are refused.
          const targetAttestationMismatch =
            goalThreshold !== undefined &&
            nodeGoalThreshold !== undefined &&
            goalThreshold !== nodeGoalThreshold;

          const synthesisRefusal: 'unattested' | 'level' | 'attestation_mismatch' | undefined =
            !frameIsSampleFrame
              ? nodeGoalThresholdFrame === undefined
                ? 'unattested'
                : 'level'
              : targetAttestationMismatch
                ? 'attestation_mismatch'
                : undefined;

          if (
            autoThreshold !== undefined &&
            Number.isFinite(autoThreshold) &&
            synthesisRefusal !== undefined
          ) {
            autoSynthesisFrameRefusal = synthesisRefusal;
            req.log.warn({
              event: 'plot.auto_constraint_from_threshold',
              goal_node_id: body.goal_node_id,
              threshold: autoThreshold,
              action: 'refused',
              goal_threshold_frame: nodeGoalThresholdFrame ?? null,
              refusal: synthesisRefusal,
              ...(synthesisRefusal === 'attestation_mismatch'
                ? { root_goal_threshold: goalThreshold, node_goal_threshold: nodeGoalThreshold }
                : {}),
              reason:
                synthesisRefusal === 'unattested'
                  ? 'goal_threshold carries no goal_threshold_frame, so the frame it is stated in is unknown. ' +
                    'ISL evaluates goal_constraints against change-from-baseline samples; synthesising an ' +
                    'unattested target would compare a possibly-absolute level against a change. ' +
                    'No constraint synthesised — the joint-goal figure is omitted rather than guessed.'
                  : synthesisRefusal === 'level'
                    ? 'goal_threshold is attested as a LEVEL, but ISL evaluates goal_constraints against ' +
                      'change-from-baseline samples and goal_constraints carry no frame field. PLoT cannot ' +
                      'convert it (no goal-node baseline; ROADMAP 2.281 pending) and will not guess. ' +
                      'No constraint synthesised — the joint-goal figure is omitted rather than mis-framed.'
                    : 'the request root and the goal node state DIFFERENT goal targets, and the frame is ' +
                      'stamped on the node. The attestation therefore describes a different number from the ' +
                      'one auto-synthesis would send. No constraint synthesised — an attestation is only ' +
                      'worth what it is attached to.',
            });
          } else if (autoThreshold !== undefined && Number.isFinite(autoThreshold)) {
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
            // Run the synthesised constraint through the SAME temporal filter the
            // compiled set went through, so moving this block does not silently
            // drop the filter's out-of-domain safety gate for it (a synthesised
            // threshold outside [0,1] must still raise plot.constraint_out_of_domain
            // and reach `warnings`, exactly as it did when the block ran first).
            // It can never be DROPPED here: it carries no deadline_metadata and no
            // unit, so neither drop rule can match.
            const autoFilterResult = filterTemporalConstraints(
              [autoConstraint as RawGoalConstraint],
              filteredGraph.nodes,
              req.log,
              goalThresholdMetaByNodeId
            );
            constraintCompilation.constraints.push(...autoFilterResult.passed);
            temporalFilterResult.warnings.push(...autoFilterResult.warnings);
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
            autoThreshold = undefined;
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

        /**
         * ROADMAP 2.239 (hole B). The auto-synthesised constraint is DERIVED FROM
         * the goal target — it is not a competing user constraint, so it must not
         * trigger the precedence branch that discards the target.
         *
         * Before this fix the fallback destroyed the very threshold it recovered:
         * one synthesised constraint tripped `constraints.length > 0`, which set
         * `effectiveGoalThreshold = undefined`, which made the translator omit
         * `goal_threshold` (translator-v3.ts:534-536), which made ISL skip
         * `probability_of_goal` (it is gated SOLELY on `request.goal_threshold is
         * not None` — robustness_analyzer_v2.py:3073-3077 @35149dd1). Net effect,
         * measured at the outbound request on pristine `2f6e997`: NO request
         * routed through auto-synthesis has ever produced a goal probability,
         * deadline or no deadline — including one carrying an explicit
         * root-level `goal_threshold`.
         *
         * Sending both is legal and independently computed by ISL:
         * `probability_of_goal` (:3073-3077) and `constraint_analysis`
         * (:3079-3083) sit in the same option loop, neither suppressing the
         * other, and `RobustnessRequestV2` declares no mutual-exclusion
         * validator (models/robustness_v2.py:856, :895, :931-938, :994-1002).
         * ISL is in fact built for the pair: `_align_goal_constraint_samples`
         * (:3005-3035) exists so a constraint on the goal node and
         * `probability_of_goal` are computed from IDENTICAL samples.
         *
         * `_internal.source` is the unspoofable witness — client-supplied
         * `_internal` is deleted at ingress (see Phase 1c above), so a
         * user-supplied constraint that happens to reuse the id
         * `auto_goal_threshold` (pinned by T9) cannot reach this branch.
         */
        const autoSynthesisOnly =
          autoSynthesisFired &&
          constraintCompilation.constraints.length === 1 &&
          (constraintCompilation.constraints[0] as { _internal?: InternalMetadata })
            ?._internal?.source === 'auto_from_goal_threshold';

        if (constraintCompilation.constraints.length > 0) {
          // Multi-constraint path activated
          activeGoalConstraints = constraintCompilation.constraints;

          // Check for conflict with goal_threshold
          if (goalThreshold !== undefined && !autoSynthesisOnly) {
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

          // Clear goal_threshold when using multi-constraint path.
          // 2.239: this stays UNCONDITIONAL on purpose. When the only constraint
          // IS the goal target the threshold is re-established exactly once,
          // just before the ISL request is built, from the POST-normalisation
          // constraint value (see "2.239 threshold carry" below). Re-establishing
          // it here too would create a second, always-overwritten authority — a
          // hunk that could be reverted without a single test noticing.
          effectiveGoalThreshold = undefined;

          req.log.info({
            event: 'multi_constraint_path_activated',
            constraint_count: activeGoalConstraints.length,
            constraint_ids: activeGoalConstraints.map(c => c.constraint_id),
            goal_threshold_carried: autoSynthesisOnly,
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
        // EVPI is priced over the parameter_uncertainties ISL ACTUALLY receives:
        // the factor PUs (buildParameterUncertaintiesV3) UNION the constraint-target
        // PUs injected after the base request is built (injectConstraintParameterUncertainties,
        // Phase 4b+ below). ISL counts BOTH in its EVPI `u`; count both here so
        // PLoT's estimate matches ISL's — conservative, never permissive (else a
        // near-ceiling multi-constraint graph passes here then ISL 422s). The
        // injected node-id set is derived via the SAME selection the injector uses
        // (one source of truth: selectConstraintInjectedPuNodeIds/classifyConstraintPu),
        // and activeGoalConstraints shares constraintsForISL's node-id set
        // (normalisation preserves node_ids), so the count is exact.
        // Build the factor PU list ONCE here (the planner needs its node-id
        // count to price EVPI) and thread the SAME list into
        // toISLRobustnessRequest below — filteredGraph.nodes is not mutated
        // between here and the request build, so the request sends byte-identical
        // PUs while paying for the pass only once. This also closes the
        // lockstep-drift hazard: the plan count can no longer diverge from what
        // the request actually carries.
        const factorParameterUncertainties = buildParameterUncertaintiesV3(filteredGraph.nodes) ?? [];
        const factorPuNodeIds = new Set(factorParameterUncertainties.map((pu) => pu.node_id));
        // One id→node map shared by the plan-time constraint-PU selection and the
        // build-time injection (both classify the same constrained nodes against
        // the same graph). Built only when there are constraints to classify, so
        // the common no-constraint path pays nothing.
        const constraintPuNodeMap =
          activeGoalConstraints && activeGoalConstraints.length > 0
            ? new Map(filteredGraph.nodes.map((n) => [n.id, n]))
            : undefined;
        const constraintInjectedPuNodeIds = selectConstraintInjectedPuNodeIds(
          activeGoalConstraints,
          filteredGraph.nodes,
          body.goal_node_id,
          factorPuNodeIds,
          constraintPuNodeMap,
        );
        const uniqueParamUncertainties = factorPuNodeIds.size + constraintInjectedPuNodeIds.size;

        // ROADMAP 2.356 — one bounded synchronous refresh, then plan or REFUSE.
        // Never plan blind: the conservative scalar fallback this replaces is
        // arithmetically incapable of promising admission against a weighted gate
        // it cannot read (both witnesses pinned in
        // tests/isl-admission-version-first-classification.test.ts), so its
        // output was a request ISL refuses with a raw 422.
        const admissionOutcome = await resolveAdmissionForPlanning();
        if (admissionOutcome.kind === 'refuse') {
          req.log.error({
            event: 'isl_admission_unavailable_refused',
            request_id: requestId,
            admission_status: admissionOutcome.resolution.status,
            advertised_version: admissionOutcome.resolution.advertisedVersion ?? null,
            node_count: causalNodeCount,
            edge_count: causalDirectedEdgeCount,
            option_count: causalOptionCount,
          });
          return reply.status(admissionOutcome.httpStatus).send(buildBlockedResponse(
            'Analysis engine unavailable',
            [{
              id: randomUUID(),
              code: admissionOutcome.code,
              severity: 'blocker' as const,
              // Truthful attribution: this is NOT a property of the caller's
              // graph, and must never read like one. Editing the graph cannot
              // help, so the message must not invite it.
              message:
                'The analysis engine did not report the compute budget it is currently enforcing, so this analysis cannot be planned against it. Nothing is wrong with your decision model — this is a temporary engine-availability problem. Please try again shortly.',
              source: 'validation' as const,
              blocks_analysis: true,
            }],
            filteredGraph,
            normalizedOptions,
            requestId,
            requestComputedAt,
          ));
        }
        const admissionResolution = admissionOutcome.resolution;

        // -----------------------------------------------------------------
        // CAPS half of the /health handshake (checkAdmissionCaps).
        // -----------------------------------------------------------------
        // #233 fitted the depth to ISL's advertised COST ceiling. ISL ALSO
        // advertises structural caps (compute_admission.caps) specifically so
        // PLoT can pre-check them: a request over a cap — most importantly
        // max_parameter_uncertainties, for which PLoT has NO other check — is
        // otherwise forwarded and comes back a raw Pydantic 422 (the exact
        // passthrough the handshake exists to prevent). Refuse it here with the
        // SAME structured GRAPH_TOO_COMPLEX blocker the cost ceiling produces,
        // BEFORE the ISL call. nodes/edges/options are checked against
        // min(PLoT LIMITS, advertised cap) — derive-not-mirror, PLoT's LIMITS
        // stay the belt-and-braces floor. Gated on a valid advertised block
        // (admission non-null) exactly like the cost gate: on skew / no caps /
        // cold warm-up this does NOT fire (no spurious refusal).
        const capsDecision = checkAdmissionCaps(
          {
            nodeCount: causalNodeCount,
            edgeCount: causalDirectedEdgeCount,
            optionCount: causalOptionCount,
            uniqueParamUncertainties,
          },
          admissionResolution.admission,
          { maxNodes: LIMITS_MAX_NODES, maxEdges: LIMITS_MAX_EDGES, maxOptions: LIMITS_MAX_OPTIONS },
        );
        if (capsDecision.kind === 'exceeded') {
          req.log.warn({
            event: 'graph_exceeds_admission_cap',
            request_id: requestId,
            dimension: capsDecision.dimension,
            observed: capsDecision.observed,
            limit: capsDecision.limit,
            limit_source: capsDecision.source,
            node_count: causalNodeCount,
            edge_count: causalDirectedEdgeCount,
            option_count: causalOptionCount,
            unique_parameter_uncertainties: uniqueParamUncertainties,
            admission_status: admissionResolution.status,
          });
          return reply.status(422).send(buildBlockedResponse(
            'Graph too complex to analyse',
            [{
              id: randomUUID(),
              code: 'GRAPH_TOO_COMPLEX',
              severity: 'blocker' as const,
              message: capsRefusalMessage(capsDecision),
              source: 'validation' as const,
              blocks_analysis: true,
            }],
            filteredGraph,
            normalizedOptions,
            requestId,
            requestComputedAt,
          ));
        }

        const depthPlanInput: DepthPlanInput = {
          nSamples: requestedNSamples,
          nSamplesExplicit: body.n_samples !== undefined,
          nodeCount: causalNodeCount,
          edgeCount: causalDirectedEdgeCount,
          optionCount: causalOptionCount,
          uniqueParamUncertainties,
          // ROADMAP 2.356 — v6 prices the per-draw status-quo reference ISL runs
          // for a LEVEL-framed goal threshold. Derived from what is KNOWN AT PLAN
          // TIME: a target was stated somewhere in the request, and the goal node
          // attests the `level` frame. `effectiveGoalThreshold` is not final until
          // well below this point (precedence routing, auto-synthesis and the
          // domain-bound guard can each still clear it), so this can over-charge a
          // request whose threshold is later dropped — the conservative direction,
          // and the same rule uniqueParamUncertainties follows. Under-charging
          // here is what produces a pass-then-422.
          levelFramedGoalThreshold: goalTargetStated && nodeGoalThresholdFrame === 'level',
          // The base /v2/run request always sends these phases (see
          // toISLRobustnessRequest); path decomposition is a request-gated opt-in.
          //
          // ⚠ These four literals MIRROR unconditional flags in the translator.
          // They are not free-floating assumptions: tests/isl-cost-request-shape
          // .test.ts asserts each one against the body toISLRobustnessRequest
          // actually produces, so a translator change that stops sending a phase
          // (or starts sending a new one) REDs here instead of silently
          // over- or under-pricing the request.
          includeVoi: true,
          includeSensitivity: true,
          includeEValues: true,
          includeFactorFlips: true,
          includePathDecomposition: body.include_path_decomposition === true,
          // PLoT sends no control_candidates today, so ISL's EVPC term is zero.
          // Pinned by the same spec — if the translator ever gains a control
          // grid, that test REDs and points here rather than under-pricing by a
          // full S·W·gridPoints term.
          controlGridPoints: 0,
        };
        // conservative (fail-loud: cap the depth-raise + tighten the scalar
        // bound) whenever ISL is configured but no version-validated admission
        // is in hand — a genuine skew with nothing retained, or the cold
        // 'warming' window. Only a truly benign no-gate state (ISL not
        // configured — nothing downstream to refuse the request) keeps the
        // standard depth + historical scalar budget.
        //
        // ⚠ ROADMAP 2.289 — this posture used to be `admissionResolution.skew`
        // ALONE, so the cold cache (warming, skew=false) planned the FULL
        // defaulted depth against the benign 30M scalar budget. That scalar can
        // UNDER-price ISL's v5 weighted gate (worked example N=20/E=40/O=10/
        // U=19: scalar 8.0M vs exact v5 34.9M against the live 24M ceiling), so
        // the request was forwarded and ISL refused it with a hard 422 — a
        // silent legacy-arithmetic mode where an honest, disclosed downsize
        // belongs. In production the window is additionally closed at the
        // source: main.ts warms the admission cache before listen, and an
        // OUTAGE-class skew (unreadable /health, no advertised version)
        // retains the last-known-good advertisement (both in
        // compute-admission.ts — drift-class skews never retain, by the #305
        // review ruling), so this fallback is the LAST line, not the plan of
        // record.
        const complexityDecision = planSampleDepth(depthPlanInput, admissionResolution.admission, {
          // ROADMAP 2.356: the posture now comes from the resolver, which has
          // already refused the no-advertisement case outright. What reaches here
          // is either a live block or a retained last-known-good one, and
          // `conservative` distinguishes the two.
          conservative: admissionOutcome.conservative,
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
        const nSamplesReducedReason =
          complexityDecision.kind === 'reduced' ? complexityDecision.reason : undefined;

        if (complexityDecision.kind === 'reduced') {
          req.log.info({
            event: 'n_samples_reduced_for_complexity',
            request_id: requestId,
            node_count: causalNodeCount,
            edge_count: causalDirectedEdgeCount,
            option_count: causalOptionCount,
            plan_mode: complexityDecision.mode,
            // ROADMAP 2.260: distinguishes a graph-cost reduction from a
            // conservative fallback cut. Both were previously indistinguishable
            // in the logs; the latter did not log at all.
            reduction_reason: complexityDecision.reason,
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
              nSamplesReducedReason,
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
            req.log,  // logger for fact_objects assembly logging
            undefined,  // optionClampDirectionByFactor (no ISL call on this path)
            undefined,  // optionDiagnosedFactors (no ISL call on this path)
            undefined,  // constraintScaleProvenanceByConstraintId (no ISL call on this path)
            goalThresholdFrameByNodeId  // L63: constraint sample-frame gate input
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
        // Codex F2a: per-constraint THRESHOLD clamp direction ('low' = clamped at
        // the range floor, 'high' = at the ceiling), derived from the constraint
        // normalisation diagnostics (entry present ONLY when the threshold
        // clamped). A clamped threshold makes the emitted breach margin a strict
        // bound — the margin egress uses this to avoid mislabelling it 'exact'.
        let constraintThresholdClampByConstraintId: Map<string, 'low' | 'high'> | undefined;
        // A3 R1: per-constraint range-unity decision, recorded by
        // normaliseGoalConstraints at ladder-decision time (entry present ONLY for
        // a normalised constraint — a diagnostic exists). The trust marker PROJECTS
        // this instead of re-deriving it; absence ⇒ never-normalised ⇒ unified.
        let constraintRangeUnifiedByCid: Map<string, boolean> | undefined;
        // THE UNIT COLLISION: per-constraint unit mismatch, recorded by
        // normaliseGoalConstraints at ladder-decision time (entry present ONLY
        // when the constraint's declared unit and the declared unit of the scale
        // it was normalised against name different quantity kinds). Projected —
        // never re-derived — by the trust marker and the reliability gate.
        let constraintUnitMismatchByCid: Map<string, ConstraintUnitMismatch> | undefined;
        // A3 trust marker: per-constraint scale provenance (built in Phase 4b
        // below once the constraint ranges + clamp map + intervention scales are
        // known). Feeds constraint_results[].scale_provenance and
        // option_comparison[].constraints_decision_grade.
        let constraintScaleProvenanceByConstraintId: Map<string, ConstraintScaleProvenance> | undefined;

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
            // F7 (Codex): log NO raw numeric decision values (original /
            // normalised). The log boundary hashes registered raw inputs, but a
            // DERIVED normalised scalar under an unlisted key is neither
            // registered nor a DECISION_DOMAIN_KEY, so it would reach info logs
            // in plaintext. Keep only the hashed factor_id, the range.source
            // vocabulary, and the clamped boolean (least data wins).
            sample: normalisationDiagnostics.slice(0, 3).map(d => ({
              factor_id: d.factor_id,
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
          // A3 range-unify: the constraint threshold on a node MUST be normalised
          // against the EXACT scale that node's interventions were scaled against
          // in Phase 4a — otherwise ISL evaluates prob_satisfied and margins with
          // the threshold and samples on two different scales (a violated cap
          // could score probability 1; margins landed on a phantom width). Build
          // the per-node intervention scale from what the interventions ACTUALLY
          // used (the Phase-4a diagnostics). A node intervened while Phase 4a was
          // SKIPPED (all interventions already in [0,1]) is carried as an
          // identity [0,1] range so its threshold stays on the same raw sample
          // scale rather than being independently re-normalised via a heuristic.
          const IDENTITY_RANGE: NormalisationRange = { min: 0, max: 1, source: 'default' };
          const interventionScaleByNodeId = ((): Map<string, NormalisationRange> => {
            const rangeByNode = new Map<string, NormalisationRange>();
            for (const d of normalisationDiagnostics) {
              if (!rangeByNode.has(d.factor_id)) rangeByNode.set(d.factor_id, d.range);
            }
            const scales = new Map<string, NormalisationRange>();
            for (const opt of normalizedOptions) {
              for (const nodeId of Object.keys(opt.interventions)) {
                if (!scales.has(nodeId)) {
                  scales.set(nodeId, rangeByNode.get(nodeId) ?? IDENTITY_RANGE);
                }
              }
            }
            return scales;
          })();

          const gateNeedsNorm = constraintsNeedNormalisation(activeGoalConstraints);
          // A NON-identity intervention scale forces normalisation even when the
          // raw constraint value already sits in [0,1] (Caveat A combo 2): that
          // value is a raw user quantity on the intervention scale and must be
          // re-scaled onto it, not forwarded as an already-normalised number.
          let anyNonIdentityScale = false;
          for (const r of interventionScaleByNodeId.values()) {
            if (!isIdentityRange(r)) {
              anyNonIdentityScale = true;
              break;
            }
          }

          if (gateNeedsNorm || anyNonIdentityScale) {
            const constraintNormResult = normaliseGoalConstraints(
              activeGoalConstraints,
              filteredGraph.nodes,
              // P0-C1: producer-declared scales (constraint '%' unit, node
              // goal_threshold_cap / goal_threshold) captured before the
              // temporal filter stripped them — see Phase 1c++ above. A3: plus
              // the per-node intervention scale, and the global gate result so
              // constraints on NON-intervened nodes keep their exact prior
              // behaviour (chain when the gate fired, forward-raw otherwise).
              {
                unitsByConstraintId: constraintUnitsByConstraintId,
                goalThresholdMetaByNodeId,
                interventionScaleByNodeId,
                normaliseWithoutScale: gateNeedsNorm,
              }
            );
            constraintsForISL = constraintNormResult.constraints;

            // Single pass over the constraint diagnostics builds BOTH per-constraint
            // maps from the SAME source of truth (derive-don't-mirror):
            //  - constraintNormalisationRanges: the range each threshold normalised
            //    against, for failure_margin_median denorm. After A3 unify these are
            //    the SAME ranges the samples live on, so the two margin-egress paths
            //    (run.ts ~1885, ~2269) denormalise on the correct (intervention)
            //    width automatically.
            //  - constraintThresholdClampByConstraintId (Codex F2a): the THRESHOLD
            //    clamp direction, from the recorded post-clamp normalised_value
            //    (0 ⇒ range floor 'low', 1 ⇒ ceiling 'high'). Only clamped
            //    thresholds get an entry; an interior value under a degenerate
            //    (zero-width) range is indeterminate and recorded as neither (the
            //    margin egress then makes no precision claim).
            constraintNormalisationRanges = new Map<string, NormalisationRange>();
            constraintThresholdClampByConstraintId = new Map<string, 'low' | 'high'>();
            //  - constraintRangeUnifiedByCid (A3 R1): the range-unity decision the
            //    normaliser recorded at ladder-decision time — projected verbatim
            //    by the trust marker (derive-don't-mirror). Set BEFORE the clamp
            //    `continue` so every diagnostic contributes it.
            constraintRangeUnifiedByCid = new Map<string, boolean>();
            //  - constraintUnitMismatchByCid: the unit-compatibility decision the
            //    normaliser recorded at ladder-decision time. Set BEFORE the
            //    clamp `continue` for the same reason range_unified is — a
            //    mis-scaled threshold that ALSO clamped must still carry its
            //    mismatch, or a clamp would silently swallow the stronger signal.
            constraintUnitMismatchByCid = new Map<string, ConstraintUnitMismatch>();
            for (const d of constraintNormResult.diagnostics) {
              constraintNormalisationRanges.set(d.constraint_id, d.range);
              constraintRangeUnifiedByCid.set(d.constraint_id, d.range_unified);
              if (d.unit_mismatch !== undefined) {
                constraintUnitMismatchByCid.set(d.constraint_id, d.unit_mismatch);
              }
              if (!d.clamped) continue;
              const direction = d.normalised_value <= 0 ? 'low' : d.normalised_value >= 1 ? 'high' : undefined;
              if (direction === undefined) continue;
              constraintThresholdClampByConstraintId.set(d.constraint_id, direction);
            }

            // Add constraint normalisation repairs to repairs_applied[]
            repairs = repairs.concat(constraintNormResult.repairs);

            req.log.info({
              event: 'constraint_normalisation',
              normalised: true,
              diagnostics_count: constraintNormResult.diagnostics.length,
              repairs_count: constraintNormResult.repairs.length,
              // F7 (Codex): log NO raw numeric decision values (original /
              // normalised) — same rationale as the intervention log above.
              // Keep the identifiers, the range.source vocabulary, and the
              // clamped boolean (surfaced by F2a; useful, non-sensitive).
              sample: constraintNormResult.diagnostics.slice(0, 3).map(d => ({
                constraint_id: d.constraint_id,
                node_id: d.node_id,
                range_source: d.range.source,
                clamped: d.clamped,
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

          // A3 trust marker (additive; D-2/D-5): build the per-constraint scale
          // provenance from the SAME #239 machinery — the resolved constraint
          // range source, the F2a threshold-clamp map, and the range-unity
          // decision the normaliser already recorded (A3 R1 — projected, not
          // re-derived). Covers EVERY active constraint (the else branch above
          // leaves constraintNormalisationRanges / constraintThresholdClampByConstraintId
          // / constraintRangeUnifiedByCid undefined → those forwarded-raw
          // constraints disclose as source 'default', range_unified true,
          // decision_grade false — fail-closed). No new suppression: only discloses.
          constraintScaleProvenanceByConstraintId = buildConstraintScaleProvenance(
            activeGoalConstraints,
            constraintNormalisationRanges,
            constraintThresholdClampByConstraintId,
            constraintRangeUnifiedByCid,
            constraintUnitMismatchByCid,
          );
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

        // === 2.239 threshold carry: derive, never mirror ===============
        // When the only active constraint is the auto-synthesised goal target,
        // `goal_threshold` and that constraint's value describe the SAME number
        // and must be identical on the wire. Phase 4b can re-scale the
        // constraint value (intervention-scale unification), so take the
        // threshold FROM the constraint that is actually being sent rather than
        // from the pre-normalisation copy — otherwise ISL would answer
        // "P(goal >= T)" and "P(constraint goal >= X)" with two different
        // numbers in one response.
        if (autoSynthesisOnly) {
          const sentAutoConstraint = constraintsForISL?.find(
            (c) => c.constraint_id === 'auto_goal_threshold'
          );
          effectiveGoalThreshold = sentAutoConstraint?.value ?? autoThreshold;
        }

        // === 2.266 carry: refusing the CONSTRAINT must not withdraw the TARGET
        // When the synthesis is refused on frame grounds the compiled set stays
        // empty, so the precedence branch above never runs and never clears
        // `effectiveGoalThreshold`. That is correct for a target supplied at the
        // request root — but a target read off the GOAL NODE
        // (`nodeGoalThreshold`) was never in `effectiveGoalThreshold` in the
        // first place; only the now-refused synthesis put it back, via the
        // carry above. Without this line, refusing the constraint would ALSO
        // stop the target reaching ISL, and ISL would return `(None, None)` —
        // "nothing to disclose" — converting a DISCLOSED gap into a SILENT one.
        // That is exactly the trade the 2.258 block below refuses to make, so
        // it must not be made here by omission either.
        if (autoSynthesisFrameRefusal !== undefined) {
          effectiveGoalThreshold = effectiveGoalThreshold ?? autoThreshold;
        }

        // === 2.239-G: refuse a DEGENERATE threshold rather than ask for a
        // === fabricated certainty ==========================================
        // ISL computes `probability_of_goal = P(goal_samples >= threshold)` on
        // the NORMALISED [0,1] goal scale. A threshold sitting on either bound
        // of that scale answers nothing about the decision:
        //
        //   <= 0  → P(goal >= 0) is satisfied by essentially every sample, so
        //           every option returns ~1.0. That is a confident "100% chance
        //           of hitting your target" which is really a statement about
        //           the normalisation FLOOR. Measured on this branch before the
        //           guard: an input of 0 or -0.2 shipped exactly this.
        //   >= 1  → P(goal >= max-of-scale): the ceiling-pinned target. CEE's
        //           own doctrine (`goal-threshold-cap.ts`) names `cap === target`
        //           forbidden precisely because it "would force
        //           goal_threshold = 1.0 and kill probability spread"; measured
        //           live at 0.021 / 0.0 on a decision whose leader wins 95% of
        //           scenarios.
        //
        // Both are degenerate BY CONSTRUCTION — meaningless whenever produced,
        // not merely when some upstream bug produces them. So this guard does
        // not depend on any reachability argument, and does not expire when the
        // CEE cap defect is fixed.
        //
        // The honest output is a GAP, not a number: omit the field, and let the
        // (re-gated) `goal_threshold_no_probability` alarm fire — `goalTargetStated`
        // is still true, because the user did state a target. An honest "not
        // available" plus a loud log beats a fabricated certainty; "0%"/"100%"
        // read as findings, "not available" reads as the gap it is.
        //
        // Scope: this guards the field THIS change introduced. The synthesised
        // `auto_goal_threshold` constraint is still sent, exactly as it was at
        // base — its degenerate `prob_satisfied` is pre-existing behaviour with
        // zero UI readers, and narrowing the guard keeps the diff off untested
        // ground. Rowed, not silently ignored.
        if (
          effectiveGoalThreshold !== undefined &&
          (effectiveGoalThreshold <= 0 || effectiveGoalThreshold >= 1)
        ) {
          req.log.warn({
            event: 'goal_threshold_degenerate_refused',
            goal_threshold: effectiveGoalThreshold,
            bound: effectiveGoalThreshold <= 0 ? 'floor' : 'ceiling',
            goal_target: goalThreshold ?? nodeGoalThreshold ?? nodeGoalThresholdRaw ?? null,
            reason:
              effectiveGoalThreshold <= 0
                ? 'P(goal >= scale floor) is ~1.0 for every option — a fabricated certainty, not a finding'
                : 'P(goal >= scale ceiling) is degenerate — the target is pinned to the top of its own normalisation range',
          });
          effectiveGoalThreshold = undefined;
        }

        // === 2.258: a threshold that ships WITHOUT a frame is a disclosed gap,
        // === not a silent one =============================================
        // THE DECISION (PR body carries the full reasoning). When a goal
        // threshold survives to the wire but the goal node carried no frame,
        // PLoT FORWARDS the threshold anyway rather than clearing it.
        //
        // The tempting alternative — "unstamped means no computable goal, so
        // clear it" — is WRONG here, and the reason is a fact about ISL that
        // must be read at the bytes rather than assumed. ISL does NOT reject an
        // unstamped request. `_resolve_goal_threshold`
        // (robustness_analyzer_v2.py:3108-3147 @`29cb4e27`) returns
        // `(None, warning)`: `probability_of_goal` is OMITTED for every option
        // and a GOAL_THRESHOLD_FRAME_UNSPECIFIED InferenceWarning rides back at
        // severity 'warning' — a severity ISL chose deliberately because PLoT
        // hides 'info'. The run still succeeds.
        //
        // So the two options are not "number vs no number". They are:
        //   forward  → no number, PLUS a named machine-readable reason the user
        //              can be shown ("no frame was stamped").
        //   clear    → no number, and ISL sees no threshold at all, so it
        //              returns `(None, None)` — "nothing to disclose". The gap
        //              becomes SILENT.
        // Clearing would buy nothing and destroy the disclosure. That is the
        // guarantee-theatre trade this estate exists to refuse.
        //
        // It is also the CONSISTENT choice: nothing here special-cases the
        // temporal-filter path. Every path that ships a threshold ships it under
        // the same rule — frame if the producer stamped one, absent otherwise —
        // so there is no path-dependent behaviour for a reviewer to hold in
        // their head, and no second policy to drift.
        //
        // This log is PLoT's own witness that it happened, since the ISL warning
        // is only visible in the response.
        if (effectiveGoalThreshold !== undefined && nodeGoalThresholdFrame === undefined) {
          req.log.warn({
            event: 'goal_threshold_frame_unstamped',
            goal_node_id: body.goal_node_id,
            goal_threshold: effectiveGoalThreshold,
            auto_synthesis_fired: autoSynthesisFired,
            reason:
              'Goal node carried no goal_threshold_frame, so goal_threshold ships unstamped. ' +
              'ISL will OMIT probability_of_goal and return GOAL_THRESHOLD_FRAME_UNSPECIFIED. ' +
              'PLoT does not guess a frame — the producer must stamp it.',
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
          constraintsForISL,       // Normalised constraint values (undefined if not using multi-constraint)
          plotSeedUsed,  // Always forward PLoT's seed (PLoT is seed authority)
          body.include_path_decomposition === true,  // Lane PLoT-W4: request-gated opt-in, forwarded only on explicit true
          factorParameterUncertainties,  // Reuse the factor PUs already built for the admission plan (same nodes → byte-identical)
          body.factor_correlations,  // Capability #100 (D-23.4): forward client-supplied factor correlations verbatim (request-gated omit inside the translator)
          nodeGoalThresholdFrame,  // ROADMAP 2.258: producer-stamped frame, forwarded if present; never minted (see below)
          body.user_stated_ranges  // ROADMAP 2.720 (P4): the user's own stated ranges, projected onto ISL's declared members inside the translator (request-gated omit)
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
          constraintPuNodeMap,  // Reuse the id→node map built for the plan-time selection above.
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
          // ROADMAP 2.202 fix ①b: was a local literal here; now imported from
          // config/timeouts.ts because the retry decision needs the SAME floor
          // (see retry-budget.ts). Two hand-written copies of a bound that must
          // agree is trap 12 — de-mirrored rather than duplicated.
          const baseCallTimeoutMs = Math.min(
            ISL_TIMEOUT_MS,
            Math.max(BASE_CALL_MIN_TIMEOUT_MS, Math.floor(baseCallRemainingMs - baseCallSafetyMarginMs)),
          );
          const configuredMaxRetries = Math.max(1, getISLClientConfig().maxRetries);
          // ROADMAP 2.202 — THE ATTEMPT COUNT IS NO LONGER FIXED UP FRONT.
          //
          // This used to pick the largest attempt count whose HONEST worst case
          // (attempts × per-attempt + the 1s+2s… backoff) fitted the remaining
          // budget. That arithmetic is correct and the comment here conceded its
          // outcome: "at the 70s default this still resolves to 1 attempt". One
          // attempt means ZERO retries — so when ISL's compute governor rejected
          // a 3rd concurrent analysis with a 429 that returned in **133 ms**,
          // PLoT emitted a typed-failure envelope with **~69.8 s of the budget
          // unspent**, and CEE mapped it to the HTTP 500 the tester saw.
          //
          // The flaw was DURATION-BLINDNESS: pricing every failure at a full
          // per-attempt timeout treats a 133 ms reject exactly like a 60 s one.
          //
          // Now: pass the configured cap as an UPPER BOUND and hand the client
          // the budget that actually remains. After each failure the client
          // projects the next attempt's real cost (delay + per-attempt timeout)
          // and retries only if it still fits — see integrations/isl/retry-budget.ts.
          //
          // The invariant the old clamp protected is UNCHANGED and is now
          // enforced at runtime rather than by static arithmetic: an attempt is
          // only ever STARTED when its full per-attempt timeout still fits the
          // budget, so the base call cannot outlive the caller. A slow failure
          // that consumes the budget still gets no retry.
          const baseCallBudget = {
            remainingMs: Math.max(0, Math.floor(baseCallRemainingMs)),
            safetyMarginMs: baseCallSafetyMarginMs,
          };
          if (baseCallTimeoutMs < ISL_TIMEOUT_MS) {
            req.log.info({
              event: 'base_isl_call_budget_clamped',
              request_id: requestId,
              isl_timeout_ms: ISL_TIMEOUT_MS,
              clamped_timeout_ms: baseCallTimeoutMs,
              configured_max_retries: configuredMaxRetries,
              remaining_budget_ms: Math.round(baseCallRemainingMs),
              // Worst case for ONE attempt — the only total guaranteed up front
              // now that further attempts are gated on the live budget. Retained
              // (rather than the old whole-ladder figure) so this row cannot
              // imply an attempt ladder that the client may never run.
              single_attempt_worst_case_ms: worstCaseMs(1, baseCallTimeoutMs),
            });
          }
          const response = await islService.callAnalysisEndpoint<any>(
            '/api/v1/robustness/analyze/v2',
            islRequest,
            requestId,
            baseCallTimeoutMs,
            configuredMaxRetries,
            undefined,
            baseCallBudget
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

            // Warn when the user STATED a success target but ISL returned no
            // probability_of_goal for some option.
            //
            // ⚠ ROADMAP 2.239: this used to be gated on `effectiveGoalThreshold`,
            // with a comment defending that choice ("multi-constraint precedence
            // routing intentionally clears the threshold"). That gating made the
            // alarm SILENT BY CONSTRUCTION in every case it exists to catch —
            // precedence routing clears `effectiveGoalThreshold` precisely when
            // the threshold fails to reach ISL, so the one scenario that should
            // ring is the one scenario that could not. Guarantee theatre: it is
            // why the 2026-08-01 walk's goal-probability gap reached a live user
            // under green CI with the alarm already in the code.
            //
            // Gate on the INPUT instead — a target stated anywhere in the request
            // (root field, node `goal_threshold`, or node `goal_threshold_raw`).
            // Nothing downstream can clear that, so the alarm now fires whenever
            // a target was stated and no probability came back, whatever the
            // routing did in between.
            if (goalTargetStated) {
              const optionData = islResult?.options ?? islResult?.results;
              const optionsWithoutProbGoal = optionData?.filter(
                (opt: any) => opt.probability_of_goal === undefined || opt.probability_of_goal === null
              );
              if (optionsWithoutProbGoal && optionsWithoutProbGoal.length > 0) {
                req.log.warn({
                  event: 'goal_threshold_no_probability',
                  // The threshold actually sent to ISL — null when routing dropped
                  // it, which is itself the most common cause of this alarm.
                  goal_threshold: effectiveGoalThreshold ?? null,
                  // The target the USER stated, which is what makes this a defect.
                  goal_target: goalThreshold ?? nodeGoalThreshold ?? nodeGoalThresholdRaw ?? null,
                  goal_target_source:
                    goalThreshold !== undefined
                      ? 'request'
                      : nodeGoalThreshold !== undefined
                        ? 'goal_node'
                        : 'goal_node_raw',
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

            // REMOVED (F3, ISL #103 / D-23.15): the flag-gated `factor_evpi`
            // arrival-proof log block. It called the deleted `mapIslFactorEvpi`
            // against ISL's removed top-level `factor_evpi[]` field, so it could
            // only ever log an empty summary against the current ISL generation.
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

        // Add normalization warnings as info critiques.
        // ROADMAP 2.645: built by the shared constructor so the producer's own
        // class rides along on `normalisation_code` and the humaniser can pick
        // copy that is TRUE for it. The wire `code` is unchanged, and
        // `addUserMessages` strips the internal field before send.
        for (const warning of normWarnings) {
          critiques.push(normalisationWarningToCritique(warning, randomUUID()));
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
        // ISL success-body critiques merge (ROADMAP 2.410, folds 2.394(a))
        // =================================================================
        // ISL's v2 SUCCESS response carries `critiques` too ("always a list,
        // never None" — its response builder), including coverage disclosures
        // like MARGINAL_SWITCH_TRUNCATED whose entire purpose is to name what
        // was NOT computed on an otherwise-good run. Until this merge, those
        // rows were read on the 422 path only, so every success warning died
        // here — the same one-hop-before-the-consumer death the CEE→UI
        // keep-list had. Same mapper as the 422 path (one function, both
        // paths); appended AFTER PLoT-authored rows so `critiques[0]`
        // consumers (CEE plot-client renders critiques[0].message) keep
        // seeing request-shape issues first. No blockers can arrive here —
        // a blocking condition surfaces as 422 or analysis_status 'failed',
        // both already returned above.
        if (Array.isArray(islResult?.critiques) && islResult.critiques.length > 0) {
          critiques.push(...mapISLCritiquesToV2(islResult.critiques));
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

        // ── Importance authority (lane PLoT importance-authority, 25 Jul 2026) ──
        //
        // Up to here `importance_rank` is a bare positional index over the graph
        // influence order (`computeFactorSensitivityFromGraph`: `importance_rank:
        // index + 1`) — byte-identical to `influence_rank` on every row, so it
        // carried ZERO additional information and, crucially, ranked
        // option-pinned LEVERS at the top.
        //
        // That contradicted PLoT's own ratified lever doctrine, which the SAME
        // response body already applies on three other surfaces
        // (decision_brief.top_drivers, m1_coaching.evidence_gaps, the
        // DOMINANT_FACTOR warning): an option-pinned lever is a decision lever,
        // not a background uncertainty, so it must not consume the top
        // importance slots. Live-verified on staging build 1dd45b6: the wire
        // crowned `fac_tech_lead` (`sensitivity_score: 0`, `elasticity: 0`,
        // `zero_reason: 'intervention_override'`) at `importance_rank: 1` while
        // those three surfaces all named `fac_hiring_cost`, as did ISL.
        //
        // NOT a precedence flip: graph-derived sensitivity stays PRIMARY and
        // `influence_score`/`influence_rank` keep their exact graph values under
        // their own names (a lever still tops `influence_rank` — it genuinely
        // does top the structural influence order). Only the *importance* claim
        // becomes lever-aware. See src/lib/importance-authority.ts.
        if (factorSensitivity) {
          factorSensitivity = applyLeverAwareImportanceOrder(factorSensitivity, structuralLeverIds);
          // Producer disclosure: which authority the rank came from. Constant
          // per response, emitted per row so no consumer can hold the number
          // without the basis. 'graph_structural' on the primary path;
          // 'isl_uncertainty' when the graph path returned nothing and ISL's own
          // Monte-Carlo importance order is what is published.
          const importanceBasis = factorSensitivitySource === 'isl'
            ? IMPORTANCE_BASIS_ISL
            : IMPORTANCE_BASIS_GRAPH;
          for (const f of factorSensitivity) {
            f.importance_basis = importanceBasis;
          }
        }

        // Enrich factor sensitivity with heuristic EVPI percentage points.
        //
        // F3 (ISL #103 / D-23.15): the former ISL COUNTERFACTUAL path — which
        // consumed the removed top-level `factor_evpi[]` and, gated by
        // FLAGS.ISL_FACTOR_EVPI_INTERNAL, replaced the heuristic on this "worth
        // checking next" ranking surface — has been REMOVED with the field. ISL
        // renamed it (win-probability successor `p_win_sensitivity`;
        // outcome-unit `factor_evppi`), so the path could never fire against the
        // current ISL generation; against live ISL this surface was ALWAYS the
        // heuristic (the stale pin fixtures that still carry `factor_evpi` were
        // the only place the dead branch ever executed).
        //
        // WITHHELD, not wired: the honest outcome-unit `factor_evppi` is NOT
        // substituted here. It is in OUTCOME units, whereas this surface's
        // `evpi_percentage_points` is WIN-PROBABILITY percentage points —
        // converting between them needs an outcome-scale→win-probability
        // reconciliation that is not trivially correct, so doing it now would be
        // a wrong-unit/wrong-label defect. The reconciliation + method-tagging
        // is the S5 typed-surface lane's job (D-23.8); until then `factor_evppi`
        // rides the raw top-level passthrough only (see the additive passthrough
        // block above) and is absent from this ranking surface.
        //
        // Heuristic (the only method emitted now): VOI × win-probability-spread
        // × 100, clamped ≥ 0, and self-disclosed as `evpi_method: 'heuristic'`
        // (NOT a real EVPI). See `src/lib/evpi-emission.ts` for the non-negative
        // contract (Howard 1966; OpenAPI `evpi_percentage_points.minimum: 0`).
        if (factorSensitivity) {
          // Doctrine 039 (D-7) — producer-owned driver_label, 4-valued. Single
          // derive-pass over the FINAL merged array (the label can never disagree
          // with the number it is emitted alongside); a suppressed lever keeps its
          // structural influence_score, so its label stays consistent.
          //
          // (1) Per-factor magnitude band (strong/moderate/minor) from each
          //     factor's FINAL emitted influence_score. Absent influence_score ⇒
          //     field omitted (honesty; not eligible to be 'biggest' either).
          for (const f of factorSensitivity) {
            const label = deriveDriverLabel(f.influence_score);
            if (label !== undefined) f.driver_label = label;
          }
          // (2) ⭐ Set-aware rank-1 override — FAMILY-4 S1b: 'biggest' is a
          //     PROJECTION of the canonical driver order, not a second argmax.
          //
          //     `factorSensitivity` has already been through
          //     `applyLeverAwareImportanceOrder` above, so by Rule S3 ("one
          //     order, and the array IS it") index 0 IS
          //     `driver_order.ranked_factor_ids[0]`. Crowning it here — rather
          //     than re-running an argmax over `influence_score` — is what makes
          //     the five #1-naming surfaces one claim instead of five.
          //
          //     ⚠ THIS SUPERSEDES A DELIBERATE PRIOR RULING (lane PLoT
          //     importance-authority, 25 Jul 2026). That lane left the crown
          //     lever-blind on a "blast radius zero" census taken at tips that
          //     have since moved, and on a definitional argument the amendment
          //     re-derived and overturned — see src/lib/driver-label.ts for the
          //     three reasons and what replaced each. The raw structural argmax
          //     is NOT lost: it is still published as `influence_rank === 1`.
          //
          //     ⛔ This does NOT un-demote levers (amendment §4.4). The order is
          //     unchanged; only which row the crown reads off it.
          //
          //     Pinned by tests/driver-order-projection.fixture.test.ts (all five
          //     surfaces, end to end) and tests/doctrine-039-driver-label.test.ts.
          const biggestIdx = indexOfCanonicalTopDriver(factorSensitivity);
          if (biggestIdx >= 0) factorSensitivity[biggestIdx].driver_label = 'biggest';

          const islOptions = processedIslResult?.options ?? processedIslResult?.results ?? [];
          const winProbs = (islOptions as any[])
            .map((o: any) => o.win_probability as number | undefined)
            .filter((wp): wp is number => wp != null)
            .sort((a, b) => b - a);
          const winProbSpread = winProbs.length >= 2 ? winProbs[0] - winProbs[1] : 0;
          if (winProbSpread > 0) {
            for (const f of factorSensitivity) {
              // P0a + D-U: never emit EVPI for an option-controlled lever —
              // ISL-stamped OR structural union member. A lever's VOI is forced
              // to 0 in mergeIslConfidenceIntoGraphFactors, and
              // computeEvpiPercentagePoints(0, …) returns a confident 0 (not
              // undefined) — which would still render an EVPI chip and rank the
              // lever as an "investigation priority". Skip it entirely so
              // evpi_percentage_points is ABSENT (preserving the missing-vs-zero
              // contract), not 0. Belt-and-braces with the producer-side VOI
              // zeroing; suppression only, no EVPI rename/redefine.
              if (isOptionControlledLever(f, structuralLeverIds)) continue;
              const evpiPp = computeEvpiPercentagePoints(f.value_of_information, winProbSpread);
              if (evpiPp !== undefined) {
                f.evpi_percentage_points = evpiPp;
                f.evpi_method = 'heuristic';
              }
            }
          }

          // Doctrine 014 — producer-owned evidence_hint ("gather evidence" gate).
          // Derived AFTER the EVPI enrichment so it reads each factor's FINAL
          // fields. The counterfactual EVPI is withheld (F3), so the gate reads
          // the heuristic VOI only (deriveEvidenceHint). Skip option-controlled
          // levers — a lever is not an evidence-gap candidate (consistent with
          // the EVPI enrichment above, which also skips levers). Absent basis ⇒
          // omitted.
          for (const f of factorSensitivity) {
            if (isOptionControlledLever(f, structuralLeverIds)) continue;
            const hint = deriveEvidenceHint({ realEvpiPp: undefined, voi: f.value_of_information });
            if (hint !== undefined) f.evidence_hint = hint;
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

        const sensitivityData: SensitivityData = {
          edgeSensitivity,
          factorSensitivity,
          edgeEValues,
          conditionalWinners,
          // Family-4 S1: the driver-order attestation's inputs, captured on the
          // path that actually knows them. `structuralLeverIds` is the SAME
          // binding applyLeverAwareImportanceOrder partitioned on above, so the
          // attested `lever_policy`/`lever_ids` describe the order that was
          // really made — not a re-derivation that could drift from it.
          structuralLeverIds,
          factorSensitivitySource,
          islSuppressedAttributions: readIslSuppressedAttributions(islResult),
        };

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
        // usable option AND that every option ISL did NOT flag as incompletely
        // computed is usable — so 'computed' cannot be reported when a computed
        // option's outcome was omitted. (Transitively gates top-level 'computed'
        // via determineTopLevelStatus.)
        //
        // ⚠ ROADMAP 2.744 — THE EXEMPTION LIST NAMED VALUES ISL CANNOT EMIT.
        // It read `r?.status === 'skipped' || r?.status === 'error'`. Both are
        // ENVELOPE-level values; ISL's per-option Literal is
        // ["computed","partial","failed"]. So NOTHING was ever exempt, and a
        // single failed option — which by construction has no usable outcome
        // stats (n_valid === 0) — collapsed hasUsableOptionComparison for the
        // WHOLE run. determineTopLevelStatus then returned 'failed', throwing
        // away a perfectly good comparison of every option that DID compute.
        // That is the exact opposite of the intent stated three lines above.
        const isOptionUsable = (r: any): boolean => hasAllRequiredOutcomeStats(r?.outcome);
        const usableOptionData = optionComparisonData ?? [];
        const hasUsableOptionComparison = hasOptionComparison &&
          usableOptionData.some(isOptionUsable) &&
          usableOptionData.every((r: any) =>
            isNotFullyComputedIslOption(r) || isOptionUsable(r)
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

        // Codex F3: usability is passed EXPLICITLY from the V2 nested-outcome
        // predicate above (hasUsableOptionComparison). The old code re-derived
        // it here from the stale V1 field `expected_outcome`, which the V2
        // wire never carries — so the check was vacuously false and the
        // 'partial' fallback in determineTopLevelStatus did the (wrong) work.
        const topLevelStatus = determineTopLevelStatus(
          optionStatus,
          robustnessStatus,
          driversStatus,  // Uses hasDriversSensitivity which checks both edge AND factor
          hasUsableOptionComparison,
          // 2.744: ISL's own verdict on the run, so PLoT cannot report it
          // healthier than the producer declared it.
          islAnalysisStatus
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

          // A3 adjacent-hunt FIX #1 (coaching companion): mirror buildResponse's
          // per-option direction-suspect detection so the coaching joint-prob
          // gate abstains on the SAME suspicion FIX #1 uses to withhold the
          // top-level wire block. Same inputs (processedIslResult +
          // activeGoalConstraints) → same verdict as the wire gate: the single
          // synthesised auto-constraint's guessed '>=' is structurally
          // unsatisfiable for at least one option (positive threshold, p90 < 0,
          // finite-guarded exactly as the option map is). Without this the gate
          // reads the near-0 joint_probability directly and emits
          // GOAL_FEASIBILITY_LOW — contradicting the 'unavailable' wire block.
          const coachingConstraintTargetDirectionSuspect = (() => {
            const autoConstraint = activeGoalConstraints?.find(
              (c) => (c as { _internal?: { source?: string } })._internal?.source === 'auto_from_goal_threshold',
            );
            if (!autoConstraint) return false;
            const islOptionData: any[] =
              processedIslResult?.options ?? processedIslResult?.results ?? [];
            return islOptionData.some(
              (r) =>
                hasAllRequiredOutcomeStats(r?.outcome) &&
                isAutoConstraintDirectionSuspect(autoConstraint.value, r?.outcome?.p90),
            );
          })();

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
            coachingConstraintTargetDirectionSuspect,  // FIX #1 companion: skip joint-prob gate on direction-suspect targets
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
        // A3 lane 2: error NAME captured when the ENTIRE flip block throws —
        // drives the FLIP_THRESHOLDS_UNAVAILABLE inference warning (wire
        // disclosure of the previously server-log-only degradation).
        let flipThresholdsFailedErrorName: string | undefined;

        // ROADMAP 2.228-F3 — THE BISECTION PROBE IS RETIRED ON THIS ROUTE.
        //
        // What used to be here: heuristic candidate selection (top 5 by
        // |elasticity|, minus factors every option intervenes on) followed by an
        // ISL-driven binary search, one full Monte Carlo per probe value, under
        // FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS / FLIP_SEARCH_OVERALL_TIMEOUT_MS
        // budgets clamped to the remaining request budget.
        //
        // Why it is gone: the 2.228 diagnosis proved the candidate selection was
        // mathematically incapable of finding a flip. After lever suppression it
        // probes argmax-INVARIANT factors — for a factor no option intervenes on
        // and that is not upstream of differential severing, every option's
        // outcome moves by the IDENTICAL amount, so the argmax cannot change.
        // 43 live rows, zero `found`. Worse than useless: each run spent up to
        // five ISL round trips and a 60s budget to publish `flip_value: null`
        // under a `no_effect_within_bounds` label it had never established.
        //
        // What replaces it: ISL's closed-form `factor_flip_values` (PR #117).
        // Epsilon noise is disabled before post-MC structural analysis, so the
        // SCM is exactly affine in a root factor's value; two deterministic
        // evaluations per option measure the transmission slopes and the
        // leader/rival crossing is algebraic. No Monte Carlo, no probe budget,
        // no timeout class — and an attested `structurally_invariant` where the
        // probe used to guess.
        //
        // ⚠ NO PROBE FALLBACK IS KEPT. If ISL omits the block (budget trip), the
        // honest wire statement is `flip_thresholds_status: 'unavailable'` plus
        // ISL's own FACTOR_FLIPS_UNAVAILABLE on `inference_warnings` (merged
        // into the PLoT array by buildResponse). Re-running the probe there
        // would republish the false no-effect attestation this lane removed.
        //
        // The old three-way guard (`factorSensitivity && optionComparisonData &&
        // length >= 2`) guarded the PROBE's preconditions — heuristic selection
        // needed elasticities and a two-option margin. The closed-form block
        // needs neither; ISL computed it against its own baseline winner.
        if (islSuccess) {
          try {
            const factorFlipMapping = mapIslFactorFlipValues(islResult?.factor_flip_values, {
              graph: filteredGraph,
              factorSensitivity: factorSensitivity as { factor_id: string; factor_label?: string }[] | undefined,
              // ISL design R3: its closed-form search runs in the EXPECTED-VALUE
              // world, which need not agree with the sampled MC recommendation.
              // Passed so disagreement is COUNTED and logged rather than assumed
              // away; no row's winner ids are rewritten.
              recommendedWinnerId: (() => {
                const top = Array.isArray(optionComparisonData)
                  ? [...optionComparisonData].sort(
                      (a: any, b: any) => (b.win_probability ?? 0) - (a.win_probability ?? 0),
                    )[0]
                  : undefined;
                return (top as any)?.option_id ?? (top as any)?.id ?? undefined;
              })(),
            });

            if (factorFlipMapping === undefined) {
              // ISL emitted no block at all. Distinct from an EMPTY block (ISL
              // ran the phase and found no eligible root factors), which maps to
              // zero rows below. Left undefined so flip_thresholds ships [] and
              // classifyFlipThresholdsStatus says 'unavailable' — never
              // 'all_no_effect', which would assert a result nobody computed.
              // ⚠ REVIEW S5 — THE FIELD NAME IS A KEY, NOT PROSE, ON PURPOSE.
              // This used to read `note: 'ISL omitted factor_flip_values; …'`
              // and shipped as `ISL omitted sha8:513e0c37_flip_values` — the
              // redactor digests graph-derived tokens found inside string
              // VALUES, and `factor` is one whenever the request carries a node
              // id containing it. An operator grepping the logs for
              // `factor_flip_values` after a silent flip outage would have found
              // nothing. Key names are preserved verbatim, so the name lives
              // there instead; the two remaining values are fixed literals that
              // no graph token can collide with.
              req.log.info({
                event: 'flip_thresholds_isl_block_absent',
                request_id: requestId,
                factor_flip_values: 'absent',
                isl_disclosure_expected: 'FACTOR_FLIPS_UNAVAILABLE',
              });
            } else {
              resolvedFlipData = factorFlipMapping.rows;

              req.log.info({
                event: 'flip_thresholds_resolved',
                request_id: requestId,
                source: 'isl_closed_form',
                count: resolvedFlipData.length,
                elapsed_ms: Math.round(performance.now() - startTime),
                // Counts only — never a factor id or a value.
                ...factorFlipMapping.diagnostics,
              });

              if (factorFlipMapping.diagnostics.baseline_winner_disagreement > 0) {
                // ISL design R3, surfaced rather than reconciled: the flip is
                // measured against the expected-value argmax, which disagrees
                // with the MC recommendation on these rows.
                req.log.warn({
                  event: 'flip_thresholds_baseline_winner_disagreement',
                  request_id: requestId,
                  rows: factorFlipMapping.diagnostics.baseline_winner_disagreement,
                });
              }
              if (factorFlipMapping.diagnostics.rejected_malformed > 0) {
                req.log.warn({
                  event: 'flip_thresholds_isl_rows_rejected',
                  request_id: requestId,
                  rejected: factorFlipMapping.diagnostics.rejected_malformed,
                });
              }

              // Denormalise to user units — the SAME path #298 built, unchanged.
              // ROADMAP 2.228 F2: `normalisationContext` is undefined for the
              // whole V5 request (Phase 4a only fires on out-of-[0,1] option
              // intervention values), so `filteredGraph` is passed as the
              // per-factor scale source — the same graph the ISL request was
              // built from, whose nodes carry observed_state.cap / raw_value.
              // Without it every row ships a normalised [0,1] number wearing a
              // currency unit. `value_scale: 'display'` is still stamped ONLY
              // where an explicit_cap range genuinely lifted the pair; the
              // [0,1] identity fallback stays refused.
              flipThresholds = denormaliseFlipThresholds(
                resolvedFlipData,
                normalisationContext,
                normalizedOptions,
                filteredGraph
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
                OPTIONAL_PHASE_MAX_RETRIES
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
            // ROADMAP 2.676 — see the field comment below. Computed here rather
            // than inline so the REFUSALS can be counted: a row dropped for
            // being un-liftable is a card the user does not get, and a drop
            // nobody can observe is the estate's own silent-drop defect class.
            // Counts only — never a factor id, never a value.
            const promptFlipRows =
              flipThresholds !== undefined ? toPromptFlipThresholdData(flipThresholds) : undefined;
            if (promptFlipRows !== undefined && flipThresholds !== undefined) {
              const refused = flipThresholds.length - promptFlipRows.length;
              if (refused > 0) {
                req.log.info({
                  event: 'decision_review_flip_rows_scale_refused',
                  request_id: requestId,
                  refused,
                  total: flipThresholds.length,
                });
              }
            }

            const decisionReviewInput: DecisionReviewInput = {
              brief: body.brief,
              graph: filteredGraph,
              options: normalizedOptions,
              islResult: processedIslResult,
              m1Coaching,
              responseHash: responseHash ?? requestId,
              requestId,
              // Pass pre-resolved flip data so orchestrator skips redundant ISL
              // calls.
              //
              // ⚠ ROADMAP 2.676 — DERIVED FROM `flipThresholds`, NOT FROM
              // `resolvedFlipData`. This used to read `resolvedFlipData`, i.e.
              // the rows as ISL emitted them, in NORMALISED [0,1] space —
              // while the response's own `flip_thresholds` block shipped the
              // denormalised pair computed ~270 lines above. CEE's
              // decision_review prompt is told these values are user units and
              // instructs the model to quote them WITH the unit appended, so
              // the same HTTP response carried `16000 GBP → 12243 GBP` at top
              // level and `"0.5 GBP" → "0.382593 GBP"` inside the review
              // (measured on the deployed builds:
              // `PHASE0-EVIDENCE-2026-07-28/probe2676-2026-08-07/`).
              //
              // The same array is ALSO what Tier-7 validates the returned
              // review against — `buildValidationContext(request)` reads
              // `request.flip_threshold_data`, which the orchestrator assigns
              // from this field. So the un-denormalised rows made the integrity
              // guard enforce identity against the WRONG number, and a model
              // that wrote the honest figure had its ENTIRE review discarded
              // (`MODIFIED_VALUES`, blocking). One cause, two faces; both close
              // here.
              //
              // `undefined` is preserved as `undefined`: when ISL emitted no
              // block — or when denormalisation itself threw, leaving
              // `flipThresholds` unset while `resolvedFlipData` survived — the
              // orchestrator's own fallback must stay reachable, and passing
              // the normalised rows on that path is the very defect being
              // closed.
              preResolvedFlipData: promptFlipRows,
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

        // Sub-item 1d + Codex F1 (a): derive the per-option clamp DIRECTION
        // map from the RECORDED normalisation diagnostics
        // (Map<optionId, Map<factorId, 'high'|'low'>>, entry present ONLY when
        // clamped; direction from the recorded post-clamp normalised_value:
        // >= 1 → 'high', <= 0 → 'low'). Reading the recorded diagnostics is
        // authoritative — recomputing from the per-option interventions
        // reaching buildResponse would read the already normalised [0,1]
        // values and always report "not clamped". The companion
        // optionDiagnosedFactors set records which factors carry a diagnostic
        // at all, so "diagnosed and not clamped" (exact) stays distinguishable
        // from "never diagnosed" (unknown → no precision claim). Feeds
        // constraint_margins margin_precision.
        const optionClampDirectionByFactor = new Map<string, Map<string, 'high' | 'low'>>();
        const optionDiagnosedFactors = new Map<string, Set<string>>();
        for (const d of normalisationDiagnostics) {
          let diagnosed = optionDiagnosedFactors.get(d.option_id);
          if (!diagnosed) {
            diagnosed = new Set<string>();
            optionDiagnosedFactors.set(d.option_id, diagnosed);
          }
          if (d.clamped) {
            const direction = d.normalised_value >= 1 ? 'high' : d.normalised_value <= 0 ? 'low' : undefined;
            if (direction === undefined) {
              // Degenerate clamp (zero-width range path) with an interior
              // normalised value: direction is indeterminate. Record NEITHER a
              // direction nor a diagnostic mark, so the margin builder makes
              // NO precision claim (neither 'lower_bound' nor 'exact').
              continue;
            }
            let inner = optionClampDirectionByFactor.get(d.option_id);
            if (!inner) {
              inner = new Map<string, 'high' | 'low'>();
              optionClampDirectionByFactor.set(d.option_id, inner);
            }
            inner.set(d.factor_id, direction);
          }
          diagnosed.add(d.factor_id);
        }

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
            nSamplesReducedReason,
            // ROADMAP 2.228-F3: no probe runs on this route any more, so there
            // is no probe depth to report. Deliberately not passed as
            // `undefined` from a dead local — the local is gone with the probe.
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
          req.log,  // logger for fact_objects assembly logging
          optionClampDirectionByFactor,  // 1d + Codex F1: per-option clamp DIRECTION map for margin_precision
          optionDiagnosedFactors,  // Codex F1: factors with a recorded diagnostic (exact vs unknown)
          constraintScaleProvenanceByConstraintId,  // A3 trust marker: scale_provenance + constraints_decision_grade (also carries F2a threshold_clamped)
          goalThresholdFrameByNodeId  // L63: constraint sample-frame gate input (producer 'delta' attestation)
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
