/**
 * ⛔ A CHANCE OF REACHING THE GOAL THAT THE MODEL DOES NOT SUPPORT IS WITHHELD, NOT SHOWN (AI Quality #72 5884802000;
 * DL 5884931550, "MG producer + Canvas display").
 *
 * Served (scenario 401e0925, CEE e4934e7): the cloud-bill brief declares "Monthly reserved-instance savings" = steady
 * spend × coverage × discount, and that savings node feeds the goal. The identity was not evaluated, so the engine only
 * ADDED the three effects, and every option's `probability_of_goal` (0.0665 / 0.4005 / 0.0016 / 0) came from that
 * additive walk. The reply said the model "cannot validly determine which option reduces the monthly bill more", and
 * the per-option chances still read "40% chance of a 15% cut". A structurally wrong number is withheld, not caveated.
 *
 * The rule: when a DECLARED identity (`nonlinear_identity` on the graph, or one PLoT withdrew and said in
 * `_meta.identities_not_forwarded`) sits on the goal's own path (it IS the goal, or it reaches the goal through the
 * graph's edges) and ISL did not report it `evaluated: true`, `probability_of_goal` is withheld on every option and
 * `GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED` names the node(s). Silence from ISL is not evaluation (fail closed).
 * An EVALUATED identity (Paul's MRR = price × subscribers, `evaluated: true`) keeps the chance: the numbers rest on it.
 * An identity that does not reach the goal leaves the goal's chance alone. Pure.
 */
import type { IdentityEvaluationV3 } from '../types/engine-v3.js';

export interface GoalIdentityNotEvaluated {
  readonly node_id: string;
  readonly label: string;
  /** The labels of the figures it is worked out from, and how ('product' reads "×", 'sum' reads "+"). */
  readonly parts: readonly string[];
  readonly operation: 'product' | 'sum' | null;
}

interface NodeLike { readonly id?: unknown; readonly kind?: unknown; readonly label?: unknown; readonly nonlinear_identity?: unknown }
interface EdgeLike { readonly from?: unknown; readonly to?: unknown }

type GraphLike = { readonly nodes?: readonly unknown[]; readonly edges?: readonly unknown[] } | undefined;

export function goalIdentitiesNotEvaluated(
  graph: GraphLike,
  identityEvaluations: readonly IdentityEvaluationV3[] | undefined,
  notForwardedNodeIds: readonly string[],
): GoalIdentityNotEvaluated[] {
  const goals = new Set(nodesOf(graph).filter((n) => n.kind === 'goal').map((n) => n.id));
  if (goals.size === 0) return [];
  const reach = reacher(graph);
  return unevaluatedIdentities(graph, identityEvaluations, notForwardedNodeIds)
    .filter((i) => [...goals].some((g) => reach(i.node_id, g)));
}

/**
 * ⛔ AI Quality's CONDITION on #416 (#72 5886183999): a LIMIT whose target IS an unevaluated identity, or is reached
 * through one (a spend limit when spend is the un-evaluated savings product), is scored on the same invalid walk, so its
 * probability is withheld with the same reason and node id, and the joint follows through `joint_withheld`. A limit on a
 * node no unevaluated identity reaches keeps its own. Pure.
 */
export function limitsOnUnevaluatedIdentityPath(
  graph: GraphLike,
  constraints: readonly { readonly constraint_id: string; readonly node_id: string }[] | undefined,
  identityEvaluations: readonly IdentityEvaluationV3[] | undefined,
  notForwardedNodeIds: readonly string[],
): { constraint_id: string; node_id: string; identities: GoalIdentityNotEvaluated[] }[] {
  const unevaluated = unevaluatedIdentities(graph, identityEvaluations, notForwardedNodeIds);
  if (unevaluated.length === 0) return [];
  const reach = reacher(graph);
  return (constraints ?? []).flatMap((c) => {
    const identities = unevaluated.filter((i) => reach(i.node_id, c.node_id));
    return identities.length > 0 ? [{ constraint_id: c.constraint_id, node_id: c.node_id, identities }] : [];
  });
}

function nodesOf(graph: GraphLike): (NodeLike & { id: string })[] {
  return (Array.isArray(graph?.nodes) ? graph!.nodes : []).filter(
    (n): n is NodeLike & { id: string } => n !== null && typeof n === 'object' && typeof (n as NodeLike).id === 'string',
  );
}

