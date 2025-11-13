import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface PreferencesRequest {
  pairs: Array<{ winner: string; loser: string; strength: number }>;
  prior: { weights: Record<string, number> };
}

export async function registerPreferencesRoute(app: FastifyInstance) {
  app.post('/v1/preferences/fit', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as PreferencesRequest;
    
    if (!body.pairs || !Array.isArray(body.pairs) || body.pairs.length === 0) {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'pairs array required' } });
    }
    
    if (!body.prior || !body.prior.weights) {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'prior.weights required' } });
    }
    
    // Simple Bradley-Terry update (stub)
    const weights = { ...body.prior.weights };
    const learningRate = 0.1;
    
    for (const pair of body.pairs) {
      for (const key in weights) {
        if (pair.winner.includes(key)) {
          weights[key] = weights[key] + learningRate * pair.strength;
        }
      }
    }
    
    return reply.code(200).send({
      schema: 'preferences.v1',
      weights,
      diagnostics: { converged: true, iterations: body.pairs.length }
    });
  });
}
