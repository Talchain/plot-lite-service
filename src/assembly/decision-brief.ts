/**
 * Decision Brief Assembly
 *
 * Pure function that assembles a DecisionBriefV1 from existing run_bundle response data.
 * No service calls, no LLM calls — deterministic assembly from computed fields.
 *
 * Same response data → same brief content (only brief_id and created_at differ).
 */

import { randomUUID } from 'node:crypto';
import type {
  DecisionBriefV1,
  BriefOption,
  BriefDriver,
  BriefWarning,
  BriefLineage,
} from '../types/decision-brief.js';
import { DECISION_BRIEF_VERSION } from '../types/decision-brief.js';
import type { RunResponseV3 } from '../types/engine-v3.js';

// =============================================================================
// Constants
// =============================================================================

const MAX_TOP_DRIVERS = 5;
const MAX_WARNINGS = 10;
const MAX_KEY_ASSUMPTIONS = 10;
const MAX_WHAT_WOULD_CHANGE = 10;

/** PLoT config version — bump when brief assembly logic changes */
const BRIEF_CONFIG_VERSION = '1.0.0';

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
  response_hash?: string;
  meta: {
    seed_used: string;
  };
};

// =============================================================================
// Robustness Level Mapping
// =============================================================================

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

  return {
    brief_id: randomUUID(),
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

function buildTopDrivers(input: BriefAssemblyInput): BriefDriver[] {
  const factors = input.factor_sensitivity;
  if (!factors || factors.length === 0) return [];

  // Sort by absolute elasticity descending, take top 5
  const withElasticity = factors
    .filter(f => f.elasticity !== undefined && f.elasticity !== null)
    .sort((a, b) => Math.abs(b.elasticity!) - Math.abs(a.elasticity!))
    .slice(0, MAX_TOP_DRIVERS);

  return withElasticity.map(f => ({
    factor_label: f.factor_label?.trim() || f.factor_id,
    sensitivity: Math.abs(f.elasticity!),
    direction: f.direction === 'negative' ? 'negative' : 'positive',
  }));
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
  const fragileEdges = input.robustness?.fragile_edges;
  if (!fragileEdges || fragileEdges.length === 0) return [];

  return fragileEdges
    .map(e => {
      const from = e.from_label?.trim() || e.from_id;
      const to = e.to_label?.trim() || e.to_id;
      return `${from} \u2192 ${to}`;
    })
    .filter(s => s.length > 0)
    .slice(0, MAX_WHAT_WOULD_CHANGE);
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
        severity: mc.severity === 'concern' ? 'warning' : mc.severity === 'warning' ? 'warning' : 'info',
      });
    }
  }

  // Cap at MAX_WARNINGS
  return warnings.slice(0, MAX_WARNINGS);
}

function buildLineage(input: BriefAssemblyInput): BriefLineage {
  return {
    config_version: BRIEF_CONFIG_VERSION,
    response_hash: input.response_hash ?? '',
  };
}
