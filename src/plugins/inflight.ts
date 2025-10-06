/**
 * Inflight Request Tracking Plugin
 * 
 * Self-contained plugin that decorates Fastify with strict inflight counter
 * and registers global hooks for request/response lifecycle tracking.
 * 
 * Works in all entry points: main.ts, test harnesses, tools.
 * No side effects - pure plugin export.
 */

import fp from 'fastify-plugin';
import { createInflight } from '../runtime/inflight.js';

export default fp(async (app) => {
  // Decorate with strict inflight counter (no clamping, detects underflows)
  app.decorate('inflight', createInflight());

  // Helper: check if URL is a probe endpoint (excluded from accounting)
  const isProbe = (url: string): boolean => {
    return url.startsWith('/test/inflight');
  };

  // Global hook: increment on request start
  app.addHook('onRequest', async (req, _reply) => {
    // Exclude test probes from counting (they're observing, not part of workload)
    if (isProbe(req.url)) return;
    
    app.inflight.inc();
  });

  // Global hook: decrement on response complete
  app.addHook('onResponse', async (req, reply) => {
    // Exclude test probes from counting
    if (isProbe(req.url)) return;
    
    // Guard against double-decrement: SSE routes set this flag in endStream()
    if ((reply.raw as any).__inflightDecDone) return;
    
    app.inflight.dec('onResponse');
  });
}, {
  name: 'inflight-plugin',
  fastify: '5.x'
});
