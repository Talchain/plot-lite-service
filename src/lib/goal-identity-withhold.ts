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

export function goalIdentitiesNotEvaluated(
  graph: { readonly nodes?: readonly unknown[]; readonly edges?: readonly unknown[] } | undefined,
  identityEvaluations: readonly IdentityEvaluationV3[] | undefined,
  notForwardedNodeIds: readonly string[],
): GoalIdentityNotEvaluated[] {
  const nodes = (Array.isArray(graph?.nodes) ? graph!.nodes : []).filter(
    (n): n is NodeLike & { id: string } => n !== null && typeof n === 'object' && typeof (n as NodeLike).id === 'string',
  );
  const goals = new Set(nodes.filter((n) => n.kind === 'goal').map((n) => n.id));
  if (goals.size === 0) return [];
  const next = new Map<string, string[]>();
  for (const e of (Array.isArray(graph?.edges) ? graph!.edges : []) as EdgeLike[]) {
    if (e === null || typeof e !== 'object' || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  }
  const reachesGoal = (from: string): boolean => {
    const seen = new Set([from]);
    const stack = [from];
    while (stack.length > 0) {
      const x = stack.pop()!;
      if (goals.has(x)) return true;
      for (const y of next.get(x) ?? []) if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
    return false;
  };
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const evaluated = new Set((identityEvaluations ?? []).filter((v) => v?.evaluated === true).map((v) => v.node_id));
  const withdrawn = new Set(notForwardedNodeIds);
  return nodes
    .filter((n) => (n.nonlinear_identity !== undefined && n.nonlinear_identity !== null) || withdrawn.has(n.id))
    .filter((n) => !evaluated.has(n.id) && reachesGoal(n.id))
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
