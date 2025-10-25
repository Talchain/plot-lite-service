/**
 * POST /v1/run - Execute probabilistic model with trust signals
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { isDemoMode, getDemoSeed } from '../../middleware/demo-mode.js';
import { getDemoRunResponse } from '../../fixtures/demo-payloads.js';
import type { Graph } from '../../trust/types.js';
import { recordEngineComputeMs } from '../../metrics.js';
import { runResponseSchema } from '../../schemas/response.js';
import { executeRun } from '../../lib/executeRun.js';

export interface RunRequest {
  graph: Graph;
  seed?: number;
  k_samples?: number;
  treatment_node?: string;
  outcome_node?: string;
  baseline_value?: number;
}

export async function registerRunRoute(app: FastifyInstance) {
  const { createValidator } = await import('../../middleware/input-validation.js');
  const { principalFor, getCached, setCached, pruneExpired } = await import('../../middleware/idempotency.js');
  
  app.post('/v1/run', {
    schema: {
      body: {
        type: 'object',
        required: ['graph'],
        properties: {
          graph: { type: 'object' },
          seed: { type: 'number' },
          k_samples: { type: 'number' },
          treatment_node: { type: 'string' },
          outcome_node: { type: 'string' },
          baseline_value: { type: 'number' },
          query: { type: 'object' }
        },
        additionalProperties: true
      },
      response: { 200: runResponseSchema }
    },
    attachValidation: true,
    bodyLimit: 96 * 1024,
    preHandler: [
      async (req: FastifyRequest, reply: FastifyReply) => {
        // Demo mode short-circuit (before validation check)
        if (isDemoMode(req)) {
          const demo_seed = getDemoSeed(req);
          const payload = getDemoRunResponse(demo_seed) as any;
          if (process.env.TRACE_MIN === '1') {
            try { payload.trace_id = randomUUID(); } catch {}
          }
          return reply.code(200).type('application/json').send(payload);
        }
        // Check validation errors (only for non-demo requests)
        if ((req as any).validationError) {
          const err = (req as any).validationError;
          throw err;  // Let global error handler format it
        }
      },
      // Idempotency replay (before validation)
      async (req: FastifyRequest, reply: FastifyReply) => {
        try { if (Math.random() < 0.01) pruneExpired(); } catch {}
        const idk = String((req.headers as any)['idempotency-key'] || (req.headers as any)['Idempotency-Key'] || '').trim();
        if (!idk) return;
        const principal = principalFor(req);
        const hit = getCached(principal, idk);
        if (hit) {
          try { reply.header('Idempotent-Replayed', '1'); } catch {}
          return reply.code(hit.status).type('application/json').send(hit.body);
        }
        // Mark for onSend storage
        (req as any).__idemp = { principal, idk };
      },
      createValidator('run'),
    ],
    onSend: [
      async (req: FastifyRequest, reply: FastifyReply, payload: any) => {
        try {
          const marker = (req as any).__idemp;
          if (!marker) return payload;
          // Only store JSON bodies
          let body: any = payload;
          if (typeof payload === 'string') {
            try { body = JSON.parse(payload); } catch { body = null; }
          }
          if (body && typeof body === 'object') {
            const status = reply.statusCode || 200;
            setCached(marker.principal, marker.idk, status, body);
            try { reply.header('Idempotent-Replayed', '0'); } catch {}
          }
          return payload;
        } catch {
          return payload;
        }
      },
    ],
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    // (demo handled in preHandler)
    const body = (req as any).body as RunRequest;
    try {
      const { report, computeMs } = await executeRun(body, {});
      recordEngineComputeMs(computeMs);
      return report;
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.includes('exceeds max nodes') || msg.includes('exceeds max edges')) {
        return reply.code(400).send({ schema: 'error.v1', code: 'SCOPE_LIMIT', message: msg });
      }
      throw err;
    }
  });
}
