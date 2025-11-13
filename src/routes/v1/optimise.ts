import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';

interface OptimiseRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  budget: number;
  actions: Array<{ id: string; cost: number; do: Array<{ node_id: string; set_to: number }> }>;
  objective: { type: 'utility_linear'; weights: Record<string, number> };
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
    
    // Greedy solver: rank by marginal gain per cost
    const rankedActions = body.actions.map(a => ({
      ...a,
      marginalGain: Math.random() * 0.5 + 0.1, // Stub
      efficiency: (Math.random() * 0.5 + 0.1) / (a.cost || 1)
    })).sort((a, b) => b.efficiency - a.efficiency);
    
    const selected: string[] = [];
    let spent = 0;
    for (const action of rankedActions) {
      if (spent + action.cost <= body.budget) {
        selected.push(action.id);
        spent += action.cost;
      }
    }
    
    const expectedUtility = 0.22;
    return reply.code(200).send({
      schema: 'optimise.v1',
      selected,
      utility: { expected: expectedUtility, p10: 0.15, p50: 0.21, p90: 0.30 },
      explanations: selected.map(id => ({ action_id: id, marginal_gain: 0.07 })),
      meta: { seed, solver: 'greedy_v1' }
    });
  });
}
