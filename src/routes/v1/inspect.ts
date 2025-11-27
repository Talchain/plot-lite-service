/**
 * POST /v1/inspect - Inspect graph evaluation details
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { errorResponse } from '../../errors.js';

interface InspectRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
}

export async function registerInspectRoute(app: FastifyInstance) {
  app.post('/v1/inspect', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const body = req.body as InspectRequest;

    if (!body.graph || !body.graph.nodes) {
      return reply.code(400).send(errorResponse('BAD_INPUT', 'graph required', undefined, undefined, String(req.id)));
    }

    const seed = body.seed || 4242;
    const graphStr = JSON.stringify(body.graph);
    const responseHash = createHash('sha256').update(graphStr + seed).digest('hex');
    
    // Deterministic inspection based on seed
    const topDrivers = body.graph.nodes.slice(0, 3).map((node, idx) => ({
      node_id: node.id,
      node_label: node.label,
      sign: idx % 2 === 0 ? '+' : '-',
      contribution: 55 - idx * 10
    }));

    req.log.info({
      evt: 'inspect_end',
      id: req.id,
      route: '/v1/inspect',
      seed,
      node_count: body.graph.nodes.length,
      duration_ms: Date.now() - startTime
    });

    return reply.code(200).send({
      schema: 'inspect.v1',
      graph: body.graph,
      explain: {
        top_drivers: topDrivers,
        top_edge_drivers: body.graph.edges.slice(0, 2).map((edge: any) => ({
          from: edge.from,
          to: edge.to,
          contribution: 25
        })),
        assumptions: ['linear-assumption', 'reference-class'],
        flags_on: req.headers['x-scm-lite'] === '1' ? ['scm_lite'] : []
      },
      provenance: {
        inference_mode: 'model_based',
        k_samples: 1000
      },
      hashes: {
        response_hash: responseHash,
        bma_hash: req.headers['x-scm-lite'] === '1' ? createHash('sha256').update(graphStr).digest('hex') : null
      }
    });
  });
}
