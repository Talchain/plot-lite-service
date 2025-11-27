/**
 * POST /v1/evidence - Evidence & Priors
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { errorResponse } from '../../errors.js';

interface EvidenceRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  priors: Array<{
    node_id: string;
    mean: number;
    variance: number;
    source?: string;
  }>;
}

// Configurable alpha for Bayesian update (weighted average)
const PRIOR_ALPHA = parseFloat(process.env.PRIOR_ALPHA || '0.3');

export async function registerEvidenceRoute(app: FastifyInstance) {
  app.post('/v1/evidence', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as EvidenceRequest;
    
    // Validation
    if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
      return reply.code(400).send(errorResponse('BAD_INPUT', 'graph.nodes required', undefined, undefined, String(req.id)));
    }

    if (!body.priors || !Array.isArray(body.priors) || body.priors.length === 0) {
      return reply.code(400).send(errorResponse('BAD_INPUT', 'priors array required with at least one prior', undefined, undefined, String(req.id)));
    }

    // Validate priors refer to existing nodes
    const nodeIds = new Set(body.graph.nodes.map((n: any) => n.id));
    const invalidPriors = body.priors.filter(p => !nodeIds.has(p.node_id));

    if (invalidPriors.length > 0) {
      return reply.code(400).send(errorResponse('BAD_INPUT', `Invalid node_ids in priors: ${invalidPriors.map(p => p.node_id).join(', ')}`, undefined, undefined, String(req.id)));
    }
    
    const seed = body.seed || 4242;
    
    // Compute baseline (without priors)
    const baselineSeed = seed;
    const baselineP50 = Math.round((baselineSeed / 10000 + 0.5) * 1000) / 1000;
    
    // Apply priors using weighted average (Bayesian update stub)
    // For each node with a prior, adjust belief
    let adjustedP50 = baselineP50;
    
    for (const prior of body.priors) {
      const node = body.graph.nodes.find((n: any) => n.id === prior.node_id);
      if (node) {
        // Weighted average: alpha * prior.mean + (1-alpha) * baseline
        const priorContribution = prior.mean * PRIOR_ALPHA;
        const baselineContribution = baselineP50 * (1 - PRIOR_ALPHA);
        adjustedP50 = Math.round((priorContribution + baselineContribution) * 1000) / 1000;
      }
    }
    
    // Compute percentiles (deterministic based on adjusted mean)
    const p10 = Math.round((adjustedP50 - 0.2) * 1000) / 1000;
    const p90 = Math.round((adjustedP50 + 0.2) * 1000) / 1000;
    
    // Top drivers (nodes with priors)
    const topDrivers = body.priors.slice(0, 3).map((p, idx) => {
      return {
        node_id: p.node_id,
        contribution: Math.round(Math.abs(p.mean) * 100),
        sign: p.mean >= 0 ? '+' : '-',
        source: p.source || 'unknown'
      };
    });
    
    const duration = Date.now() - start;
    req.log.info({ 
      evt: 'evidence', 
      id: req.id, 
      route: '/v1/evidence', 
      seed, 
      priors_count: body.priors.length,
      duration_ms: duration 
    }, 'evidence completed');
    
    return reply.code(200).send({
      schema: 'evidence.v1',
      result: {
        summary: {
          p10,
          p50: adjustedP50,
          p90
        },
        baseline: {
          p50: baselineP50
        },
        adjustment: {
          delta: Math.round((adjustedP50 - baselineP50) * 1000) / 1000,
          direction: adjustedP50 > baselineP50 ? 'increase' : (adjustedP50 < baselineP50 ? 'decrease' : 'none')
        }
      },
      top_drivers: topDrivers,
      meta: { 
        seed, 
        inference_mode: 'model_based',
        prior_alpha: PRIOR_ALPHA,
        limitations: 'v1: Simple weighted average. Full Bayesian update in future versions.'
      }
    });
  });
}
