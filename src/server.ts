import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';
import { rateLimit } from './rateLimit.js';

const PORT = Number(process.env.PORT || 4311);
const HOST = '0.0.0.0';

// Logger with strict redaction: never include parse_text or request bodies
const app = Fastify({
  logger: {
    level: 'info',
    redact: { paths: ['parse_text', 'body.parse_text', 'request.body.parse_text'], remove: true },
  },
  bodyLimit: 128 * 1024, // 128 KiB
  requestTimeout: Number(process.env.REQUEST_TIMEOUT_MS || 5000),
  disableRequestLogging: true,
});

// Security headers
await app.register(helmet, { global: true });

// Dev CORS (opt-in)
if (process.env.CORS_DEV === '1') {
  await app.register(cors, { origin: 'http://localhost:5173' });
}

// Optional rate limit (enabled by default, disable with RATE_LIMIT_ENABLED=0)
app.addHook('onRequest', rateLimit);

// Minimal structured access log without bodies
app.addHook('onRequest', async (req) => {
  (req as any).startTime = process.hrtime.bigint();
});

app.addHook('onResponse', async (req, reply) => {
  const start = (req as any).startTime as bigint | undefined;
  const end = process.hrtime.bigint();
  const durationMs = start ? Number(end - start) / 1e6 : undefined;
  const route = (req as any)?.routeOptions?.url ?? req.url;
  if (typeof durationMs === 'number') {
    try {
      const { recordDurationMs, recordStatus } = await import('./metrics.js');
      recordDurationMs(durationMs);
      recordStatus(reply.statusCode);
    } catch {}
  }
  app.log.info({ reqId: req.id, route, statusCode: reply.statusCode, durationMs }, 'request completed');
});

// Load fixtures at startup and pre-serialise responses for all cases
const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
let firstCaseResponseRaw = '';
const caseMap = new Map<string, string>();
try {
  const fixturesText = readFileSync(fixturesPath, 'utf8');
  const fixtures = JSON.parse(fixturesText);
  if (!fixtures || !Array.isArray(fixtures.cases) || fixtures.cases.length === 0) {
    throw new Error('No fixtures.cases found');
  }
  for (const c of fixtures.cases) {
    if (!c.name) continue;
    caseMap.set(c.name, JSON.stringify(c.response));
  }
  // Pre-serialise exactly
  firstCaseResponseRaw = JSON.stringify(fixtures.cases[0].response);
} catch (err) {
  app.log.error({ err }, `Failed to load fixtures from ${fixturesPath}`);
  process.exit(1);
}

