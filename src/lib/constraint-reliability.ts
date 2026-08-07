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
  | 'target_base_defaulted'
  /**
   * ROADMAP 2.xxx (L63). The target node's Monte-Carlo samples carry NO absolute
   * anchor, so no absolute threshold can be compared against them. See
   * `detectUnanchoredSampleFrameTargets` for the derivation.
   */
  | 'sample_frame_unanchored'
  /**
   * The constraint's declared unit and the declared unit of the scale its
   * threshold was normalised against name DIFFERENT QUANTITY KINDS — the
   * witnessed `<= 2 'count'` divided by an `observed_state {cap: 100, unit:'%'}`
   * (see `lib/constraint-units.ts`). The number on the wire is then about a
   * different quantity than the one the user asked about, so no probability
   * derived from it may be delivered. See `detectUnitMismatchedConstraintTargets`.
   */
  | 'constraint_unit_mismatch';

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

// ---------------------------------------------------------------------------
// L63 — the constraint SAMPLE-FRAME gate
// ---------------------------------------------------------------------------

/** How a constraint target's samples were proved to carry an absolute anchor. */
export type ConstraintSampleFrameAnchor =
  /** The producer attested that targets on this node are stated in the samples' own frame. */
  | 'attested_delta'
  /** Every option intervenes on this node, so each sample IS that absolute value. */
  | 'pinned_by_every_option'
  /** Root node with an observed value — the evaluator seeds it as the sample's base. */
  | 'root_observed_level';

/** Minimal shape of a graph node this module needs. Structural, not nominal. */
interface AnchorNodeLike {
  id?: unknown;
  observed_state?: { value?: unknown } | null;
}

/** Minimal shape of an option this module needs. Structural, not nominal. */
interface AnchorOptionLike {
  interventions?: Record<string, unknown> | null;
}

/**
 * Decide whether a constraint target node's samples carry an ABSOLUTE ANCHOR,
 * and if so on what basis. `null` = no anchor could be proved.
 *
 * THE ARITHMETIC, read off ISL's own evaluator rather than assumed
 * (`robustness_analyzer_v2.py` `SCMEvaluatorV2.evaluate`, @`80aa83f6`)::
 *
 *     if node in interventions:  sample = interventions[node]
 *     else:                      sample = base + intercept + SUM(parent * strength)
 *     where base = observed_state.value  iff  is_root AND it is present
 *                = 0.0                   otherwise
 *     and   is_root = the node has no parents in the DIRECTED edge set
 *
 * So a sample is an absolute quantity in exactly three cases, and in no others:
 *
 *   1. `pinned_by_every_option` — an intervention overrides the structural
 *      equation entirely, so the sample IS the intervened value. Required for
 *      EVERY option: if one option leaves the node free, that option's samples
 *      are unanchored and the constraint is not comparable ACROSS options,
 *      which is the only way a constraint is ever read.
 *   2. `root_observed_level` — a root's base is its observed value and its
 *      parent contribution is empty, so the sample is that level (plus the
 *      node's own intercept and noise). This is ISL's own reading: its
 *      goal-threshold resolver REFUSES a level conversion for a root goal
 *      precisely because "a root goal takes its base from observed_state.value,
 *      so its samples are not in the non-root change-from-origin frame".
 *   3. `attested_delta` — the producer stamped `goal_threshold_frame: 'delta'`
 *      on the node, attesting that targets on it are already expressed in the
 *      samples' own frame. This is the SAME attestation, read the SAME way, as
 *      the auto-synthesis gate (ROADMAP 2.266, `routes/v2/run.ts`) — not a
 *      second doctrine. ISL has no way to verify a caller's attestation and
 *      neither has PLoT; what it buys is that a wrong number is then the
 *      producer's stated frame, not a silent assumption by us.
 *
 * ⚠ WHY A NON-ROOT NODE IS NOT ANCHORED, EVEN WHEN ITS PARENTS ALL CARRY DATA.
 * The tempting reading is that `intercept + SUM(parent * strength)` is a
 * CALIBRATED LEVEL: the parents hold their absolute current values, so the sum
 * ought to predict the node's actual level. ISL tried exactly that reading and
 * MEASURED it wrong. The ROADMAP 2.286 correction
 * (`robustness_analyzer_v2.py:3455-3487`) records the case: baseline 0.7,
 * status-quo sample 0.25 — the sample and the level disagree by more than the
 * whole comparison — and the fix was to stop reading the sample's absolute
 * position at all, recovering levels per draw against a status-quo reference
 * (`level_i = B + (option_sample_i - status_quo_sample_i)`). Only sample
 * DIFFERENCES survive that derivation. Nothing calibrates `intercept` — it
 * defaults to 0.0, and no witnessed live graph sets it (both scenarios in
 * `PHASE0-EVIDENCE-2026-07-28/l60-artefacts/scenario-*.json`: every node's
 * `intercept` is absent) — so in practice the sample is bare parent
 * propagation. An absolute threshold compared against it answers a question
 * nobody asked, and answers it with a structural zero.
 *
 * ⚠ WHY `ParameterUncertainty` IS NOT AN ANCHOR HERE, THOUGH ISL'S OWN
 * `CONSTRAINT_NODE_DEFAULT_BASE` CRITIQUE TREATS IT AS ONE. That critique asks
 * "will this node's base silently default to 0.0?", and a PU answers it: the
 * FactorSampler supplies a base. This function asks a DIFFERENT question — "is
 * the sample an absolute level?" — and for a NON-ROOT node a PU does not make
 * it one: the sampled base REPLACES `base` and the parent contribution is still
 * ADDED on top, giving `observed + intercept + S`, which double-counts rather
 * than anchors. ISL says as much where it excludes non-root nodes from factor
 * flips: "`factor_values` would ADD to their parent contribution rather than
 * replace a base". Deliberately divergent from that list, for a stated reason.
 */
