/**
 * POST /v1/run_batch - Batch inference runs
 * P2: Semaphore-controlled parallelization for better throughput
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { recordAuditEvent } from '../../governance/audit-ring.js';
import { createHash } from 'crypto';
import { replyWithAppError } from '../../errors.js';
import { processWithConcurrency } from '../../util/semaphore.js';
import { MAX_NODES, MAX_EDGES, MAX_OPTIONS } from '../../constants/limits.js';

interface BatchItem {
  graph: { nodes: any[]; edges: any[] };
  seed?: number;
  k_samples?: number;
}

interface BatchRequest {
  items: BatchItem[];
}

const MAX_BATCH_ITEMS = MAX_OPTIONS; // Batch items limited to same as options
const MAX_NODES_PER_ITEM = MAX_NODES;
const MAX_EDGES_PER_ITEM = MAX_EDGES;

// P2: Concurrency control for batch processing
// Clamp to safe range [1, MAX_BATCH_ITEMS] and warn on invalid/capped values
const rawConcurrency = parseInt(process.env.BATCH_CONCURRENCY || '3', 10);
const BATCH_CONCURRENCY = Math.max(1, Math.min(MAX_BATCH_ITEMS, Number.isNaN(rawConcurrency) ? 3 : rawConcurrency));

if (process.env.BATCH_CONCURRENCY !== undefined) {
  if (Number.isNaN(rawConcurrency)) {
    console.warn(`[run-batch] Invalid BATCH_CONCURRENCY="${process.env.BATCH_CONCURRENCY}", using default 3`);
  } else if (rawConcurrency !== BATCH_CONCURRENCY) {
    console.warn(`[run-batch] BATCH_CONCURRENCY=${rawConcurrency} clamped to ${BATCH_CONCURRENCY} (valid range: 1-${MAX_BATCH_ITEMS})`);
  }
}

// Semaphore and concurrency processing moved to ../../util/semaphore.js

export async function registerRunBatchRoute(app: FastifyInstance) {
  app.post('/v1/run_batch', async (req: FastifyRequest, reply: FastifyReply) => {
    const start = Date.now();
    const body = req.body as BatchRequest;
    
    // Validation
    if (!body.items || !Array.isArray(body.items)) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'items array required',
        fields: { field: 'items' },
      });
    }
    
    if (body.items.length === 0) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: 'items array must not be empty',
        fields: { field: 'items' },
      });
    }
    
    if (body.items.length > MAX_BATCH_ITEMS) {
      return replyWithAppError(reply, {
        type: 'BAD_INPUT',
        statusCode: 400,
        message: `Batch size exceeds limit: ${body.items.length} > ${MAX_BATCH_ITEMS}`,
        fields: { field: 'items' },
      });
    }
    
    // Validate each item
    for (let i = 0; i < body.items.length; i++) {
      const item = body.items[i];
      
      if (!item.graph || !item.graph.nodes || !Array.isArray(item.graph.nodes)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Item ${i}: graph.nodes required`,
          fields: { field: `items[${i}].graph.nodes` },
        });
      }
      
      if (item.graph.nodes.length > MAX_NODES_PER_ITEM) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Item ${i}: nodes exceed limit (${item.graph.nodes.length} > ${MAX_NODES_PER_ITEM})`,
          fields: { field: `items[${i}].graph.nodes` },
        });
      }
      
      if (!item.graph.edges || !Array.isArray(item.graph.edges)) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Item ${i}: graph.edges required`,
          fields: { field: `items[${i}].graph.edges` },
        });
      }
      
      if (item.graph.edges.length > MAX_EDGES_PER_ITEM) {
        return replyWithAppError(reply, {
          type: 'BAD_INPUT',
          statusCode: 400,
          message: `Item ${i}: edges exceed limit (${item.graph.edges.length} > ${MAX_EDGES_PER_ITEM})`,
          fields: { field: `items[${i}].graph.edges` },
        });
      }
    }
    
    // P2: Process items with controlled concurrency for better throughput
    const results = await processWithConcurrency(
      body.items,
      BATCH_CONCURRENCY,
      async (item, idx) => {
        const seed = item.seed ?? (4242 + idx);
        const k_samples = item.k_samples ?? 1000;

        // Simplified inference (deterministic stub)
        // In production, this would call the actual inference engine
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
      }
    );
    
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
