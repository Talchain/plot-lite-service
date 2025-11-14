import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { runKernel } from '../../scm-lite/kernel.js';
import { adaptGraphToDAG } from '../../scm-lite/adapter.js';

interface OptimiseRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  budget: number;
  actions: Array<{ id: string; cost: number; do: Array<{ node_id: string; set_to: number }> }>;
  objective: { type: 'utility_linear'; weights: Record<string, number> };
}

// Helper: Apply action interventions to graph
// NOTE: Current kernel doesn't support do-calculus interventions.
// We approximate by modifying edge weights from intervened nodes.
function applyAction(graph: any, action: any): any {
  const nodeMap = new Map(graph.nodes.map((n: any) => [n.id, { ...n }]));
  const interventionMap = new Map(action.do.map((d: any) => [d.node_id, d.set_to]));
  
  // Modify edges: scale weights from intervened nodes by intervention value
  const modifiedEdges = graph.edges.map((e: any) => {
    const interventionValue = interventionMap.get(e.from);
    if (interventionValue !== undefined && typeof interventionValue === 'number') {
      return { ...e, weight: (e.weight || 1) * interventionValue };
    }
    return e;
  });
  
  return {
    nodes: Array.from(nodeMap.values()),
    edges: modifiedEdges
  };
}

// Helper: Compute utility from kernel result
// runKernel returns {target, quantiles: {p10, p50, p90}, ...}
// We use p50 as the utility measure for the target node
function computeUtility(result: any, objective: any, targetNode: string): number {
  if (objective.type !== 'utility_linear') {
    return 0;
  }
  
  // If the objective weights the target node, use its p50 quantile
  const weight = objective.weights[targetNode];
  if (weight !== undefined && result.quantiles) {
    return result.quantiles.p50 * weight;
  }
  
  return 0;
}

export async function registerOptimiseRoute(app: FastifyInstance) {
  app.post('/v1/optimise', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as OptimiseRequest;
    if (!body.actions || typeof body.budget !== 'number') {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'actions and budget required' } });
    }
    
    const start = performance.now();
    const seed = body.seed || 4242;
    const actionIds = new Set<string>();
    for (const action of body.actions) {
      if (actionIds.has(action.id)) {
        return reply.code(400).send({ error: { type: 'BAD_INPUT', message: `Duplicate action id: ${action.id}` } });
      }
      actionIds.add(action.id);
      if (action.cost < 0) {
        return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'Action costs must be >= 0' } });
      }
    }
    
    // Evaluate baseline utility
    const targetNode = Object.keys(body.objective.weights)[0];
    if (!targetNode) {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'objective.weights must specify at least one node' } });
    }
    
    const baselineDAG = adaptGraphToDAG(body.graph);
    const baselineResult = runKernel(baselineDAG, targetNode, { seed });
    const baselineUtility = computeUtility(baselineResult, body.objective, targetNode);
    
    // Evaluate marginal gain for each action deterministically
    const rankedActions = body.actions.map(a => {
      const modifiedGraph = applyAction(body.graph, a);
      const modifiedDAG = adaptGraphToDAG(modifiedGraph);
      const actionResult = runKernel(modifiedDAG, targetNode, { seed });
      const actionUtility = computeUtility(actionResult, body.objective, targetNode);
      const marginalGain = actionUtility - baselineUtility;
      const efficiency = marginalGain / (a.cost || 1);
      return { ...a, marginalGain, efficiency };
    }).sort((a, b) => b.efficiency - a.efficiency);
    
    // Greedy knapsack: select actions under budget
    const selected: string[] = [];
    let spent = 0;
    let totalGain = 0;
    for (const action of rankedActions) {
      if (spent + action.cost <= body.budget) {
        selected.push(action.id);
        spent += action.cost;
        totalGain += action.marginalGain;
      }
    }
    
    const finalUtility = baselineUtility + totalGain;
    const duration_ms = Math.round(performance.now() - start);
    
    req.log.info({
      evt: 'optimise',
      id: req.id,
      route: '/v1/optimise',
      nodes: body.graph.nodes.length,
      edges: body.graph.edges.length,
      actions: body.actions.length,
      selected: selected.length,
      budget: body.budget,
      spent,
      seed,
      duration_ms
    });
    
    return reply.code(200).send({
      schema: 'optimise.v1',
      selected,
      utility: { expected: finalUtility, p10: finalUtility * 0.9, p50: finalUtility, p90: finalUtility * 1.1 },
      explanations: selected.map(id => {
        const action = rankedActions.find(a => a.id === id)!;
        return { action_id: id, marginal_gain: action.marginalGain };
      }),
      meta: { seed, solver: 'greedy_v1', baseline_utility: baselineUtility }
    });
  });
}
