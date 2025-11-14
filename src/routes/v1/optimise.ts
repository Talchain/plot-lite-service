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
function applyAction(graph: any, action: any): any {
  const nodeMap = new Map(graph.nodes.map((n: any) => [n.id, { ...n }]));
  
  for (const intervention of action.do) {
    const node: any = nodeMap.get(intervention.node_id);
    if (node) {
      node.value = intervention.set_to;
    }
  }
  
  return {
    nodes: Array.from(nodeMap.values()),
    edges: graph.edges
  };
}

// Helper: Compute utility from kernel result
function computeUtility(result: any, objective: any): number {
  if (objective.type !== 'utility_linear') {
    return 0;
  }
  
  let utility = 0;
  for (const [nodeId, weight] of Object.entries(objective.weights)) {
    const nodeResult = result.nodes?.find((n: any) => n.id === nodeId);
    if (nodeResult) {
      utility += (nodeResult.belief || 0) * (weight as number);
    }
  }
  return utility;
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
    const baselineDAG = adaptGraphToDAG(body.graph);
    const baselineResult = runKernel(baselineDAG, Object.keys(body.objective.weights)[0] || 'target', { seed });
    const baselineUtility = computeUtility(baselineResult, body.objective);
    
    // Evaluate marginal gain for each action deterministically
    const rankedActions = body.actions.map(a => {
      const modifiedGraph = applyAction(body.graph, a);
      const modifiedDAG = adaptGraphToDAG(modifiedGraph);
      const actionResult = runKernel(modifiedDAG, Object.keys(body.objective.weights)[0] || 'target', { seed });
      const actionUtility = computeUtility(actionResult, body.objective);
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
