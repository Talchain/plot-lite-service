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
    // Normalize graph at ingress
    if (body.graph) {
      body.graph = normalizeGraph(body.graph);
    }
    
    const violations: any[] = [];
    if ((req as any).validationError) {
      const err = (req as any).validationError;
      violations.push({ path: 'body', reason: err.message || 'validation_failed' });
    }
    return reply.send({ valid: violations.length === 0, violations });
  });
}
