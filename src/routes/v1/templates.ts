import type { FastifyInstance } from 'fastify';

type Graph = { nodes: any[]; edges: any[] };
const UPDATED_AT = '2025-01-01T00:00:00.000Z';

const graphs: Record<string, Graph> = {
  small: {
    nodes: [ { id: 'A', label: 'A' }, { id: 'B', label: 'B' } ],
    edges: [ { from: 'A', to: 'B', label: 'A->B' } ]
  },
  medium: {
    nodes: [
      { id: 'Price', label: 'Price' },
      { id: 'Demand', label: 'Demand' },
      { id: 'Revenue', label: 'Revenue' },
      { id: 'Marketing', label: 'Marketing' }
    ],
    edges: [
      { from: 'Price', to: 'Demand' },
      { from: 'Demand', to: 'Revenue' },
      { from: 'Marketing', to: 'Demand' }
    ]
  },
  edge: {
    nodes: [ { id: 'X', label: 'Baseline Near Zero' }, { id: 'Y', label: 'Output' } ],
    edges: [ { from: 'X', to: 'Y' } ]
  }
};

const catalog = [
  { id: 'small', label: 'Small Demo', summary: 'Minimal A→B graph', updated_at: UPDATED_AT },
  { id: 'medium', label: 'Medium Demo', summary: 'Price→Demand→Revenue (+Marketing)', updated_at: UPDATED_AT },
  { id: 'edge', label: 'Edge Case', summary: 'Near-zero baseline', updated_at: UPDATED_AT },
];

export async function registerTemplatesRoutes(app: FastifyInstance) {
  app.get('/v1/templates', async (_req, reply) => {
    reply.header('Content-Type', 'application/json');
    reply.header('Cache-Control', 'no-cache');
    return catalog;
  });

  app.get('/v1/templates/:id/graph', async (req: any, reply) => {
    const id = String(req.params?.id || '');
    const g = (graphs as any)[id];
    if (!g) {
      return reply.code(404).send({ schema: 'error.v1', code: 'NOT_FOUND', message: `Template '${id}' not found` });
    }
    reply.header('Content-Type', 'application/json');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Last-Modified', UPDATED_AT);
    return g;
  });
}
