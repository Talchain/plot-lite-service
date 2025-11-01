import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function registerValidateRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  
  app.post('/v1/validate', {
    schema: { body: { type: 'object', required: ['graph'], properties: { graph: { type: 'object' } } } },
    attachValidation: true,
    preHandler: [createValidator('run')],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const violations: any[] = [];
    if ((req as any).validationError) {
      const err = (req as any).validationError;
      violations.push({ path: 'body', reason: err.message || 'validation_failed' });
    }
    return reply.send({ valid: violations.length === 0, violations });
  });
}
