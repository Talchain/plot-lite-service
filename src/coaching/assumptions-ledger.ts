/**
 * C1: Assumptions Ledger
 *
 * Collects all implicit and explicit assumptions from ISL, normaliser, and CEE.
 * Single canonical schema with deduplication by composite key.
 */

import type { CoachingInputs } from './types.js';
import { getThresholds } from './thresholds.js';

export interface AssumptionRecord {
  /** Deduplication key: {source_service}:{action}:{entity_type}:{entity_id}:{field} */
  dedup_key: string;

  /** Where this assumption originated */
  source_service: 'plot_normaliser' | 'isl_engine' | 'cee_review';

  /** What action was taken */
  action:
    | 'clamped'
    | 'defaulted'
    | 'inferred'
    | 'floored'
    | 'derived'
    | 'flagged'
    | 'assumed';

  /** Type of entity affected */
  entity_type: 'edge' | 'node' | 'option' | 'global';

  /** Entity identifier (node_id, edge_id, option_id, or 'global') */
  entity_id: string;

  /** Field that was modified or flagged */
  field: string;

  /** Original value (null if missing) */
  from_value: number | string | null;

  /** New value after action */
  to_value: number | string | null;

  /** Human-readable explanation */
  reason: string;

  /** Impact classification */
  impact: 'high' | 'medium' | 'low';

  /** Rule-based code explaining impact level */
  impact_reason_code:
    | 'AFFECTS_WINNER'
    | 'HIGH_INFLUENCE_FACTOR'
    | 'FRAGILE_EDGE'
    | 'OUTCOME_MODIFIER'
    | 'STRUCTURAL_ONLY'
    | 'COSMETIC';
}

export interface AssumptionsLedger {
  assumptions: AssumptionRecord[];
  total_count: number;
  high_impact_count: number;
  medium_impact_count: number;
  low_impact_count: number;
}

/**
 * Build assumptions ledger from all available sources.
 *
 * @param inputs Normalised coaching inputs
 * @param repairsApplied Repairs from normaliser (_meta.repairs_applied)
 * @param ceeCritiques CEE decision review critiques (if available)
 * @returns AssumptionsLedger with deduplicated records
 */
export function buildAssumptionsLedger(
  inputs: CoachingInputs,
  repairsApplied: Array<{
    field: string;
    action: string;
    from_value: number | string | null;
    to_value: number | string;
    reason: string;
  }> = [],
  ceeCritiques: Array<{
    type: string;
    message: string;
    severity?: string;
  }> = []
): AssumptionsLedger {
  const records = new Map<string, AssumptionRecord>();

  // 1. Collect from normaliser repairs
  for (const repair of repairsApplied) {
    const record = mapRepairToAssumption(repair, inputs);
    records.set(record.dedup_key, record);
  }

  // 2. Collect from ISL robustness flags
  const islAssumptions = extractISLAssumptions(inputs);
  for (const assumption of islAssumptions) {
    records.set(assumption.dedup_key, assumption);
  }

  // 3. Collect from CEE critiques
  for (const critique of ceeCritiques) {
    const record = mapCEECritiqueToAssumption(critique, inputs);
    if (record) {
      records.set(record.dedup_key, record);
    }
  }

  // Deduplicated list
  const assumptions = Array.from(records.values());

  // Count by impact
  const highCount = assumptions.filter((a) => a.impact === 'high').length;
  const mediumCount = assumptions.filter((a) => a.impact === 'medium').length;
  const lowCount = assumptions.filter((a) => a.impact === 'low').length;

  return {
    assumptions,
    total_count: assumptions.length,
    high_impact_count: highCount,
    medium_impact_count: mediumCount,
    low_impact_count: lowCount,
  };
}

/**
 * Map normaliser repair to assumption record.
 */
function mapRepairToAssumption(
  repair: {
    field: string;
    action: string;
    from_value: number | string | null;
    to_value: number | string;
    reason: string;
  },
  inputs: CoachingInputs
): AssumptionRecord {
  // Parse field to extract entity info
  // Format: "edge.exists_probability", "node.value.mean", "edge.strength.std"
  const parts = repair.field.split('.');
  const entityType = (parts[0] === 'edge' ? 'edge' : parts[0] === 'node' ? 'node' : 'global') as
    | 'edge'
    | 'node'
    | 'global';

  // Entity ID extraction would require context from repairs (not always available)
  // For now, use field as entity_id since repairs don't include entity IDs
  const entityId = 'unknown';

  const dedupKey = `plot_normaliser:${repair.action}:${entityType}:${entityId}:${repair.field}`;

  // Classify impact
  const impact = classifyRepairImpact(repair, inputs);

  return {
    dedup_key: dedupKey,
    source_service: 'plot_normaliser',
    action: repair.action as any,
    entity_type: entityType,
    entity_id: entityId,
    field: repair.field,
    from_value: repair.from_value,
    to_value: repair.to_value,
    reason: repair.reason,
    impact: impact.level,
    impact_reason_code: impact.code,
  };
}

