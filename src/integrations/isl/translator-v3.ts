/**
 * ISL Translator for V3 Engine
 *
 * Translates from internal EngineGraphV3 format to ISL wire format.
 * ISL expects a flattened format with different field names.
 *
 * @see Integration Alignment Implementation Brief v1.1
 */

import type {
  EngineGraphV3,
  EngineNodeV3,
  EngineEdgeV3,
  OptionV3,
  InterventionValueV3,
  GoalConstraint,
  ConstraintLevelDomain,
  FactorCorrelation,
  NonlinearIdentity,
} from '../../types/engine-v3.js';
import { INFERENCE_WARNING_CODES, type InferenceWarning } from '../../types/engine-v3.js';
import {
  DEFAULT_STD_FLOOR,
  BINARY_DEFAULT_STD,
  VALUE_BASED_STD_FRACTION,
  MIN_USER_STD,
  resolveUserSuppliedStd,
} from './parameter-uncertainty-bounds.js';
import { sha8 } from '../../util/pii-redact.js';
import { resolveNodeFrame, type NodeFrameCarrier } from '../../lib/intervention-normaliser.js';
import { buildAdjacencyList, checkPathToGoal } from '../../validation/path-to-goal.js';
// ROADMAP 2.258. DERIVED from the shared contract, never hand-mirrored.
//
// `GoalThresholdFrame` is the Zod enum itself, so `parseGoalThresholdFrame`
// below validates against the CONTRACT's member list rather than a local copy
// of it, and `GoalThresholdFrameType` follows the contract automatically. If
// 0.32.0 ever adds a third frame, this file widens with it instead of silently
// rejecting the new token — the hand-maintained-mirror defect class (the
// dominant one in this estate) cannot arise here by construction.
import { GoalThresholdFrame, type GoalThresholdFrameType, type QuantityFrameType } from '@talchain/schemas';

/**
 * The frame a `goal_threshold` is stated in, as the shared contract defines it.
 * Re-exported so callers in this repo import one name, not two.
 */
export type { GoalThresholdFrameType };

/**
 * Validate an untrusted producer-stamped frame against the CONTRACT's enum.
 *
 * Returns the frame when it is a member, `undefined` otherwise — and
 * `undefined` is a legitimate, meaningful answer here (see
 * `ISLRobustnessRequestV3.goal_threshold_frame`): a junk value must degrade to
 * ABSENT, never to a guess. Forwarding an unrecognised token would make ISL
 * reject the whole request at Pydantic validation, turning a producer typo into
 * a failed analysis instead of a disclosed missing frame.
 */
/**
 * ROADMAP 2.920 — the user's objective sense for the goal node.
 *
 * ISL's deployed contract (`build c00f507`) accepts
 * `goal_direction: 'maximise' | 'minimise' | 'target' | null` and honours it:
 * MEASURED on a reduce-goal, one variable, `isl-staging`:
 *
 *     absent      : opt_high 0.98125  ← the option that MAXIMISES churn
 *     'minimise'  : opt_low  0.98125  ← ranking flips
 *     'maximise'  : opt_high 0.98125  ← byte-identical to absent
 *
 * The `maximise` arm is the control: it proves absent ⇒ maximise, which is why
 * ISL emits `GOAL_DIRECTION_UNATTESTED` on every unstamped run and says in terms
 * that "the historical rule crowned the worst option" for a quantity to reduce.
 *
 * ⚠ DEFINED LOCALLY, NOT IMPORTED. `@talchain/schemas` 0.59.0 exports
 * `GoalThresholdFrame` but has NO `GoalDirection` (re-verified against the vendored
 * 0.59.0 tarball's dist/, with `GoalThresholdFrame` as the contrast control). When CEE wires the
 * producer side the shared package should carry it and this local type should be
 * replaced by the import — exactly as `value_frame` uses `GoalThresholdFrameType`.
 */
export type GoalDirectionType = 'maximise' | 'minimise' | 'target';

const GOAL_DIRECTIONS: ReadonlySet<string> = new Set([
  'maximise',
  'minimise',
  'target',
]);

/**
 * Narrow an unknown to a `GoalDirectionType`, or `undefined`.
 *
 * Returns `undefined` for anything unrecognised rather than defaulting: an
 * omitted key reproduces today's behaviour EXACTLY, whereas a guessed direction
 * INVERTS the ranking and is strictly worse than the current error.
 */
export function parseGoalDirection(value: unknown): GoalDirectionType | undefined {
  return typeof value === 'string' && GOAL_DIRECTIONS.has(value)
    ? (value as GoalDirectionType)
    : undefined;
}

export function parseGoalThresholdFrame(value: unknown): GoalThresholdFrameType | undefined {
  const parsed = GoalThresholdFrame.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

// -----------------------------------------------------------------------------
// ISL Wire Format Types
// -----------------------------------------------------------------------------

/**
 * ISL node format.
 */
export interface ISLNodeV3 {
  id: string;
  kind?: string;
  label?: string;
  observed_state?: {
    value?: number;
    baseline?: number;
    unit?: string;
    std?: number;
    /** V3 expansion fields (passed through for downstream consumers) */
    raw_value?: number;
    cap?: number;
    factor_type?: string;
    uncertainty_drivers?: string[];
    /**
     * CEE-origin fields PLoT's normaliser does not currently produce, but which
     * ISL's `ObservedState` declares and the projection allowlist forwards.
     *
     * ⚠ ROADMAP 2.274 — these were MISSING from this type while present on
     * `ISL_DECLARED_OBSERVED_STATE_FIELDS`, and the `as` cast in
     * toISLObservedState erased the discrepancy: had a PLoT observed_state ever
     * carried them they would have gone on the wire untyped and unnoticed. The
     * two are now pinned to each other at COMPILE time (see the list below), so
     * this class of divergence cannot recur silently.
     */
    source?: string;
    extractionType?: string;
  };
  intercept?: number;
  epsilon_std?: number;
  /**
   * R3 slice 1 (B2): the node is exactly `operation` of `factor_ids`. Forwarded VERBATIM only when
   * the node declares one (validated at ingress by `readNonlinearIdentity`), so every other
   * request's ISL body — and its response_hash — is byte-identical.
   */
  nonlinear_identity?: NonlinearIdentity;
  /**
   * R3-8: the node's frame (user units = normalised × frame), resolved by THE node-frame reader
   * (`resolveNodeFrame`: cap → scale_frame → pair). Runtime metadata, attached ONLY to a declared
   * identity's own nodes (`attachIdentityExecutionFrames`); never persisted, never written into
   * `nonlinear_identity`. Absent when no frame resolves — ISL then withholds the identity
   * (`identity_frame_missing`), never infers one.
   */
  execution_frame?: { frame: number; carrier: NodeFrameCarrier };
  /**
   * R1 S3 (@talchain/schemas 0.61.0): what the node's value measures, forwarded by presence from
   * the canonical node. Absent = `level`; so a request no producer typed is byte-identical.
   */
  quantity_frame?: QuantityFrameType;
  /**
   * R1 S3 (wire R3 #72 5872798858): the RAW bounds this node's normalised values are read on —
   * `v_n = (v − min)/(max − min)`. Sent ONLY on a `change_rel` target whose limits all resolved
   * the same real range (`attachChangeFrameRawRanges`); ISL needs it to turn `r` into a change
   * on the sample scale. Absent ⇒ ISL refuses the relative change by name; PLoT never guesses
   * `min = 0`.
   */
  raw_range?: { min: number; max: number };
}

/**
 * R1 S3 — attach the raw bounds ISL needs to resolve a `change_rel` target, to THAT target only.
 *
 * `rawRangeByNodeId` holds one agreed real range per `change_rel` target (the normaliser's copy for
 * a limit; `[0, goal_threshold_cap]` for the goal). Every other node is untouched, so a request with
 * no relative change sends a byte-identical ISL body (the `attachIdentityExecutionFrames` pattern).
 *
 * WHOSE base is NOT attached here: it is the target's `observed_state.source`, already on the wire
 * (`ISL_DECLARED_OBSERVED_STATE_FIELDS`), and ISL derives the owner from it — one carrier on every
 * hop, no `baseline_owner` field anywhere (DL olumi-schemas #69 5873822541, decision (b)).
 */
export function attachChangeFrameRawRanges(
  islNodes: ISLNodeV3[],
  rawRangeByNodeId: ReadonlyMap<string, { min: number; max: number }>,
): void {
  if (rawRangeByNodeId.size === 0) return;
  for (const node of islNodes) {
    const range = rawRangeByNodeId.get(node.id);
    if (range !== undefined) node.raw_range = { min: range.min, max: range.max };
  }
}

/**
 * R3-8: attach each declared identity's participants' execution frames (the node, its factor_ids
 * and its addends) to the ISL nodes, in place. Every node that is not an identity participant is
 * untouched, so a request that declares no identity sends a byte-identical ISL body.
 */
export function attachIdentityExecutionFrames(
  islNodes: ISLNodeV3[],
  engineNodes: readonly EngineNodeV3[],
  scaleFrameByNodeId: ReadonlyMap<string, number>,
  /**
   * The GOAL's producer-declared `goal_threshold_cap` by node id (`collectGoalThresholdNodeMeta`). Read ONLY for a
   * `kind: 'goal'` participant, and ONLY when the node-frame reader resolves nothing — see `goalCapFrame`.
   */
  goalCapByNodeId: ReadonlyMap<string, number> = new Map(),
  /** Variant (a): OUT — each frame PLoT derived for a frameless inferred intermediate carrier (`_meta.identity_derived_frames`). */
  derivedFrames: IdentityDerivedFrame[] = [],
  /** Variant (d): the goals' card-domain carriers (`goalCarrierIds`). Empty → (d) reads the goal alone. */
  goalCarriers: ReadonlySet<string> = new Set(),
): IdentityNotForwarded[] {
  const engineById = new Map(engineNodes.map((node) => [node.id, node]));
  const islById = new Map(islNodes.map((node) => [node.id, node]));
  const participantsOf = (node: ISLNodeV3): string[] => {
    const identity = node.nonlinear_identity!;
    return [node.id, ...identity.factor_ids, ...(identity.addends ?? [])];
  };
  for (const node of islNodes) {
    if (!node.nonlinear_identity) continue;
    for (const id of participantsOf(node)) {
      const participant = islById.get(id);
      if (!participant || participant.execution_frame) continue;
      const engine = engineById.get(id);
      const resolved = resolveNodeFrame(engine?.observed_state, scaleFrameByNodeId.get(id))
        ?? goalCapFrame(engine, goalCapByNodeId.get(id));
      if (resolved) participant.execution_frame = { frame: resolved.frame, carrier: resolved.carrier };
    }
  }
  // ⛔ Variant (d) (AIQ #72 5891286280; R3 5891423959): an INFERRED (`stated_in_brief: false`) PRODUCT identity ON THE
  // GOAL is Olumi's reading of how the user's goal is made, and the user has not confirmed it. The brief's own words
  // license a silent product (then it arrives `stated_in_brief: true`); anything else waits for the user's Yes on the
  // card (CEE #2292 writes it `stated_in_brief: true`). Until then it is NOT forwarded: the goal stays linear and
  // `goalIdentitiesNotEvaluated` withholds every goal figure under its own code — never a chance through an unconfirmed
  // product (served: "reaches above £85k MRR in 99.8%"), never one from the linear walk. Sums, stated identities and
  // non-goal carriers fall through to the variants below untouched.
  // The card domain decides, not the node kind (AIQ 5891608873; DL 5891633125; PR Review CR 5891899825): a goal carrier
  // (`goalCarrierIds` — units compose to the goal's, the user's three levels, within 5%) is a reading of the goal too,
  // however many parents the goal has. A carrier outside the domain (DL A15: an Olumi level) is not (d)'s.
  const notForwarded: IdentityNotForwarded[] = [];
  for (const node of islNodes) {
    const identity = node.nonlinear_identity;
    if (!identity || identity.stated_in_brief !== false || identity.operation !== 'product') continue;
    if (engineById.get(node.id)?.kind !== 'goal' && !goalCarriers.has(node.id)) continue;
    delete node.nonlinear_identity;
    notForwarded.push({ node_id: node.id, reason: 'inferred_identity_unconfirmed', frameless_node_ids: [] });
  }
  // ⭐ Variant (a) (DL #72 5865205478, Canonical 5862317311) — ONE shape only: an INFERRED (`stated_in_brief: false`)
  // PRODUCT identity with no addends, whose carrier is a NON-GOAL OUTCOME with no level and no frame, and EVERY factor of
  // which is framed. Its frame is the product of its factors' frames — the most the parts can make — sent as carrier
  // `cap` (ISL's enum unchanged) and DISCLOSED as Olumi's derived frame (`IdentityDerivedFrame`), never a user figure.
  // Served: journey A's `pro_plan_mrr = price × subscribers` (5 of 10 runs since 05:15Z) was withheld for want of a
  // ruler. The ruler gate (×0.5 / ×1 / ×2 on 5 served drafts, ISL's real analyser) is the PR's evidence. A goal, a
  // stated identity, a carrier with a level, and a partly framed identity fall through to today's rules untouched.
  for (const node of islNodes) {
    const identity = node.nonlinear_identity;
    if (!identity || identity.stated_in_brief !== false || identity.operation !== 'product') continue;
    if ((identity.addends?.length ?? 0) > 0 || node.execution_frame) continue;
    const engine = engineById.get(node.id);
    if (engine?.kind !== 'outcome' || hasFiniteLevel(engine.observed_state)) continue;
    const factorFrames = identity.factor_ids.map((id) => ({ node_id: id, frame: islById.get(id)?.execution_frame?.frame }));
    if (factorFrames.some((f) => typeof f.frame !== 'number' || !Number.isFinite(f.frame) || f.frame <= 0)) continue;
    const frame = factorFrames.reduce((product, f) => product * (f.frame as number), 1);
    if (!Number.isFinite(frame) || frame <= 0) continue;
    node.execution_frame = { frame, carrier: 'cap' };
    derivedFrames.push({
      node_id: node.id,
      frame,
      source: 'olumi_derived_product_of_factor_frames',
      factor_frames: factorFrames.map((f) => ({ node_id: f.node_id, frame: f.frame as number })),
    });
  }
  // ⛔ Variant (b) (DL #72 5863297824): an INFERRED identity (`stated_in_brief: false`) with any participant left
  // frameless is NOT forwarded — the node stays linear, exactly as served before the re-land — and is said
  // (`IdentityNotForwarded`). ISL would refuse the whole Run (`identity_frame_missing`) for a figure the user never
  // stated and cannot answer. A STATED identity is always forwarded: ISL's refusal stands (AIQ's rule).
  for (const node of islNodes) {
    const identity = node.nonlinear_identity;
    if (!identity || identity.stated_in_brief !== false) continue;
    const missing = participantsOf(node).filter((id) => !islById.get(id)?.execution_frame);
    if (missing.length === 0) continue;
    delete node.nonlinear_identity;
    notForwarded.push({ node_id: node.id, reason: 'inferred_identity_frame_unresolved', frameless_node_ids: missing });
  }
  // A frame is carried only on a participant of an identity that IS forwarded (R3-8: no other node is touched).
  if (notForwarded.length > 0) {
    const kept = new Set(islNodes.filter((n) => n.nonlinear_identity).flatMap(participantsOf));
    for (const node of islNodes) if (node.execution_frame && !kept.has(node.id)) delete node.execution_frame;
  }
  return notForwarded;
}

/** ISL's reconciliation tolerance (the stated level within 5% of the product), as CEE's mint reads it. */
const CARRIER_RECONCILIATION_TOLERANCE = 0.05;

/** A level the USER gave (a finite `raw_value` whose `source` is the brief or the user), else `undefined`. */
function userLevel(node: { observed_state?: { raw_value?: unknown; source?: unknown } } | undefined): number | undefined {
  const raw = node?.observed_state?.raw_value;
  const source = node?.observed_state?.source;
  const users = source === 'brief_extraction' || (typeof source === 'string' && source.startsWith('user'));
  return users && typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

const unitOf = (node: { observed_state?: { unit?: unknown } } | undefined): string =>
  typeof node?.observed_state?.unit === 'string' ? node.observed_state.unit : '';

const CURRENCIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/£|\bgbp\b|\bpounds?\b/i, 'GBP'], [/\$|\busd\b|\bdollars?\b/i, 'USD'], [/€|\beur\b|\beuros?\b/i, 'EUR'],
];
const PERIODS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(month|months|monthly|mo|pcm|mrr)\b/i, 'month'], [/\b(year|years|yearly|annual|annually|yr|pa|arr)\b/i, 'year'],
  [/\b(week|weeks|weekly|wk)\b/i, 'week'], [/\b(day|days|daily)\b/i, 'day'], [/\b(quarter|quarters|quarterly|qtr)\b/i, 'quarter'],
];
const currencyOf = (unit: string): string | undefined => CURRENCIES.find(([re]) => re.test(unit))?.[1];
const periodsOf = (unit: string): string[] => PERIODS.filter(([re]) => re.test(unit)).map(([, p]) => p);
const NOT_A_COUNT = /%|percent|proportion|share|fraction|ratio/i;

