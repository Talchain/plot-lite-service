/**
 * Decision Brief Assembly
 *
 * Pure function that assembles a DecisionBriefV1 from existing run_bundle response data.
 * No service calls, no LLM calls — deterministic assembly from computed fields.
 *
 * Same response data → same brief (including deterministic brief_id).
 */

/**
 * DecisionBriefV1 Assembly Mapping (G.1)
 *
 * headline:          m2_decision_review.narrative_summary → executive_summary.summary
 * options:           option_comparison[] sorted by win_probability desc
 * top_drivers:       factor_sensitivity[] top 5 by abs(elasticity)
 * key_assumptions:   m1_coaching.evidence_gaps[].factor_label → []
 * what_would_change: robustness.fragile_edges[].from_label/to_label → factor_sensitivity[].factor_label (sorted by |elasticity|)
 * robustness:        robustness.level → 'moderate' (default)
 * warnings:          critiques (severity>=warning) + m1_coaching.model_critiques → []
 * lineage.response_hash: meta.response_hash (computed before brief assembly)
 * lineage.config_version: SHA-256 hash of n_samples_default + review/facts flags + brief_assembly_version
 */

import { createHash } from 'node:crypto';
import type {
  DecisionBriefV1,
  BriefOption,
  BriefDriver,
  BriefWarning,
  BriefLineage,
  BriefBandedHeadline,
  BriefDefaultedAssumption,
  BriefRobustnessCaveat,
  BriefAnalysisSummary,
} from '../types/decision-brief.js';
import { DECISION_BRIEF_VERSION } from '../types/decision-brief.js';
import type { RunResponseV3 } from '../types/engine-v3.js';
import { STANDARD_N_SAMPLES_DEFAULT } from '../config/sampling.js';
import { FLAGS } from '../config/flags.js';
// Lane PLoT-R3: 'very close' band shares the near-tie threshold (0.10) with
// computeNearTie so the brief and robustness.near_tie can never disagree.
import { NEAR_TIE_THRESHOLD } from '../trust/result-coherence.js';
// A1b: intervention-controlled levers are not independently tunable; exclude them
// from the |elasticity|-ranked tunability surfaces (top_drivers, what_would_change).
import { filterInterventionOverrides, interventionOverrideFactorIds, filterLeverSourcedFragileEdges } from '../lib/intervention-override.js';

// =============================================================================
// Constants
// =============================================================================

const MAX_TOP_DRIVERS = 5;
const MAX_WARNINGS = 10;
const MAX_KEY_ASSUMPTIONS = 10;
const MAX_WHAT_WOULD_CHANGE = 10;
const MAX_DEFAULTED_ASSUMPTIONS = 10;
const MAX_WARNING_CODES = 20;

/**
 * provisional_doctrine_v0 — gap at/above which the leader MAY be called
 * 'clearly ahead' (still requires established robustness; see
 * buildBandedHeadline). Below it (and at/above NEAR_TIE_THRESHOLD) the claim
 * is 'slightly ahead'. Deliberately far above the UI's UI-SEM-006/060
 * GAP_THRESHOLD (0.10) so the strongest wording needs a decisive gap.
 */
export const CLEARLY_AHEAD_GAP_THRESHOLD = 0.25;

/**
 * Deterministic brief_id: SHA-256 of `graph_hash:seed:config_version`,
 * first 16 bytes formatted as UUID v4 layout (version + variant bits set).
 */
