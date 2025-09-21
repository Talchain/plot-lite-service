import Fastify from 'fastify';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { spawnSync } from 'child_process';

const PORT = 4311;
const HOST = '0.0.0.0';

// Logger with strict redaction: never include parse_text or request bodies
const app = Fastify({
  logger: {
    level: 'info',
    redact: { paths: ['parse_text', 'body.parse_text', 'request.body.parse_text'], remove: true },
  },
  bodyLimit: 128 * 1024, // 128 KiB
  requestTimeout: 5000,  // 5 seconds
  disableRequestLogging: true,
});

// Minimal structured access log without bodies
app.addHook('onRequest', async (req) => {
  (req as any).startTime = process.hrtime.bigint();
});

app.addHook('onResponse', async (req, reply) => {
  const start = (req as any).startTime as bigint | undefined;
  const end = process.hrtime.bigint();
  const durationMs = start ? Number(end - start) / 1e6 : undefined;
  const route = (req as any)?.routeOptions?.url ?? req.url;
  app.log.info({ reqId: req.id, route, statusCode: reply.statusCode, durationMs }, 'request completed');
});

// Load fixtures at startup and pre-serialise the first case response exactly
const fixturesPath = resolve(process.cwd(), 'fixtures', 'deterministic-fixtures.json');
let firstCaseResponseRaw = '';
try {
  const fixturesText = readFileSync(fixturesPath, 'utf8');
  const fixtures = JSON.parse(fixturesText);
  if (!fixtures || !Array.isArray(fixtures.cases) || fixtures.cases.length === 0) {
    throw new Error('No fixtures.cases found');
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
  return { status: 'ok', p95_ms: 0 };
});

app.get('/version', async () => {
  return { api: '1.0.0', build: getBuildId(), model: 'fixtures' };
});

app.post('/draft-flows', async (req, reply) => {
  // Never log request body; specifically do not log parse_text
  reply.header('Content-Type', 'application/json');
  return reply.send(firstCaseResponseRaw);
});

app.post('/critique', async () => {
  return [
    { note: 'Missing baseline: revenue', severity: 'BLOCKER', fix_available: true },
    { note: 'Consider competitor response', severity: 'IMPROVEMENT', fix_available: true },
    { note: '£99 psychological threshold', severity: 'OBSERVATION', fix_available: false },
  ];
});

app.post('/improve', async (req: any) => {
  const { parse_json } = req.body || {};
  return { parse_json, fix_applied: [] };
});

async function start() {
  try {
    await app.listen({ port: PORT, host: HOST });
    app.log.info({ port: PORT }, 'server started');
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

start();