/**
 * Do a money RATE and a COUNT compose to the goal's money-per-period unit? The card domain's unit half, read
 * conservatively from the typed units PLoT receives: the goal's currency sits on exactly one factor (the rate), the
 * other is a plain count (no currency, no percentage, no period), and the rate's period — when it names one — is the
 * goal's. A rate with no period is the card's "confirm" case (CEE #2296), so it composes. A goal unit that names NO
 * period composes too: CEE also reads the goal's period from its label, which PLoT does not parse, so PLoT fails closed
 * and withholds (AIQ 5892025855 on MG 5892012494: unit "GBP", label "Monthly recurring revenue"). Pure.
 */
function composesToGoal(goalUnit: string, unitA: string, unitB: string): boolean {
  const currency = currencyOf(goalUnit);
  const goalPeriods = periodsOf(goalUnit);
  if (currency === undefined || goalPeriods.length > 1) return false;
  const [rate, count] = currencyOf(unitA) !== undefined ? [unitA, unitB] : [unitB, unitA];
  if (currencyOf(rate) !== currency || currencyOf(count) !== undefined) return false;
  if (NOT_A_COUNT.test(count) || periodsOf(count).length > 0 || count.trim() === '') return false;
  const ratePeriods = periodsOf(rate);
  return goalPeriods.length === 0 || ratePeriods.length === 0 || (ratePeriods.length === 1 && ratePeriods[0] === goalPeriods[0]);
}

/**
 * Variant (d)'s card-domain carriers (AIQ 5891608873; DL 5891633125; PR Review CR 5891899825): a parent of the goal
 * (not an option, not the decision) carrying an inferred PRODUCT of two factors that is a reading of the goal itself —
 * its units compose to the goal's unit, its two levels and the goal's are the USER's, and the product is within 5% of
 * the goal's level. Served `ed49d44` run 4: `pro_plan_mrr` = £49/subscriber/month × 1,500 subscribers = £73,500 beside
 * Olumi's £1,500 residual, goal £75,000/month. Whether the goal has other parents does not decide; the card domain does.
 * PLoT reads typed units and levels only; CEE's predicate stays the authority, and a coincidental match withholds
 * (fail closed). Pure.
 */
export function goalCarrierIds(
  nodes: readonly { id: string; kind?: unknown; nonlinear_identity?: unknown; observed_state?: { raw_value?: unknown; source?: unknown; unit?: unknown } }[],
  edges: readonly { from?: unknown; to?: unknown }[],
): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const carriers = new Set<string>();
  for (const goal of nodes.filter((n) => n.kind === 'goal')) {
    const target = userLevel(goal);
    if (target === undefined || target === 0) continue;
    const parents = [...new Set(edges.filter((e) => e.to === goal.id && typeof e.from === 'string').map((e) => e.from as string))]
      .filter((id) => byId.get(id)?.kind !== 'option' && byId.get(id)?.kind !== 'decision');
    for (const id of parents) {
      const identity = byId.get(id)?.nonlinear_identity as { operation?: unknown; stated_in_brief?: unknown; factor_ids?: unknown } | undefined;
      if (identity?.operation !== 'product' || identity.stated_in_brief !== false || !Array.isArray(identity.factor_ids)) continue;
      if (identity.factor_ids.length !== 2 || !identity.factor_ids.every((f) => typeof f === 'string')) continue;
      const [a, b] = (identity.factor_ids as string[]).map((f) => byId.get(f));
      const levels = [userLevel(a), userLevel(b)];
      if (levels.some((l) => l === undefined)) continue;
      if (!composesToGoal(unitOf(goal), unitOf(a), unitOf(b))) continue;
      const product = (levels[0] as number) * (levels[1] as number);
      if (Math.abs(product - target) <= CARRIER_RECONCILIATION_TOLERANCE * Math.abs(target)) carriers.add(id);
    }
  }
  return carriers;
}

/**
 * Variant (a): a frame PLoT DERIVED for a frameless inferred intermediate product carrier (`_meta.identity_derived_frames`)
 * — Olumi's ruler, the product of its factors' frames; never a figure the user stated.
 */
export interface IdentityDerivedFrame {
  node_id: string;
  frame: number;
  source: 'olumi_derived_product_of_factor_frames';
  factor_frames: { node_id: string; frame: number }[];
}

/** A finite `observed_state.value` or `raw_value` — the node has a level, so its ruler is not ours to choose. */
function hasFiniteLevel(observed: unknown): boolean {
  const o = observed as { value?: unknown; raw_value?: unknown } | null | undefined;
  return (typeof o?.value === 'number' && Number.isFinite(o.value)) || (typeof o?.raw_value === 'number' && Number.isFinite(o.raw_value));
}

/** An inferred identity PLoT did not forward to ISL, and why (`_meta.identities_not_forwarded`). */
export interface IdentityNotForwarded {
  node_id: string;
  /** `inferred_<ISL withheld_reason>` for an identity ISL withheld (any of its reasons, today's four and any new one). */
  reason: 'inferred_identity_frame_unresolved' | `inferred_identity_${string}`;
  /** The identity's own nodes that had no frame — the node, a factor or an addend (empty when ISL withheld it). */
  frameless_node_ids: string[];
  /** `inferred_identity_inconsistent` only: ISL's own reconciliation, verbatim from its critique. */
  reconciliation?: { reconstructed?: number; stated?: number; mismatch_share?: number };
}

/**
 * ISL's typed withheld reason (`IdentityWithheldReason`: `identity_frame_missing`, `_operand_missing`, `_zero_level`,
 * `_inconsistent` at 14f1a3a; `identity_scale_out_of_range` from ISL #199). PLoT matches the SHAPE, not a list
 * (AIQ #72 5869104258): a new ISL reason must never turn an identity the user did not state into a refused Run.
 */
const ISL_WITHHELD_REASON = /^identity_[a-z0-9]+(?:_[a-z0-9]+)*$/;

/**
 * ⛔ Variant (c) (DL #72 5864468829, HIGH), widened by R3-A1 (AIQ RESULT + RULING #72 5867263914, HIGH): an INFERRED
 * identity (`stated_in_brief: false`) that ISL cannot evaluate — for ANY of its reasons — is withdrawn and the Run asked
 * again, once — exactly as variant (b) withdraws a frameless one. ONLY a STATED identity refuses the Run.
 *
 * Served journey C since #383 (3 of 6 final Runs refused, 0 before): Olumi's reading "MRR = Pro price × Pro paying
 * subscribers" held Olumi's OWN estimate of subscribers (1,000); the user then said "our current MRR is £72,000";
 * £49 × 1,000 ≠ £72,000, so ISL withheld the identity (`identity_inconsistent`, share > 5%) and — by its R3 rule, a
 * declared identity the decision depends on that is not evaluated is a blocker — refused the whole Run. The user was
 * refused over a contradiction Olumi's own guess created. R3-A1 (served PLoT aac1970 · ISL 14f1a3a, Paul's a6ed1bff
 * request): the same inferred identity with an operand level MISSING (`identity_operand_missing`) or ZERO
 * (`identity_zero_level`) still refused the whole Run, because only `identity_inconsistent` was withdrawn.
 *
 * ISL stays the ONE judge: PLoT re-derives nothing. It reads ISL's 422 and acts only when EVERY blocker is an
 * `IDENTITY_NOT_EVALUATED` critique whose typed identity carries ANY ISL withheld reason (matched by shape, never a
 * list: AIQ #72 5869104258, ISL #199's `identity_scale_out_of_range`) on a node PLoT forwarded as INFERRED. Then those declarations (and the frames only they needed) are removed, the node stays linear as before
 * #383, and each is said with its reason (`inferred_<ISL reason>`; an inconsistent one with ISL's own figures).
 * Anything else — a STATED identity (the user's own figures: AIQ's rule stands), a critique with no typed reason, or
 * any other blocker — returns `null`: ISL's refusal stands. Mutates `islNodes` only when it returns a non-empty list.
 */