function computeBriefId(graphHash: string, seed: number, configVersion: string): string {
  const digest = createHash('sha256')
    .update(`${graphHash}:${seed}:${configVersion}`)
    .digest();
  // Take first 16 bytes and format as UUID v4
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Set version (4) in byte 6
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // Set variant (10xx) in byte 8
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Compute config_version as SHA-256 hash of computation-affecting config values.
 *
 * Track S: the sample depth is now a per-request input (was hardcoded 1000), so
 * briefs computed at different depths get different config_versions (and thus
 * different brief_ids). Defaults to the standard depth (PR-E: 4000) when omitted.
 * The live route always passes the resolved depth, so the default only affects
 * direct callers/tests.
 */
function computeConfigVersion(nSamples: number = STANDARD_N_SAMPLES_DEFAULT): string {
  const configInputs = {
    n_samples_default: nSamples,
    enable_review_pass: process.env.ENABLE_REVIEW_PASS ?? 'default',
    enable_facts_assembly: process.env.ENABLE_FACTS_ASSEMBLY ?? 'default',
    brief_assembly_version: '1',
  };
  return createHash('sha256')
    .update(JSON.stringify(configInputs))
    .digest('hex')
    .slice(0, 12);
}

// =============================================================================
// Assembly Input
// =============================================================================

/**
 * Subset of RunResponseV3 needed for brief assembly.
 * Using Pick/Partial to stay coupled to the canonical response type.
 */
export type BriefAssemblyInput = Pick<RunResponseV3, 'analysis_status' | 'critiques'> & {
  option_comparison?: RunResponseV3['option_comparison'];
  factor_sensitivity?: RunResponseV3['factor_sensitivity'];
  robustness?: RunResponseV3['robustness'];
  m1_coaching?: RunResponseV3['m1_coaching'];
  m1_review?: RunResponseV3['m1_review'];
  /**
   * Lane PLoT-R3 (additive, optional): the run's inference_warnings, used for
   * warning_codes (warning-severity echo) and defaulted_assumptions
   * (DEFAULT-coded disclosures). Absent → both surfaces treat as none.
   */
  inference_warnings?: RunResponseV3['inference_warnings'];
  response_hash?: string;
  meta: {
    seed_used: string;
    /** Track S: resolved Monte Carlo sample depth (drives config_version + lineage.n_samples) */
    n_samples?: number;
  };
};

// =============================================================================
// Robustness Level Mapping
// =============================================================================

/**
 * Pure projection of ISL `robustness.level` onto the
 * `DecisionBriefV1.robustness` field (narrow union
 * `'robust' | 'moderate' | 'fragile'`).
 *
 * **This is NOT a synthesis.** It does not consult fragile edges, evidence
 * gaps, low driver confidence, or `recommendation_stability`. Those signals
 * are surfaced separately:
 *   - fragile edges → `what_would_change` and (via PR #174 tone gate) the
 *     `headline` wording;
 *   - evidence gaps → `key_assumptions` and (via tone gate) `headline`;
 *   - low driver confidence and near-tie status → tone gate `headline`.
 *
 * The semantic mapping is "graph perturbation stability under ISL's
 * robustness analysis" — `high → 'robust'`, `moderate → 'moderate'`,
 * `low | very_low → 'fragile'`. See `src/types/decision-brief.ts` jsdoc
 * for the consumer-facing contract and the readiness-widening follow-up
 * for the longer-term action-readiness surface.
 */
function mapRobustnessLevel(level: string | undefined): 'robust' | 'moderate' | 'fragile' {
  switch (level) {
    case 'high': return 'robust';
    case 'moderate': return 'moderate';
    case 'low':
    case 'very_low': return 'fragile';
    default: return 'moderate';
  }
}

// =============================================================================
// Assembly
// =============================================================================

/**
 * Assemble a DecisionBriefV1 from run_bundle response data.
 *
 * Returns null when analysis_status is 'blocked' or 'failed' — no brief for
 * incomplete analyses.
 *
 * Pure function: deterministic given the same input (only brief_id and
 * created_at are non-deterministic).
 */
export function assembleBrief(input: BriefAssemblyInput): DecisionBriefV1 | null {
  const { analysis_status } = input;

  // No brief for blocked or failed analyses
  if (analysis_status === 'failed') return null;
  // 'blocked' is not a standard TopLevelAnalysisStatus but guard defensively
  if ((analysis_status as string) === 'blocked') return null;

  // No brief when required source data is absent — analysis is incomplete
  const optionComparison = input.option_comparison;
  if (!optionComparison || optionComparison.length === 0) return null;
  if (!input.robustness) return null;

  const isPartial = analysis_status === 'partial';

  // --- Headline ---
  const headline = resolveHeadline(input);

  // --- Options ---
  const options = buildOptions(input);

  // --- Top Drivers ---
  const topDrivers = buildTopDrivers(input);

  // --- Key Assumptions ---
  const keyAssumptions = buildKeyAssumptions(input);

  // --- What Would Change ---
  const whatWouldChange = buildWhatWouldChange(input);

  // --- Robustness ---
  const robustness = mapRobustnessLevel(input.robustness?.level);

  // --- Warnings ---
  const warnings = buildWarnings(input, isPartial);

  // --- Lineage ---
  const lineage = buildLineage(input);

  // --- Snapshot identity ---
  const graphHash = input.response_hash ?? '';
  const seed = Number(input.meta.seed_used);
  const briefId = computeBriefId(graphHash, seed, lineage.config_version);

  // --- Lane PLoT-R3 claim-safe surfaces (provisional_doctrine_v0) ---
  // Gated default-ON; the flag exists ONLY so pre-R3 golden fixtures stay
  // byte-identical (see FLAGS.BRIEF_CLAIM_SAFE_SURFACES_ENABLE).
  const claimSafeSurfaces = FLAGS.BRIEF_CLAIM_SAFE_SURFACES_ENABLE
    ? {
        ...(() => {
          const banded = buildBandedHeadline(options, input);
          return banded ? { headline_banded: banded } : {};
        })(),
        defaulted_assumptions: buildDefaultedAssumptions(input),
        robustness_caveat: buildRobustnessCaveat(input),
        warning_codes: buildWarningCodes(input),
      }
    : {};

  // --- Platform lane (roadmap 3.1): decision-record capture surface ---
  // Gated default-OFF (dark ship); shape pinned against
  // DecisionRecordAnalysisSummarySchema.strict() in
  // tests/decision-brief.analysis-summary.test.ts.
  const analysisSummarySurface = FLAGS.BRIEF_DECISION_RECORD_SUMMARY_ENABLE
    ? (() => {
        const summary = buildAnalysisSummary(options, input);
        return summary ? { analysis_summary: summary } : {};
      })()
    : {};

  return {
    brief_id: briefId,
    version: DECISION_BRIEF_VERSION,
    graph_hash: graphHash,
    seed,
    created_at: new Date().toISOString(),
    headline,
    options,
    top_drivers: topDrivers,
    key_assumptions: keyAssumptions,
    what_would_change: whatWouldChange,
    robustness,
    warnings,
    lineage,
    ...claimSafeSurfaces,
    ...analysisSummarySurface,
  };
}

// =============================================================================
// Field Builders
// =============================================================================

function resolveHeadline(input: BriefAssemblyInput): string {
  // Primary: M2 decision review narrative_summary
  const m2Summary = input.m1_review?.narrative_summary?.trim();
  if (m2Summary) return m2Summary;

  // Fallback: M1 coaching executive_summary.summary
  const m1Summary = input.m1_coaching?.executive_summary?.summary?.trim();
  if (m1Summary) return m1Summary;

  // Final fallback
  return 'Analysis complete';
}

function buildOptions(input: BriefAssemblyInput): BriefOption[] {
  const optionComparison = input.option_comparison;
  if (!optionComparison || optionComparison.length === 0) return [];

  // Sort by win_probability descending, then option_id ascending for deterministic tie-breaking
  const sorted = [...optionComparison]
    .filter(o => o.win_probability !== undefined && o.win_probability !== null)
    .sort((a, b) => {
      const diff = (b.win_probability ?? 0) - (a.win_probability ?? 0);
      if (diff !== 0) return diff;
      return a.option_id < b.option_id ? -1 : a.option_id > b.option_id ? 1 : 0;
    });

  return sorted.map((o, i) => ({
    option_id: o.option_id,
    label: o.option_label || o.label || o.option_id,
    win_probability: o.win_probability ?? 0,
    rank: i + 1,
  }));
}

/**
 * Platform lane (roadmap 3.1): the decision-record capture surface.
 *
 * Ratified seam (orchestrator, 2026-07-10) — every field copied, none
 * derived: leading_option/win_probability from the rank-1 option (the same
 * deterministic ranking as buildOptions), goal_fit from the LEADER's
 * probability_of_joint_goal (omitted when absent — never invented from
 * probability_of_goal or anything else), robustness_band from
 * robustness.display_verdict VERBATIM incl. 'not_assessed' (omitted when
 * the verdict is absent — never derived from level/is_robust; that honest
 * mapping already happened in robustness-display-verdict.ts).
 *
 * Returns undefined when no ranked leader exists — the surface is
 * optional-forward and consumers tolerate absence.
 */
function buildAnalysisSummary(
  options: BriefOption[],
  input: BriefAssemblyInput,
): BriefAnalysisSummary | undefined {
  const leader = options[0];
  if (!leader) return undefined;

  const summary: BriefAnalysisSummary = {
    leading_option: leader.label,
    win_probability: leader.win_probability,
  };

  const leaderComparison = (input.option_comparison ?? []).find(
    (o) => o.option_id === leader.option_id,
  );
  const goalFit = leaderComparison?.probability_of_joint_goal;
  if (typeof goalFit === 'number' && Number.isFinite(goalFit)) {
    summary.goal_fit = goalFit;
  }

  const verdict = input.robustness?.display_verdict;
  if (typeof verdict === 'string' && verdict.length > 0) {
    summary.robustness_band = verdict;
  }

  return summary;
}

function buildTopDrivers(input: BriefAssemblyInput): BriefDriver[] {
  // A1b: exclude intervention-controlled levers — top_drivers ranks by
  // abs(elasticity) and would otherwise present option-pinned levers as tunable.
  const factors = filterInterventionOverrides(input.factor_sensitivity ?? []);
  if (factors.length === 0) return [];

  // Sort by absolute elasticity descending, ties broken by factor_id (node_id) bytewise ascending
  const withElasticity = factors
    .filter(f => f.elasticity !== undefined && f.elasticity !== null)
    .sort((a, b) => {
      const diff = Math.abs(b.elasticity!) - Math.abs(a.elasticity!);
      if (diff !== 0) return diff;
      return a.factor_id < b.factor_id ? -1 : a.factor_id > b.factor_id ? 1 : 0;
    })
    .slice(0, MAX_TOP_DRIVERS);

  // Direction prefers the upstream signed `direction` field — the canonical
  // source already used by factor_sensitivity[*].direction and
  // m1_coaching.key_drivers[*].direction. Deriving from sign(elasticity)
  // mislabels negative drivers as positive in production because no real
  // path emits a signed elasticity: the graph path sets
  // `elasticity = normalised_influence` (always >= 0) and the ISL path
  // sets it to null. Output `BriefDriver.direction` is the narrow union
  // 'positive' | 'negative', so 'mixed' / 'unknown' / missing fall back to
  // sign(elasticity) — which yields 'positive' for unsigned magnitudes.
  return withElasticity.map(f => {
    let direction: 'positive' | 'negative';
    if (f.direction === 'positive') {
      direction = 'positive';
    } else if (f.direction === 'negative') {
      direction = 'negative';
    } else {
      direction = f.elasticity! < 0 ? 'negative' : 'positive';
    }
    return {
      factor_label: f.factor_label?.trim() || f.factor_id,
      sensitivity: Math.abs(f.elasticity!),
      direction,
    };
  });
}

function buildKeyAssumptions(input: BriefAssemblyInput): string[] {
  const gaps = input.m1_coaching?.evidence_gaps;
  if (!gaps || gaps.length === 0) return [];

  return gaps
    .map(g => g.factor_label?.trim())
    .filter((label): label is string => !!label)
    .slice(0, MAX_KEY_ASSUMPTIONS);
}

function buildWhatWouldChange(input: BriefAssemblyInput): string[] {
  // A1c: lever-id set from zero_reason (BriefAssemblyInput carries no interventionTargetIds).
  const leverIds = interventionOverrideFactorIds(input.factor_sensitivity ?? []);
  // Primary: fragile edges — A1c excludes edges SOURCED from an option-pinned lever
  // ("lever → X" here would imply the user can tune the pinned lever). Non-lever
  // fragile edges are kept; if none remain, fall through to the (A1b-filtered) factor path.
  const fragileEdges = filterLeverSourcedFragileEdges(input.robustness?.fragile_edges ?? [], leverIds, (e) => e.from_id);
  if (fragileEdges.length > 0) {
    return fragileEdges
      .map(e => {
        const from = e.from_label?.trim() || e.from_id;
        const to = e.to_label?.trim() || e.to_id;
        return `${from} → ${to}`;
      })
      .filter(s => s.length > 0)
      .slice(0, MAX_WHAT_WOULD_CHANGE);
  }

  // Fallback: factor_sensitivity labels (top drivers by |elasticity|)
  // A1b: exclude intervention-controlled levers from this |elasticity|-ranked fallback.
  const factors = filterInterventionOverrides(input.factor_sensitivity ?? []);
  if (factors.length > 0) {
    return factors
      .filter(f => f.elasticity !== undefined && f.elasticity !== null)
      .sort((a, b) => Math.abs(b.elasticity!) - Math.abs(a.elasticity!))
      .map(f => f.factor_label?.trim() || f.factor_id)
      .filter((label): label is string => !!label)
      .slice(0, MAX_WHAT_WOULD_CHANGE);
  }

  return [];
}

function buildWarnings(input: BriefAssemblyInput, isPartial: boolean): BriefWarning[] {
  const warnings: BriefWarning[] = [];

  // Partial analysis warning
  if (isPartial) {
    warnings.push({
      code: 'PARTIAL_ANALYSIS',
      message: 'Some analysis features were unavailable',
      severity: 'warning',
    });
  }

  // M2 decision review unavailable — brief uses deterministic coaching fallback
  if (!input.m1_review) {
    warnings.push({
      code: 'M2_UNAVAILABLE',
      message: 'Decision review was unavailable; brief uses deterministic coaching fallback',
      severity: 'warning',
    });
  }

  // Critiques where severity !== 'info'
  for (const c of input.critiques) {
    if (c.severity === 'info') continue;
    warnings.push({
      code: c.code,
      message: c.message,
      severity: c.severity === 'error' || c.severity === 'blocker' ? 'error' : 'warning',
    });
  }

  // M1 coaching model critiques
  const modelCritiques = input.m1_coaching?.model_critiques;
  if (modelCritiques) {
    for (const mc of modelCritiques) {
      warnings.push({
        code: mc.type,
        message: mc.challenge_question,
        severity: mc.severity === 'blocker' ? 'error' : mc.severity === 'warn' ? 'warning' : 'info',
      });
    }
  }

  // Dedup on code (keep first occurrence)
  const seen = new Set<string>();
  const deduped: BriefWarning[] = [];
  for (const w of warnings) {
    if (!seen.has(w.code)) {
      seen.add(w.code);
      deduped.push(w);
    }
  }

  // Sort: severity desc (error > warning > info), then code bytewise ascending
  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  deduped.sort((a, b) => {
    const sevDiff = (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2);
    if (sevDiff !== 0) return sevDiff;
    return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
  });

  // Cap at MAX_WARNINGS
  return deduped.slice(0, MAX_WARNINGS);
}

function buildLineage(input: BriefAssemblyInput): BriefLineage {
  const nSamples = input.meta.n_samples;
  return {
    config_version: computeConfigVersion(nSamples),
    response_hash: input.response_hash ?? '',
    // Track S: record sample depth explicitly. Omitted when absent so pre-Track-S
    // briefs (and fixtures without a depth) keep their existing lineage shape.
    ...(nSamples !== undefined ? { n_samples: nSamples } : {}),
  };
}

// =============================================================================
// Lane PLoT-R3 claim-safe surface builders (provisional_doctrine_v0)
//
// Wording rules enforced here:
//   - band vocabulary is EXACTLY 'very close' / 'slightly ahead' /
//     'clearly ahead' — and 'clearly ahead' only when robustness is
//     established (UI-SEM-060 producer leg);
//   - no 'EVPI', no 'expected value', no 'sensitive to <factor>' phrasing;
//   - intervention-pinned levers never appear in "check this" framing
//     (value_defaulted disclosures filter them like top_drivers does);
//   - nothing is invented: every sentence is derived from a present upstream
//     signal, and absence is stated as absence (robustness_caveat 'absent').
// =============================================================================

/**
 * Robustness is "established" only on a positive signal: an explicit
 * `is_robust === true`, or `level === 'high'` without an explicit
 * `is_robust === false` contradicting it. Missing signals never count.
 */
function isRobustnessEstablished(robustness: BriefAssemblyInput['robustness']): boolean {
  if (!robustness) return false;
  if (robustness.is_robust === true) return true;
  if (robustness.is_robust === false) return false;
  return robustness.level === 'high';
}

/**
 * Leader claim banded by win-probability gap (provisional_doctrine_v0):
 *   gap <  NEAR_TIE_THRESHOLD (0.10)        → 'very_close'
 *   gap >= CLEARLY_AHEAD_GAP_THRESHOLD (0.25)
 *     AND robustness established            → 'clearly_ahead'
 *   otherwise                               → 'slightly_ahead'
 *     (robustness_gated: true when only the missing robustness kept the
 *      claim out of 'clearly_ahead')
 *
 * Returns null when fewer than two ranked options exist — no comparative
 * claim without a comparison.
 */
function buildBandedHeadline(
  options: BriefOption[],
  input: BriefAssemblyInput,
): BriefBandedHeadline | null {
  if (options.length < 2) return null;

  const leader = options[0];
  const runnerUp = options[1];
  const gap = leader.win_probability - runnerUp.win_probability;
  const robust = isRobustnessEstablished(input.robustness);

  let band: BriefBandedHeadline['band'];
  let robustnessGated = false;
  let text: string;

  if (gap < NEAR_TIE_THRESHOLD) {
    band = 'very_close';
    // provisional_doctrine_v0
    text = `${leader.label} leads, but the top options are very close.`;
  } else if (gap >= CLEARLY_AHEAD_GAP_THRESHOLD && robust) {
    band = 'clearly_ahead';
    // provisional_doctrine_v0 — strongest claim requires decisive gap AND robustness
    text = `${leader.label} is clearly ahead.`;
  } else {
    band = 'slightly_ahead';
    robustnessGated = gap >= CLEARLY_AHEAD_GAP_THRESHOLD && !robust;
    // provisional_doctrine_v0
    text = `${leader.label} is slightly ahead.`;
  }

  return {
    text,
    band,
    leader_option_id: leader.option_id,
    leader_label: leader.label,
    runner_up_option_id: runnerUp.option_id,
    runner_up_label: runnerUp.label,
    win_probability_gap: gap,
    robustness_gated: robustnessGated,
    doctrine: 'provisional_doctrine_v0',
  };
}

/**
 * Defaulted-input disclosures:
 *   1. factor_sensitivity entries with value_defaulted === true —
 *      intervention-pinned levers EXCLUDED (a pinned lever must never appear
 *      in "check this input" framing; same A1b predicate as top_drivers).
 *      Sorted by factor_id bytewise for determinism.
 *   2. inference warnings whose code contains 'DEFAULT'
 *      (e.g. ROOT_NODE_DEFAULT_VALUE) — run-level disclosures echoed
 *      verbatim (message is producer-owned wording), sorted by code.
 * Capped at MAX_DEFAULTED_ASSUMPTIONS, factor-scoped entries first.
 */
function buildDefaultedAssumptions(input: BriefAssemblyInput): BriefDefaultedAssumption[] {
  const out: BriefDefaultedAssumption[] = [];

  const factors = filterInterventionOverrides(input.factor_sensitivity ?? [])
    .filter((f) => f.value_defaulted === true)
    .sort((a, b) => (a.factor_id < b.factor_id ? -1 : a.factor_id > b.factor_id ? 1 : 0));
  for (const f of factors) {
    const label = f.factor_label?.trim() || f.factor_id;
    out.push({
      factor_label: label,
      // provisional_doctrine_v0
      note: `No starting value was provided for "${label}" — the analysis used a default. Setting a real value or range would make this result more trustworthy.`,
      source: 'value_defaulted',
      doctrine: 'provisional_doctrine_v0',
    });
  }

  const seenCodes = new Set<string>();
  const defaultWarnings = (input.inference_warnings ?? [])
    .filter((w) => typeof w.code === 'string' && w.code.includes('DEFAULT'))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const w of defaultWarnings) {
    if (seenCodes.has(w.code)) continue;
    seenCodes.add(w.code);
    out.push({
      factor_label: null,
      note: w.message,
      source: 'default_disclosure',
      code: w.code,
      doctrine: 'provisional_doctrine_v0',
    });
  }

  return out.slice(0, MAX_DEFAULTED_ASSUMPTIONS);
}

