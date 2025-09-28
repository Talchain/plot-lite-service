import { createServer } from './createServer.js';

const PORT = Number(process.env.PORT || 4311);
const HOST = '0.0.0.0';

async function start() {
  if (process.env.NODE_ENV === 'production' && process.env.TEST_ROUTES === '1') {
    // Fail fast before binding any ports
    console.error('TEST_ROUTES in production – aborting');
    process.exit(1);
  }
  const app = await createServer({ enableTestRoutes: process.env.TEST_ROUTES === '1' });
  let closing = false;
  let inflight = 0;
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

  for (const sig of ['SIGINT','SIGTERM'] as const) {
    process.on(sig, async () => {
      if (closing) return;
      closing = true;
      app.log.info({ sig }, 'shutting down');
      try {
        // Stop accepting new connections
        await app.close();
        process.exit(0);
      } catch {
        process.exit(1);
      }
    });
  }
}

start();