export function withdrawInferredUnevaluatedIdentities(
  islNodes: ISLNodeV3[],
  critiques: ReadonlyArray<{ code?: unknown; severity?: unknown; identity?: unknown }> | undefined,
): IdentityNotForwarded[] | null {
  const blockers = (critiques ?? []).filter((c) => c.severity === 'blocker');
  if (blockers.length === 0) return null;
  const byId = new Map(islNodes.map((node) => [node.id, node]));
  const withdrawn: IdentityNotForwarded[] = [];
  for (const c of blockers) {
    const identity = (c.identity ?? null) as Record<string, unknown> | null;
    const nodeId = identity?.node_id;
    const withheldReason = identity?.withheld_reason;
    const reason: IdentityNotForwarded['reason'] | undefined = typeof withheldReason === 'string' && ISL_WITHHELD_REASON.test(withheldReason)
      ? `inferred_${withheldReason}` as IdentityNotForwarded['reason']
      : undefined;
    if (c.code !== 'IDENTITY_NOT_EVALUATED' || identity === null || reason === undefined || typeof nodeId !== 'string') return null;
    const declared = byId.get(nodeId)?.nonlinear_identity;
    if (!declared || declared.stated_in_brief !== false) return null;
    if (withdrawn.some((w) => w.node_id === nodeId)) continue;
    if (reason !== 'inferred_identity_inconsistent') {
      withdrawn.push({ node_id: nodeId, reason, frameless_node_ids: [] });
      continue;
    }
    const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const reconciliation = {
      ...(finite(identity.reconstructed) !== undefined && { reconstructed: finite(identity.reconstructed) }),
      ...(finite(identity.stated) !== undefined && { stated: finite(identity.stated) }),
      ...(finite(identity.mismatch_share) !== undefined && { mismatch_share: finite(identity.mismatch_share) }),
    };
    withdrawn.push({ node_id: nodeId, reason, frameless_node_ids: [], reconciliation });
  }
  const participantsOf = (node: ISLNodeV3): string[] => {
    const identity = node.nonlinear_identity!;
    return [node.id, ...identity.factor_ids, ...(identity.addends ?? [])];
  };
  for (const w of withdrawn) delete byId.get(w.node_id)!.nonlinear_identity;
  // As variant (b): a frame is carried only on a participant of an identity that IS still forwarded (R3-8).
  const kept = new Set(islNodes.filter((n) => n.nonlinear_identity).flatMap(participantsOf));
  for (const node of islNodes) if (node.execution_frame && !kept.has(node.id)) delete node.execution_frame;
  return withdrawn;
}

/**
 * ⛔ A GOAL CARRIER WITH NO OBSERVED LEVEL STILL HAS A FRAME — its `goal_threshold_cap` (MG, 28 Sep; Canonical #72
 * 5862209460). Served journey A after batch 7: the carrier `mrr = pro_plan_price × pro_paying_subscribers` is the GOAL,
 * with `observed_state: null` and `goal_threshold_cap: 25000` (goal_threshold 0.8 = £20k / £25k). The node-frame reader
 * reads only observed cap / scale_frame / pair, so `mrr` got NO frame, ISL withheld the identity
 * (`identity_frame_missing`, a blocker) and journey A's Run was refused — asking the user for units they had given.
 *
 * The goal's normalised levels ARE value / goal_threshold_cap (the ruler CEE and the UI already rescale the goal by), so
 * user units = normalised × cap: exactly an `execution_frame`. Carried as `cap`, so ISL's carrier enum is unchanged.
 * Only a `kind: 'goal'` node, only a finite positive cap, only when nothing else resolved — every other node, and a
 * goal whose own observed frame resolves, is byte-identical to before.
 */
function goalCapFrame(
  engine: EngineNodeV3 | undefined,
  goalCap: number | undefined,
): { frame: number; carrier: NodeFrameCarrier } | undefined {
  if (engine?.kind !== 'goal') return undefined;
  if (typeof goalCap !== 'number' || !Number.isFinite(goalCap) || goalCap <= 0) return undefined;
  return { frame: goalCap, carrier: 'cap' };
}

/**
 * ISL edge format.
 */
export interface ISLEdgeV3 {
  from: string;
  to: string;
  exists_probability: number;
  strength: {
    mean: number;
    std: number;
  };
}

/**
 * ISL option format - interventions are flattened to Record<string, number>.
 */
export interface ISLOptionV3 {
  id: string;
  label?: string;
  interventions: Record<string, number>;
  /**
   * TEMPORAL step 2 (ISL #216 `InterventionOption.intervention_ranges`): per node the option
   * sets, the stated range in RAW units + its meaning + the node's affine map. Present only when
   * stated; ISL samples it for this option's own limit on that node and echoes
   * `sampled_intervention_ranges`.
   */
  intervention_ranges?: Record<string, ISLInterventionRange>;
}

export interface ISLInterventionRange {
  low: number;
  high: number;
  meaning: string;
  normalisation?: { raw_at_zero: number; raw_at_one: number };
}

/**
 * ISL constraint format.
 * ISL's canonical field is "value" (the legacy "threshold" alias is coerced server-side
 * by _coerce_legacy_threshold). PLoT and ISL now use the same field name.
 */
export interface ISLGoalConstraint {
  constraint_id: string;
  node_id: string;
  operator: '>=' | '<=';
  /** Constraint value — ISL's canonical field (F-20: was legacy "threshold") */
  value: number;
  label?: string;
  weight?: number;
  /**
   * ROADMAP 2.855 — the frame `value` is stated in. Mirrors ISL's
   * `GoalConstraint.value_frame` (`src/models/robustness_v2.py`), which is
   * `Optional[Literal["level","delta"]]` and fail-closed: absent ⇒
   * `CONSTRAINT_FRAME_UNSPECIFIED` and `constraint_analysis` omitted entirely.
   *
   * ⚠ ISL's model is `extra: "ignore"`, so a misspelt key here would die at
   * parse with a clean 200 and no error anywhere — which is why this field's
   * arrival is proven through the ENDPOINT, not by a green build.
   */
  value_frame?: GoalThresholdFrameType;
  /**
   * Release gate (ii) — ISL #181's `GoalConstraint.level_domain`. By presence,
   * like `value_frame`; PLoT mints it (see `GoalConstraint.level_domain`).
   * ISL #181 is not in the pinned model yet: at the pin it is `extra: "ignore"`,
   * so an older ISL drops it silently and returns no fraction (the response is
   * then identical but for the hashes over this request, which now carries it).
   */
  level_domain?: ConstraintLevelDomain;
}

/**
 * One user-stated range for a factor's value — the RAW statement, as said.
 *
 * Mirrors ISL's `UserStatedRange` (isl/src/models/range_fit.py:55-110,
 * ROADMAP 2.720) EXACTLY. Kept pinned to it by
 * `ISL_DECLARED_USER_STATED_RANGE_FIELDS` below plus the `satisfies` /
 * exhaustiveness pair, and by `tests/isl-user-stated-ranges.contract.test.ts`
 * T2c, which derives the expected member set from ISL's pinned OpenAPI rather
 * than from a second hand-copy.
 *
 * ⚠ `lower` / `upper` ARE OPTIONAL ON PURPOSE, and PLoT must not "helpfully"
 * fill one in. ISL declares them Optional so an OPEN-ENDED statement ("at least
 * X", "no more than Y") is EXPRESSIBLE and can be refused LOUDLY as
 * `RANGE_OPEN_ENDED`, rather than silently reshaped into a range the user never
 * stated. A producer that defaulted a missing bound to 0 (or to the observed
 * value) would manufacture an interval and get a clean, wrong, fitted
 * distribution back — a fabricated value wearing real provenance, which is this
 * estate's dominant defect class.
 *
 * ⚠ `domain` IS REQUIRED and is never inferred. ISL selects the fitted family
 * from it (`unit_interval` → beta, `unbounded` → normal) and deliberately does
 * NOT infer from whether the numbers happen to lie in [0,1]. PLoT forwards the
 * producer's declaration; it does not guess one.
 */
export interface ISLUserStatedRange {
  /** The factor node the range was stated for. ISL pattern: `^[a-z0-9_:-]+$`. */
  node_id: string;
  /** The user's stated lower bound, raw. ABSENT = open-ended below. */
  lower?: number;
  /** The user's stated upper bound, raw. ABSENT = open-ended above. */
  upper?: number;
  /** DECLARED domain of the quantity — determines the fitted family. */
  domain: 'unit_interval' | 'unbounded';
  /** Who stated the range (provenance, e.g. 'user'). */
  source?: string;
  /** When it was stated (ISO 8601, producer-stamped). */
  stated_at?: string;
  /** ELICITATION method version stamped by the producer — NOT the fit method. */
  method_version?: string;
}

/**
 * ISL robustness request format.
 */
export interface ISLRobustnessRequestV3 {
  request_id: string;
  graph: {
    nodes: ISLNodeV3[];
    edges: ISLEdgeV3[];
  };
  options: ISLOptionV3[];
  goal_node_id: string;
  n_samples?: number;
  confidence_level?: number;
  analysis_types: Array<'comparison' | 'sensitivity' | 'robustness'>;
  /**
   * Members mirror ISL's `ParameterUncertainty`
   * (isl/src/models/robustness_v2.py:243-291 @ 47f20068) EXACTLY: {node_id,
   * distribution, std, range_min, range_max}. ISL has never declared a `mean`
   * here — for a NORMAL entry the sampling centre is read from the node's
   * `observed_state.value`, not from this list — so a `mean` sent here was
   * dropped by ISL's `extra: "ignore"` and could never move a result. Removed
   * in contract step-2 slice 6; do not re-add a member ISL does not declare.
   *
   * The union is the point, and it is what closes the prior-only defect. ISL
   * supports THREE families and only one of them takes its centre from the
   * graph node:
   *   - `normal`   → `rng.normal(observed_state.value ?? 0.0, std)`
   *                  (robustness_analyzer_v2.py:1080-1086, 1175-1178)
   *   - `uniform`  → `rng.uniform(range_min, range_max)` — the centre lives
   *                  ENTIRELY on the wire; `observed_state` is not read at all
   *                  (robustness_analyzer_v2.py:1180-1188), and the correlated
   *                  copula path treats it the same way (1140-1149).
   *   - `point_mass` → the observed value verbatim (`_sample_from_distribution`
   *                  returns the mean; no sampling). Useless to a node that has
   *                  no observed value, so PLoT emits it ONLY for a PINNED lever
   *                  (T7b, `pinnedLeverIds`): a controllable lever an option
   *                  sets exactly to its own today level, which must be held
   *                  EXACT. ISL rejects it for a factor named in
   *                  `factor_correlations` (robustness_v2.py
   *                  validate_factor_correlations), so such a lever is never
   *                  sent as point_mass.
   * A factor whose only quantitative statement is a `prior` therefore MUST go
   * out as `uniform`: sent as a `normal` it parses cleanly, and ISL then
   * silently centres a declared Uniform[0.6,1.0] on 0.0.
   */
  parameter_uncertainties?: Array<
    | {
        node_id: string;
        distribution: 'normal';
        std: number;
        /** ISL `ParameterUncertainty.spread_source`: whose spread `std` is. Sent only for a real `observed_state.std`
         *  whose `std_source` says so (see `spreadSourceOf`); absent = not stated, and ISL never infers it. */
        spread_source?: 'user' | 'template';
      }
    | {
        node_id: string;
        distribution: 'uniform';
        range_min: number;
        range_max: number;
      }
    | {
        node_id: string;
        distribution: 'point_mass';
      }
  >;
  /**
   * User-defined success threshold for goal.
   * When provided, ISL returns probability_of_goal per option
   * — but ONLY if `goal_threshold_frame` below is also present.
   */
  goal_threshold?: number;

  /**
   * ROADMAP 2.258. Declares which FRAME `goal_threshold` is expressed in.
   * Mirrors ISL's `RobustnessRequestV2.goal_threshold_frame`
   * (models/robustness_v2.py:882 @`29cb4e27`) and `@talchain/schemas` 0.31.0
   * `NodeV3.goal_threshold_frame` (`dist/graph.js:194`).
   *
   *   'delta' — already in the goal SAMPLES' own frame (change from the model's
   *             origin). Used as-is; byte-identical to the pre-2.258 comparison.
   *   'level' — an absolute level of the goal quantity, sharing the domain of
   *             the graph's `observed_state` values. ISL converts it into the
   *             sample frame via `threshold - goal_baseline + goal_intercept`.
   *
   * ⚠ PLoT NEVER MINTS THIS VALUE. It is forwarded if and only if the producer
   * (CEE) stamped it on the goal node. The whole point of 2.258 is that an
   * unattested frame is a category error: CEE mints `goal_threshold` as a
   * normalised LEVEL, while a non-root goal's samples are a CHANGE from origin,
   * so comparing them yielded a STRUCTURAL ZERO the product rendered as
   * "< 1% chance of hitting your goal". Guessing a frame here would reinstate
   * exactly that defect with PLoT's name on it.
   *
   * ⚠ ABSENT IS A MEANINGFUL STATE, NOT A FAILURE TO POPULATE. ISL fail-closes:
   * with no frame it OMITS `probability_of_goal` and returns a
   * `GOAL_THRESHOLD_FRAME_UNSPECIFIED` inference warning at severity 'warning'
   * (chosen deliberately because PLoT hides 'info'), naming what was missing.
   * The request itself still succeeds — this is a disclosed gap, not a rejection.
   * See `robustness_analyzer_v2.py:3108-3147`.
   *
   * STRUCTURAL COUPLING: this key is emitted ONLY inside the `goal_threshold`
   * branch below, so a frame can never travel without the number it describes.
   * That is enforced by position, not by a comment.
   */
  goal_threshold_frame?: GoalThresholdFrameType;

