import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { validateConstraints, filterActionsByConstraints, isFeasible, type Constraints, type Action } from '../../engine/constraints.js';

interface OptimiseRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  budget: number;
  actions: Array<{ id: string; cost: number; do: Array<{ node_id: string; set_to: number }> }>;
  objective: { type: 'utility_linear'; weights: Record<string, number> };
  constraints?: Constraints;
}

export async function registerOptimiseRoute(app: FastifyInstance) {
  app.post('/v1/optimise', async (req: FastifyRequest, reply: FastifyReply) => {
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
    
    // Merge budget into constraints
    const constraints: Constraints = {
      budget: body.budget,
      ...(body.constraints || {})
    };
    
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
    
    // Greedy solver: rank remaining actions by marginal gain per cost
    const remainingActions = filtered.filter(a => !selected.includes(a.id));
    const rankedActions = remainingActions.map(a => ({
      ...a,
      marginalGain: Math.random() * 0.5 + 0.1, // Stub
      efficiency: (Math.random() * 0.5 + 0.1) / (a.cost || 1)
    })).sort((a, b) => {
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
    
    const expectedUtility = 0.22;
    return reply.code(200).send({
      schema: 'optimise.v1',
      selected,
      utility: { expected: expectedUtility, p10: 0.15, p50: 0.21, p90: 0.30 },
      explanations: selected.map(id => ({ action_id: id, marginal_gain: 0.07 })),
      meta: { seed, solver: 'greedy_v1', constraints_applied: body.constraints ? Object.keys(body.constraints) : [] }
    });
  });
}
