/**
 * L1: /v1/limits endpoint with ETag support
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';

const LIMITS = {
  max_nodes: 12,
  max_edges: 20,
  version: 1
};

// Compute ETag once at startup
const LIMITS_JSON = JSON.stringify(LIMITS);
const LIMITS_ETAG = `"${createHash('sha256').update(LIMITS_JSON).digest('hex').slice(0, 16)}"`;

export default async function limitsRoute(fastify: FastifyInstance) {
  fastify.get('/v1/limits', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            max_nodes: { type: 'number' },
            max_edges: { type: 'number' },
            version: { type: 'number' }
          },
          required: ['max_nodes', 'max_edges']
        }
      }
    },
    onSend: async (request, reply, payload) => {
      // Override security middleware's Cache-Control for this endpoint
      reply.header('Cache-Control', 'max-age=60, must-revalidate');
      return payload;
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Check If-None-Match
    const clientETag = request.headers['if-none-match'];
    
    if (clientETag === LIMITS_ETAG) {
      reply.header('ETag', LIMITS_ETAG);
      return reply.code(304).send();
    }
    
    // Send with caching headers
    reply.header('ETag', LIMITS_ETAG);
    
    return reply.send(LIMITS);
  });
}
