/**
 * R1 (schemas 0.61.0) — a LEVEL limit on a `quantity_frame: 'change'` node is that node's own CHANGE.
 *
 * `NodeV3.quantity_frame: 'change'` is the contract's typed marker for a quantity that exists only because of the
 * decision ("migration downtime", "one-off switching cost"): "the node's value IS a change from today, so today's value
 * is 0 by definition … a target on such a node needs no base". CEE's construction drafter declares it (Olumi's
 * reading, never guessed from a word list; AIQ #72 5881263293 / 5881419717).
 *
 * WHY THIS HOP: such a node is usually COMPUTED from other factors, and a computed node's samples carry no absolute
 * anchor, so a LEVEL limit on it is withheld (`sample_frame_unanchored` → CONSTRAINT_TARGET_UNRELIABLE). With today = 0,
 * "level ≤ X" and "change from today ≤ X" are the SAME statement, and the change frame is the one ISL resolves on the
 * same draw (`isl_resolved_change`). Served cloud journey (MG #72 5881406690): withheld as a level; as `change_abs`,
 * P 0.81 / 0.99 and decision-grade.
 *
 * FAIL CLOSED on the marker's own premise: a node that holds a NON-ZERO level contradicts "0 by definition" (the
 * contract: a user-stated non-zero today makes the reading yield), so its limit is left exactly as sent. No marker,
 * or any other frame: returned untouched (same object). The constraint id never changes.
 */
import type { GoalConstraint } from '../types/engine-v3.js';

export function changeQuantityLevelLimitsAsChanges(
  constraints: GoalConstraint[],
  nodes: readonly { readonly id: string; readonly quantity_frame?: unknown; readonly observed_state?: unknown }[] | undefined,
): GoalConstraint[] {
  const byId = new Map((nodes ?? []).map((n) => [n.id, n] as const));
  return constraints.map((c) => {
    if (c.value_frame !== 'level') return c;
    const node = byId.get(c.node_id);
    if (node?.quantity_frame !== 'change') return c;
    const os = node.observed_state as { value?: unknown; raw_value?: unknown } | null | undefined;
    if ([os?.value, os?.raw_value].some((v) => typeof v === 'number' && v !== 0)) return c;
    return { ...c, value_frame: 'change_abs' };
  });
}
