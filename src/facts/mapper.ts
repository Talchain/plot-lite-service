/**
 * ISL / Inference → FactObject mapping.
 *
 * Converts raw inference results into structured FactObjectV1 instances.
 * Respects analysis_status — only emits what's valid.
 *
 * Two entry points:
 *  1. assembleFactObjects() — generic mapper for ISL-style responses
 *  2. assembleFactsFromBundleResults() — run_bundle-specific mapper
 */

import type {
  FactObjectV1,
  FactKey,
  FactType,
  FactData,
  FactLineage,
  FactsEnvelope,
  ProbabilityFactData,
  FactorSensitivityFactData,
  CritiqueFactData,
  RobustnessFactData,
} from './types.js';
import { FACTS_SCHEMA_VERSION } from './types.js';
import { generateFactId, generateContentHash } from './hash.js';

// ---------------------------------------------------------------------------
// Input interfaces — decouple from ISL types to avoid import cycles
// ---------------------------------------------------------------------------

/** Minimal option result shape for probability facts. */
export interface OptionResultInput {
  option_id: string;
  label?: string;
  outcome?: {
    p10?: number;
    p50?: number;
    p90?: number;
    mean?: number;
  };
}

/** Minimal factor sensitivity shape. */
export interface FactorSensitivityInput {
  node_id: string;
  label?: string;
  sensitivity_score?: number;
  importance_score?: number;
  importance_rank: number;
  elasticity?: number;
  direction?: 'positive' | 'negative' | 'mixed';
  confidence?: number;
  attribution_stability?: 'high' | 'moderate' | 'low' | 'negligible';
}

/** Minimal critique shape. */
export interface CritiqueInput {
  id: string;
  code: string;
  severity: 'info' | 'warning' | 'error' | 'blocker';
  message: string;
  suggestion?: string;
  affected_option_ids?: string[];
  affected_node_ids?: string[];
}

/** Minimal robustness shape. */
export interface RobustnessInput {
  label?: 'robust' | 'moderate' | 'fragile';
  score?: number;
}

/** Generic ISL-style response for assembleFactObjects. */
export interface ISLResponseInput {
  analysis_status: 'computed' | 'partial' | 'failed';
  options?: OptionResultInput[];
  factor_sensitivity?: FactorSensitivityInput[];
  critiques?: CritiqueInput[];
  robustness?: RobustnessInput;
}

// ---------------------------------------------------------------------------
// run_bundle–specific input shape
// ---------------------------------------------------------------------------