  /**
   * Multiple success constraints for joint evaluation.
   * When provided, ISL evaluates joint satisfaction across all constraints.
   * Uses ISL's canonical "value" field (same as PLoT's GoalConstraint.value).
   *
   * ⚠ This used to say "Takes precedence over goal_threshold if both are
   * provided". FALSE, corrected under ROADMAP 2.239 by reading ISL at
   * `35149dd1`: `probability_of_goal` (robustness_analyzer_v2.py:3073-3077)
   * and `constraint_analysis` (:3079-3083) are computed in the same option
   * loop from independent gates, neither suppressing the other, and
   * `RobustnessRequestV2` declares no mutual-exclusion validator
   * (models/robustness_v2.py:856, :895). ISL is built for the pair —
   * `_align_goal_constraint_samples` (:3005-3035) exists so a goal-node
   * constraint and `probability_of_goal` answer from IDENTICAL samples.
   *
   * The false comment mattered: it made "send both" look pointless, and
   * sending both is exactly what makes the goal probability computable when
   * the only constraint is the auto-synthesised goal target.
   */
  goal_constraints?: ISLGoalConstraint[];

  /**
   * ROADMAP 2.920 — the user's attested objective sense for the goal node.
   * Omitted when unknown: ISL then runs the maximiser UNATTESTED and says so
   * (`GOAL_DIRECTION_UNATTESTED`). PLoT never infers it from a node label.
   */
  goal_direction?: GoalDirectionType;

  /**
   * R1 S4 (B) (R3 #72 5879133964; ISL #209): the goal must be strictly PAST `goal_threshold` ("above £85k";
   * "below" when minimising), so a draw exactly on the threshold is NOT met. Sent only as `true` and only beside a
   * `goal_threshold` (ISL refuses `true` without one with a 422 that fails the whole analysis); absent = "at least".
   */
  goal_threshold_strict?: boolean;

  // CIL 0.1: forward seed to ISL for deterministic Monte Carlo runs
  seed?: string | number;

  /** Request edge E-value analysis from ISL (evidence strength per edge). */
  include_e_values?: boolean;
  /** Request Value of Information (EVPI) analysis from ISL. */
  include_voi?: boolean;
  /**
   * Request per-root-factor flip thresholds from ISL (V2 envelope
   * `factor_flip_values`, ISL PR #117 / ROADMAP 2.228-F3).
   *
   * ISL defaults this to `false` and emits nothing when it is absent, so the
   * capability was live-but-unreachable until PLoT began asking. Sent
   * UNCONDITIONALLY (`true`) beside `include_e_values` / `include_voi` — NOT a
   * request-gated opt-in like `include_path_decomposition`, because flip
   * thresholds are not an optional extra here: they are the ONLY source of
   * `enrichment.flip_thresholds[].flip_value` now that PLoT's own bisection
   * probe is retired on this path. Per the no-new-flag-gates rule this is a
   * constant, not an env var or a request key.
   */
  include_factor_flips?: boolean;
  /**
   * Request structural pathway decomposition from ISL (V2 envelope
   * `path_decomposition`, ISL build 9a22a1a+). REQUEST-GATED OPT-IN: only
   * forwarded when the inbound /v2/run request set it — never defaulted on,
   * so the ISL payload does not grow for callers that did not ask.
   */
  include_path_decomposition?: boolean;

  /**
   * Client-supplied pairwise factor correlations (capability #100, doctrine
   * D-23.4). Forwarded VERBATIM from the /v2/run request when present and
   * non-empty; OMITTED otherwise (request-gated — no default payload growth,
   * ISL's `extra:"ignore"` never sees an empty array). Deep semantics
   * (unknown-factor / |rho|>1 / self-pair / duplicate) are validated ISL-side.
   */
  factor_correlations?: FactorCorrelation[];

  /**
   * ⭐ ROADMAP 2.720 — the user's OWN stated ranges for factor values (pillar P4,
   * human–AI collaboration). Forwarded from the /v2/run request when present and
   * non-empty; OMITTED otherwise (request-gated — no default payload growth, and
   * ISL's `extra:"ignore"` never sees an empty array).
   *
   * WHAT ISL DOES WITH IT, STATED PRECISELY. ISL treats each range as a ≈50%
   * CREDIBLE INTERVAL and runs an interquartile fit
   * (`services/range_fit.py::resolve_range_fits`, method `range-iq-fit-v1`),
   * returning either a fitted distribution or one of seven TYPED refusals on
   * `range_fit_disclosures` + `inference_warnings`. **This is S3:
   * FIT-AND-DISCLOSE ONLY. Compute is BYTE-IDENTICAL whether or not this field
   * is present** — ISL's own comment records that the resolver is pure, RNG-free
   * and placed AFTER all sampling so byte-identity is structural, not merely
   * tested. Application (S4) waits on 2.521 Q2 + the combination ruling. PLoT
   * MUST NOT be changed to make the range WEIGH in the maths on the strength of
   * this field arriving.
   *
   * ⚠ WHY THIS IS NOT THE `prior: {distribution:'uniform', range_min, range_max}`
   * PATH, and must never be routed into it. That path carries SYSTEM-derived
   * declared-uniform SUPPORTS (CEE's drafter mints them from brief wording), and
   * `buildParameterUncertaintiesV3` forwards them to ISL AS a uniform, bounds
   * intact — the support is taken at its word, not fitted. A HUMAN-STATED range
   * is a ~50% credible interval, whose σ is 0.7413·width — 2.57× LARGER than the
   * same range read as a uniform support. Routing a human statement down the
   * prior path would silently understate the user's uncertainty. The two coexist
   * by design and are fitted in different places.
   *
   * ⚠ AND IT WAS DARK UNTIL NOW. ISL declared, implemented, tested and DEPLOYED
   * this converter, and PLoT's own pin note recorded *"user_stated_ranges (2.720,
   * PLoT does not send it)"*. A capability with no producer is not a capability.
   * The reverse hazard applies to the addition itself: ISL's request models are
   * `extra="ignore"` and `extra="forbid"` appears nowhere in the service, so a
   * misspelled key here would die with a clean 200 and no error anywhere — which
   * is why this field's arrival is proved by a LIVE capture against deployed ISL
   * carrying a misspelled-key control, not by a green typecheck
   * (`tests/fixtures/isl-range-fit-live-20260807/`).
   */
  user_stated_ranges?: ISLUserStatedRange[];
}

// -----------------------------------------------------------------------------
// Translation Functions
// -----------------------------------------------------------------------------

/**
 * The COMPLETE member list of ISL's `ObservedState`
 * (isl/src/models/robustness_v2.py:160-200 @ 7d144c7f):
 * value, baseline, unit, source, std, raw_value, cap, extractionType,
 * factor_type, uncertainty_drivers.
 *
 * PLoT produces all ten. ⚠ THIS PARAGRAPH USED TO SAY THE OPPOSITE — "PLoT
 * produces eight of the ten; `source` and `extractionType` are CEE-origin fields
 * PLoT's normaliser does not carry, so they are absent here by construction
 * rather than by exclusion" — and it was FALSE from #313 (`9b47976`, 5 Aug 2026,
 * ROADMAP 2.520 S1) onwards, which taught `normaliseNode` to copy both. It was
 * arguably never right: both members sat in the list five lines below it the
 * whole time, so the comment contradicted the code it introduced. Left in place
 * as trap 14's exhibit — an accurate note is not self-maintaining, and the most
 * convincing stale sentence is one attached to correct machinery.
 *
 * ⚠ ROADMAP 2.274 — THIS WAS A HAND-MAINTAINED MIRROR OF ANOTHER REPO'S MODEL
 * WITH NO LOUD FAILURE (trap 12), and the comment that used to sit here said so
 * and left it at that: "until [the drift pairing] lands, this comment IS the
 * disclosure". A comment is not an alarm. Its drift is asymmetric and BOTH
 * directions are silent: if ISL ADDS a field PLoT quietly stops forwarding
 * something ISL would accept; if ISL REMOVES one PLoT resumes sending an
 * undeclared key.
 *
 * It is now pinned MECHANICALLY on both edges, so neither can move unnoticed:
 *
 *  - **list ↔ ISL's model**, at TEST time: `tests/isl-observed-state-mirror
 *    .test.ts` DERIVES the expected members from `ObservedState` in the pinned,
 *    sha256-verified ISL OpenAPI document (`tests/fixtures/isl-pinned/`), which
 *    is Pydantic's own machine-generated description of the mounted models — not
 *    a second hand-copy. Re-pin ISL and this list must follow, or CI REDs.
 *  - **list ↔ PLoT's own type**, at COMPILE time: the `satisfies` clause below
 *    plus the exhaustiveness pin under it. Together they forbid a member on one
 *    side and not the other, in either direction. This is enforced by
 *    `npm run build`, which is a required PR check.
 *
 * ⚠ `baseline` IS LOAD-BEARING ON THIS LIST. It is what ISL needs to convert a
 * `'level'` goal threshold (`threshold − goal_baseline + goal_intercept`), so a
 * silent strip here does not degrade a number — it kills the goal-probability
 * capability outright, with ISL refusing every `'level'` threshold as
 * `missing_goal_baseline`. Guarded by a named assertion in the test above and by
 * `tests/goal-threshold-frame.test.ts` T10.
 */
type DeclaredObservedStateKey = keyof NonNullable<ISLNodeV3['observed_state']>;

export const ISL_DECLARED_OBSERVED_STATE_FIELDS = [
  'value',
  'baseline',
  'unit',
  'source',
  'std',
  'raw_value',
  'cap',
  'extractionType',
  'factor_type',
  'uncertainty_drivers',
] as const satisfies readonly DeclaredObservedStateKey[];

/**
 * COMPILE-TIME EXHAUSTIVENESS PIN — the direction `satisfies` cannot see.
 *
 * `satisfies` proves every listed field EXISTS on the type. This proves the
 * converse: that the type declares nothing the list omits. Without it, adding a
 * member to `ISLNodeV3['observed_state']` and forgetting the list would compile
 * happily and the field would be silently dropped on the wire for every request
 * — the exact failure this pin exists to prevent, in the quieter direction.
 * Resolves to `never` (and so fails to compile) the moment the two diverge.
 */
type _ObservedStateFieldsAreExhaustive = Exclude<
  DeclaredObservedStateKey,
  (typeof ISL_DECLARED_OBSERVED_STATE_FIELDS)[number]
> extends never
  ? true
  : never;
const _observedStateFieldsAreExhaustive: _ObservedStateFieldsAreExhaustive = true;
void _observedStateFieldsAreExhaustive;

/**
 * ⭐ ROADMAP 2.520 S1 — COMPILE-TIME UNION PIN: PLoT's CANONICAL graph must be
 * able to CARRY everything this projector promises to FORWARD.
 *
 * The two pins above make the egress list agree with the egress TYPE, and the
 * mirror test makes it agree with ISL. All three can be perfectly consistent
 * while the field never arrives — because `toISLObservedState` can only forward
 * what the normalised graph actually holds, and that is `EngineNodeV3`, one hop
 * upstream and previously unpinned to any of this.
 *
 * That gap is not hypothetical: it is the 2.520 defect. `source` and
 * `extractionType` sat on this list, and on ISL's model, and were echoed back by
 * ISL — while `EngineNodeV3['observed_state']` could not represent them, so
 * PLoT's ingress dropped every one and the projector forwarded a field that was
 * never there. Every guard on this path was green throughout.
 *
 * This is the union assertion the estate's trap-12 doctrine prescribes for
 * exactly this shape: the canonical type must be a SUPERSET of every sibling
 * lookup. It resolves to `never` — and so fails `npm run build`, a required
 * check — the moment a field is added to the ISL list without the canonical
 * graph being able to hold it.
 *
 * ⚠ Deliberately ONE-directional. The canonical type may legitimately carry
 * more than ISL declares (e.g. the PLoT-internal `metadata` the projection
 * strips on purpose), so the converse must NOT be asserted here.
 */
type _CanonicalGraphCanCarryEveryDeclaredField = Exclude<
  (typeof ISL_DECLARED_OBSERVED_STATE_FIELDS)[number],
  keyof NonNullable<EngineNodeV3['observed_state']>
> extends never
  ? true
  : never;
const _canonicalGraphCanCarryEveryDeclaredField: _CanonicalGraphCanCarryEveryDeclaredField = true;
void _canonicalGraphCanCarryEveryDeclaredField;

/**
 * ISL's DECLARED string-length bounds on `ObservedState`
 * (isl/src/models/robustness_v2.py:180-187 @ 3c4ab84d, staging; identical in
 * the pinned OpenAPI @ 686fcb7f):
 *
 *   unit:   Optional[str] = Field(None, max_length=50,  description="Display unit …")
 *   source: Optional[str] = Field(None, max_length=100, description="Data provenance …")
 *
 * No other `ObservedState` member is bounded. `tests/isl-observed-state-string-
 * bounds.test.ts` derives this map from the pinned OpenAPI's `maxLength`s and
 * REDs if the two disagree in either direction.
 *
 * ⚠ 25 Sep 2026 — a factor unit longer than 50 characters made ISL answer 422
 * (`graph -> nodes -> 4 -> observed_state -> unit: String should have at most
 * 50 characters`) and PLoT failed the WHOLE Run: 8 staging Runs, 00:40–05:42Z,
 * produced no analysis. One over-long display string cost the user every number.
 *
 * An over-bound value is OMITTED from the ISL request, NEVER clipped. ISL only
 * echoes these fields back (e.g. `split_unit` on a conditional-winner row); it
 * never computes with them. A clipped unit would be echoed to the user as if it
 * were the real one — an untruthful label on a real number. PLoT keeps the FULL
 * value on its own graph (normaliser, preflight's % detection, flip displays
 * all read that, not the ISL request).
 */
