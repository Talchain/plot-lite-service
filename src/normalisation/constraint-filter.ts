/**
 * Temporal Constraint Filter
 *
 * Filters non-evaluable temporal constraints BEFORE forwarding to ISL.
 * ISL evaluates constraints via Monte Carlo sampling on a static causal graph.
 * Temporal constraints (e.g., "achieve goal within 6 months") cannot be evaluated
 * because time is not a modelled dimension — the graph is a point-in-time snapshot.
 *
 * Pipeline order: constraint compilation → TEMPORAL FILTER → auto-fallback → validation → ISL
 *
 * ⚠ The filter runs BEFORE the auto-fallback (changed under ROADMAP 2.239). The
 * fallback asks "did any constraint survive to the ISL boundary?", so it must
 * see the POST-filter set: a deadline constraint that this filter is about to
 * delete used to suppress the fallback that would have replaced it, and the
 * request reached ISL with no constraints AND no goal threshold. The fallback
 * re-enters this function with its own synthesised constraint (it can never be
 * dropped — no deadline_metadata, no unit) so the out-of-domain safety gate
 * still applies to it.
 *
 * Drop rules (any match → remove):
 *   1. deadline_metadata is present (reliable CEE temporal signal)
 *   2. node_id targets goal/outcome/risk AND the unit is a duration the unit table knows (any value, any cap)
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
import { isPercentUnit, type GoalThresholdNodeMeta } from '../lib/intervention-normaliser.js';
import { dimensionOfScale, unitScale } from '../lib/constraint-units.js';

// Node kinds whose scores are in probability domain (expected [0,1] range).
// Constraints with large values + temporal units on these nodes are non-evaluable.
const PROBABILITY_DOMAIN_KINDS = new Set(['goal', 'outcome', 'risk']);

/**
 * ⛔ BY STRUCTURE, NOT A LIST (F1b D3; DL 5931936029 → corrected 5932184568; CODEX 5931878824 + 5932134950). A DURATION
 * is read off the ONE unit table (`lib/constraint-units.ts`, trimmed + case-folded: seconds … years), never a list
 * here. On a normalised (goal/outcome/risk) node it is OUT OF SCOPE at any value and any cap — time is not a modelled
 * dimension, so the model cannot test it (reason `temporal_against_normalised_goal`).
 * Everything else keeps its tested path: none / % / fraction-ratio-probability as today; a currency, count or other unit
 * under a covering declared cap is scaled (P0-C1) or scored from the modelled distribution (P0-C2); and a unit with NO
 * declared scale still meets the default-range suppression + CONSTRAINT_TARGET_UNRELIABLE (a units repair is owed, the
 * leader stays withheld). Dropping those as out of scope too would NAME the leader past a limit the user can repair
 * (9 pinned rows: 'points' / 'USD' with and without a cap, Paul's 20/% chain, doctrine B), so they are out of reach here.
 */
function isDurationUnit(unit: unknown): boolean {
  const scale = unitScale(unit);
  return scale !== undefined && dimensionOfScale(scale) === 'duration';
}

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
 * @param goalThresholdMetaByNodeId  Raw-node goal-threshold metadata (P0-C1) —
 *   a threshold that normalises into [0,1] under a producer-declared scale
 *   (node goal_threshold_cap, or 100 for a '%' unit) is IN-domain, so the
 *   out-of-domain safety gate must not fire for it
 */
export function filterTemporalConstraints(
  constraints: RawGoalConstraint[],
  nodes: EngineNodeV3[],
  logger?: Logger,
  goalThresholdMetaByNodeId?: Map<string, GoalThresholdNodeMeta>
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

    // --- DROP RULE 2: probability-domain node + temporal unit (any value, any cap) ---
    // Goal/outcome/risk scores are normalised to [0,1]. A constraint like
    // "goal_X <= 12 months" produces P(goal_score <= 12) = 1.0 trivially.
    // Only drop when ALL three conditions are met — value > 1 alone is legitimate
    // (e.g., NRR above 110% = value 1.1).
    const isTemporalUnit = isDurationUnit(unit);
    const isProbabilityNode = PROBABILITY_DOMAIN_KINDS.has(nodeKind);
    // ⛔ THE VALUE NEVER DECIDES, AND NEITHER DOES A CAP (F1b D3, CEE 52f8cd; F5 5930871304; DL 5931024377; CODEX CR
    // 5931449776). "Migration downtime ≤ 1 week" on an outcome was forwarded RAW as 1.0 on the [0,1] score — trivially
    // true — while "≤ 2 weeks" was dropped here: one week flipped the run's limit reason and its leader verdict. A declared
    // `goal_threshold_cap` does not rescue it: that cap is the GOAL THRESHOLD's own scale (e.g. £/month), not a time scale,
    // and the consumer forwards a value ≤ 1 raw past the cap anyway (`run.ts` normalisation gate + the forward-raw rung):
    // cap 12 sent 1 week as 1.0 and 2 weeks as 0.167. A time unit is no reading of a normalised node: dropped at ANY value
    // and ANY cap, as out of scope — the leader is named with the honest "your … limit was not tested" caveat.
    if (isProbabilityNode && isTemporalUnit) {
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
    //
    // P0-C1 exception: a raw threshold that normalises INTO [0,1] under a
    // producer-declared scale — the node's CEE-stamped goal_threshold_cap, or
    // 100 for a '%' unit — is in-domain (e.g. "at least 20%" = 0.2). The
    // normaliser will scale it against that same cap; warning here would flag
    // the user's own valid target as a data issue.
    if (isProbabilityNode && (value < 0 || value > 1) && !isTemporalUnit) {
      const nodeMeta = goalThresholdMetaByNodeId?.get(node_id);
      const declaredCap =
        typeof nodeMeta?.goal_threshold_cap === 'number' &&
        Number.isFinite(nodeMeta.goal_threshold_cap) &&
        nodeMeta.goal_threshold_cap > 0
          ? nodeMeta.goal_threshold_cap
          : isPercentUnit(unit)
            ? 100
            : undefined;
      const scalableIntoDomain =
        declaredCap !== undefined && value >= 0 && value <= declaredCap;

      if (scalableIntoDomain) {
        logger?.info({
          event: 'plot.constraint_scale_resolved',
          constraint_id,
          node_id,
          threshold: value,
          node_kind: nodeKind,
          unit: unit ?? null,
          declared_cap: declaredCap,
        });
      } else {
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
      // ROADMAP 2.855 — by presence, never defaulted. This rebuild runs over
      // the ENTIRE merged constraint set on every request and its output
      // REPLACES the list, so a field omitted here can never reach ISL however
      // faithfully CEE stamps it or the translator projects it.
      ...(constraint.value_frame !== undefined && { value_frame: constraint.value_frame }),
      ...((constraint as any)._internal !== undefined && { _internal: (constraint as any)._internal }),
    };
    passed.push(clean);
  }

  return { passed, filtered, warnings };
}