/** A single scenario result from run_bundle. */
export interface BundleResultInput {
  label: string;
  summary: { p10: number; p50: number; p90: number } | null;
  sensitivity_by_node?: Array<{
    node_id: string;
    node_label: string;
    contribution_pct: number;
    edge_count: number;
  }>;
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Internal: build a single FactObjectV1
// ---------------------------------------------------------------------------

function buildFact(
  factKey: FactKey,
  factType: FactType,
  data: FactData,
  lineage: FactLineage,
): FactObjectV1 {
  return {
    fact_id: generateFactId(factKey, lineage),
    fact_key: factKey,
    fact_type: factType,
    data,
    lineage,
    content_hash: generateContentHash(data),
  };
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function mapOptionResults(
  options: OptionResultInput[],
  lineage: FactLineage,
): FactObjectV1[] {
  return options
    .filter((o) => o.outcome)
    .map((o) => {
      const data: ProbabilityFactData = {
        type: 'probability',
        option_id: o.option_id,
        option_label: o.label ?? o.option_id,
        p10: o.outcome!.p10 ?? 0,
        p50: o.outcome!.p50 ?? 0,
        p90: o.outcome!.p90 ?? 0,
        mean: o.outcome!.mean ?? o.outcome!.p50 ?? 0,
      };
      const key: FactKey = { type: 'probability', option_id: o.option_id };
      return buildFact(key, 'probability', data, lineage);
    });
}

function mapFactorSensitivity(
  factors: FactorSensitivityInput[],
  lineage: FactLineage,
): FactObjectV1[] {
  return factors.map((f, idx) => {
    const data: FactorSensitivityFactData = {
      type: 'factor_sensitivity',
      node_id: f.node_id,
      label: f.label ?? f.node_id,
      sensitivity_score: f.sensitivity_score ?? 0,
      importance_score: f.importance_score ?? f.sensitivity_score ?? 0,
      importance_rank: f.importance_rank ?? idx + 1,
      elasticity: f.elasticity ?? f.sensitivity_score ?? 0,
      direction: f.direction === 'mixed' ? 'positive' : (f.direction ?? 'positive'),
      confidence: f.confidence ?? 0.5,
      attribution_stability: f.attribution_stability ?? 'moderate',
    };
    const key: FactKey = {
      type: 'factor_sensitivity',
      node_id: f.node_id,
      metric: 'sensitivity_score',
    };
    return buildFact(key, 'factor_sensitivity', data, lineage);
  });
}

function mapCritiques(
  critiques: CritiqueInput[],
  lineage: FactLineage,
): FactObjectV1[] {
  return critiques.map((c) => {
    const data: CritiqueFactData = {
      type: 'critique',
      id: c.id,
      code: c.code,
      severity: c.severity,
      message: c.message,
      ...(c.suggestion !== undefined && { suggestion: c.suggestion }),
      ...(c.affected_option_ids?.length && { affected_option_ids: c.affected_option_ids }),
      ...(c.affected_node_ids?.length && { affected_node_ids: c.affected_node_ids }),
    };
    const key: FactKey = { type: 'critique', node_id: c.id, metric: c.code };
    return buildFact(key, 'critique', data, lineage);
  });
}

function mapRobustness(
  robustness: RobustnessInput,
  lineage: FactLineage,
): FactObjectV1 {
  const data: RobustnessFactData = {
    type: 'robustness',
    robustness_level: robustness.label ?? 'moderate',
    robustness_score: robustness.score ?? 0.5,
  };
  const key: FactKey = { type: 'robustness', metric: 'robustness_score' };
  return buildFact(key, 'robustness', data, lineage);
}

// ---------------------------------------------------------------------------
// Fact key comparison for deterministic ordering
// ---------------------------------------------------------------------------

const TYPE_ORDER: Record<FactType, number> = {
  probability: 0,
  factor_sensitivity: 1,
  critique: 2,
  robustness: 3,
};

/**
 * Compare two fact keys for deterministic sort:
 * type → option_id → node_id → edge_id → metric
 */
export function compareFactKeys(a: FactKey, b: FactKey): number {
  const typeA = TYPE_ORDER[a.type] ?? 99;
  const typeB = TYPE_ORDER[b.type] ?? 99;
  if (typeA !== typeB) return typeA - typeB;

  const cmpOption = (a.option_id ?? '').localeCompare(b.option_id ?? '');
  if (cmpOption !== 0) return cmpOption;

  const cmpNode = (a.node_id ?? '').localeCompare(b.node_id ?? '');
  if (cmpNode !== 0) return cmpNode;

  const cmpEdge = (a.edge_id ?? '').localeCompare(b.edge_id ?? '');
  if (cmpEdge !== 0) return cmpEdge;

  return (a.metric ?? '').localeCompare(b.metric ?? '');
}

// ---------------------------------------------------------------------------
// Primary entry point: generic ISL-style response → FactsEnvelope
// ---------------------------------------------------------------------------

/**
 * Assemble FactObjectV1 instances from an ISL-style response.
 *
 * Respects analysis_status:
 * - failed  → critiques only
 * - partial → critiques + whatever data is available
 * - computed → full assembly
 *
 * Deterministic for identical inputs within this endpoint. No cross-endpoint content identity guarantee.
 * Clients may assume stable ordering and stable IDs within this endpoint for identical inputs.
 */
export function assembleFactObjects(
  islResponse: ISLResponseInput,
  lineage: FactLineage,
): FactsEnvelope {
  const facts: FactObjectV1[] = [];

  // Always try critiques (available even on partial/failed)
  if (islResponse.critiques?.length) {
    facts.push(...mapCritiques(islResponse.critiques, lineage));
  }

  // Only on computed/partial
  if (islResponse.analysis_status !== 'failed') {
    if (islResponse.options?.length) {
      facts.push(...mapOptionResults(islResponse.options, lineage));
    }

    if (islResponse.factor_sensitivity?.length) {
      // Top N drivers (start with top 5)
      const topN = [...islResponse.factor_sensitivity]
        .sort((a, b) => (a.importance_rank ?? 999) - (b.importance_rank ?? 999))
        .slice(0, 5);
      facts.push(...mapFactorSensitivity(topN, lineage));
    }

    if (islResponse.robustness) {
      facts.push(mapRobustness(islResponse.robustness, lineage));
    }
  }

  // Stable sort by fact_key for deterministic ordering
  facts.sort((a, b) => compareFactKeys(a.fact_key, b.fact_key));

  return {
    facts_schema_version: FACTS_SCHEMA_VERSION,
    facts,
    analysis_status: islResponse.analysis_status,
  };
}

// ---------------------------------------------------------------------------
// run_bundle–specific entry point
// ---------------------------------------------------------------------------

/**
 * Assemble facts from run_bundle results.
 *
 * run_bundle produces local SCM-Lite inference results:
 * - Each scenario has label + summary (p10/p50/p90)
 * - Optional sensitivity_by_node
 * - No critiques/robustness from ISL (those are V2 /run path)
 *
 * Maps scenario results → probability facts.
 *
 * Deterministic for identical inputs within this endpoint. No cross-endpoint content identity guarantee.
 * Clients may assume stable ordering and stable IDs within this endpoint for identical inputs.
 */
export function assembleFactsFromBundleResults(
  results: BundleResultInput[],
  lineage: FactLineage,
): FactsEnvelope {
  const facts: FactObjectV1[] = [];

  // Determine analysis status from results
  const failedCount = results.filter((r) => r.error).length;
  let analysisStatus: 'computed' | 'partial' | 'failed';
  if (results.length === 0) {
    analysisStatus = 'computed'; // No results to fail
  } else if (failedCount === results.length) {
    analysisStatus = 'failed';
  } else if (failedCount > 0) {
    analysisStatus = 'partial';
  } else {
    analysisStatus = 'computed';
  }

  // Only emit probability facts for successful results
  for (const result of results) {
    if (!result.summary || result.error) continue;

    const data: ProbabilityFactData = {
      type: 'probability',
      option_id: result.label,
      option_label: result.label,
      p10: result.summary.p10,
      p50: result.summary.p50,
      p90: result.summary.p90,
      mean: (result.summary.p10 + result.summary.p50 + result.summary.p90) / 3,
    };

    const key: FactKey = { type: 'probability', option_id: result.label };
    facts.push(buildFact(key, 'probability', data, lineage));
  }

  // Stable sort
  facts.sort((a, b) => compareFactKeys(a.fact_key, b.fact_key));

  return {
    facts_schema_version: FACTS_SCHEMA_VERSION,
    facts,
    analysis_status: analysisStatus,
  };
}