export const ISL_OBSERVED_STATE_UNIT_MAX_LENGTH = 50;
export const ISL_OBSERVED_STATE_SOURCE_MAX_LENGTH = 100;

export const ISL_OBSERVED_STATE_STRING_MAX_LENGTHS: Readonly<
  Partial<Record<(typeof ISL_DECLARED_OBSERVED_STATE_FIELDS)[number], number>>
> = {
  unit: ISL_OBSERVED_STATE_UNIT_MAX_LENGTH,
  source: ISL_OBSERVED_STATE_SOURCE_MAX_LENGTH,
};

/**
 * True when `value` is a string longer than ISL's declared bound for `field`.
 *
 * Length is counted in Unicode CODE POINTS, as Pydantic counts (Python `len()`),
 * not in UTF-16 code units (JS `.length`): a unit ending in an emoji can be 50
 * code points and 51 UTF-16 units, and ISL accepts it.
 */
function exceedsIslDeclaredStringBound(
  field: (typeof ISL_DECLARED_OBSERVED_STATE_FIELDS)[number],
  value: unknown,
): boolean {
  const max = ISL_OBSERVED_STATE_STRING_MAX_LENGTHS[field];
  return max !== undefined && typeof value === 'string' && [...value].length > max;
}

/**
 * Project a PLoT-internal `observed_state` onto the fields ISL declares.
 *
 * Slice 6: the previous code forwarded `node.observed_state` VERBATIM, so any
 * key present at runtime transited to ISL regardless of the declared type.
 * One always did: PLoT's own normaliser attaches `metadata` to constraint
 * nodes (`graph-normaliser.ts:274-276`) so `constraint-compiler.ts` can read
 * `.operator` — a PLoT-internal key ISL's `ObservedState` does not declare and
 * silently dropped under `extra: "ignore"`. The compiler reads it off the
 * normalised PLoT graph, never off the ISL request, so projecting here costs
 * nothing internally.
 *
 * The projection is by PRESENCE, not by declared type: an absent field stays
 * absent on the wire rather than becoming an explicit `undefined`, so the
 * serialized bytes are unchanged for every field PLoT already sent.
 *
 * ONE exception: a string longer than ISL's declared bound
 * (`ISL_OBSERVED_STATE_STRING_MAX_LENGTHS`) is OMITTED, never clipped — sending
 * it would make ISL 422 the whole request. Every in-bound value is forwarded
 * byte-for-byte as before.
 *
 * Shared with the `/v1/run` producer (`integrations/isl/index.ts`) so the two
 * ISL request builders cannot drift apart into two different allowlists.
 */
export function toISLObservedState(observedState: unknown): ISLNodeV3['observed_state'] {
  if (observedState === undefined || observedState === null || typeof observedState !== 'object') {
    return undefined;
  }
  const os = observedState as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const field of ISL_DECLARED_OBSERVED_STATE_FIELDS) {
    const value = os[field];
    if (value === undefined) continue;
    if (exceedsIslDeclaredStringBound(field, value)) continue;
    projected[field] = value;
  }
  return projected as ISLNodeV3['observed_state'];
}

/**
 * The COMPLETE member list of ISL's `UserStatedRange`
 * (isl/src/models/range_fit.py:55-110 @ 686fcb7f).
 *
 * Pinned MECHANICALLY on both edges, exactly as
 * `ISL_DECLARED_OBSERVED_STATE_FIELDS` is — because this list is otherwise the
 * same hand-maintained mirror of another repo's model (trap 12), and its drift
 * is silent in BOTH directions under ISL's `extra:"ignore"`:
 *
 *  - **list ↔ ISL's model**, at TEST time:
 *    `tests/isl-user-stated-ranges.contract.test.ts` T2c derives the expected
 *    member set from `UserStatedRange` in the pinned, sha256-verified ISL
 *    OpenAPI (Pydantic's own machine-generated description of the mounted
 *    models), and T2d asserts each member resolves as DECLARED under
 *    `RobustnessRequestV2`. Re-pin ISL and this list must follow, or CI REDs.
 *  - **list ↔ PLoT's own type**, at COMPILE time: the `satisfies` clause plus
 *    the exhaustiveness pin below, enforced by `npm run build` (a required
 *    check).
 *
 * ⚠ The list is used as a PROJECTION, so a caller-supplied key ISL does not
 * declare cannot transit. That matters more here than on most fields: this one
 * is populated from a CLIENT-SUPPLIED /v2/run array, and an undeclared key would
 * be dropped at ISL's parse with a clean 200 and no warning anywhere.
 */
type DeclaredUserStatedRangeKey = keyof ISLUserStatedRange;

export const ISL_DECLARED_USER_STATED_RANGE_FIELDS = [
  'node_id',
  'lower',
  'upper',
  'domain',
  'source',
  'stated_at',
  'method_version',
] as const satisfies readonly DeclaredUserStatedRangeKey[];

/**
 * COMPILE-TIME EXHAUSTIVENESS PIN — the direction `satisfies` cannot see.
 * Resolves to `never` (and so fails to compile) the moment `ISLUserStatedRange`
 * declares a member this list omits, which would otherwise silently strip that
 * member from every request.
 */
type _UserStatedRangeFieldsAreExhaustive = Exclude<
  DeclaredUserStatedRangeKey,
  (typeof ISL_DECLARED_USER_STATED_RANGE_FIELDS)[number]
> extends never
  ? true
  : never;
const _userStatedRangeFieldsAreExhaustive: _UserStatedRangeFieldsAreExhaustive = true;
void _userStatedRangeFieldsAreExhaustive;

/**
 * Project one caller-supplied stated range onto the fields ISL declares.
 *
 * By PRESENCE, not by declared type — an absent bound stays ABSENT on the wire
 * rather than becoming an explicit `undefined`/`null`, because absence is
 * MEANINGFUL here: it is what makes ISL refuse `RANGE_OPEN_ENDED` instead of
 * fitting an interval the user never stated.
 */
export function toISLUserStatedRange(range: unknown): ISLUserStatedRange | undefined {
  if (range === undefined || range === null || typeof range !== 'object') return undefined;
  const src = range as Record<string, unknown>;
  const projected: Record<string, unknown> = {};
  for (const field of ISL_DECLARED_USER_STATED_RANGE_FIELDS) {
    if (src[field] !== undefined) projected[field] = src[field];
  }
  return projected as unknown as ISLUserStatedRange;
}

/**
 * Translate internal node to ISL format.
 *
 * NOTE: `category` field is intentionally excluded from ISL translation.
 * It is PLoT-internal metadata used for M1 coaching classification and
 * prior validation (external factors only). ISL does not consume it —
 * its node schema has no category field. See Platform Contract §3.3.1.
 */
export function toISLNode(node: EngineNodeV3): ISLNodeV3 {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    observed_state: toISLObservedState(node.observed_state),
    intercept: node.intercept ?? 0.0,
    epsilon_std: node.epsilon_std ?? 0.0,
    ...(node.nonlinear_identity
      ? {
          nonlinear_identity: {
            operation: node.nonlinear_identity.operation,
            factor_ids: [...node.nonlinear_identity.factor_ids],
            stated_in_brief: node.nonlinear_identity.stated_in_brief,
            ...(node.nonlinear_identity.addends
              ? { addends: [...node.nonlinear_identity.addends] }
              : {}),
          },
        }
      : {}),
    ...(node.quantity_frame !== undefined ? { quantity_frame: node.quantity_frame } : {}),
  };
}

/**
 * Translate internal edge to ISL format.
 *
 * Preserves structural uncertainty via exists_probability field.
 * The edge.exists_probability has already been normalized from legacy
 * fields (belief, belief_exists) by the graph normalizer.
 */
export function toISLEdge(edge: EngineEdgeV3): ISLEdgeV3 {
  return {
    from: edge.from,
    to: edge.to,
    // Use actual exists_probability (defaults to 0.8 if not set during normalization)
    exists_probability: edge.exists_probability,
    strength: {
      mean: edge.strength.mean,
      std: edge.strength.std,
    },
  };
}

/**
 * Flatten interventions from InterventionValueV3 to simple number values.
 *
 * ISL wire format uses Record<string, number> for interventions.
 * The source metadata is stripped for the wire format.
 *
 * @param interventions Internal intervention format
 * @returns Flattened interventions for ISL
 * @throws Error if any intervention value is invalid
 */
export function toISLInterventions(
  interventions: Record<string, InterventionValueV3>
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const [nodeId, intervention] of Object.entries(interventions)) {
    if (typeof intervention.value !== 'number' || !Number.isFinite(intervention.value)) {
      throw new Error(`Invalid intervention value for node '${nodeId}'`);
    }
    result[nodeId] = intervention.value;
  }

  return result;
}

/**
 * Translate internal option to ISL format.
 */
export function toISLOption(option: OptionV3): ISLOptionV3 {
  const islOption: ISLOptionV3 = {
    id: option.id,
    label: option.label,
    interventions: toISLInterventions(option.interventions),
  };
  if (option.intervention_ranges !== undefined && Object.keys(option.intervention_ranges).length > 0) {
    islOption.intervention_ranges = Object.fromEntries(
      Object.keys(option.intervention_ranges).sort().map((nodeId) => {
        const r = option.intervention_ranges![nodeId];
        const forwarded: ISLInterventionRange = { low: r.low, high: r.high, meaning: r.meaning };
        if (r.normalisation !== undefined) forwarded.normalisation = { ...r.normalisation };
        return [nodeId, forwarded];
      }),
    );
  }
  return islOption;
}

/**
 * The largest |level| each factor is set to by any option (T7b). Levels are
 * read in whatever units the options carry — callers pass the options as ISL
 * receives them, so this is in the factor's normalised units. A non-finite
 * level contributes nothing (it cannot reach the wire: toISLInterventions throws).
 */
function maxAbsOptionLevelByFactor(options: readonly OptionV3[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const option of options) {
    for (const [factorId, intervention] of Object.entries(option.interventions ?? {})) {
      const level = intervention?.value;
      if (typeof level !== 'number' || !Number.isFinite(level)) continue;
      out.set(factorId, Math.max(out.get(factorId) ?? 0, Math.abs(level)));
    }
  }
  return out;
}

/**
 * `observed_state.source` stamps that make a today level THE USER'S OWN (T7b
 * amended rule, AI Quality #72 5867934055). Mirrors CEE's `classifyValueSource`
 * (olumi-assistants-service src/cee/graph-readiness/obligation-provenance.ts,
 * OBSERVED_STATE_SOURCE): every stamp it classifies `user_stated` or
 * `user_ratified`. Exact, case-sensitive membership — as CEE's is. `cee_inference`,
 * `inferred`, `cee_repair` and an absent stamp are NOT the user's own.
 *
 * ⚠ The stamp is an unvalidated string (see `EngineNodeV3.observed_state.source`,
 * ROADMAP 2.525). Here it can only NARROW a spread to exact, and only for a level
 * an option in the same Run restates exactly, so a forged stamp can hold a lever
 * at a number the options already assert — never move the number itself.
 */
export const USER_OWN_TODAY_SOURCES: ReadonlySet<string> = new Set([
  'brief_extraction',
  'explicit',
  'user',
  'user_override',
  'user_edited',
  'user_calibration',
  'panel_elicited',
  'user_confirmed',
  'user_assumption',
]);

/** Relative tolerance for "an option sets the lever EXACTLY to today" (T7b). */
export const PIN_RELATIVE_TOLERANCE = 1e-9;

/**
 * The PINNED levers of a Run (T7b amended rule, AI Quality olumi-programme-docs
 * #72 5867604513 + 5867934055).
 *
 * A factor is PINNED when ALL of:
 *   - it is a controllable lever (`category === 'controllable'`, the top-level
 *     field `normaliseNode` validates and lower-cases);
 *   - it has a finite today level (`observed_state.value`);
 *   - some option sets it EXACTLY to that level:
 *     |level − today| ≤ PIN_RELATIVE_TOLERANCE × max(1, |today|), both read in
 *     the normalised units they share on the ISL wire (pass the options AS SENT);
 *   - that today level is the user's own (`USER_OWN_TODAY_SOURCES`) OR exactly 0.
 *
 * WHY: ISL's sum identity computes a plan's tally as today + (plan − this draw's
 * status-quo operands), so ANY spread on today's level of a lever leaks into an
 * exact plan total — at MIN_USER_STD on a £100k frame the journey-C features
 * tally had sd £9.93 and P(spend ≤ £20,000) ≈ 0.509 where it is 1. A pinned
 * lever's today level is therefore held EXACT (point_mass).
 *
 * NOT pinned: an Olumi NON-zero estimate an option merely echoes (e.g.
 * `cee_inference` £10,000 with "keep marketing as is" at £10,000) — that number
 * is ours, not the user's, and keeps its spread.
 */