function getBuildId(): string {
  try {
    const res = spawnSync('git', ['--no-pager', 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    if (res.status === 0) return res.stdout.trim() || new Date().toISOString();
  } catch {}
  return new Date().toISOString();
}

app.get('/health', async () => {
  const { p95Ms, snapshot } = await import('./metrics.js');
  const { rateLimitState } = await import('./rateLimit.js');
  return { status: 'ok', p95_ms: p95Ms(), ...snapshot(), rate_limit: rateLimitState() };
});

app.get('/version', async () => {
  return { api: '1.0.0', build: getBuildId(), model: 'fixtures' };
});

app.post('/draft-flows', async (req, reply) => {
  // Never log request body; specifically do not log parse_text
  const body: any = (req as any).body || {};
  const seed = body?.seed;
  // Dev-only forced errors via header (test taxonomy)
  {
    const force = (req.headers['x-debug-force-error'] as string | undefined)?.toUpperCase();
    if (force === 'TIMEOUT') {
      const { errorResponse } = await import('./errors.js');
      return reply.code(504).send(errorResponse('TIMEOUT', 'Simulated timeout', 'Reduce processing time'));
    }
    if (force === 'RETRYABLE') {
      const { errorResponse } = await import('./errors.js');
      return reply.code(503).send(errorResponse('RETRYABLE', 'Temporary issue', 'Please retry'));
    }
    if (force === 'INTERNAL') {
      throw new Error('Forced internal');
    }
  }
  if (typeof seed !== 'undefined') {
    app.log.info({ reqId: req.id, seed }, 'seed received');
  }
  const fixtureCase = body?.fixture_case as string | undefined;
  if (fixtureCase) {
    const hit = caseMap.get(fixtureCase);
    if (!hit) {
      const { errorResponse } = await import('./errors.js');
      return reply.code(400).send(errorResponse('BAD_INPUT', `Unknown fixture_case: ${fixtureCase}`, 'Provide a valid case name from fixtures.cases[].name'));
    }
    reply.header('Content-Type', 'application/json');
    return reply.send(hit);
  }
  reply.header('Content-Type', 'application/json');
  return reply.send(firstCaseResponseRaw);
});

app.post('/critique', async (req: any, reply) => {
  const body = req.body || {};
  // Block obviously sensitive content (never echo raw)
  function hasSensitive(obj: any): boolean {
    if (!obj || typeof obj !== 'object') return false;
    for (const [k, v] of Object.entries(obj)) {
      const key = String(k).toLowerCase();
      if (key.includes('password') || key.includes('api_key') || key.includes('apikey')) return true;
      if (typeof v === 'string') {
        const s = v.toLowerCase();
        if (s.includes('password') || s.includes('api_key') || s.includes('apikey')) return true;
      } else if (typeof v === 'object') {
        if (hasSensitive(v)) return true;
      }
    }
    return false;
  }
  if (hasSensitive(body)) {
    const { errorResponse } = await import('./errors.js');
    return reply.code(400).send(errorResponse('BLOCKED_CONTENT', 'Blocked content', 'Remove sensitive tokens'));
  }
  // Dev-only forced error via header
  {
    const force = (req.headers['x-debug-force-error'] as string | undefined)?.toUpperCase();
    if (force === 'TIMEOUT') {
      const { errorResponse } = await import('./errors.js');
      return reply.code(504).send(errorResponse('TIMEOUT', 'Simulated timeout', 'Reduce processing time'));
    }
    if (force === 'RETRYABLE') {
      const { errorResponse } = await import('./errors.js');
      return reply.code(503).send(errorResponse('RETRYABLE', 'Temporary issue', 'Please retry'));
    }
    if (force === 'INTERNAL') {
      throw new Error('Forced internal');
    }
  }
  const parse_json = body.parse_json;
  if (!parse_json) {
    const { errorResponse } = await import('./errors.js');
    return reply.code(400).send(errorResponse('BAD_INPUT', 'Field parse_json is required', 'Provide a parse_json object matching flow.schema.json'));
  }
  try {
    const { validateFlowAsync } = await import('./validation.js');
    const res = await validateFlowAsync(parse_json);
    if (!res.ok) {
      const { errorResponse } = await import('./errors.js');
      return reply.code(400).send(errorResponse('BAD_INPUT', 'Invalid parse_json', res.hint));
    }
  } catch (e: any) {
    const { errorResponse } = await import('./errors.js');
    return reply.code(500).send(errorResponse('INTERNAL', 'Validator error', e?.message));
  }
  // Phase 2 rules (deterministic, no AI)
  const { critiqueFlow } = await import('./critique.js');
  return critiqueFlow(parse_json);
});

app.post('/improve', async (req: any, reply) => {
  const { parse_json } = req.body || {};
  if (typeof parse_json === 'undefined') {
    const { errorResponse } = await import('./errors.js');
    return reply.code(400).send(errorResponse('BAD_INPUT', 'Field parse_json is required', 'Provide a parse_json object to be echoed back'));
  }
  return { parse_json, fix_applied: [] };
});

// Simple global error handler mapping to typed error
app.setErrorHandler(async (err, req, reply) => {
  const type = err.message?.includes('body limit') ? 'BAD_INPUT' : 'INTERNAL';
  const { errorResponse } = await import('./errors.js');
  reply.code(type === 'INTERNAL' ? 500 : 400).send(errorResponse(type as any, err.message || 'Unhandled error'));
});

let ready = false;

app.get('/ready', async (_req, reply) => {
  return reply.code(ready ? 200 : 503).send({ ok: ready });
});

app.post('/internal/replay-status', async (req: any, reply) => {
  const s = req.body?.status;
  const { setLastReplay } = await import('./metrics.js');
  if (s === 'ok' || s === 'drift') setLastReplay(s);
  return { recorded: s };
});

async function start() {
  try {
    // Warm validator for readiness
    try { const { warmValidator } = await import('./validation.js'); await warmValidator(); } catch {}
    await app.listen({ port: PORT, host: HOST });
    ready = true;
    app.log.info({ port: PORT }, 'server started');
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
for (const sig of ['SIGINT','SIGTERM'] as const) {
  process.on(sig, async () => {
    ready = false;
    app.log.info({ sig }, 'shutting down');
    try { await app.close(); process.exit(0); } catch { process.exit(1); }
  });
}

start();
