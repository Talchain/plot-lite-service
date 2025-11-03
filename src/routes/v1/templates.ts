import type { FastifyInstance } from 'fastify';
import { canonicalStringify, sha256Hex } from '../../util/canonical.js';

type Graph = { 
  version?: string;
  default_seed?: number;
  nodes: any[]; 
  edges: any[];
  meta?: { roots?: string[]; leaves?: string[]; suggested_positions?: Record<string, {x: number; y: number}> };
};
const UPDATED_AT = '2025-01-01T00:00:00.000Z';

const graphs: Record<string, Graph> = {
  small: {
    version: '1.2',
    default_seed: 4242,
    nodes: [ 
      { id: 'A', label: 'A', kind: 'option' }, 
      { id: 'B', label: 'B', kind: 'outcome', utility: 0.5 } 
    ],
    edges: [ 
      { from: 'A', to: 'B', label: 'A->B', weight: 0.7, belief: 0.85, provenance: 'template' } 
    ],
    meta: { roots: ['A'], leaves: ['B'] }
  },
  medium: {
    version: '1.2',
    default_seed: 4242,
    nodes: [
      { id: 'Price', label: 'Price', kind: 'decision', body: 'Set product price' },
      { id: 'Demand', label: 'Demand', kind: 'option', prior: 0.5 },
      { id: 'Revenue', label: 'Revenue', kind: 'outcome', utility: 0.7 },
      { id: 'Marketing', label: 'Marketing', kind: 'option', prior: 0.3 }
    ],
    edges: [
      { from: 'Price', to: 'Demand', weight: 0.6, belief: 0.8, provenance: 'template' },
      { from: 'Demand', to: 'Revenue', weight: 0.8, belief: 0.9, provenance: 'template' },
      { from: 'Marketing', to: 'Demand', weight: 0.4, belief: 0.7, provenance: 'assumption' }
    ],
    meta: { roots: ['Price', 'Marketing'], leaves: ['Revenue'] }
  },
  edge: {
    version: '1.2',
    default_seed: 4242,
    nodes: [ 
      { id: 'X', label: 'Baseline Near Zero', kind: 'option' }, 
      { id: 'Y', label: 'Output', kind: 'outcome', utility: 0.0 } 
    ],
    edges: [ 
      { from: 'X', to: 'Y', weight: 0.01, belief: 1.0, provenance: 'template' } 
    ],
    meta: { roots: ['X'], leaves: ['Y'] }
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
    // Strong ETag over canonical JSON
    const canonical = canonicalStringify(g);
    const etag = '"' + sha256Hex(canonical) + '"';
    const inm = String(req.headers['if-none-match'] || '');
    reply.header('Content-Type', 'application/json');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Last-Modified', UPDATED_AT);
    reply.header('Vary', 'If-None-Match');
    reply.header('ETag', etag);
    if (inm && inm === etag) {
      return reply.code(304).send();
    }
    return g;
  });
}