export function resolveConstraintSampleFrameAnchor(
  nodeId: string,
  nodes: readonly AnchorNodeLike[] | undefined,
  directedEdgeTargets: ReadonlySet<string>,
  options: readonly AnchorOptionLike[] | undefined,
  goalThresholdFrameByNodeId: ReadonlyMap<string, string> | undefined,
): ConstraintSampleFrameAnchor | null {
  if (goalThresholdFrameByNodeId?.get(nodeId) === 'delta') return 'attested_delta';

  // Pinned by EVERY option. An empty option list proves nothing (`[].every()`
  // is vacuously true), so it must not mint an anchor — the same vacuous-true
  // trap the constraints_decision_grade aggregate documents.
  //
  // ⚠ THIS LIMB READS INTERVENTION KEYS ONLY, AND THAT IS LOAD-BEARING. The
  // caller passes the options held at response-assembly time, which are not the
  // same OBJECTS as the ones sent to ISL (`optionsForISL` — Phase 4a rescales
  // the values). Keys are safe to read across that boundary because
  // `normaliseOptions` cannot drop one: ROADMAP 1.278 established that omitting
  // an intervention "would silently change WHAT WAS ANALYSED while still
  // returning a confident answer", so the normaliser REFUSES instead of
  // omitting. Reading a VALUE here would be reading the wrong number; reading a
  // key is reading the same set ISL receives. If that invariant is ever
  // relaxed, this limb becomes fail-OPEN (a pin PLoT sees and ISL does not) and
  // must be re-pointed at the egress options.
  //
  // Note the direction of every other limb's error is fail-CLOSED, so this is
  // the one place in the gate where an upstream change could cost truth rather
  // than coverage.
  if (
    Array.isArray(options) &&
    options.length > 0 &&
    options.every((o) => {
      const interventions = o?.interventions;
      return (
        interventions !== null &&
        typeof interventions === 'object' &&
        Object.prototype.hasOwnProperty.call(interventions, nodeId)
      );
    })
  ) {
    return 'pinned_by_every_option';
  }

  if (directedEdgeTargets.has(nodeId)) return null; // non-root ⇒ base = 0.0

  const node = Array.isArray(nodes) ? nodes.find((n) => n?.id === nodeId) : undefined;
  const observedValue = node?.observed_state?.value;
  if (typeof observedValue === 'number' && Number.isFinite(observedValue)) {
    return 'root_observed_level';
  }
  return null;
}

