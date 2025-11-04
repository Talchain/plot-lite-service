import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { normalizeGraph } from '../../util/normalize.js';

export async function registerValidateRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  
  app.post('/v1/validate', {
    schema: { body: { type: 'object', required: ['graph'], properties: { graph: { type: 'object' } } } },
    attachValidation: true,
    preHandler: [createValidator('run')],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req as any).body || {};
    if (body.graph) {
      body.graph = normalizeGraph(body.graph, false);
    }
    
    const violations: any[] = [];
    if ((req as any).validationError) {
      const err = (req as any).validationError;
      violations.push({ path: 'body', reason: err.message || 'validation_failed' });
    }
    
    // Check outcome edges for missing belief (non-fatal warning)
    if (body.graph?.nodes && body.graph?.edges) {
      const outcomes = new Set(body.graph.nodes.filter((n: any) => n.kind === 'outcome').map((n: any) => n.id));
      body.graph.edges.forEach((e: any) => {
        if (outcomes.has(e.to) && e.belief === undefined) {
          violations.push({ code: 'MISSING_BELIEF_ON_OUTCOME_EDGE', severity: 'warning', at: { from: e.from, to: e.to } });
        }
      });
    }
    
    return reply.send({ valid: violations.length === 0, violations });
  });
}
