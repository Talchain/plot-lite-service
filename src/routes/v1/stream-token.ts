/**
 * POST /v1/stream/token - Issue short-lived stream tokens
 */
import type { FastifyInstance } from 'fastify';
import { issueStreamToken } from '../../lib/stream-token.js';
import { incStreamTokenIssued } from '../../observability/streamMetrics.js';

export async function registerStreamTokenRoute(app: FastifyInstance) {
  app.post('/v1/stream/token', async (req, reply) => {
    const audience = 'stream';
    
    try {
      const tokenData = issueStreamToken(audience);
      
      // Metrics
      incStreamTokenIssued(audience);
      
      return reply.code(200).send(tokenData);
    } catch (err) {
      req.log.error({ err }, 'stream token issuance failed');
      return reply.code(500).send({
        schema: 'error.v1',
        code: 'SERVER_ERROR',
        message: 'Failed to issue token'
      });
    }
  });
}