/**
 * Detect constraints whose target node's samples carry no absolute anchor
 * (L63 — the constraint-frame hole).
 *
 * WHY THIS EXISTS AS A SEPARATE DETECTOR, next to
 * `detectUnreliableConstraintTargets`. That function reads ISL's emitted
 * `CONSTRAINT_NODE_DEFAULT_BASE` warnings — it MIRRORS an upstream list, and
 * so it inherits every gap in it (a PU'd non-root target, for instance, is
 * never flagged there, yet its samples are just as unanchored). This one is
 * DERIVED, from the very graph and options PLoT is sending on this request, so
 * the predicate and the payload cannot disagree and no upstream emission
 * change can silently open a hole in it.
 *
 * FAIL CLOSED. An anchor must be PROVED. A missing graph, a missing node, a
 * missing observed value — none of them establish an anchor, so all of them
 * refuse. This is the same posture as ISL's own frame resolver ("FAIL CLOSED.
 * Every path that cannot be proved returns (None, warning)").
 *
 * @param directedEdgeTargets  node ids with >=1 DIRECTED incoming edge. Derived
 *   by the caller from the same edge set the ISL translator forwards
 *   (`edge_type !== 'bidirected'`) — bidirected edges are stripped from the
 *   forward model, so they create no parent and cannot un-root a node.
 */
export function detectUnanchoredSampleFrameTargets(
  goalConstraints: GoalConstraint[] | undefined,
  nodes: readonly AnchorNodeLike[] | undefined,
  directedEdgeTargets: ReadonlySet<string>,
  options: readonly AnchorOptionLike[] | undefined,
  goalThresholdFrameByNodeId: ReadonlyMap<string, string> | undefined,
): UnreliableConstraintTarget[] {
  if (!goalConstraints || goalConstraints.length === 0) return [];

  const out: UnreliableConstraintTarget[] = [];
  for (const gc of goalConstraints) {
    const anchor = resolveConstraintSampleFrameAnchor(
      gc.node_id,
      nodes,
      directedEdgeTargets,
      options,
      goalThresholdFrameByNodeId,
    );
    if (anchor === null) {
      out.push({
        constraint_id: gc.constraint_id,
        node_id: gc.node_id,
        reasons: ['sample_frame_unanchored'],
      });
    }
  }
  return out;
}

/**
 * Detect constraints whose threshold was normalised against a scale in a
 * DIFFERENT UNIT — the goal-fit unit collision.
 *
 * WHY IT IS A THIRD, SEPARATE DETECTOR rather than a limb of either sibling.
 * `detectUnreliableConstraintTargets` asks "did the SCALE come from somewhere
 * real?" and `detectUnanchoredSampleFrameTargets` asks "are the SAMPLES an
 * absolute quantity?". Both can answer YES for the witnessed capture and both
 * did: the range source was `explicit_cap` (a real, producer-declared node cap,
 * so no `threshold_normalisation_defaulted`), and the L63 anchor limb
 * `root_observed_level` PROVES a frame for any root target carrying an observed
 * value — proving nothing whatever about the unit. This detector asks the third
 * question, which neither of the others can reach: **is the threshold about the
 * SAME QUANTITY as the scale it was divided by?**
 *
 * It reads the decision `normaliseGoalConstraints` already recorded (projected
 * through `scale_provenance.unit_mismatch`) rather than re-deriving it from
 * units + nodes here — the normaliser is the only place that holds both
 * operands at ladder-decision time, and a second derivation is a second thing
 * to drift.
 *
 * FAIL-CLOSED IN THE DIRECTION THAT MATTERS: an ABSENT provenance entry claims
 * nothing and detects nothing, which is correct — a constraint with no
 * provenance underwent no normalisation (forwarded raw, already in [0,1]), so
 * no scale was applied to collide with.
 */
