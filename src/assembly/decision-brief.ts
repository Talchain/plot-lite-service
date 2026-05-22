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

/** Compute config_version as SHA-256 hash of computation-affecting config values. */
function computeConfigVersion(): string {
  const configInputs = {
    n_samples_default: 1000,
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
  // Primary: fragile edges
  const fragileEdges = input.robustness?.fragile_edges;
  if (fragileEdges && fragileEdges.length > 0) {
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
  const factors = input.factor_sensitivity;
  if (factors && factors.length > 0) {
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
  return {
    config_version: computeConfigVersion(),
    response_hash: input.response_hash ?? '',
  };
}
