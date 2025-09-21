import { createServer } from './createServer.js';

const PORT = Number(process.env.PORT || 4311);
const HOST = '0.0.0.0';

async function start() {
  const app = await createServer({ enableTestRoutes: process.env.TEST_ROUTES === '1' });
  await app.listen({ port: PORT, host: HOST });
  app.log.info({ port: PORT }, 'server started');

  // Health snapshot on SIGUSR2 (ops nicety)
  process.on('SIGUSR2', async () => {
    try {
      const { p95Ms, p99Ms, eventLoopDelayMs, snapshot, getIdemCacheSize } = await import('./metrics.js');
      const { rateLimitState } = await import('./rateLimit.js');
      const s = snapshot();
      const mem = process.memoryUsage();
      app.log.info({
        runtime: {
          node: process.version,
          uptime_s: Math.round(process.uptime()),
          rss_mb: Math.round(mem.rss / 1024 / 1024),
          heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
          eventloop_delay_ms: eventLoopDelayMs(),
          p95_ms: p95Ms(),
          p99_ms: p99Ms(),
        },
        caches: { idempotency_current: getIdemCacheSize() },
        ...s,
        rate_limit: rateLimitState()
      }, 'SIGUSR2 health snapshot');
    } catch (e) {
      app.log.error({ err: (e as any)?.message }, 'failed to log health snapshot');
    }
  });

  // Graceful shutdown with in-flight drain
  let closing = false;
  let inflight = 0;
  app.addHook('onRequest', async () => { if (!closing) inflight++; });
  app.addHook('onResponse', async () => { if (inflight > 0) inflight--; });

  for (const sig of ['SIGINT','SIGTERM'] as const) {
    process.on(sig, async () => {
      if (closing) return;
      closing = true;
      app.log.info({ sig }, 'shutting down');
      try {
        // Stop accepting new connections
        await app.close();
        const deadline = Date.now() + 5000;
        while (inflight > 0 && Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 50));
        }
        process.exit(0);
      } catch {
        process.exit(1);
      }
    });
  }
}

start();
