/**
 * Inflight Request Tracking Plugin
 * 
 * Bullet-proof accounting: decrement exactly once per request.
 * Uses WeakSet to ensure idempotent decrement across JSON and SSE routes.
 */

import fp from 'fastify-plugin';
import { createInflight } from '../runtime/inflight.js';
import type { FastifyReply } from 'fastify';

export default fp(async (app) => {
  // Decorate with strict inflight counter (no clamping, detects underflows)
  app.decorate('inflight', createInflight());

  // Track which replies have been decremented (idempotent guard)
  const decremented = new WeakSet<FastifyReply['raw']>();

  // Helper: check if URL is a probe endpoint (excluded from accounting)
  const isProbe = (url: string): boolean => {
    return url.startsWith('/test/inflight');
  };

  // Helper: decrement exactly once
  const decrementOnce = (reply: FastifyReply, source: string) => {
    if (decremented.has(reply.raw)) return;
    decremented.add(reply.raw);
    app.inflight.dec(source);
  };

  // Global hook: increment on request start
  app.addHook('onRequest', async (req, _reply) => {
    // Exclude test probes from counting (they're observing, not part of workload)
    if (isProbe(req.url)) return;
    
    app.inflight.inc();
  });

  // Global hook: decrement on response complete (JSON routes)
  app.addHook('onResponse', async (req, reply) => {
    // Exclude test probes from counting
    if (isProbe(req.url)) return;
    
    decrementOnce(reply, 'onResponse');
  });

  // Expose decrementOnce for SSE routes to call explicitly
  app.decorate('decrementInflightOnce', decrementOnce);
}, {
  name: 'inflight-plugin',
  fastify: '5.x'
});
