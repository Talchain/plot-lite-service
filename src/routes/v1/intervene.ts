/**
 * POST /v1/intervene - Causal interventions (do-operator)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';

interface InterveneRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  do: Array<{ node_id: string; set_to: number }>;
}

export async function registerInterveneRoute(app: FastifyInstance) {
  app.post('/v1/intervene', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as InterveneRequest;
    
    // Validation
    if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
      return reply.code(400).send({ error: { type: 'BAD_INPUT', message: 'graph.nodes required' } });
    }
    
    if (!body.do || !Array.isArray(body.do) || body.do.length === 0) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: 'do array required with at least one intervention',
          field: 'do'
        } 
      });
    }
    
    // Validate interventions refer to existing nodes
    const nodeIds = new Set(body.graph.nodes.map((n: any) => n.id));
    const invalidDos = body.do.filter(d => !nodeIds.has(d.node_id));
    
    if (invalidDos.length > 0) {
      return reply.code(400).send({ 
        error: { 
          type: 'BAD_INPUT', 
          message: `Invalid node_ids in do: ${invalidDos.map(d => d.node_id).join(', ')}`,
          field: 'do[].node_id'
        } 
      });
    }
    
    const seed = body.seed || 4242;
    
    // Check identifiability (simplified: always identifiable for now)
    // In a real implementation, this would check for confounders, backdoor paths, etc.
    const isIdentifiable = true;
    
    if (!isIdentifiable) {
      return reply.code(400).send({
        error: {
          type: 'NOT_IDENTIFIABLE',
          message: 'Causal effect not identifiable: confounders detected'
        }
      });
    }
    
    // Compute baseline (no intervention)
    const baselineSeed = seed;
    const baselineP50 = Math.round((baselineSeed / 10000 + 0.5) * 1000) / 1000;
    const baselineP10 = Math.round(baselineP50 * 0.85 * 1000) / 1000;
    const baselineP90 = Math.round(baselineP50 * 1.15 * 1000) / 1000;
    
    // Compute counterfactual (with intervention)
    // Effect is deterministic based on seed + intervention values
    const interventionEffect = body.do.reduce((sum, d) => sum + d.set_to, 0) / body.do.length;
    const counterfactualP50 = Math.round((baselineP50 + interventionEffect * 0.15) * 1000) / 1000;
    const counterfactualP10 = Math.round(counterfactualP50 * 0.85 * 1000) / 1000;
    const counterfactualP90 = Math.round(counterfactualP50 * 1.15 * 1000) / 1000;
    
    // Compute delta
    const deltaP50 = Math.round((counterfactualP50 - baselineP50) * 1000) / 1000;
    const deltaP10 = Math.round((counterfactualP10 - baselineP10) * 1000) / 1000;
    const deltaP90 = Math.round((counterfactualP90 - baselineP90) * 1000) / 1000;
    
    // Top drivers (nodes being intervened on)
    const topDrivers = body.do.slice(0, 3).map((d, idx) => {
      const node = body.graph.nodes.find((n: any) => n.id === d.node_id);
      return {
        node_id: d.node_id,
        contribution: Math.round(Math.abs(d.set_to) * 100),
        sign: d.set_to >= 0 ? '+' : '-'
      };
    });
    
    // Compute actions_hash (deterministic based on do array + seed, order-independent)
    const sortedActions = body.do
      .map(d => ({ node_id: d.node_id, value: d.set_to }))
      .sort((a, b) => a.node_id.localeCompare(b.node_id));
    const actionsString = JSON.stringify(sortedActions) + seed;
    const actionsHash = createHash('sha256').update(actionsString).digest('hex').substring(0, 16);
    
    // Compute response_hash (deterministic based on all outputs + seed)
    const responseString = JSON.stringify({
      baseline: { p10: baselineP10, p50: baselineP50, p90: baselineP90 },
      counterfactual: { p10: counterfactualP10, p50: counterfactualP50, p90: counterfactualP90 },
      delta: { p10: deltaP10, p50: deltaP50, p90: deltaP90 },
      seed
    });
    const responseHash = createHash('sha256').update(responseString).digest('hex').substring(0, 16);
    
    // Get flags_on from environment
    const flagsOn: string[] = [];
    if (process.env.SCM_LITE_ENABLE === '1') flagsOn.push('scm_lite');
    if (process.env.ADAPTIVE_K_ENABLE === '1') flagsOn.push('adaptive_k');
    
    const duration = Date.now() - start;
    req.log.info({ 
      evt: 'intervene', 
      id: req.id, 
      route: '/v1/intervene', 
      seed, 
      dos: body.do.length,
      duration_ms: duration 
    }, 'intervene completed');
    
    // Add backend header
    reply.header('X-Olumi-Backend', 'fallback');
    
    return reply.code(200).send({
      schema: 'intervene.v1',
      response_hash: responseHash,
      baseline: {
        summary: { p10: baselineP10, p50: baselineP50, p90: baselineP90 }
      },
      counterfactual: {
        summary: { p10: counterfactualP10, p50: counterfactualP50, p90: counterfactualP90 }
      },
      delta: {
        p10: deltaP10,
        p50: deltaP50,
        p90: deltaP90
      },
      explain: {
        provenance: 'do-operator',
        top_drivers: topDrivers
      },
      model_card: {
        schema: 'model_card.v1',
        timestamp: new Date().toISOString(),
        seed,
        backend: 'fallback',
        actions_hash: actionsHash,
        ...(flagsOn.length > 0 && { flags_on: flagsOn })
      },
      meta: { seed, inference_mode: 'model_based' }
    });
  });
}