/**
 * Extract assumptions from ISL robustness data.
 */
function extractISLAssumptions(inputs: CoachingInputs): AssumptionRecord[] {
  const assumptions: AssumptionRecord[] = [];
  const thresholds = getThresholds();

  // Fragile edges are high-impact assumptions
  // Use centralized threshold for consistency with other coaching components.
  // Presence branch (Codex P1-5): only a MEASURED switchProb may generate a
  // "% chance of flipping decision" record — absence renders nothing.
  for (const edge of inputs.fragileEdges) {
    if (typeof edge.switchProb === 'number' && edge.switchProb >= thresholds.headline_fragile_edge_min) {
      const dedupKey = `isl_engine:flagged:edge:${edge.edgeId}:switch_probability`;

      assumptions.push({
        dedup_key: dedupKey,
        source_service: 'isl_engine',
        action: 'flagged',
        entity_type: 'edge',
        entity_id: edge.edgeId,
        field: 'switch_probability',
        from_value: null,
        to_value: edge.switchProb,
        reason: `Edge ${edge.displayLabel} has ${Math.round(edge.switchProb * 100)}% chance of flipping decision`,
        impact: edge.switchProb >= 0.25 ? 'high' : 'medium',
        impact_reason_code: 'FRAGILE_EDGE',
      });
    }
  }

  // Low confidence factors are assumptions
  for (const factor of inputs.factorSensitivity) {
    if (factor.confidence !== undefined && factor.confidence < 0.5) {
      const dedupKey = `isl_engine:flagged:node:${factor.node_id}:confidence`;

      assumptions.push({
        dedup_key: dedupKey,
        source_service: 'isl_engine',
        action: 'flagged',
        entity_type: 'node',
        entity_id: factor.node_id,
        field: 'confidence',
        from_value: null,
        to_value: factor.confidence,
        reason: `Factor ${factor.label} has low confidence (${Math.round(factor.confidence * 100)}%)`,
        impact: classifyFactorImpact(factor, inputs).level,
        impact_reason_code: classifyFactorImpact(factor, inputs).code,
      });
    }
  }

  return assumptions;
}

/**
 * Map CEE critique to assumption record (if applicable).
 */
function mapCEECritiqueToAssumption(
  critique: { type: string; message: string; severity?: string },
  _inputs: CoachingInputs
): AssumptionRecord | null {
  // Only map critiques that represent assumptions (not all do)
  if (
    critique.type === 'MISSING_CONSIDERATION' ||
    critique.type === 'OVERSIMPLIFICATION' ||
    critique.type === 'HIDDEN_ASSUMPTION'
  ) {
    const dedupKey = `cee_review:flagged:global:global:${critique.type}`;

    return {
      dedup_key: dedupKey,
      source_service: 'cee_review',
      action: 'flagged',
      entity_type: 'global',
      entity_id: 'global',
      field: critique.type,
      from_value: null,
      to_value: null,
      reason: critique.message,
      impact: critique.severity === 'high' ? 'high' : critique.severity === 'medium' ? 'medium' : 'low',
      impact_reason_code: 'OUTCOME_MODIFIER',
    };
  }

  return null;
}

/**
 * Classify impact of normaliser repair.
 */
function classifyRepairImpact(
  repair: {
    field: string;
    action: string;
    from_value: number | string | null;
    to_value: number | string;
  },
  _inputs: CoachingInputs
): { level: 'high' | 'medium' | 'low'; code: AssumptionRecord['impact_reason_code'] } {
  // High impact: affects outcome directly
  if (
    repair.field.includes('outcome') ||
    repair.field.includes('win_probability') ||
    repair.field.includes('exists_probability')
  ) {
    return { level: 'high', code: 'OUTCOME_MODIFIER' };
  }

  // Medium impact: affects edge strength
  if (repair.field.includes('strength')) {
    return { level: 'medium', code: 'FRAGILE_EDGE' };
  }

  // Low impact: structural or cosmetic
  return { level: 'low', code: 'STRUCTURAL_ONLY' };
}

/**
 * Classify impact of factor based on influence and position.
 */
function classifyFactorImpact(
  factor: { node_id: string; label: string; elasticity?: number; influence_score?: number; importance_rank?: number },
  _inputs: CoachingInputs
): { level: 'high' | 'medium' | 'low'; code: AssumptionRecord['impact_reason_code'] } {
  const influence = Math.abs(factor.elasticity ?? factor.influence_score ?? 0);

  // High impact: top-ranked or high influence
  if (factor.importance_rank !== undefined && factor.importance_rank <= 3) {
    return { level: 'high', code: 'HIGH_INFLUENCE_FACTOR' };
  }

  if (influence >= 0.5) {
    return { level: 'high', code: 'HIGH_INFLUENCE_FACTOR' };
  }

  // Medium impact: moderate influence
  if (influence >= 0.2) {
    return { level: 'medium', code: 'HIGH_INFLUENCE_FACTOR' };
  }

  // Low impact
  return { level: 'low', code: 'STRUCTURAL_ONLY' };
}
