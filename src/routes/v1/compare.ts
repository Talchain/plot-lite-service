/**
 * POST /v1/compare - Compare multiple graph options
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface CompareRequest {
  seed?: number;
  graphs: Array<{ graph: { nodes: any[]; edges: any[] }; label: string }>;
}

export async function registerCompareRoute(app: FastifyInstance) {
  app.post('/v1/compare', async (req: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const body = req.body as CompareRequest;

    // Validation
    if (!body.graphs || !Array.isArray(body.graphs)) {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'graphs array required' } });
    }

    if (body.graphs.length < 2 || body.graphs.length > 5) {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'graphs must contain 2-5 options' } });
    }

    const seed = body.seed || 4242;
    
    // Simulate evaluation (deterministic with seed)
    const options = body.graphs.map((g, idx) => {
      // Simple deterministic calculation based on seed and index
      const base = (seed + idx * 100) / 10000;
      return {
        label: g.label,
        p10: Math.round((base + 0.2) * 100) / 100,
        p50: Math.round((base + 0.9) * 100) / 100,
        p90: Math.round((base + 1.7) * 100) / 100,
        top_drivers: [
          {
            node_id: g.graph.nodes[0]?.id || 'unknown',
            node_label: g.graph.nodes[0]?.label || 'Unknown',
            sign: '+' as const,
            contribution: 55 + idx * 5
          }
        ],
        delta: idx === 0 ? { p10: 0, p50: 0, p90: 0 } : {
          p10: Math.round((base - body.graphs[0].graph.nodes.length * 0.1) * 100) / 100,
          p50: Math.round((base - body.graphs[0].graph.nodes.length * 0.1) * 100) / 100,
          p90: Math.round((base - body.graphs[0].graph.nodes.length * 0.1) * 100) / 100
        }
      };
    });
    
    req.log.info({
      evt: 'compare_end',
      id: req.id,
      route: '/v1/compare',
      seed,
      options_count: body.graphs.length,
      duration_ms: Date.now() - startTime
    });

    return reply.code(200).send({
      schema: 'compare.v1',
      baseline: body.graphs[0].label,
      options,
      seed,
      model_card_subset: {
        determinism_note: 'Results are deterministic given the same seed'
      }
    });
  });
}