export function pinnedLeverIds(
  nodes: readonly EngineNodeV3[],
  options: readonly OptionV3[],
): Set<string> {
  const todayById = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind !== 'factor' || node.category !== 'controllable') continue;
    const today = node.observed_state?.value;
    if (typeof today !== 'number' || !Number.isFinite(today)) continue;
    const source = node.observed_state?.source;
    const userOwn = typeof source === 'string' && USER_OWN_TODAY_SOURCES.has(source);
    if (!userOwn && today !== 0) continue;
    todayById.set(node.id, today);
  }
  const pinned = new Set<string>();
  if (todayById.size === 0) return pinned;
  for (const option of options) {
    for (const [factorId, intervention] of Object.entries(option.interventions ?? {})) {
      const today = todayById.get(factorId);
      if (today === undefined) continue;
      const level = intervention?.value;
      if (typeof level !== 'number' || !Number.isFinite(level)) continue;
      if (Math.abs(level - today) <= PIN_RELATIVE_TOLERANCE * Math.max(1, Math.abs(today))) {
        pinned.add(factorId);
      }
    }
  }
  return pinned;
}

/**
 * Every factor id named on either side of a `factor_correlations` pair — the
 * set a pinned lever must NOT be sent as point_mass for (ISL rejects it there).
 * Tolerates the unvalidated request shape: non-string ids are skipped.
 */
export function correlatedFactorIdsOf(
  factorCorrelations: readonly FactorCorrelation[] | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(factorCorrelations)) return ids;
  for (const pair of factorCorrelations) {
    if (typeof pair?.factor_a === 'string') ids.add(pair.factor_a);
    if (typeof pair?.factor_b === 'string') ids.add(pair.factor_b);
  }
  return ids;
}

/**
 * Build parameter uncertainties from factor nodes with observed_state.
 *
 * For each factor node with an observed value, create a parameter uncertainty
 * specification for ISL. This enables ISL to compute factor_sensitivity scores.
 *
 * Standard deviation calculation priority:
 * 1. Finite positive `observed_state.std` → clamped to [MIN_USER_STD, MAX_USER_STD].
 *    The user value is honoured down to MIN_USER_STD; the default floor below
 *    does NOT apply.
 * 2. Binary factors (0/1 range or labelled yes/no) → BINARY_DEFAULT_STD.
 * 3. Non-zero continuous factors → |value| × VALUE_BASED_STD_FRACTION.
 * 4. Zero-valued continuous factors:
 *    a. some option sets the factor to a NON-zero level → VALUE_BASED_STD_FRACTION
 *       × the largest |level| any of `options` sets for it (never below
 *       MIN_USER_STD, NOT floored by DEFAULT_STD_FLOOR);
 *    b. otherwise (no option intervenes on it, or — for a factor that cannot be
 *       pinned — options set it only to 0) → HELD at 0: point_mass (a normal at
 *       MIN_USER_STD if `factor_correlations` names it), and NAMED to the user
 *       (`zeroFactorsHeldExact` → ZERO_FACTOR_HELD_EXACT). AIQ #72 5869679096.
 *
 * ⭐ PINNED LEVERS COME FIRST, ahead of priority 1 (T7b amended rule, AIQ #72
 * 5867934055; see `pinnedLeverIds`): a controllable lever that an option sets
 * EXACTLY to its own today level, where that level is the user's own or exactly
 * 0, goes out as `{distribution: 'point_mass'}` — ISL holds it at
 * `observed_state.value` with no sampling and no floor. A CEE-sent std does NOT
 * override this (AIQ Control 1: a user-stated today echoed by an option → sd 0).
 * The ONE exception is a pinned lever named in `factor_correlations`: ISL rejects
 * point_mass there, so it is sent as a normal at MIN_USER_STD (the tightest
 * normal ISL admits) rather than failing the whole Run with a 422.
 *
 * The DEFAULT_STD_FLOOR is applied ONLY to priorities 2–3 and 4b (synthesised
 * defaults), never to user-supplied values. This is the fix for the
 * silent-widening bug where `observed_state.std = 0.001` was being floored to 0.1.
 *
 * ⛔ PRIORITY 4 NEVER TAKES ITS SPREAD FROM THE FRAME (T7b, AI Quality re-rule
 * olumi-programme-docs #72 5867008723, R3-2 root 1). A std here is in the
 * factor's NORMALISED units — a fraction of its frame (cap / scale_frame). The
 * old FALLBACK_STD = 0.5 was therefore "half the frame": AIQ's served journey C
 * sampled a £0 lever at ±£50,000 on a £100k cap and would have sampled it at
 * ±£100,000 had CEE framed it at £200k — the same decision, a different answer.
 * The option levels ARE in those same normalised units, so 0.15 × max|level| is
 * 0.15 × (the largest raw level) / frame: its RAW spread (±£3,000 on journey C)
 * does not move with the frame. DEFAULT_STD_FLOOR (0.1 = a tenth of the frame)
 * is deliberately NOT applied to it, for the same reason.
 * ⛔ NO SILENT HOLD, AND NO FRAME-SIZED SPREAD (Verifier FIX_FIRST, then AIQ #72
 * 5869679096, measured): a zero factor NO option touches has no option scale.
 * FALLBACK_STD (0.5 of the frame) made the answer depend on the frame (served
 * journey E: doubling a frame moved the goal sd +30%); a bare hold hid it. It
 * is held at 0 AND said: one ZERO_FACTOR_HELD_EXACT warning per factor.
 *
 * Non-finite, zero, and negative `observed_state.std` are treated as missing
 * and fall through to default synthesis.
 *
 * SECOND PASS — factors whose only quantitative statement is a `prior`.
 * These have no `observed_state`, so they emit `{distribution:'uniform',
 * range_min, range_max}`: the one ISL family whose centre travels on the wire
 * rather than being read from the graph node. A degenerate range (min == max)
 * is DECLINED rather than approximated, so ISL discloses the defaulted root
 * instead of sampling a centre nobody stated. See the long note at the push
 * site — this is the prior-only sampling-centre P0, and reverting it to a
 * normal reinstates a silently-wrong analysis.
 *
 * ⚠ THIS PASS IS DELIBERATELY CATEGORY-AGNOSTIC (was `category === 'external'`).
 * A `prior` is the producer's QUANTITATIVE STATEMENT; `category` is a coaching
 * CLASSIFICATION, and the two answer different questions. Gating the statement
 * on the classification meant a controllable or observable factor could declare
 * a support and still be sent to ISL as an undeclared root defaulting to 0.0.
 * The guard that actually decides this pass is the `observed_state.value` skip
 * immediately below: a stated value always wins, whatever the category.
 *
 * @param nodes Graph nodes
 * @param options The options EXACTLY AS THEY TRAVEL TO ISL (post-normalisation,
 *   the same units as `observed_state.value`) — the only source of a scale for a
 *   zero-valued factor (priority 4a) and of a pin. Omitted ⇒ no option levels ⇒
 *   nothing pinned and every zero factor takes the base FALLBACK_STD path.
 * @param correlatedFactorIds Factor ids named in the request's
 *   `factor_correlations` (either side of any pair). A pinned lever among them
 *   is sent as normal at MIN_USER_STD, because ISL rejects a correlated point_mass.
 * @returns Parameter uncertainties for ISL
 */
/** A zero-valued factor PLoT holds at 0 because nothing gives it a scale (priority 4b). */
export interface ZeroFactorHeldExact {
  node_id: string;
  label: string;
  unit?: string;
  /**
   * True when an option REACHES the factor — a directed path of length ≥ 1 from a node some option sets (AIQ #72
   * 5871640445). Only its STARTING level is then held exact; the analysis still moves it, so the user may not be told
   * it has "no uncertainty". False ⇒ nothing any option sets feeds it, and that sentence is the true one.
   */
  moved_by_options: boolean;
  /**
   * The factor's direct parents that carry an effect (the same DAG filter), by label — AIQ #72 5872285581: only a node
   * with NO parents has "no uncertainty"; any node with parents varies, through the options or an uncertain ancestor.
   */
  parent_labels: string[];
}

/**
 * The factors `buildParameterUncertaintiesV3` holds at 0 under priority 4b — a finite zero level, not pinned, no
 * user std, not binary, and no option sets it (AIQ #72 5869679096). The same predicate as the builder, so the
 * warning names exactly the factors held.
 *
 * ⛔ HELD IS NOT UNMOVED (AIQ #72 5871640445, served journey E on PLoT b4eaa0c). "Engineering delivery capacity" and
 * "Annual salary spend" are held zeros whose parents are the hire levers every option sets: the analysis moves them,
 * and "with no uncertainty" was false. `moved_by_options` records, per held factor, whether any option-set node has a
 * directed path to it — read through the estate's ONE DAG filter and walk (`buildAdjacencyList` / `checkPathToGoal`,
 * validation/path-to-goal.ts: a bidirected edge, or one with exists_probability ≤ 0, carries no effect). ONLY options
 * count (the rule as briefed): a zero below an uncertain root no option reaches is not moved by the options. A factor
 * the options set only to 0 is its own source — a length-0 path — and is not counted: it is 0 in every option.
 *
 * @param edges The graph's edges as the analysis will read them. REQUIRED: without them no held zero could be told
 *   apart from an unreached one, and the default would be the false sentence.
 */
export function zeroFactorsHeldExact(
  nodes: EngineNodeV3[],
  options: readonly OptionV3[],
  edges: readonly EngineEdgeV3[],
): ZeroFactorHeldExact[] {
  const maxOptionLevel = maxAbsOptionLevelByFactor(options);
  const pinned = pinnedLeverIds(nodes, options);
  const optionSetIds = [...new Set(options.flatMap((o) => Object.keys(o.interventions ?? {})))];
  const adjacency = buildAdjacencyList([...edges]);
  const labelOf = new Map(nodes.map((n) => [n.id, typeof n.label === 'string' && n.label !== '' ? n.label : n.id]));
  const parentsOf = (id: string): string[] =>
    [...new Set([...adjacency].filter(([, tos]) => tos.includes(id)).map(([from]) => labelOf.get(from) ?? from))].sort();
  const held: ZeroFactorHeldExact[] = [];
  for (const node of nodes) {
    const value = node.observed_state?.value;
    if (node.kind !== 'factor' || value !== 0 || pinned.has(node.id)) continue;
    if (resolveUserSuppliedStd(node.observed_state?.std) !== null || isBinaryFactor(node)) continue;
    if ((maxOptionLevel.get(node.id) ?? 0) > 0) continue;
    const unit = typeof node.observed_state?.unit === 'string' ? node.observed_state.unit : undefined;
    const movedByOptions = optionSetIds.some((id) => id !== node.id && checkPathToGoal(adjacency, id, node.id).reachable);
    held.push({
      node_id: node.id,
      label: typeof node.label === 'string' && node.label !== '' ? node.label : node.id,
      ...(unit !== undefined && { unit }),
      moved_by_options: movedByOptions,
      parent_labels: parentsOf(node.id),
    });
  }
  return held;
}

/** Quoted labels as a person lists them: "A", "A" and "B", "A", "B" and "C". */
function sayLabels(labels: readonly string[]): string {
  const q = labels.map((l) => `"${l}"`);
  return q.length <= 1 ? (q[0] ?? '') : `${q.slice(0, -1).join(', ')} and ${q[q.length - 1]}`;
}

/** "£0" for a money unit, "0%" for a percent, "0 <unit>" otherwise, "0" with none — the held level as figures are said. */
export function formatHeldZero(unit: string | undefined): string {
  const u = unit?.trim() ?? '';
  if (u === '') return '0';
  if (/^(?:£|gbp)/i.test(u)) return '£0';
  if (/^(?:\$|usd)/i.test(u)) return '$0';
  if (/^(?:€|eur)/i.test(u)) return '€0';
  if (/^%/.test(u)) return '0%';
  return `0 ${u}`;
}

/**
 * One typed `ZERO_FACTOR_HELD_EXACT` warning per held factor, naming it (AIQ #72 5869679096: never a silent hold).
 * "With no uncertainty" ONLY for a factor no option reaches; a reached one is told the true thing — its starting
 * level is held exact and the options still move it (AIQ #72 5871640445). ONE code for both: every reader keys on
 * the code alone and none maps this one to copy (the UI's audit row renders it generically and never echoes
 * `message`; CEE reads no ZERO_FACTOR_HELD_EXACT) — so a reader that ever maps it must not say "no uncertainty".
 */
