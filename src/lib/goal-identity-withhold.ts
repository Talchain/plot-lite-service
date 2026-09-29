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
