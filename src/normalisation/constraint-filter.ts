/**
 * Temporal Constraint Filter
 *
 * Filters non-evaluable temporal constraints BEFORE forwarding to ISL.
 * ISL evaluates constraints via Monte Carlo sampling on a static causal graph.
 * Temporal constraints (e.g., "achieve goal within 6 months") cannot be evaluated
 * because time is not a modelled dimension — the graph is a point-in-time snapshot.
 *
 * Pipeline order: constraint compilation → auto-fallback → TEMPORAL FILTER → validation → ISL
 *
 * Drop rules (any match → remove):
 *   1. deadline_metadata is present (reliable CEE temporal signal)
 *   2. node_id targets goal/outcome/risk AND value > 1.0 AND unit is temporal
 *
 * Safety gate (warn, don't drop):
 *   - Targets goal/outcome/risk AND value outside [0,1] AND unit is NOT temporal
 *     → log plot.constraint_out_of_domain, still forward to ISL
 *
 * @see F.6: PLoT=compute (deterministic, no LLM call)
 */

import type {
  GoalConstraint,
  RawGoalConstraint,
  EngineNodeV3,
  FilteredConstraintRecord,
} from '../types/engine-v3.js';

// Node kinds whose scores are in probability domain (expected [0,1] range).
// Constraints with large values + temporal units on these nodes are non-evaluable.
const PROBABILITY_DOMAIN_KINDS = new Set(['goal', 'outcome', 'risk']);

// Temporal unit tokens (case-insensitive). Includes both singular and plural forms.
const TEMPORAL_UNITS = new Set([
  'months', 'month',
  'days', 'day',
  'weeks', 'week',
  'years', 'year',
]);

export interface ConstraintFilterResult {
  /** Constraints that passed the filter (safe to forward to ISL) */
  passed: GoalConstraint[];
  /** Records of filtered constraints (for _meta and logging) */
  filtered: FilteredConstraintRecord[];
  /** Warning records for out-of-domain constraints (forwarded but flagged) */
  warnings: Array<{
    constraint_id: string;
    node_id: string;
    threshold: number;
    node_kind: string;
    message: string;
  }>;
}

interface Logger {
  info: (obj: Record<string, unknown>) => void;
  warn: (obj: Record<string, unknown>) => void;
}

/**
 * Filter non-evaluable temporal constraints before ISL forwarding.
 *
 * @param constraints  Raw constraints (may carry CEE-specific fields like deadline_metadata, unit)
 * @param nodes        Graph nodes (for node-kind lookup)
 * @param logger       Optional structured logger (req.log compatible)
 */
export function filterTemporalConstraints(
  constraints: RawGoalConstraint[],
  nodes: EngineNodeV3[],
  logger?: Logger
): ConstraintFilterResult {
  const nodeMap = new Map<string, EngineNodeV3>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const passed: GoalConstraint[] = [];
  const filtered: FilteredConstraintRecord[] = [];
  const warnings: ConstraintFilterResult['warnings'] = [];

  for (const constraint of constraints) {
    const { constraint_id, node_id, value, unit, deadline_metadata } = constraint;
    const targetNode = nodeMap.get(node_id);
    const nodeKind = targetNode?.kind ?? 'unknown';

    // --- DROP RULE 1: deadline_metadata present ---
    // CEE attaches deadline_metadata to temporal constraints like "within 12 months".
    // These cannot be evaluated on a static causal graph.
    if (deadline_metadata !== undefined && deadline_metadata !== null) {
      const record: FilteredConstraintRecord = {
        constraint_id,
        node_id,
        reason: 'temporal_deadline',
      };
      filtered.push(record);
      logger?.info({
        event: 'plot.constraint_filtered',
        constraint_id,
        node_id,
        reason: 'temporal_deadline',
      });
      continue;
    }

    // --- DROP RULE 2: probability-domain node + value > 1 + temporal unit ---
    // Goal/outcome/risk scores are normalised to [0,1]. A constraint like
    // "goal_X <= 12 months" produces P(goal_score <= 12) = 1.0 trivially.
    // Only drop when ALL three conditions are met — value > 1 alone is legitimate
    // (e.g., NRR above 110% = value 1.1).
    const isTemporalUnit = typeof unit === 'string' && TEMPORAL_UNITS.has(unit.toLowerCase());
    const isProbabilityNode = PROBABILITY_DOMAIN_KINDS.has(nodeKind);

    if (isProbabilityNode && value > 1.0 && isTemporalUnit) {
      const record: FilteredConstraintRecord = {
        constraint_id,
        node_id,
        reason: 'temporal_against_normalised_goal',
      };
      filtered.push(record);
      logger?.info({
        event: 'plot.constraint_filtered',
        constraint_id,
        node_id,
        reason: 'temporal_against_normalised_goal',
        value,
        unit,
        node_kind: nodeKind,
      });
      continue;
    }

    // --- SAFETY GATE: out-of-domain warning ---
    // Constraint targets a probability-domain node with value outside [0,1],
    // but the unit is NOT temporal. This may be legitimate (e.g., NRR above 110%)
    // or a data issue. Log a warning but still forward to ISL.
    if (isProbabilityNode && (value < 0 || value > 1) && !isTemporalUnit) {
      warnings.push({
        constraint_id,
        node_id,
        threshold: value,
        node_kind: nodeKind,
        message: `Constraint ${constraint_id} targets ${nodeKind} node "${node_id}" with threshold ${value} outside [0,1] range`,
      });
      logger?.warn({
        event: 'plot.constraint_out_of_domain',
        constraint_id,
        node_id,
        threshold: value,
        node_kind: nodeKind,
        unit: unit ?? null,
      });
    }

    // Strip CEE-specific fields, keep only GoalConstraint fields for ISL.
    // Preserve PLoT-internal _internal namespace for provenance tracking in _meta.
    const clean: GoalConstraint = {
      constraint_id: constraint.constraint_id,
      node_id: constraint.node_id,
      operator: constraint.operator,
      value: constraint.value,
      ...(constraint.label !== undefined && { label: constraint.label }),
      ...(constraint.weight !== undefined && { weight: constraint.weight }),
      ...((constraint as any)._internal !== undefined && { _internal: (constraint as any)._internal }),
    };
    passed.push(clean);
  }

  return { passed, filtered, warnings };
}