/** `reach(from, to)`: `from` IS `to`, or reaches it through the graph's edges. */
function reacher(graph: GraphLike): (from: string, to: string) => boolean {
  const next = new Map<string, string[]>();
  for (const e of (Array.isArray(graph?.edges) ? graph!.edges : []) as EdgeLike[]) {
    if (e === null || typeof e !== 'object' || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  }
  return (from, to) => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length > 0) {
      const x = stack.pop()!;
      if (x === to) return true;
      for (const y of next.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    return false;
  };
}

/** Every DECLARED identity (on the graph, or withdrawn and said) that ISL did not report `evaluated: true`. */
export function unevaluatedIdentities(
  graph: GraphLike,
  identityEvaluations: readonly IdentityEvaluationV3[] | undefined,
  notForwardedNodeIds: readonly string[],
): GoalIdentityNotEvaluated[] {
  const nodes = nodesOf(graph);
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const evaluated = new Set((identityEvaluations ?? []).filter((v) => v?.evaluated === true).map((v) => v.node_id));
  const withdrawn = new Set(notForwardedNodeIds);
  return nodes
    .filter((n) => (n.nonlinear_identity !== undefined && n.nonlinear_identity !== null) || withdrawn.has(n.id))
    .filter((n) => !evaluated.has(n.id))
    .map((n) => {
      const identity = (n.nonlinear_identity ?? null) as { operation?: unknown; factor_ids?: unknown } | null;
      const ids = Array.isArray(identity?.factor_ids) ? identity!.factor_ids.filter((x): x is string => typeof x === 'string') : [];
      return {
        node_id: n.id,
        label: labelOf(n),
        parts: ids.map((id) => labelOf(byId.get(id) ?? { id })),
        operation: identity?.operation === 'product' || identity?.operation === 'sum' ? identity.operation : null,
      };
    });
}

function labelOf(n: NodeLike): string {
  return typeof n.label === 'string' && n.label.trim() !== '' ? n.label : String(n.id);
}

/**
 * The words, exactly as AI Quality set them (#72 5885033487 (2)): no user action is implied (the fix is Olumi's), labels
 * come from the graph, and several identities name the first and add "(and N more)".
 */
export function goalIdentityWithheldMessage(nodes: readonly GoalIdentityNotEvaluated[]): string {
  const first = nodes[0]!;
  const joiner = first.operation === 'sum' ? ' + ' : ' × ';
  const parts = first.parts.length > 0 ? first.parts.join(joiner) : 'other figures in the model';
  const more = nodes.length > 1 ? ` (and ${nodes.length - 1} more)` : '';
  return `Not shown. '${first.label}' depends on ${parts}${more}, but this run couldn't calculate it that way, `
    + 'so the figures for each option would be wrong.';
}

/** The words for a withheld LIMIT, in the register AI Quality set for the goal (#72 5885033487): no action asked. */
export function limitIdentityWithheldMessage(targetLabel: string, identities: readonly GoalIdentityNotEvaluated[]): string {
  const first = identities[0]!;
  const joiner = first.operation === 'sum' ? ' + ' : ' × ';
  const parts = first.parts.length > 0 ? first.parts.join(joiner) : 'other figures in the model';
  const more = identities.length > 1 ? ` (and ${identities.length - 1} more)` : '';
  return `Not shown for the limit on '${targetLabel}'. '${first.label}' depends on ${parts}${more}, but this run couldn't `
    + 'calculate it that way, so the figures for that limit would be wrong.';
}

/**
 * ⛔ R3 SCIENCE #72 5888737291: ISL's value-of-information figures — `p_win_sensitivity` (its `current_metric` is
 * the chance of meeting the goal), `factor_evppi` (the best option's expected outcome, with and without perfect
 * information) and `decision_evpi` — are computed on the same links-only walk as the per-option figures withheld
 * under an unevaluated goal identity (`goalIdentitiesNotEvaluated`). They point the user at the wrong uncertainty,
 * so they are withheld with them. Every other passthrough key (e.g. `correlation_model`, an input structure) stays.
 */
export const GOAL_DERIVED_VOI_KEYS = ['p_win_sensitivity', 'factor_evppi', 'decision_evpi'] as const;

export function withoutGoalDerivedVoi(
  passthrough: Record<string, unknown>,
  goalFiguresWithheld: boolean,
): Record<string, unknown> {
  if (!goalFiguresWithheld) return passthrough;
  const out = { ...passthrough };
  for (const key of GOAL_DERIVED_VOI_KEYS) delete out[key];
  return out;
}

/**
 * ⛔ R3 SCIENCE #72 5889219876 — ONE RULE under `goalIdentitiesNotEvaluated`: withhold what the WALK (the goal's
 * links-only draws) computed; keep what the STRUCTURE computed (R3-5, #405).
 *
 * A factor row's quantities behind `importance_rank` / `sensitivity_score` / `elasticity` / `direction` come from the
 * authority its `importance_basis` names (contracts/openapi.yaml): a structural basis keeps them; anything else
 * (`isl_uncertainty`, ISL's Monte-Carlo ordering, or no disclosure) is the walk. Value of information, attribution
 * stability, rank-flip rate, flip risk and the heuristic EVPI are always the walk's. `confidence` is kept only when
 * its source is attested structural (`plot_unified_from_graph`); a bootstrap-blended confidence is the walk's.
 * `influence_*` (structural influence) always stays.
 */
const STRUCTURAL_FACTOR_BASES: ReadonlySet<unknown> = new Set(['graph_structural', 'isl_structural']);
const WALK_FACTOR_FIELDS = [
  'value_of_information', 'attribution_stability', 'rank_flip_rate', 'flip_risk_category',
  'evpi_percentage_points', 'evpi_method',
] as const;
const BASIS_DEPENDENT_FACTOR_FIELDS = ['sensitivity_score', 'elasticity', 'importance_rank', 'direction'] as const;
const CONFIDENCE_FIELDS = ['confidence', 'confidence_source', 'confidence_provenance', 'confidence_components'] as const;
const STRUCTURAL_CONFIDENCE_SOURCE = 'plot_unified_from_graph';

export function isStructuralFactorBasis(basis: unknown): boolean {
  return STRUCTURAL_FACTOR_BASES.has(basis);
}

/** A factor row less every quantity the walk computed (see above). The row object is copied, never mutated. */
export function factorRowWithoutWalk<T extends object>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of WALK_FACTOR_FIELDS) delete out[k];
  if (!isStructuralFactorBasis(out.importance_basis)) for (const k of BASIS_DEPENDENT_FACTOR_FIELDS) delete out[k];
  if (out.confidence_source !== STRUCTURAL_CONFIDENCE_SOURCE) for (const k of CONFIDENCE_FIELDS) delete out[k];
  return out as T;
}

