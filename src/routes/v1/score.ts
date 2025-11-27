/**
 * POST /v1/score - Option scoring with utilities/rewards
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'crypto';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { errorResponse } from '../../errors.js';

interface ScoreRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  utilities: {
    type: 'linear';
    weights: Record<string, number>;
    risk?: { attitude: 'averse' | 'neutral' | 'seeking' };
  };
}

export async function registerScoreRoute(app: FastifyInstance) {
  app.post('/v1/score', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as ScoreRequest;
    
    // Validation
    if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
      return reply.code(400).send(errorResponse('BAD_INPUT', 'graph.nodes required', undefined, undefined, String(req.id)));
    }

    if (!body.utilities || body.utilities.type !== 'linear') {
      return reply.code(400).send(errorResponse('BAD_INPUT', 'utilities.type must be "linear"', undefined, undefined, String(req.id)));
    }

    if (!body.utilities.weights || typeof body.utilities.weights !== 'object') {
      return reply.code(400).send(errorResponse('BAD_INPUT', 'utilities.weights required', undefined, undefined, String(req.id)));
    }

    // Validate weights refer to existing nodes
    const nodeIds = new Set(body.graph.nodes.map((n: any) => n.id));
    const weightKeys = Object.keys(body.utilities.weights);
    const invalidWeights = weightKeys.filter(k => !nodeIds.has(k));

    if (invalidWeights.length > 0) {
      return reply.code(400).send(errorResponse('BAD_INPUT', `Invalid node_ids in weights: ${invalidWeights.join(', ')}`, undefined, undefined, String(req.id)));
    }
    
    const seed = body.seed || 4242;
    const riskAttitude = body.utilities.risk?.attitude || 'neutral';
    
    // Deterministic scoring computation
    // For each node with a weight, compute utility based on seed-derived values
    const options = body.graph.nodes
      .filter((n: any) => body.utilities.weights[n.id] !== undefined)
      .map((node: any, idx: number) => {
        const weight = body.utilities.weights[node.id];
        const seedOffset = (seed + idx * 137) / 10000; // Deterministic offset
        
        // Compute percentiles (deterministic based on seed + weight)
        const base = weight * seedOffset;
        const p10 = Math.round((base + 0.1) * 1000) / 1000;
        const p50 = Math.round((base + 0.5) * 1000) / 1000;
        const p90 = Math.round((base + 0.9) * 1000) / 1000;
        const expected = Math.round((p10 + p50 + p90) / 3 * 1000) / 1000;
        
        return {
          node_id: node.id,
          label: node.label || node.id,
          utility: { p10, p50, p90, expected }
        };
      });
    
    // Ranking: sort by expected utility (descending), stable sort by node_id for ties
    const ranking = [...options]
      .sort((a, b) => {
        const diff = b.utility.expected - a.utility.expected;
        return diff !== 0 ? diff : a.node_id.localeCompare(b.node_id);
      })
      .map(o => o.node_id);
    
    // Top drivers (simplified: top 3 nodes by weight)
    const topDrivers = Object.entries(body.utilities.weights)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 3)
      .map(([nodeId, weight], idx) => {
        const node = body.graph.nodes.find((n: any) => n.id === nodeId);
        return {
          node_id: nodeId,
          contribution: Math.round((weight as number) * 100),
          sign: (weight as number) >= 0 ? '+' : '-'
        };
      });
    
    const duration = Date.now() - start;
    req.log.info({ 
      evt: 'score', 
      id: req.id, 
      route: '/v1/score', 
      seed, 
      options_count: options.length,
      duration_ms: duration 
    }, 'score completed');
    
    const response = {
      schema: 'score.v1',
      result: {
        options,
        ranking
      },
      top_drivers: topDrivers,
      meta: { seed, inference_mode: 'model_based' }
    };
    
    // Record audit event (no payload bodies, only hashes + meta)
    const responseHash = createHash('sha256').update(JSON.stringify(response)).digest('hex').slice(0, 16);
    recordAuditEvent({
      evt: 'score',
      route: '/v1/score',
      id: req.id,
      seed,
      inference_mode: 'model_based',
      response_hash: responseHash,
      status: 200,
      ts: new Date().toISOString()
    });
    
    return reply.code(200).send(response);
  });
}
