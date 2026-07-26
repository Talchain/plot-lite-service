/**
 * End-to-end guard for the route × caller telemetry (D-PLoT, arch step 1).
 *
 * Two things are proven here that the unit tests cannot prove on their own:
 *
 *  1. THE HOOK IS ACTUALLY WIRED. The unit tests exercise the counter module
 *     directly; they would still pass if the onRequest hook in createServer.ts
 *     were deleted. Here the counter is moved by a REAL request through the
 *     real app, and the route recorded is the matched PATTERN.
 *
 *  2. /health STILL FITS ITS 4 KiB CONTRACT AT THE TELEMETRY'S WORST CASE.
 *     tests/health.size.test.ts and tests/contracts.health.size.test.ts measure
 *     an idle server, where these counters are empty — so they would not catch
 *     an unbounded telemetry field. This test saturates the map to its caps
 *     first, with maximum-length route and caller strings, and only then
 *     measures. /health degrades to a `minimal` payload if it exceeds budget,
 *     so an unbounded field here would not fail loudly — it would silently
 *     delete most of /health. That is why this guard exists.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import {
  getRouteCallerSnapshot,
  recordRouteCall,
  resetRouteCallerTelemetry,
  MAX_ENTRIES,
} from '../src/observability/routeCallerTelemetry.js';

let app: FastifyInstance;

const prevAuth = process.env.AUTH_ENABLED;
const prevSecret = process.env.TOKEN_HMAC_SECRET;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.TOKEN_HMAC_SECRET =
    process.env.TOKEN_HMAC_SECRET ||
    'abc123456789012345678901234567890123456789012345678901234567890123';
  app = await createServer({});
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED;
  else process.env.AUTH_ENABLED = prevAuth;
  if (prevSecret === undefined) delete process.env.TOKEN_HMAC_SECRET;
  else process.env.TOKEN_HMAC_SECRET = prevSecret;
});

beforeEach(() => {
  resetRouteCallerTelemetry();
});

describe('telemetry hook is wired into the real app', () => {
  it('POSITIVE CONTROL: a real request moves the counter', async () => {
    expect(getRouteCallerSnapshot().plot_requests_total).toBe(0);

    await app.inject({
      method: 'POST',
      url: '/v1/analysis/dominance',
      headers: { origin: 'https://olumi.netlify.app', 'user-agent': 'vitest/1' },
      payload: {},
    });

    const s = getRouteCallerSnapshot();
    expect(s.plot_requests_total).toBeGreaterThan(0);
    expect(s.refused_routes.by_route['/v1/analysis/dominance']).toBe(1);
    expect(s.refused_routes.callers[0]).toContain('o:https://olumi.netlify.app');
  });

  it('records the matched route PATTERN, never the raw URL with its query string', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/analysis/pareto?customer_email=someone%40example.com&token=abc',
      payload: {},
    });

    const rendered = JSON.stringify(getRouteCallerSnapshot());
    expect(rendered).toContain('/v1/analysis/pareto');
    expect(rendered).not.toContain('someone');
    expect(rendered).not.toContain('example.com');
    expect(rendered).not.toContain('token=abc');
  });

  it('does not count its own health probes', async () => {
    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/v1/health' });
    await app.inject({ method: 'GET', url: '/version' });

    expect(getRouteCallerSnapshot().plot_requests_total).toBe(0);
  });

  it('surfaces the counters on /health and /v1/health', async () => {
    await app.inject({ method: 'POST', url: '/v1/analysis/thresholds', payload: {} });

    const health = (await app.inject({ method: 'GET', url: '/health' })).json();
    const v1health = (await app.inject({ method: 'GET', url: '/v1/health' })).json();

    expect(health.route_callers).toBeDefined();
    expect(health.route_callers.refused_routes.by_route['/v1/analysis/thresholds']).toBe(1);
    expect(v1health.route_callers).toBeDefined();
    expect(v1health.route_callers.refused_routes.by_route['/v1/analysis/thresholds']).toBe(1);
  });
});

describe('/health stays inside its 4 KiB contract at telemetry saturation', () => {
  /** Saturate the map with worst-case-length keys, as a hostile caller would. */
  function saturate() {
    const longRoute = '/v1/' + 'r'.repeat(56);
    const longCaller = `kf:deadbeef|o:https://${'o'.repeat(28)}.test|ua:${'u'.repeat(32)}`;
    for (let i = 0; i < MAX_ENTRIES + 250; i++) {
      recordRouteCall(`${longRoute}${i % 7}`, `${longCaller}${i}`);
    }
    // Withdrawn-route callers too, so the sample list is full rather than empty.
    for (let i = 0; i < 25; i++) {
      recordRouteCall('/v1/analysis/conditional-recommend', `${longCaller}-v${i}`);
    }
  }

  it('POSITIVE CONTROL: saturation really does fill the map', () => {
    saturate();
    const s = getRouteCallerSnapshot();

    expect(s.at_capacity).toBe(true);
    expect(s.overflow).toBeGreaterThan(0);
    expect(s.refused_routes.callers.length).toBeGreaterThan(0);
  });

  it('/health remains under 4 KiB', async () => {
    saturate();

    const res = await app.inject({ method: 'GET', url: '/health' });
    const bytes = Buffer.byteLength(res.body, 'utf8');

    expect(res.statusCode).toBe(200);
    expect(bytes).toBeLessThan(4096);
    // And it did NOT silently degrade to the `minimal` payload to get there.
    expect(res.json().runtime).toBeDefined();
    expect(res.json().route_callers).toBeDefined();
  });

  it('/v1/health remains under 4 KiB', async () => {
    saturate();

    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    const bytes = Buffer.byteLength(res.body, 'utf8');

    expect(res.statusCode).toBe(200);
    expect(bytes).toBeLessThan(4096);
    expect(res.json().route_callers).toBeDefined();
  });
});
