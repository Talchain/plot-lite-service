/**
 * Constraint-target reliability detection (producer honesty, lane PLoT-H item A).
 *
 * Live defect (scenario 327bc417, 2026-07-07): a success target of "20" (unit
 * "%") was set on a node with NO observed value. The chain was:
 *
 *   1. PLoT `plot.constraint_out_of_domain` (warn) — threshold 20 outside [0,1]
 *      on a probability-domain node;
 *   2. PLoT constraint normalisation fell back to the DEFAULT [0,1] range
 *      (`range_source: "default"`) because the target node carries no value,
 *      cap, range, baseline or intervention spread — so 20 clamped to 1, i.e.
 *      "threshold >= domain max";
 *   3. ISL `isl.constraint.default_base` — the target node defaulted to
 *      base=0.0 (`reason: no_parameter_uncertainty`), surfaced only as the
 *      info-level CONSTRAINT_NODE_DEFAULT_BASE inference warning;
 *   4. Result: `probability_of_joint_goal` = 0 for EVERY option — a meaningless
 *      "0% goal fit everywhere", the mirror image of a fabricated 98%.
 *
 * Neither number is decision-grade. When either leg of the chain fires for a
 * constraint's target node, the emitted joint-goal / per-constraint
 * probabilities must be SUPPRESSED (absence is honest — the UI already gates
 * goal-fit rendering on absence) and a WARNING-severity inference warning must
 * tell the user what to do. Raw computed values stay in diagnostics (logs)
 * only.
 *
 * DOCTRINE B EXCEPTION (lane P0-C2, ratified by the product owner 2026-07-07):
 * when the ONLY reason is `target_base_defaulted` AND the target node has
 * forward-propagated inputs (≥1 directed incoming edge), the probabilities are
 * DELIVERED, not suppressed. Rationale: post PR #203 the threshold
 * normalisation is sound (producer-declared scale), and ISL scores the
 * constraint from the target node's forward-propagated outcome-sample series
 * (robustness_analyzer_v2.py — evaluate_multi shares the outcome code path;
 * prob_satisfied compares the SAME normalised samples the already-delivered
 * `probability_of_goal` uses). The defaulted base=0.0 means those samples are
 * the modelled level driven by upstream factors from a zero baseline — a
 * meaningful modelled distribution, not a constant placeholder. Delivery
 * carries an additive `goal_fit_basis` provenance annotation and an
 * info-severity CONSTRAINT_GOALFIT_MODELLED_BASIS note instead of the
 * warning. A defaulted-base target WITHOUT forward-propagated inputs (root
 * node) keeps suppressing: its samples would be a constant placeholder.
 * (ISL only emits CONSTRAINT_NODE_DEFAULT_BASE for non-root nodes today —
 * robustness_analyzer_v2.py `if not is_root and …` — the PLoT-side edge check
 * is defensive against ISL semantics drift.)
 *
 * This module is detection + classification only — suppression/delivery
 * happens at the emission sites in `src/routes/v2/run.ts` (buildResponse).
 * No ISL request change; no ISL change.
 */

import type { GoalConstraint } from '../types/engine-v3.js';
import type { NormalisationRange } from './intervention-normaliser.js';

/** ISL's open-vocabulary warning code for a constraint target defaulted to base=0.0. */
export const ISL_CONSTRAINT_NODE_DEFAULT_BASE_CODE = 'CONSTRAINT_NODE_DEFAULT_BASE';

/** Why a constraint target is not decision-grade. */
export type ConstraintUnreliabilityReason =
  /** Threshold normalisation fell back to the default [0,1] range (range_source: "default") */
  | 'threshold_normalisation_defaulted'
  /** ISL defaulted the target node's base to 0.0 (no observed value / no parameter uncertainty) */
  | 'target_base_defaulted';

export interface UnreliableConstraintTarget {
  constraint_id: string;
  node_id: string;
  reasons: ConstraintUnreliabilityReason[];
}

/**
 * Detect constraints whose emitted probabilities are NOT decision-grade.
 *
 * A constraint target is unreliable when EITHER:
 *  - its threshold normalisation used the default [0,1] fallback range
 *    (`constraintNormRanges` entry with `source: 'default'`), i.e. the
 *    user-unit threshold was scaled against a made-up domain; OR
 *  - ISL reported the target node's base was defaulted to 0.0
 *    (CONSTRAINT_NODE_DEFAULT_BASE in `inference_warnings` — wire shape
 *    `{ code, detail: { node_id, ... } }` — or in `critiques` via
 *    `affected_node_ids`), i.e. the sampled quantity itself is fabricated.
 *
 * Detection is deliberately conservative: absent inputs (no ranges map, no
 * islResult, no warnings) contribute nothing, so well-formed runs are
 * untouched.
 */
