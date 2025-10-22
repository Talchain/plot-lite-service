/**
 * T1: Templates Registry (read-only)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';

interface Template {
  id: string;
  name: string;
  version: number;
  description: string;
  hash: string;
  default_seed?: number;
  default_belief_mode?: string;
  graph: any;
}

// Sample templates (in production, load from DB/config)
const TEMPLATES: Template[] = [
  {
    id: 'pricing-change-v1',
    name: 'Pricing Change Analysis',
    version: 1,
    description: 'Analyze impact of price changes on demand and revenue',
    hash: createHash('sha256').update('pricing-v1').digest('hex').slice(0, 16),
    default_seed: 4242,
    graph: {
      nodes: [
        { id: 'price', kind: 'input', label: 'Price' },
        { id: 'demand', kind: 'intermediate', label: 'Demand' },
        { id: 'revenue', kind: 'output', label: 'Revenue' }
      ],
      edges: [
        { source: 'price', target: 'demand' },
        { source: 'demand', target: 'revenue' }
      ]
    }
  }
];

const TEMPLATES_MAP = new Map(TEMPLATES.map(t => [t.id, t]));
const LIST_ETAG = `"${createHash('sha256').update(JSON.stringify(TEMPLATES.map(t => t.id))).digest('hex').slice(0, 16)}"`;

export default async function templatesRoute(fastify: FastifyInstance) {
  // GET /v1/templates - list all
  fastify.get('/v1/templates', async (request: FastifyRequest, reply: FastifyReply) => {
    const clientETag = request.headers['if-none-match'];
    
    if (clientETag === LIST_ETAG) {
      return reply.code(304).send();
    }
    
    reply.header('ETag', LIST_ETAG);
    reply.header('Cache-Control', 'max-age=60, must-revalidate');
    
    const list = TEMPLATES.map(({ graph, ...meta }) => meta);
    return reply.send(list);
  });
  
  // GET /v1/templates/:id - get specific template
  fastify.get<{ Params: { id: string } }>('/v1/templates/:id', async (request, reply) => {
    const template = TEMPLATES_MAP.get(request.params.id);
    
    if (!template) {
      return reply.code(404).send({ error: 'Template not found' });
    }
    
    const templateETag = `"${template.hash}"`;
    const clientETag = request.headers['if-none-match'];
    
    if (clientETag === templateETag) {
      return reply.code(304).send();
    }
    
    reply.header('ETag', templateETag);
    reply.header('Cache-Control', 'max-age=60, must-revalidate');
    
    return reply.send(template);
  });
}
