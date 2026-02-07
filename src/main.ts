import { createServer } from './createServer.js';
import { validateEnv } from './config-validator.js';
import { loadFromFile } from './config/runtimeConfig.js';
import { logResolvedTimeouts } from './config/timeouts.js';

const PORT = Number(process.env.PORT || 4311);
const HOST = '0.0.0.0';

// Graceful shutdown state
let closing = false;

async function start() {
  // Validate environment variables first (fail-fast)
  validateEnv();

  // Log all resolved timeout values (single source of truth)
  logResolvedTimeouts();

  // CEE config diagnostic - helps debug V2 path activation and timeout issues
  console.log('[STARTUP] CEE config:', {
    CEE_TIMEOUT_MS: process.env.CEE_TIMEOUT_MS,
    CEE_TIMEOUT_MS_parsed: Number(process.env.CEE_TIMEOUT_MS),
    CEE_SCHEMA_V2: process.env.CEE_SCHEMA_V2,
    CEE_SCHEMA_V2_type: typeof process.env.CEE_SCHEMA_V2,
    CEE_SCHEMA_V2_length: process.env.CEE_SCHEMA_V2?.length,
    CEE_SCHEMA_V2_is_1: process.env.CEE_SCHEMA_V2 === '1',
    CEE_SCHEMA_V2_is_true: process.env.CEE_SCHEMA_V2 === 'true',
  });

  if (process.env.NODE_ENV === 'production' && process.env.TEST_ROUTES === '1') {
    // Fail fast before binding any ports
    process.stderr.write('TEST_ROUTES in production – aborting\n');
    process.exit(1);
  }
  // Inflight tracking is now handled by the inflight plugin (registered in createServer)
  // Plugin provides: decoration, onRequest/onResponse hooks, probe exclusion, double-dec guard
  const app = await createServer({ enableTestRoutes: process.env.TEST_ROUTES === '1' });

  await app.listen({ port: PORT, host: HOST });

  // Startup summary - use same CORS precedence as createServer
  const { parseCorsCsv } = await import('./lib/corsParser.js');
  const defaultOrigins = 'http://localhost:5173';
  const originsCsv = (process.env.CORS_ORIGINS || process.env.CORS_ALLOW_ORIGINS || process.env.WEB_APP_ORIGIN || defaultOrigins).trim();
  const corsOrigins = parseCorsCsv(originsCsv, { allowWildcardDev: process.env.CORS_DEV === '1' });
  const rpm = Number(process.env.RATE_LIMIT_PER_MIN || 60);
  app.log.info({
    port: PORT,
    cors_allowlist: corsOrigins,
    rate_limit_rpm: rpm
  }, 'server started');

  // Hot-reload knobs on SIGHUP (safe subset)
  process.on('SIGHUP', () => {
    try {
      const cfg = loadFromFile('artifact/runtime-config.json');
      app.log.info({ cfg }, 'runtime-config reloaded');
      // Record last successful reload timestamp
      (async () => { try { const { setLastConfigReloadISO } = await import('./metrics.js'); setLastConfigReloadISO(new Date().toISOString()); } catch (err) {
        app.log.warn({ err }, 'Failed to update config reload timestamp');
      } })();
    } catch (e: any) {
      app.log.warn({ err: e?.message || String(e) }, 'runtime-config reload failed');
    }
  });

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
      const inflightCount = app.inflight.count();
      app.log.info({ sig, inflight: inflightCount }, 'graceful shutdown initiated');
      
      try {
        // Stop accepting new connections
        await app.close();
        
        // Wait for in-flight requests to complete (max 5 seconds)
        const deadline = Date.now() + 5000;
        let current = app.inflight.count();
        while (current > 0 && Date.now() < deadline) {
          const remaining = deadline - Date.now();
          app.log.info({ inflight: current, remaining }, 'draining in-flight requests');
          await new Promise(r => setTimeout(r, 100));
          current = app.inflight.count();
        }
        
        const final = app.inflight.count();
        if (final > 0) {
          app.log.warn({ inflight: final }, 'shutdown deadline reached with in-flight requests');
        } else {
          app.log.info('all in-flight requests completed');
        }
        
        process.exit(0);
      } catch (err) {
        app.log.error({ err }, 'shutdown error');
        process.exit(1);
      }
    });
  }
}

start();