export function detectUnreliableConstraintTargets(
  goalConstraints: GoalConstraint[] | undefined,
  constraintNormRanges: Map<string, NormalisationRange> | undefined,
  islResult: unknown,
): UnreliableConstraintTarget[] {
  if (!goalConstraints || goalConstraints.length === 0) return [];

  // Collect node ids ISL flagged as defaulted-base (both wire channels).
  const defaultedBaseNodeIds = collectDefaultedBaseNodeIds(islResult);

  const out: UnreliableConstraintTarget[] = [];
  for (const gc of goalConstraints) {
    const reasons: ConstraintUnreliabilityReason[] = [];

    const range = constraintNormRanges?.get(gc.constraint_id);
    if (range?.source === 'default') {
      reasons.push('threshold_normalisation_defaulted');
    }

    if (defaultedBaseNodeIds.has(gc.node_id)) {
      reasons.push('target_base_defaulted');
    }

    if (reasons.length > 0) {
      out.push({ constraint_id: gc.constraint_id, node_id: gc.node_id, reasons });
    }
  }
  return out;
}

/** Extract node ids named by ISL CONSTRAINT_NODE_DEFAULT_BASE signals. */
function collectDefaultedBaseNodeIds(islResult: unknown): Set<string> {
  const ids = new Set<string>();
  const r = islResult as
    | {
        inference_warnings?: Array<{
          code?: unknown;
          node_id?: unknown;
          detail?: { node_id?: unknown };
        }>;
        critiques?: Array<{ code?: unknown; affected_node_ids?: unknown }>;
      }
    | null
    | undefined;
  if (!r || typeof r !== 'object') return ids;

  if (Array.isArray(r.inference_warnings)) {
    for (const w of r.inference_warnings) {
      if (w?.code !== ISL_CONSTRAINT_NODE_DEFAULT_BASE_CODE) continue;
      const nodeId = w?.detail?.node_id ?? w?.node_id;
      if (typeof nodeId === 'string' && nodeId.length > 0) ids.add(nodeId);
    }
  }

  if (Array.isArray(r.critiques)) {
    for (const c of r.critiques) {
      if (c?.code !== ISL_CONSTRAINT_NODE_DEFAULT_BASE_CODE) continue;
      if (Array.isArray(c.affected_node_ids)) {
        for (const nodeId of c.affected_node_ids) {
          if (typeof nodeId === 'string' && nodeId.length > 0) ids.add(nodeId);
        }
      }
    }
  }

  return ids;
}

/**
 * Wire value for the goal-fit provenance annotation (doctrine B): the
 * delivered probabilities are scored from the target node's
 * forward-propagated Monte Carlo outcome distribution against the normalised
 * threshold — not measured against an observed baseline for that node.
 */
export const GOAL_FIT_SCORED_FROM_MODELLED_OUTCOME = 'modelled_outcome_distribution' as const;

/** Partition of unreliable targets into suppression vs doctrine-B delivery. */
export interface ConstraintTargetPartition {
  /** Targets that keep run-level suppression (any reason set other than the doctrine-B case). */
  suppressed: UnreliableConstraintTarget[];
  /**
   * Doctrine-B targets: reason set exactly {target_base_defaulted} AND the
   * node has forward-propagated inputs. Probabilities are delivered with a
   * `goal_fit_basis` annotation + info-severity disclosure.
   */
  modelledBasis: UnreliableConstraintTarget[];
}

/**
 * Classify detected unreliable targets under doctrine B (P0-C2).
 *
 * A target qualifies for modelled-basis DELIVERY only when:
 *  - its reason set is exactly {target_base_defaulted} — i.e. threshold
 *    normalisation used a real, producer-declared or node-derived scale
 *    (post-#203); AND
 *  - the target node has at least one DIRECTED incoming edge in the graph
 *    PLoT sent to ISL, so its sample series is a forward-propagated modelled
 *    distribution, not a constant defaulted placeholder. Bidirected edges are
 *    excluded — the ISL translator strips them from the forward model
 *    (translator-v3.ts), so they contribute no propagation.
 *
 * Conservative on absent inputs: no graph (or no edges) → nothing qualifies,
 * every target keeps suppressing exactly as before doctrine B.
 */
export function partitionConstraintTargets(
  targets: UnreliableConstraintTarget[],
  graph: { edges?: Array<{ from?: string; to?: string; edge_type?: string }> } | undefined,
): ConstraintTargetPartition {
  const suppressed: UnreliableConstraintTarget[] = [];
  const modelledBasis: UnreliableConstraintTarget[] = [];

  // Node ids with ≥1 directed (non-bidirected) incoming edge — mirrors the
  // ISL translator's directed-edge filter (edge_type !== 'bidirected').
  const forwardPropagatedNodeIds = new Set<string>();
  if (Array.isArray(graph?.edges)) {
    for (const edge of graph.edges) {
      if (edge?.edge_type === 'bidirected') continue;
      if (typeof edge?.to === 'string' && edge.to.length > 0) {
        forwardPropagatedNodeIds.add(edge.to);
      }
    }
  }

  for (const target of targets) {
    const baseDefaultedOnly =
      target.reasons.length === 1 && target.reasons[0] === 'target_base_defaulted';
    if (baseDefaultedOnly && forwardPropagatedNodeIds.has(target.node_id)) {
      modelledBasis.push(target);
    } else {
      suppressed.push(target);
    }
  }

  return { suppressed, modelledBasis };
}

