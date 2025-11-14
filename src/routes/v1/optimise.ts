import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { validateConstraints, filterActionsByConstraints, isFeasible, type Constraints, type Action } from '../../engine/constraints.js';
import { runKernel } from '../../scm-lite/kernel.js';
import { adaptGraphToDAG } from '../../scm-lite/adapter.js';

interface OptimiseRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  budget: number;
  actions: Array<{ id: string; cost: number; do: Array<{ node_id: string; set_to: number }> }>;
  objective: { type: 'utility_linear'; weights: Record<string, number> };
  constraints?: Constraints;
}

// Helper: Apply action interventions to graph by scaling edge weights
function applyAction(graph: any, action: any): any {
  const nodeMap = new Map(graph.nodes.map((n: any) => [n.id, { ...n }]));
  const interventionMap = new Map(action.do.map((d: any) => [d.node_id, d.set_to]));
  
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

// Helper: Compute utility from kernel result using p50 quantile
function computeUtility(result: any, objective: any, targetNode: string): number {
  if (objective.type !== 'utility_linear') {
    return 0;
  }
  
  const weight = objective.weights[targetNode];
  if (weight !== undefined && result.quantiles) {
    return result.quantiles.p50 * weight;
  }
  
  return 0;
}

export async function registerOptimiseRoute(app: FastifyInstance) {
  app.post('/v1/optimise', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as OptimiseRequest;
    if (!body.actions || typeof body.budget !== 'number') {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'actions and budget required' } });
    }
    
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
    
    // Enforce top-level budget precedence
    const incoming = body.constraints ?? {};
    const constraints: Constraints = { ...incoming, budget: body.budget };
    if (typeof (incoming as any).budget === 'number' && (incoming as any).budget !== body.budget) {
      req.log.warn({
        evt: 'constraints_budget_overridden',
        id: req.id,
        request_budget: body.budget,
        constraints_budget: (incoming as any).budget
      }, 'Nested constraints.budget ignored; using top-level budget');
    }
    
    // Check feasibility
    const { feasible, violations: feasibilityViolations } = isFeasible(body.actions as Action[], constraints);
    if (!feasible) {
      return reply.code(400).send({
        error: {
          schema: 'error.v1',
          code: 'INFEASIBLE',
          message: 'Constraints cannot be satisfied',
          violations: feasibilityViolations
        }
      });
    }
    
    // Filter actions by constraints
    const { filtered, violations: filterViolations } = filterActionsByConstraints(body.actions as Action[], constraints);
    if (filterViolations.length > 0) {
      return reply.code(400).send({
        error: {
          schema: 'error.v1',
          code: 'INFEASIBLE',
          message: 'Constraints cannot be satisfied',
          violations: filterViolations
        }
      });
    }
    
    // Start with must actions
    const mustActions = constraints.must 
      ? filtered.filter(a => constraints.must!.includes(a.id))
      : [];
    let spent = mustActions.reduce((sum, a) => sum + a.cost, 0);
    const selected: string[] = mustActions.map(a => a.id);
    
    // Deterministic solver: compute marginal gain for each action using kernel
    const remainingActions = filtered.filter(a => !selected.includes(a.id));
    
    // Get target nodes from objective weights
    const targetNodes = Object.keys(body.objective.weights);
    if (targetNodes.length === 0) {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'objective.weights must specify at least one target node' } });
    }
    const targetNode = targetNodes[0]; // Use first weighted node as primary target
    
    // Compute baseline utility (no actions)
    let baselineUtility = 0;
    try {
      const dag = adaptGraphToDAG(body.graph);
      const baseResult = runKernel(dag, targetNode, { seed });
      baselineUtility = computeUtility(baseResult, body.objective, targetNode);
    } catch (err) {
      // If kernel fails, log but continue with zero baseline
      req.log.warn({ evt: 'optimise_baseline_failed', error: String(err) });
    }
    
    // Compute marginal gain for each remaining action
    const rankedActions = remainingActions.map(a => {
      let marginalGain = 0;
      try {
        const modifiedGraph = applyAction(body.graph, a);
        const dag = adaptGraphToDAG(modifiedGraph);
        const result = runKernel(dag, targetNode, { seed });
        const actionUtility = computeUtility(result, body.objective, targetNode);
        marginalGain = actionUtility - baselineUtility;
      } catch (err) {
        req.log.warn({ evt: 'optimise_action_eval_failed', action_id: a.id, error: String(err) });
      }
      
      return {
        ...a,
        marginalGain,
        efficiency: marginalGain / (a.cost || 1)
      };
    }).sort((a, b) => {
      // Deterministic tie-breaking by id
      if (Math.abs(b.efficiency - a.efficiency) < 0.0001) {
        return a.id.localeCompare(b.id);
      }
      return b.efficiency - a.efficiency;
    });
    
    // Add actions greedily
    for (const action of rankedActions) {
      if (spent + action.cost <= constraints.budget!) {
        selected.push(action.id);
        spent += action.cost;
      }
    }
    
    // Validate final selection against constraints
    const selectedActions = body.actions.filter(a => selected.includes(a.id)) as Action[];
    const finalViolations = validateConstraints(selectedActions, body.actions as Action[], constraints);
    if (finalViolations.length > 0) {
      return reply.code(400).send({
        error: {
          schema: 'error.v1',
          code: 'INFEASIBLE',
          message: 'Selected actions violate constraints',
          violations: finalViolations
        }
      });
    }
    
    // Compute final utility with selected actions
    let finalUtility = baselineUtility;
    const explanations: Array<{ action_id: string; marginal_gain: number }> = [];
    
    for (const actionId of selected) {
      const action = body.actions.find(a => a.id === actionId);
      if (action) {
        const rankedAction = rankedActions.find(ra => ra.id === actionId);
        const marginalGain = rankedAction?.marginalGain || 0;
        finalUtility += marginalGain;
        explanations.push({ action_id: actionId, marginal_gain: marginalGain });
      }
    }
    
    // Structured logging
    const duration = Date.now() - start;
    req.log.info({
      evt: 'optimise_complete',
      id: req.id,
      route: '/v1/optimise',
      duration_ms: duration,
      nodes: body.graph.nodes.length,
      edges: body.graph.edges.length,
      actions_evaluated: body.actions.length,
      actions_selected: selected.length,
      budget_spent: spent,
      budget_total: body.budget,
      utility_baseline: baselineUtility,
      utility_final: finalUtility,
      seed,
      constraints_applied: body.constraints ? Object.keys(body.constraints).filter(k => k !== 'budget') : []
    });
    
    return reply.code(200).send({
      schema: 'optimise.v1',
      selected,
      utility: { expected: finalUtility, p10: finalUtility * 0.9, p50: finalUtility, p90: finalUtility * 1.1 },
      explanations,
      meta: { seed, solver: 'greedy_kernel_v1', constraints_applied: body.constraints ? Object.keys(body.constraints).filter(k => k !== 'budget') : [] }
    });
  });
}