/** The driver order is the walk's only when its basis is ISL's Monte-Carlo ordering (`isl_uncertainty`). */
export function driverOrderUnderWithhold<T extends { basis?: unknown }>(order: T | undefined, goalFiguresWithheld: boolean): T | undefined {
  return goalFiguresWithheld && order?.basis === 'isl_uncertainty' ? undefined : order;
}

const OPTION_GOAL_FIGURES = ['win_probability', 'probability_of_goal', 'downside', 'expected_outcome', 'confidence_interval'] as const;
const OUTCOME_FIGURES = ['mean', 'std', 'p10', 'p50', 'p90'] as const;
const ISL_WALK_KEYS = ['p_win_sensitivity', 'factor_evppi', 'decision_evpi', 'factor_flip_values', 'conditional_winners', 'robustness'] as const;

/**
 * ⛔ AIQ #72 5889514782 / R3 5889219876 — the PUBLISHED view of ISL's answer under an unevaluated goal identity, for
 * the consumers that read ISL's answer directly rather than the response (M1 coaching): each option less its goal
 * figures (sample counts stay), the walk's top-level blocks absent, and each factor row less the walk's fields.
 * A copy; the answer itself is untouched (the response is built from it under the same rule).
 */
export function islResultWithoutGoalFigures<T>(islResult: T): T {
  if (!islResult || typeof islResult !== 'object') return islResult;
  const src = islResult as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  for (const k of ISL_WALK_KEYS) delete out[k];
  for (const key of ['options', 'results'] as const) {
    const rows = src[key];
    if (!Array.isArray(rows)) continue;
    out[key] = rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const r = { ...(row as Record<string, unknown>) };
      for (const k of OPTION_GOAL_FIGURES) delete r[k];
      if (r.outcome && typeof r.outcome === 'object') {
        const o = { ...(r.outcome as Record<string, unknown>) };
        for (const k of OUTCOME_FIGURES) delete o[k];
        r.outcome = o;
      }
      return r;
    });
  }
  if (Array.isArray(src.factor_sensitivity)) out.factor_sensitivity = (src.factor_sensitivity as object[]).map(factorRowWithoutWalk);
  return out as T;
}

/**
 * ⛔ AIQ #72 5889514782 — M1 coaching under an unevaluated goal identity, field by field on R3's rule. Its lead
 * (headline type, executive summary, story headlines), readiness, next actions and evidence gaps rank or name options
 * by the goal's walk — and, fed the published view, the coaching builder reads absent win probabilities as 0 ("too
 * close to call", "0% win probability"). So only the fields that make no claim about the goal's outcome stay: the key
 * drivers (structural influence), the model critiques, the assumptions ledger (inputs, not outcomes) and metadata.
 */
const COACHING_STRUCTURAL_FIELDS = ['coaching_version', 'computed_at', 'thresholds_used', 'key_drivers', 'model_critiques', 'assumptions_ledger'] as const;

export function coachingWithoutWalk<T extends object>(coaching: T): T {
  const src = coaching as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of COACHING_STRUCTURAL_FIELDS) if (k in src) out[k] = src[k];
  return out as T;
}
