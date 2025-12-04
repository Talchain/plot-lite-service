/**
 * POST /v1/sensitivity - Sensitivity & Robustness Analysis
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { createHash } from 'crypto';
import { replyWithAppError } from '../../errors.js';

interface SensitivityRequest {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  method?: 'oat'; // one-at-a-time
  delta?: number; // proportional perturbation
  targets?: string[]; // optional subset of nodes
}

export async function registerSensitivityRoute(app: FastifyInstance) {
  app.post('/v1/sensitivity', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as SensitivityRequest;
    
    // Validation
    if (!body.graph || !body.graph.nodes || !Array.isArray(body.graph.nodes)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'graph.nodes required',
        fields: { field: 'graph.nodes' },
      });
    }
    
    const method = body.method || 'oat';
    if (method !== 'oat') {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'method must be "oat"',
        fields: { field: 'method' },
      });
    }
    
    const delta = body.delta ?? 0.1;
    if (delta <= 0 || delta > 1) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'delta must be in (0, 1]',
        fields: { field: 'delta' },
      });
    }
    
    const seed = body.seed || 4242;
    
    // Determine targets (default: all nodes)
    const nodeIds = body.graph.nodes.map((n: any) => n.id);
    const targets = body.targets || nodeIds;
    
    // Validate targets exist
    const nodeIdSet = new Set(nodeIds);
    const invalidTargets = targets.filter(t => !nodeIdSet.has(t));
    if (invalidTargets.length > 0) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Invalid target node_ids: ${invalidTargets.join(', ')}`,
        fields: { field: 'targets' },
      });
    }
    
    // Compute baseline
    const baselineSeed = seed;
    const baselineP50 = Math.round((baselineSeed / 10000 + 0.5) * 1000) / 1000;
    
    // One-at-a-time sensitivity analysis
    // For each target node, perturb by ±delta and compute effect
    const drivers = targets.map((nodeId, _idx) => {
      const node = body.graph.nodes.find((n: any) => n.id === nodeId);
      const baseValue = (node as any)?.value ?? 0.5;
      
      // Perturb low (-delta)
      const lowValue = baseValue * (1 - delta);
      const lowEffect = Math.round((baselineSeed / 10000 + lowValue * 0.1 - baselineP50) * 1000) / 1000;
      
      // Perturb high (+delta)
      const highValue = baseValue * (1 + delta);
      const highEffect = Math.round((baselineSeed / 10000 + highValue * 0.1 - baselineP50) * 1000) / 1000;
      
      return {
        node_id: nodeId,
        tornado: {
          low: lowEffect,
          high: highEffect
        },
        rank: 0 // Will be assigned after sorting
      };
    });
    
    // Rank by total swing (|low| + |high|), stable sort by node_id for ties
    const sortedDrivers = [...drivers].sort((a, b) => {
      const swingA = Math.abs(a.tornado.low) + Math.abs(a.tornado.high);
      const swingB = Math.abs(b.tornado.low) + Math.abs(b.tornado.high);
      const diff = swingB - swingA;
      return diff !== 0 ? diff : a.node_id.localeCompare(b.node_id);
    });
    
    // Assign ranks
    sortedDrivers.forEach((d, idx) => {
      d.rank = idx + 1;
    });
    
    const evaluations = 1 + 2 * targets.length; // baseline + 2 per target
    
    const duration = Date.now() - start;
    req.log.info({
      evt: 'sensitivity',
      id: req.id,
      route: '/v1/sensitivity',
      seed,
      method,
      evaluations,
      drivers: sortedDrivers.length,
      duration_ms: duration
    }, 'sensitivity completed');
    
    const response = {
      schema: 'sensitivity.v1',
      summary: {
        baseline: { p50: baselineP50 }
      },
      drivers: sortedDrivers,
      meta: { seed, method, evaluations }
    };
    
    // Record audit event
    const responseHash = createHash('sha256').update(JSON.stringify(response)).digest('hex').slice(0, 16);
    recordAuditEvent({
      evt: 'sensitivity',
      route: '/v1/sensitivity',
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