export function detectUnitMismatchedConstraintTargets(
  goalConstraints: GoalConstraint[] | undefined,
  scaleProvenanceByConstraintId:
    | ReadonlyMap<string, { unit_mismatch?: { constraint_unit: string; scale_unit: string } }>
    | undefined,
): UnreliableConstraintTarget[] {
  if (!goalConstraints || goalConstraints.length === 0) return [];
  if (!scaleProvenanceByConstraintId) return [];

  const out: UnreliableConstraintTarget[] = [];
  for (const gc of goalConstraints) {
    const mismatch = scaleProvenanceByConstraintId.get(gc.constraint_id)?.unit_mismatch;
    if (mismatch === undefined) continue;
    out.push({
      constraint_id: gc.constraint_id,
      node_id: gc.node_id,
      reasons: ['constraint_unit_mismatch'],
    });
  }
  return out;
}

/**
 * Union two unreliability detections by constraint_id, preserving reason order
 * and de-duplicating. Neither detector is authoritative over the other: they
 * answer different questions (see `detectUnanchoredSampleFrameTargets`), and a
 * constraint can fail both.
 */
export function mergeUnreliableConstraintTargets(
  ...detections: UnreliableConstraintTarget[][]
): UnreliableConstraintTarget[] {
  const byConstraintId = new Map<string, UnreliableConstraintTarget>();
  for (const detection of detections) {
    for (const target of detection) {
      const existing = byConstraintId.get(target.constraint_id);
      if (existing === undefined) {
        byConstraintId.set(target.constraint_id, {
          constraint_id: target.constraint_id,
          node_id: target.node_id,
          reasons: [...target.reasons],
        });
        continue;
      }
      for (const reason of target.reasons) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      }
    }
  }
  return [...byConstraintId.values()];
}

/**
 * Node ids carrying >=1 DIRECTED incoming edge, derived from the edge set PLoT
 * forwards to ISL. Single-sourced so the doctrine-B forward-propagation test
 * and the L63 root test can never drift apart — they are the same question
 * ("does this node have parents in ISL's forward model?") asked twice.
 */
