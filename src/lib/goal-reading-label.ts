/** Science §(e): the whole licensed goal reading selected for the ISL request. */
import type { UpstreamGraph } from '../types/engine-v3.js';
import { normaliseGraph } from '../normalisation/graph-normaliser.js';
import { collectScaleFrameByNodeId } from './intervention-normaliser.js';
import { attachIdentityExecutionFrames, goalCarrierIds, toISLNode } from '../integrations/isl/translator-v3.js';
import { buildAdjacencyList, checkPathToGoal } from '../validation/path-to-goal.js';

export interface LicensedGoalReading {
  node_id: string;
  factor_ids: string[];
  addends: string[];
}

/**
 * Read the RAW Run graph, retaining its `scale_frame` and `goal_threshold_cap` carriers.
 * Reuse the translator's exact forwarding gate on fresh nodes: a frameless licensed identity
 * is excluded, and eligible intermediate products may receive variant (a)'s derived frame.
 * No labels, arithmetic, confirmation, or Science licence predicate are invented here.
 *
 * This is selection before ISL evaluation/reconciliation, not evidence of `evaluated:true`.
 * A later meta consumer must also check ISL's evaluation and any identity withdrawn on retry.
 * Do not pass a canonical graph that has already lost its raw frame carriers.
 */
export function licensedGoalReadings(graph: UpstreamGraph): LicensedGoalReading[] {
  const engine = normaliseGraph(graph).graph;
  const goals = engine.nodes.filter((n) => n.kind === 'goal');
  const adjacency = buildAdjacencyList(engine.edges);
  const licensed = engine.nodes.filter((n) =>
    n.nonlinear_identity?.reading_licence === 'olumi_reading'
    && goals.some((g) => checkPathToGoal(adjacency, n.id, g.id).reachable),
  );
  if (licensed.length === 0) return [];

  // Capture the producer's goal ruler before normalisation drops it, as /v2/run does.
  const goalCaps = new Map<string, number>();
  for (const node of graph.nodes) {
    const raw = node as typeof node & { goal_threshold_cap?: unknown; data?: { goal_threshold_cap?: unknown } };
    const cap = raw.goal_threshold_cap ?? raw.data?.goal_threshold_cap;
    if (typeof cap === 'number' && Number.isFinite(cap)) goalCaps.set(node.id, cap);
  }
  const islNodes = engine.nodes.map(toISLNode);
  attachIdentityExecutionFrames(
    islNodes, engine.nodes, collectScaleFrameByNodeId(graph.nodes), goalCaps, [],
    goalCarrierIds(engine.nodes, engine.edges),
  );
  const forwarded = new Set(islNodes.filter((n) => n.nonlinear_identity).map((n) => n.id));
  return licensed.filter((n) => forwarded.has(n.id)).map((n) => ({
    node_id: n.id,
    factor_ids: [...n.nonlinear_identity!.factor_ids],
    addends: [...(n.nonlinear_identity!.addends ?? [])],
  }));
}