export function zeroFactorHeldWarnings(held: readonly ZeroFactorHeldExact[]): InferenceWarning[] {
  return held.map((h) => ({
    code: INFERENCE_WARNING_CODES.ZERO_FACTOR_HELD_EXACT,
    // AIQ #72 5872285581: "no uncertainty" is true ONLY for a node with no parents; a reached node is moved by the options;
    // an unreached node with parents still varies with them.
    message: h.moved_by_options
      ? `Olumi holds the starting level of "${h.label}" at ${formatHeldZero(h.unit)} exactly; the options still move it.`
      : h.parent_labels.length > 0
        ? `Olumi holds the starting level of "${h.label}" at ${formatHeldZero(h.unit)} exactly; it still varies with ${sayLabels(h.parent_labels)}.`
        : `Olumi holds "${h.label}" at ${formatHeldZero(h.unit)} with no uncertainty; give a range if it can vary.`,
    severity: 'info' as const,
    node_label: h.label,
  }));
}

/**
 * Options whose every goal ancestor they set is sent EXACT (`point_mass`) — for them ISL's zero-variance critique is
 * a true statement about exact inputs, not a missing path (AIQ #72 5869679096 (b)). An option that sets no goal
 * ancestor is never here: its zero variance keeps today's "never reaches the goal" wording.
 */