export function collectDirectedEdgeTargets(
  edges: ReadonlyArray<{ from?: string; to?: string; edge_type?: string }> | undefined,
): Set<string> {
  const targets = new Set<string>();
  if (!Array.isArray(edges)) return targets;
  for (const edge of edges) {
    if (edge?.edge_type === 'bidirected') continue;
    if (typeof edge?.to === 'string' && edge.to.length > 0) targets.add(edge.to);
  }
  return targets;
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

  // Node ids with ≥1 directed (non-bidirected) incoming edge. Single-sourced
  // with the L63 root test (`collectDirectedEdgeTargets`) so the two cannot
  // drift: doctrine B's "forward-propagated" and L63's "non-root" are the same
  // predicate, and they must stay the same predicate.
  const forwardPropagatedNodeIds = collectDirectedEdgeTargets(graph?.edges);

  for (const target of targets) {
    // ⚠ L63 OVERRIDE — a target whose SAMPLE FRAME is unanchored can never be
    // delivered under doctrine B, whatever else is true of it.
    //
    // Doctrine B's ratified rationale was, verbatim: ISL "scores the constraint
    // from the target node's forward-propagated outcome-sample series …
    // prob_satisfied compares the SAME normalised samples the already-delivered
    // `probability_of_goal` uses". That premise was TRUE when it was ratified
    // (2026-07-07) and was INVALIDATED by ROADMAP 2.258/2.286 without this rule
    // being revisited: `probability_of_goal` no longer compares the threshold
    // against raw samples at all — it rides a per-draw GoalThresholdPlan
    // (`level_i = B + (option_i − sq_i)`) or REFUSES. The constraint path still
    // compares raw. The two are no longer the same comparison, so the reason to
    // trust the second because the first was delivered has gone.
    //
    // It is not a theoretical drift. On the witnessed live run
    // (`PHASE0-EVIDENCE-2026-07-28/diagnosis-goalfit-untruth.md` §6, deployed
    // tips) the two channels answered in OPPOSITE directions inside one
    // response: `probability_of_goal` ABSENT (the frame guard refusing) beside
    // `probability_of_joint_goal` = 0 DELIVERED under this very exception —
    // and the UI substituted the delivered zero into the goal-fit surface the
    // refusal had honestly left empty. Doctrine B is therefore restricted, not
    // repealed: it still delivers where an anchor is PROVED (a pinned or
    // root-observed target, or a producer-attested 'delta' frame), which is
    // exactly where its rationale still holds.
    if (target.reasons.includes('sample_frame_unanchored')) {
      suppressed.push(target);
      continue;
    }
    // ⚠ UNIT-COLLISION OVERRIDE — same shape as the L63 override above, and for
    // a stronger reason. Doctrine B delivers because the samples are "a
    // meaningful modelled distribution" scored "against the target". When the
    // threshold and the scale it was divided by are in different units, the
    // thing being compared against is not the user's target at all — "lose at
    // most 2 account executives" arrives as "attrition at or below 2%". No
    // property of the SAMPLES can rescue a threshold that is about a different
    // quantity, so this can never ride any delivery exception.
    if (target.reasons.includes('constraint_unit_mismatch')) {
      suppressed.push(target);
      continue;
    }
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
  /**
   * The colliding units, when `constraint_unit_mismatch` is among the reasons.
   * Optional so every existing call site is unchanged; without it the unit
   * branch still fires but names the collision generically rather than by unit.
   */
  unitMismatch?: { constraint_unit: string; scale_unit: string },
): string {
  // The unit collision outranks every other reason: the other reasons describe
  // problems with a comparison between the user's target and the model, while
  // this one says the number compared was never the user's target. Claim-safe,
  // same rules as its siblings — names what was and was not compared, never
  // quotes the withheld probability, names a concrete user action.
  if (reasons.includes('constraint_unit_mismatch')) {
    const inUnits =
      unitMismatch !== undefined
        ? `your target is stated in ${unitMismatch.constraint_unit} while "${nodeLabel}" is ` +
          `measured in ${unitMismatch.scale_unit}`
        : `your target and "${nodeLabel}" are measured in different units`;
    return (
      `The target on "${nodeLabel}" can't be scored: ${inUnits}, so scaling the target ` +
      `against that factor would silently change what you asked for into a target about a ` +
      `different quantity. Goal-fit probabilities were withheld for this run rather than ` +
      `computed from the wrong number. Restate the target in the same units as ` +
      `"${nodeLabel}" — or set that factor's unit to match your target.`
    );
  }
  // L63 takes priority when present: it is the strongest statement available
  // about this target (the comparison itself is not well-posed), and the other
  // reasons describe inputs to a comparison that is not going to happen.
  // Claim-safe, same rules as its siblings: says what was and was not compared,
  // never quotes the withheld probability, and names a concrete user action.
  if (reasons.includes('sample_frame_unanchored')) {
    return (
      `The target on "${nodeLabel}" can't be scored against this model: "${nodeLabel}" is ` +
      `calculated from the factors feeding into it, so the analysis produces a modelled ` +
      `change for it, not a reading on the same scale as your target. Comparing the two ` +
      `would report a near-zero chance for every option no matter how good the options are, ` +
      `so goal-fit probabilities were withheld for this run rather than shown. ` +
      `Set a current value for "${nodeLabel}" — or state the target as the change you want ` +
      `from today — to make it comparable.`
    );
  }
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