/**
 * Honest robustness caveat (provisional_doctrine_v0). Wording is derived
 * strictly from upstream signals; when neither is_robust nor level is
 * present the caveat SAYS robustness was not assessed instead of implying
 * stability.
 */
function buildRobustnessCaveat(input: BriefAssemblyInput): BriefRobustnessCaveat {
  const robustness = input.robustness;
  const isRobust = robustness?.is_robust;
  const level = robustness?.level as string | undefined;

  const basis: BriefRobustnessCaveat['basis'] =
    isRobust !== undefined ? 'is_robust' : level !== undefined ? 'level' : 'absent';

  // provisional_doctrine_v0 wording matrix
  let text: string;
  if (basis === 'absent') {
    text = 'Robustness was not assessed for this run — treat the ranking as unverified against perturbations.';
  } else if (isRobust === true || (isRobust === undefined && level === 'high')) {
    text = 'This ranking held up under the perturbations tested. That is not a guarantee — defaulted or uncertain inputs can still change the result.';
  } else if (isRobust === false && level === undefined) {
    text = 'This ranking did not pass the robustness checks — small changes to assumptions could change which option leads.';
  } else if (level === 'medium' || level === 'moderate') {
    text = 'This ranking was only moderately stable under the perturbations tested — treat the lead as provisional.';
  } else if (level === 'low' || level === 'very_low') {
    text = 'This ranking was fragile under the perturbations tested — small changes to assumptions could change which option leads.';
  } else {
    // is_robust === false with a level that is not low/very_low, or an
    // unrecognised level value — state the weaker of the two signals.
    text = 'This ranking did not pass the robustness checks — small changes to assumptions could change which option leads.';
  }

  return { text, basis, doctrine: 'provisional_doctrine_v0' };
}

/**
 * Echo of warning-severity inference-warning codes (codes only — no values,
 * no prose). Deduplicated, bytewise-sorted, capped. Info-severity warnings
 * are NOT echoed (they are diagnostics, not caveats).
 */
function buildWarningCodes(input: BriefAssemblyInput): string[] {
  const codes = new Set<string>();
  for (const w of input.inference_warnings ?? []) {
    if (w.severity === 'warning' && typeof w.code === 'string' && w.code.length > 0) {
      codes.add(w.code);
    }
  }
  return [...codes].sort().slice(0, MAX_WARNING_CODES);
}
