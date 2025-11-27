/**
 * POST /v1/run_batch - Batch inference runs
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { createHash } from 'crypto';
import { errorResponse } from '../../errors.js';

interface BatchItem {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  k_samples?: number;
}

interface BatchRequest {
  items: BatchItem[];
}

const MAX_BATCH_ITEMS = 10;
const MAX_NODES_PER_ITEM = 50;
const MAX_EDGES_PER_ITEM = 100;

export async function registerRunBatchRoute(app: FastifyInstance) {
  app.post('/v1/run_batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as BatchRequest;
    
    // Validation
    if (!body.items || !Array.isArray(body.items)) {
      return reply.code(400).send(errorResponse('BAD_INPUT', 'items array required', undefined, undefined, String(req.id)));
    }

    if (body.items.length === 0) {
      return reply.code(400).send(errorResponse('BAD_INPUT', 'items array must not be empty', undefined, undefined, String(req.id)));
    }

    if (body.items.length > MAX_BATCH_ITEMS) {
      return reply.code(400).send(errorResponse('BAD_INPUT', `Batch size exceeds limit: ${body.items.length} > ${MAX_BATCH_ITEMS}`, undefined, undefined, String(req.id)));
    }

    // Validate each item
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];

      if (!item.graph || !item.graph.nodes || !Array.isArray(item.graph.nodes)) {
        return reply.code(400).send(errorResponse('BAD_INPUT', `Item ${i}: graph.nodes required`, undefined, undefined, String(req.id)));
      }
      
      if (item.graph.nodes.length > MAX_NODES_PER_ITEM) {
        return reply.code(400).send(errorResponse('BAD_INPUT', `Item ${i}: nodes exceed limit (${item.graph.nodes.length} > ${MAX_NODES_PER_ITEM})`, undefined, undefined, String(req.id)));
      }

      if (!item.graph.edges || !Array.isArray(item.graph.edges)) {
        return reply.code(400).send(errorResponse('BAD_INPUT', `Item ${i}: graph.edges required`, undefined, undefined, String(req.id)));
      }

      if (item.graph.edges.length > MAX_EDGES_PER_ITEM) {
        return reply.code(400).send(errorResponse('BAD_INPUT', `Item ${i}: edges exceed limit (${item.graph.edges.length} > ${MAX_EDGES_PER_ITEM})`, undefined, undefined, String(req.id)));
      }
    }
    
    // Process each item deterministically
    const results = body.items.map((item, idx) => {
      const seed = item.seed ?? (4242 + idx);
      const k_samples = item.k_samples ?? 1000;
      
      // Simplified inference (deterministic stub)
      const baselineP50 = Math.round((seed / 10000 + 0.5) * 1000) / 1000;
      const p10 = Math.round((baselineP50 - 0.2) * 1000) / 1000;
      const p90 = Math.round((baselineP50 + 0.2) * 1000) / 1000;
      
      const modelCard = {
        schema: 'report.v1',
        seed,
        k_samples,
        nodes: item.graph.nodes.length,
        edges: item.graph.edges.length
      };
      
      const responseHash = createHash('sha256')
        .update(JSON.stringify({ p10, p50: baselineP50, p90, modelCard }))
        .digest('hex')
        .slice(0, 16);
      
      return {
        response_hash: responseHash,
        model_card: modelCard
      };
    });
    
    const duration = Date.now() - start;
    req.log.info({
      evt: 'run_batch',
      id: req.id,
      route: '/v1/run_batch',
      items: body.items.length,
      duration_ms: duration
    }, 'batch run completed');
    
    const response = {
      schema: 'run_batch.v1',
      results
    };
    
    // Record audit event
    const responseHash = createHash('sha256').update(JSON.stringify(response)).digest('hex').slice(0, 16);
    recordAuditEvent({
      evt: 'run_batch',
      route: '/v1/run_batch',
      id: req.id,
      seed: body.items[0]?.seed,
      inference_mode: 'model_based',
      response_hash: responseHash,
      status: 200,
      ts: new Date().toISOString()
    });
    
    return reply.code(200).send(response);
  });
}