export function exactInputOptionIds(
  nodes: EngineNodeV3[],
  edges: ReadonlyArray<{ from: string; to: string }>,
  goalNodeId: string,
  options: readonly OptionV3[],
  uncertainties: ReadonlyArray<{ node_id: string; distribution?: string }>,
): Set<string> {
  const exact = new Set(uncertainties.filter((u) => u.distribution === 'point_mass').map((u) => u.node_id));
  const parents = new Map<string, string[]>();
  for (const e of edges) parents.set(e.to, [...(parents.get(e.to) ?? []), e.from]);
  const ancestors = new Set<string>();
  const stack = [...(parents.get(goalNodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    stack.push(...(parents.get(id) ?? []));
  }
  const factorIds = new Set(nodes.filter((n) => n.kind === 'factor').map((n) => n.id));
  const out = new Set<string>();
  for (const option of options) {
    const touched = Object.keys(option.interventions ?? {}).filter((id) => factorIds.has(id) && ancestors.has(id));
    if (touched.length > 0 && touched.every((id) => exact.has(id))) out.add(option.id);
  }
  return out;
}

/**
 * R3-B #72 5895208669 (frames, AIQ 5895140735): map the upstream claim `observed_state.std_source` onto ISL's
 * `ParameterUncertainty.spread_source`. `'user'` → `'user'`; `'olumi'` → `'template'` (Olumi's spread, e.g. one
 * carried across a frame move). Anything else, or absent → undefined: fail closed — a spread is never called the
 * user's unless upstream says so, and ISL echoes `null` ("not stated").
 */
export function spreadSourceOf(stdSource: unknown): 'user' | 'template' | undefined {
  if (stdSource === 'user') return 'user';
  if (stdSource === 'olumi') return 'template';
  return undefined;
}

export function buildParameterUncertaintiesV3(
  nodes: EngineNodeV3[],
  options: readonly OptionV3[] = [],
  correlatedFactorIds: ReadonlySet<string> = new Set(),
): ISLRobustnessRequestV3['parameter_uncertainties'] {
  const uncertainties: NonNullable<ISLRobustnessRequestV3['parameter_uncertainties']> = [];
  const maxOptionLevel = maxAbsOptionLevelByFactor(options);
  const pinned = pinnedLeverIds(nodes, options);

  for (const node of nodes) {
    if (node.kind === 'factor' && node.observed_state?.value !== undefined && Number.isFinite(node.observed_state.value)) {
      const value = node.observed_state.value;

      if (pinned.has(node.id)) {
        if (correlatedFactorIds.has(node.id)) {
          // ISL 14f1a3a rejects point_mass for any factor named in
          // factor_correlations (robustness_v2.py validate_factor_correlations,
          // _CORRELATION_SUPPORTED_DISTRIBUTIONS = {normal, uniform}) with a 422
          // that fails the whole Run. The tightest admissible hold is a normal at
          // MIN_USER_STD — the only place a pinned lever is not held exact.
          uncertainties.push({ node_id: node.id, distribution: 'normal', std: MIN_USER_STD });
        } else {
          // T7b: a pinned lever's today level is held EXACT — no sampling, no
          // floor, and ahead of a CEE-sent std (AIQ Control 1).
          uncertainties.push({ node_id: node.id, distribution: 'point_mass' });
        }
        continue;
      }

      const userStd = resolveUserSuppliedStd(node.observed_state.std);

      let std: number;

      if (userStd !== null) {
        // Priority 1: honour user-supplied std (already clamped to
        // [MIN_USER_STD, MAX_USER_STD]). DEFAULT_STD_FLOOR intentionally does
        // not apply — small user values must reach ISL as-is.
        std = userStd;
      } else {
        // Priorities 2–3: synthesised defaults, with DEFAULT_STD_FLOOR applied.
        const isBinary = isBinaryFactor(node);
        if (isBinary) {
          std = Math.max(DEFAULT_STD_FLOOR, BINARY_DEFAULT_STD);
        } else if (value !== 0) {
          std = Math.max(DEFAULT_STD_FLOOR, Math.abs(value) * VALUE_BASED_STD_FRACTION);
        } else {
          const maxLevel = maxOptionLevel.get(node.id) ?? 0;
          if (maxLevel > 0) {
            // Priority 4a (T7b): scaled by the option levels, never by the frame
            // — and so NOT floored by DEFAULT_STD_FLOOR, itself a frame fraction.
            std = Math.max(MIN_USER_STD, VALUE_BASED_STD_FRACTION * maxLevel);
          } else {
            // Priority 4b (AIQ #72 5869679096, measured): a zero no option touches has no
            // scale of its own; FALLBACK_STD would be half its FRAME (journey E: ±£500,000
            // of salary on a £1m frame; doubling the frame moved the goal sd +30%). It is
            // HELD at 0 — exact, or MIN_USER_STD where ISL rejects a correlated point_mass —
            // and never silently: `zeroFactorsHeldExact` names each one to the user.
            uncertainties.push(correlatedFactorIds.has(node.id)
              ? { node_id: node.id, distribution: 'normal', std: MIN_USER_STD }
              : { node_id: node.id, distribution: 'point_mass' });
            continue;
          }
        }
      }

      // Slice 6: no `mean` — ISL samples Normal(observed_state.value, std) and
      // reads the centre from the graph node, not from this entry.
      // Whose spread this is — only for a REAL observed_state.std (priority 1), never for a spread PLoT synthesised.
      const spreadSource = userStd !== null ? spreadSourceOf(node.observed_state.std_source) : undefined;
      uncertainties.push({
        node_id: node.id,
        distribution: 'normal',
        std,
        ...(spreadSource !== undefined && { spread_source: spreadSource }),
      });
    }
  }

  // Second pass: factors with a prior distribution and no stated value.
  for (const node of nodes) {
    // Skip if already processed via observed_state (observed_state takes precedence)
    if (node.kind === 'factor' && node.observed_state?.value !== undefined) continue;

    // No `category` conjunct: see the SECOND PASS note in the function's doc
    // block. A declared prior is honoured whatever the factor is classified as;
    // the `observed_state.value` skip above is what protects the stated value.
    if (node.kind === 'factor' && node.prior) {
      // Only "uniform" distribution supported for now
      if (node.prior.distribution !== 'uniform') {
        // Wave1-L1 (PII): node id + user-supplied distribution text digested —
        // an unsupported distribution is arbitrary user input.
        console.warn(
          `[PARAMETER_UNCERTAINTY] node_id=${sha8(String(node.id))} unsupported prior distribution (distribution_sha8=${sha8(String(node.prior.distribution))}), skipping`
        );
        continue;
      }

      let rangeMin = node.prior.range_min;
      let rangeMax = node.prior.range_max;

      // Validate range_min and range_max are finite numbers
      if (typeof rangeMin !== 'number' || !Number.isFinite(rangeMin) ||
          typeof rangeMax !== 'number' || !Number.isFinite(rangeMax)) {
        // Wave1-L1 (PII): node id digested.
        console.warn(
          `[PARAMETER_UNCERTAINTY] node_id=${sha8(String(node.id))} prior has non-finite range values, skipping`
        );
        continue;
      }

      // Swap if range_min > range_max
      if (rangeMin > rangeMax) {
        // Wave1-L1 (PII): raw range values are decision inputs — digested.
        console.warn(
          `[PARAMETER_UNCERTAINTY] node_id=${sha8(String(node.id))} prior range_min (${sha8(rangeMin)}) > range_max (${sha8(rangeMax)}), swapping`
        );
        [rangeMin, rangeMax] = [rangeMax, rangeMin];
      }

      // ⚠ A DEGENERATE RANGE CANNOT BE EXPRESSED, SO IT IS DECLINED — LOUDLY.
      // `range_min == range_max` is a point mass, and ISL has no way to carry
      // one for a node with no `observed_state`: its `point_mass` branch
      // returns the observed value (robustness_analyzer_v2.py:1171-1173),
      // which for a prior-only factor is the 0.0 default. Emitting anything
      // here would put a fabricated centre on the wire, so PLoT emits NOTHING
      // and the factor falls to ISL's root-default detector, which fires
      // ROOT_NODE_DEFAULT_VALUE precisely because no ParameterUncertainty
      // entry is present (robustness_analyzer_v2.py:1826-1834). The user sees
      // "no observed value provided … results may be unreliable" instead of a
      // confident number drawn from nowhere. ISL's own validator would also
      // 422 a `range_min >= range_max` uniform (robustness_v2.py:277-283), so
      // sending one would take the whole analysis down rather than one factor.
      if (!(rangeMin < rangeMax)) {
        // Wave1-L1 (PII): raw range values are decision inputs — digested.
        console.warn(
          `[PARAMETER_UNCERTAINTY] node_id=${sha8(String(node.id))} prior range is degenerate (range_min == range_max, value_sha8=${sha8(rangeMin)}); no uncertainty emitted — ISL will disclose the defaulted root instead of sampling a fabricated centre`
        );
        continue;
      }

      // Send ISL the uniform it actually supports, bounds and all.
      //
      // ⚠ THIS REPLACED A σ = width/√12 NORMAL, AND THE REASON MATTERS. The
      // old conversion was a correct moment-match for the WIDTH and had no
      // channel for the CENTRE, because ISL's ParameterUncertainty declares no
      // `mean`. What that missed is that ISL never needed one: its `uniform`
      // branch reads the bounds straight off this entry and does not consult
      // `observed_state` at all (robustness_analyzer_v2.py:1180-1188; the
      // correlated copula path likewise, 1140-1149). A prior-only external
      // factor has no `observed_state`, so the normal entry was centred on the
      // 0.0 default: measured through ISL's own FactorSampler at 47f20068, a
      // stated Uniform[0.6,1.0] sampled at mean -0.000434 with all 20,000
      // draws OUTSIDE the declared support. Worse, it was uncaveated — the
      // root-default detector is satisfied by the mere PRESENCE of an entry
      // (robustness_analyzer_v2.py:1826-1834), so nothing warned. The pairing
      // that measures this is tests/isl-factor-sampler-centre.contract.test.ts;
      // do not revert this to a normal without re-running it.
      //
      // Preserved from the old conversion, because it is still true:
      //
      // ⚠ SCOPE BOUNDARY (ROADMAP 2.721, derived at the bytes 8 Aug 2026):
      // the ranges on this path are SYSTEM-derived declared-uniform SUPPORTS,
      // not user-stated ranges. CEE's drafter mints
      // `prior: {distribution:'uniform', range_min, range_max}` on a 0–1
      // qualitative index from brief WORDING ("low"→[0,0.4] … — the
      // "External prior anchoring" table, defaults-v187/v19), and no
      // user-elicited range can reach this field: CEE's `prior_range_edit`
      // system event is `fact_and_commit` — a judgement receipt that never
      // writes the graph — and the calibration path (2.627) refuses to mint
      // prior bounds from user statements. A declared uniform support is
      // exactly what a uniform entry means, so this is now a passthrough of
      // the producer's own statement rather than a lossy fit of it.
      //
      // A USER-STATED range is a ~50% credible interval (Neil's 2.521 Q1
      // ruling): its σ is 0.7413·width — 2.57× LARGER than the uniform
      // moment-match — fitted ISL-side per
      // `parallel-briefs/RANGE-TO-DISTRIBUTION-SPEC-2026-08-08.md` (§4.4
      // states this coexistence rule explicitly). A human-stated range must
      // NEVER route through this path; it would silently understate the
      // user's uncertainty and normalise their slips (the swap above is a
      // producer-noise repair for LLM-minted priors, not a licence to reorder
      // what a human said).
      uncertainties.push({
        node_id: node.id,
        distribution: 'uniform',
        range_min: rangeMin,
        range_max: rangeMax,
      });
    }
  }

  return uncertainties.length > 0 ? uncertainties : undefined;
}

/**
 * Detect if a factor node is binary using strong signals.
 * Avoids misclassifying continuous factors (e.g., "Number of Developers Hired" = 0) as binary.
 *
 * Binary detection signals (in order):
 * 1. Explicit range [0,1]
 * 2. Label contains explicit binary markers: "(0/1)", "yes/no", "true/false"
 * 3. Unit suggests boolean: "boolean", "bool", "binary"
 * 4. Common boolean naming patterns + value is exactly 0 or 1
 */
function isBinaryFactor(node: EngineNodeV3): boolean {
  const range = node.state_space?.range;
  const value = node.observed_state?.value;

  // Signal 1: Explicit range [0,1]
  if (range && range.min === 0 && range.max === 1) {
    return true;
  }

  const label = (node.label ?? '').toLowerCase();

  // Signal 2: Label contains explicit binary markers
  if (label.includes('(0/1)') || label.includes('yes/no') || label.includes('true/false')) {
    return true;
  }

  // Signal 3: Unit suggests boolean
  const unit = (node.observed_state?.unit ?? '').toLowerCase();
  if (unit === 'boolean' || unit === 'bool' || unit === 'binary') {
    return true;
  }

  // Signal 4: Common boolean naming patterns + value is exactly 0 or 1
  // Only applies when no range is specified and value suggests binary
  if ((value === 0 || value === 1) && !range) {
    const id = node.id.toLowerCase();
    const booleanPrefixes = ['is_', 'has_', 'can_', 'should_', 'will_', 'was_', 'did_'];
    const booleanSuffixes = ['_flag', '_enabled', '_active', '_hired', '_present', '_available'];

    if (booleanPrefixes.some((p) => id.startsWith(p))) return true;
    if (booleanSuffixes.some((s) => id.endsWith(s))) return true;
  }

  return false;
}

/**
 * Translate full request to ISL robustness request format.
 *
 * @param graph Internal graph format
 * @param options Internal options format
 * @param goalNodeId Goal node ID
 * @param requestId Request ID for correlation
 * @param nSamples Number of samples (optional)
 * @param goalThreshold Goal threshold for probability_of_goal computation (optional)
 * @param goalConstraints Goal constraints for multi-constraint analysis (optional)
 * @param seed Seed forwarded to ISL for deterministic Monte Carlo runs (optional)
 * @param includePathDecomposition Forward include_path_decomposition to ISL
 *   (optional, request-gated opt-in — only sent when the caller explicitly
 *   asked; the key is OMITTED otherwise so the ISL payload never grows by
 *   default)
 * @returns ISL robustness request
 */
export function toISLRobustnessRequest(
  graph: EngineGraphV3,
  options: OptionV3[],
  goalNodeId: string,
  requestId: string,
  nSamples?: number,
  goalThreshold?: number,
  goalConstraints?: GoalConstraint[],
  // CIL 0.1: forward seed to ISL for deterministic Monte Carlo runs
  seed?: string | number,
  includePathDecomposition?: boolean,
  // Optional: the factor PU list already built from `graph.nodes` by the caller
  // (the /v2/run admission planner computes it to price EVPI). Threading it in
  // avoids a second identical `buildParameterUncertaintiesV3` pass over the same
  // nodes; byte-identical to recomputing here. Omitted callers recompute.
  prebuiltParameterUncertainties?: ISLRobustnessRequestV3['parameter_uncertainties'],
  // Capability #100 (doctrine D-23.4): client-supplied pairwise factor
  // correlations, forwarded VERBATIM. Request-gated — the key is included only
  // when a non-empty array is supplied, so the ISL payload never grows by
  // default and ISL's `extra:"ignore"` never sees an empty array.
  factorCorrelations?: FactorCorrelation[],
  // ROADMAP 2.258: the producer-stamped frame for `goalThreshold`. Appended
  // rather than placed beside `goalThreshold` because 66 call sites pass these
  // positionally and reshuffling them is a mis-wire waiting to happen. The
  // COUPLING that matters is not positional adjacency — it is that the key is
  // emitted only inside the `goalThreshold !== undefined` branch below, so a
  // frame can never reach the wire without its number.
  goalThresholdFrame?: GoalThresholdFrameType,
  // ROADMAP 2.720: the user's own stated ranges, forwarded from the /v2/run
  // request. Appended for the same reason as `goalThresholdFrame` above — the
  // call sites pass these positionally and reshuffling them is a mis-wire
  // waiting to happen.
  userStatedRanges?: ISLUserStatedRange[],
  // ROADMAP 2.920: the user's attested objective sense. Appended for the same
  // reason as `goalThresholdFrame` and `userStatedRanges` above — the call sites
  // pass these positionally and reshuffling them is a mis-wire waiting to happen.
  goalDirection?: GoalDirectionType,
  // R1 S4 (B): the producer's attested strict comparator. Appended last for the same positional-call reason.
  goalThresholdStrict?: boolean
): ISLRobustnessRequestV3 {
  // Bidirected edges are trust-layer only (identifiability + warnings).
  // ISL operates on directed edges only. Phase 3A-inference will add inference semantics.
  const directedEdges = graph.edges.filter((e) => e.edge_type !== 'bidirected');

  const request: ISLRobustnessRequestV3 = {
    request_id: requestId,
    graph: {
      nodes: graph.nodes.map(toISLNode),
      edges: directedEdges.map(toISLEdge),
    },
    options: options.map(toISLOption),
    goal_node_id: goalNodeId,
    n_samples: nSamples,
    analysis_types: ['comparison', 'sensitivity', 'robustness'],
    parameter_uncertainties:
      prebuiltParameterUncertainties ??
      buildParameterUncertaintiesV3(graph.nodes, options, correlatedFactorIdsOf(factorCorrelations)),
    include_e_values: true,
    include_voi: true,
    // ROADMAP 2.228-F3: ask ISL for closed-form per-factor flip thresholds.
    // Unconditional, like its two siblings above — ISL's default is False, so
    // omitting this key is what kept `factor_flip_values` off every live
    // response and `flip_thresholds[].flip_value` null on every run.
    include_factor_flips: true,
  };

  // Only include goal_threshold if provided (omit entirely when absent)
  if (goalThreshold !== undefined) {
    request.goal_threshold = goalThreshold;

    // ROADMAP 2.258. The frame rides INSIDE this branch on purpose: a frame
    // without a threshold describes nothing, and ISL would reject the pair as
    // incoherent. Nesting makes that impossible structurally rather than by
    // convention — delete the nesting and `goal-threshold-frame.test.ts`
    // ("a frame never travels without its threshold") reds.
    //
    // Still request-gated within the branch: an unstamped threshold omits the
    // key entirely, which is the state ISL fail-closes on with a NAMED reason
    // (GOAL_THRESHOLD_FRAME_UNSPECIFIED). PLoT does NOT substitute a default —
    // 'delta' would silently restore the pre-2.258 structural zero and 'level'
    // would assert a domain PLoT has not verified.
    if (goalThresholdFrame !== undefined) {
      request.goal_threshold_frame = goalThresholdFrame;
    }
  }

  // Only include goal_constraints if provided and non-empty (omit entirely when absent).
  // F-20: Send canonical "value" field (was legacy "threshold").
  if (goalConstraints && goalConstraints.length > 0) {
    request.goal_constraints = goalConstraints.map((c) => ({
      constraint_id: c.constraint_id,
      node_id: c.node_id,
      operator: c.operator,
      value: c.value,
      ...(c.label !== undefined && { label: c.label }),
      ...(c.weight !== undefined && { weight: c.weight }),
      // ROADMAP 2.855 — by presence. Structurally coupled to its own number by
      // construction: the frame rides ON the constraint object, so it cannot
      // reach the wire without the `value` it describes (the coupling the node
      // channel has to arrange positionally for `goal_threshold_frame`).
      ...(c.value_frame !== undefined && { value_frame: c.value_frame }),
      // Release gate (ii) — by presence, bounds copied field by field so no
      // other key can ride along on the domain object.
      ...(c.level_domain !== undefined && {
        level_domain: {
          ...(c.level_domain.min !== undefined && { min: c.level_domain.min }),
          ...(c.level_domain.max !== undefined && { max: c.level_domain.max }),
        },
      }),
    }));
  }

  // ROADMAP 2.920 — the user's attested objective sense, request-gated.
  //
  // Omitted when absent. PLoT does NOT substitute a default, for the same reason
  // it does not default `goal_threshold_frame`: absent reproduces today's
  // behaviour exactly (ISL runs the maximiser and DISCLOSES that it is
  // unattested), whereas a guessed direction INVERTS the ranking silently and is
  // strictly worse than the current error.
  //
  // ⛔ THE 'target' GUARD IS NOT DEFENSIVE POLISH. ISL's contract: a 'target'
  // sense "REQUIRES goal_threshold and goal_threshold_frame (a target sense with
  // no target is refused at parse, never silently downgraded to maximise)". That
  // refusal is a 422 that fails the WHOLE analysis, not just the direction — so
  // forwarding an unsatisfiable 'target' would convert a missing-nicety into a
  // total outage. Dropping it back to the unattested maximiser is the same
  // outcome the user gets today, with the disclosure intact.
  if (goalDirection !== undefined) {
    const targetIsSatisfiable =
      request.goal_threshold !== undefined && request.goal_threshold_frame !== undefined;
    if (goalDirection !== 'target' || targetIsSatisfiable) {
      request.goal_direction = goalDirection;
    }
  }

  // R1 S4 (B) — a STRICT goal, request-gated and verbatim. Forwarded only as `true` and only when this request
  // carries the threshold it qualifies: ISL #209 refuses `goal_threshold_strict: true` with no `goal_threshold` (a 422
  // that fails the WHOLE analysis), and PLoT's frame/domain safeguards can clear the threshold. Absent or false is
  // omitted, so the request is byte-identical to today's. PLoT never infers strictness.
  if (goalThresholdStrict === true && request.goal_threshold !== undefined) {
    request.goal_threshold_strict = true;
  }

  // CIL 0.1: forward seed to ISL for deterministic Monte Carlo runs
  if (seed !== undefined) {
    request.seed = seed;
  }

  // Path decomposition is a request-gated opt-in (lane PLoT-W4): forward the
  // flag ONLY when the inbound request explicitly asked for it. The key is
  // omitted (not sent as false) otherwise — no default payload growth on
  // either the ISL request or the ISL response.
  if (includePathDecomposition === true) {
    request.include_path_decomposition = true;
  }

  // Capability #100 (doctrine D-23.4): forward client-supplied factor
  // correlations VERBATIM, request-gated. Included ONLY when a non-empty array
  // is supplied — omitted otherwise so the ISL payload is byte-identical for
  // callers who did not ask, and ISL's `extra:"ignore"` never receives an
  // empty array. Deep semantics (unknown-factor / |rho|>1 / self-pair /
  // duplicate) are ISL's single source of truth and surface as a 422.
  if (factorCorrelations && factorCorrelations.length > 0) {
    request.factor_correlations = factorCorrelations;
  }

  // ROADMAP 2.720: forward the user's stated ranges, PROJECTED onto ISL's
  // declared members. Request-gated — included only when at least one range
  // survives the projection, so the ISL payload is byte-identical for callers
  // who did not state any, and ISL's `extra:"ignore"` never receives an empty
  // array. Deep semantics (zero width, inverted order, out of domain,
  // open-ended, non-convergent) are ISL's single source of truth and come back
  // as TYPED refusals on `range_fit_disclosures` — PLoT does not re-implement
  // them, and must not "repair" a range into something the user did not say.
  if (userStatedRanges && userStatedRanges.length > 0) {
    const projected = userStatedRanges
      .map(toISLUserStatedRange)
      .filter((r): r is ISLUserStatedRange => r !== undefined);
    if (projected.length > 0) {
      request.user_stated_ranges = projected;
    }
  }

  return request;
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/**
 * Validate ISL request before sending.
 *
 * Catches issues that would cause ISL to reject the request.
 *
 * @param request ISL request to validate
 * @returns Array of error messages (empty if valid)
 */
export function validateISLRequest(request: ISLRobustnessRequestV3): string[] {
  const errors: string[] = [];

  // Check graph
  if (!request.graph.nodes || request.graph.nodes.length === 0) {
    errors.push('Graph has no nodes');
  }

  // Check options
  if (!request.options || request.options.length === 0) {
    errors.push('No options provided');
  }

  for (const option of request.options ?? []) {
    if (!option.interventions || Object.keys(option.interventions).length === 0) {
      errors.push(`Option '${option.id}' has no interventions`);
    }
  }

  // Check goal node exists
  const nodeIds = new Set(request.graph.nodes?.map((n) => n.id) ?? []);
  if (!nodeIds.has(request.goal_node_id)) {
    errors.push(`Goal node '${request.goal_node_id}' not in graph`);
  }

  // Check intervention targets exist
  for (const option of request.options ?? []) {
    for (const targetId of Object.keys(option.interventions ?? {})) {
      if (!nodeIds.has(targetId)) {
        errors.push(`Option '${option.id}' intervention target '${targetId}' not in graph`);
      }
    }
  }

  return errors;
}