/**
 * Build the user-facing CONSTRAINT_GOALFIT_MODELLED_BASIS info note
 * (doctrine B delivery disclosure).
 *
 * provisional_doctrine_v0 — wording surface. Claim-safe: says what the
 * numbers ARE (modelled from the forward-propagated outcome distribution
 * against the target) and what they are NOT (anchored to an observed
 * baseline), names the node and the concrete user action, and never quotes
 * the delivered probabilities.
 */
export function buildConstraintGoalFitModelledMessage(nodeLabel: string): string {
  return (
    `Goal-fit for "${nodeLabel}" is modelled: "${nodeLabel}" has no observed baseline value, ` +
    `so each option's probability is scored from the modelled outcome distribution for ` +
    `"${nodeLabel}" against your target — it reflects modelled change driven by upstream ` +
    `factors, not distance from a measured starting point. ` +
    `Set a value for "${nodeLabel}" to anchor these probabilities to an observed baseline.`
  );
}

/**
 * Build the user-facing CONSTRAINT_TARGET_UNRELIABLE warning message.
 *
 * provisional_doctrine_v0 — wording surface. Names the node and the concrete
 * user action; never quotes the suppressed raw probabilities (those live in
 * diagnostics logs only).
 */
export function buildConstraintTargetUnreliableMessage(
  nodeLabel: string,
  reasons: ConstraintUnreliabilityReason[],
): string {
  const because = reasons.includes('target_base_defaulted')
    ? `"${nodeLabel}" has no observed value or uncertainty range, so the analysis substituted a placeholder`
    : `the target for "${nodeLabel}" could not be scaled against any known range for that node`;
  return (
    `The success target on "${nodeLabel}" can't be evaluated reliably: ${because}. ` +
    `Goal-fit probabilities were withheld for this run because they would be meaningless. ` +
    `Set a value or range for "${nodeLabel}" to make this target computable.`
  );
}

/**
 * Defensive sign-check for the auto-constraint fallback (Phase 1c+, run.ts
 * ~line 3696): when goal_constraints is empty but a bare `goal_threshold`
 * exists, PLoT synthesises a single `>= threshold` constraint because it has
 * no visibility into the goal-framing text CEE extracted the number from —
 * a target phrased as a maximum ("keep churn under X") would need `<=`, not
 * `>=`, and PLoT cannot tell the two apart from the number alone.
 *
 * Guessing wrong is usually harmless-looking (a plausible-but-wrong
 * probability), which is exactly what makes it dangerous. This function
 * catches the one case PLoT CAN detect on its own evidence, with no NLP:
 * the guessed threshold is positive, and the modelled outcome distribution
 * for that SAME target node never gets there even at its most favourable
 * sampled percentile (p90 < 0). In that case `>= positive_threshold` is
 * structurally unsatisfiable — every option is guaranteed a ~0% joint-goal
 * probability by construction, not because the graph says the goal is hard.
 * That ~0% is indistinguishable on the wire from a real "this option won't
 * reach the target" signal, so emitting it would be a fabrication dressed
 * up as a computation. Abstain instead (see run.ts call site).
 *
 * Deliberately conservative: absent/non-finite inputs, a non-positive
 * threshold, or an outcome that reaches non-negative territory anywhere in
 * its sampled range all return false — normal (satisfiable-looking) runs are
 * completely untouched.
 */
export function isAutoConstraintDirectionSuspect(
  autoConstraintValue: number | undefined,
  outcomeP90: number | undefined,
): boolean {
  if (typeof autoConstraintValue !== 'number' || !Number.isFinite(autoConstraintValue)) return false;
  if (autoConstraintValue <= 0) return false;
  if (typeof outcomeP90 !== 'number' || !Number.isFinite(outcomeP90)) return false;
  return outcomeP90 < 0;
}

/**
 * Build the user-facing CONSTRAINT_DIRECTION_SUSPECT warning message.
 *
 * provisional_doctrine_v0 — wording surface. Names the node, states what
 * PLoT observed (not an intent judgement — PLoT cannot see the goal framing
 * text), says probabilities were withheld rather than fabricated, and
 * suggests the concrete fix. Never quotes a suppressed number.
 */
export function buildConstraintDirectionSuspectMessage(nodeLabel: string): string {
  return (
    `The auto-generated success target for "${nodeLabel}" assumes higher is better, but the ` +
    `modelled outcome for "${nodeLabel}" stays negative for every option even in the most ` +
    `favourable modelled scenario — the target and the modelled direction don't line up. ` +
    `Goal-fit probabilities were withheld for this run rather than showing a near-zero number ` +
    `that the direction mismatch — not the graph — would produce. If "${nodeLabel}" is meant ` +
    `to be minimised (e.g. a cost or a rate you want low), add an explicit goal constraint with ` +
    `the correct operator instead of relying on the plain threshold.`
  );
}
