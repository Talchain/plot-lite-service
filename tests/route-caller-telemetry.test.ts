/**
 * Route × caller-class telemetry (D-PLoT evidence, arch step 1).
 *
 * The point of this counter is to make "nobody calls this route" a MEASUREMENT
 * rather than an assertion. That only works if the counter would actually move
 * when the claim is false — so every assertion below that expects a zero is
 * paired with a positive control that expects a non-zero from the same probe.
 *
 * Three properties are load-bearing and each is pinned here:
 *   1. it counts (positive control), and it counts the route PATTERN not the raw URL;
 *   2. it never stores a secret — the bearer token must not survive anywhere in
 *      the snapshot, the metrics text, or the caller class;
 *   3. it is bounded — an attacker rotating headers cannot grow it without limit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  callerClass,
  isCountedRoute,
  recordRouteCall,
  getRouteCallerSnapshot,
  renderRouteCallerMetrics,
  resetRouteCallerTelemetry,
  MAX_ENTRIES,
  MAX_VACUOUS_ENTRIES,
  MAX_SAMPLE,
  MAX_TOP,
  VACUOUS_ANALYSIS_ROUTES,
} from '../src/observability/routeCallerTelemetry.js';

const SECRET = 'super-secret-bearer-token-value-do-not-leak-9f3a';

beforeEach(() => {
  resetRouteCallerTelemetry();
});

describe('caller class derivation', () => {
  it('POSITIVE CONTROL: distinct callers produce distinct classes', () => {
    const a = callerClass({ headers: { authorization: `Bearer token-A` } });
    const b = callerClass({ headers: { authorization: `Bearer token-B` } });

    expect(a).not.toBe(b);
  });

  it('the same caller produces a stable class across requests', () => {
    const h = { authorization: `Bearer ${SECRET}`, origin: 'https://olumi.netlify.app' };

    expect(callerClass({ headers: h })).toBe(callerClass({ headers: h }));
  });

  it('NEVER embeds the bearer token — only a one-way digest of it', () => {
    const cls = callerClass({ headers: { authorization: `Bearer ${SECRET}` } });

    expect(cls).not.toContain(SECRET);
    expect(cls).not.toContain('Bearer');
    // A key fingerprint is present, so the class is still caller-distinguishing.
    expect(cls).toMatch(/^kf:[0-9a-f]{8}\|/);
  });

  it('prefers an explicit non-secret key id header when the caller sends one', () => {
    const cls = callerClass({
      headers: { 'x-api-key-id': 'cee-prod', authorization: `Bearer ${SECRET}` },
    });

    expect(cls).toContain('id:cee-prod');
    expect(cls).not.toContain(SECRET);
  });

  it('records origin and user-agent, and marks an unauthenticated caller anon', () => {
    const cls = callerClass({
      headers: { origin: 'https://olumi.netlify.app/some/path', 'user-agent': 'node-fetch/3.0' },
    });

    expect(cls).toContain('anon');
    // Origin reduced to scheme://host — no path.
    expect(cls).toContain('o:https://olumi.netlify.app');
    expect(cls).not.toContain('/some/path');
    expect(cls).toContain('ua:node-fetch/3.0');
  });

  it('truncates a hostile over-long user-agent rather than storing it whole', () => {
    const cls = callerClass({ headers: { 'user-agent': 'x'.repeat(5000) } });

    expect(cls.length).toBeLessThan(200);
  });
});

describe('counted vs probe routes', () => {
  it('POSITIVE CONTROL: real PLoT routes are counted', () => {
    expect(isCountedRoute('/v1/run')).toBe(true);
    expect(isCountedRoute('/v1/analysis/dominance')).toBe(true);
  });

  it('infrastructure probes are excluded so platform noise cannot bury caller traffic', () => {
    for (const probe of ['/health', '/v1/health', '/ready', '/live', '/version', '/metrics']) {
      expect(isCountedRoute(probe)).toBe(false);
    }
  });

  it('an unmatched route (undefined pattern) is not counted', () => {
    expect(isCountedRoute(undefined)).toBe(false);
    expect(isCountedRoute('')).toBe(false);
  });
});

describe('counters', () => {
  it('POSITIVE CONTROL: recording moves the totals', () => {
    const before = getRouteCallerSnapshot();
    expect(before.plot_requests_total).toBe(0);

    recordRouteCall('/v1/run', 'anon|o:-|ua:-');

    const after = getRouteCallerSnapshot();
    expect(after.plot_requests_total).toBe(1);
    expect(after.routes_seen).toBe(1);
    expect(after.caller_classes).toBe(1);
  });

  it('separates counts per route and per caller class', () => {
    recordRouteCall('/v1/run', 'kf:aaaaaaaa|o:-|ua:-');
    recordRouteCall('/v1/run', 'kf:aaaaaaaa|o:-|ua:-');
    recordRouteCall('/v1/run', 'kf:bbbbbbbb|o:-|ua:-');
    recordRouteCall('/v1/score', 'kf:aaaaaaaa|o:-|ua:-');

    const s = getRouteCallerSnapshot();
    expect(s.plot_requests_total).toBe(4);
    expect(s.routes_seen).toBe(2);
    expect(s.caller_classes).toBe(2);
    expect(s.top_routes[0]).toEqual(['/v1/run', 3]);
  });

  it('reports every vacuous analysis route explicitly, at zero, before any traffic', () => {
    const s = getRouteCallerSnapshot();

    // All seven keys present with an explicit 0 — a missing key and a zero key
    // must not be confusable when reading the evidence externally.
    expect(Object.keys(s.vacuous_analysis.by_route).sort()).toEqual(
      [...VACUOUS_ANALYSIS_ROUTES].sort()
    );
    for (const r of VACUOUS_ANALYSIS_ROUTES) {
      expect(s.vacuous_analysis.by_route[r]).toBe(0);
    }
    expect(s.vacuous_analysis.total).toBe(0);
  });

  it('POSITIVE CONTROL: a call to a vacuous route is visible in the evidence', () => {
    recordRouteCall('/v1/analysis/dominance', 'kf:12345678|o:https://x.test|ua:curl/8');

    const s = getRouteCallerSnapshot();
    expect(s.vacuous_analysis.total).toBe(1);
    expect(s.vacuous_analysis.by_route['/v1/analysis/dominance']).toBe(1);
    expect(s.vacuous_analysis.callers).toContain('kf:12345678|o:https://x.test|ua:curl/8');
    // …and the other six stay at zero.
    expect(s.vacuous_analysis.by_route['/v1/analysis/pareto']).toBe(0);
  });
});

describe('bounded by construction', () => {
  it('never exceeds the distinct-key cap, and counts what it dropped', () => {
    // Simulate an attacker rotating the caller class on every request.
    for (let i = 0; i < MAX_ENTRIES + 500; i++) {
      recordRouteCall('/v1/run', `kf:${String(i).padStart(8, '0')}|o:-|ua:-`);
    }

    const s = getRouteCallerSnapshot();
    expect(s.caller_classes).toBeLessThanOrEqual(MAX_ENTRIES);
    expect(s.at_capacity).toBe(true);
    expect(s.overflow).toBe(500);
    // The total is still truthful even though the breakdown was capped.
    expect(s.plot_requests_total).toBe(MAX_ENTRIES + 500);
  });

  it('a saturated general map CANNOT evict the vacuous-route evidence', () => {
    // The regression this pins: with a single shared map, this flood evicted
    // the vacuous routes entirely, and /health then reported a confident zero
    // for a route that had in fact been called. The vacuous counters now have
    // their own reserved budget.
    for (let i = 0; i < MAX_ENTRIES + 500; i++) {
      recordRouteCall('/v1/run', `kf:${String(i).padStart(8, '0')}|o:-|ua:-`);
    }

    // A single genuine call to a route we are about to delete, AFTER the flood.
    recordRouteCall('/v1/analysis/optimise', 'kf:realcall|o:https://caller.test|ua:curl/8');

    const s = getRouteCallerSnapshot();
    expect(s.vacuous_analysis.by_route['/v1/analysis/optimise']).toBe(1);
    expect(s.vacuous_analysis.total).toBe(1);
    expect(s.vacuous_analysis.callers).toContain('kf:realcall|o:https://caller.test|ua:curl/8');
  });

  it('the vacuous reserve is itself bounded', () => {
    for (let i = 0; i < MAX_VACUOUS_ENTRIES + 100; i++) {
      recordRouteCall('/v1/analysis/pareto', `kf:${String(i).padStart(8, '0')}|o:-|ua:-`);
    }

    const s = getRouteCallerSnapshot();
    expect(s.at_capacity).toBe(true);
    expect(s.overflow).toBe(100);
    // Total remains truthful even though distinct callers were capped.
    expect(s.vacuous_analysis.total).toBe(MAX_VACUOUS_ENTRIES);
    expect(s.plot_requests_total).toBe(MAX_VACUOUS_ENTRIES + 100);
  });

  it('caps the vacuous-route caller sample and the top-routes list', () => {
    for (let i = 0; i < 50; i++) {
      recordRouteCall('/v1/analysis/pareto', `kf:${String(i).padStart(8, '0')}|o:-|ua:-`);
      recordRouteCall(`/v1/route-${i}`, 'anon|o:-|ua:-');
    }

    const s = getRouteCallerSnapshot();
    expect(s.vacuous_analysis.callers.length).toBeLessThanOrEqual(MAX_SAMPLE);
    expect(s.top_routes.length).toBeLessThanOrEqual(MAX_TOP);
  });

  it('the snapshot stays small no matter how much traffic is recorded', () => {
    for (let i = 0; i < MAX_ENTRIES + 1000; i++) {
      recordRouteCall(
        `/v1/analysis/${['dominance', 'pareto', 'thresholds'][i % 3]}`,
        `kf:${String(i).padStart(8, '0')}|o:https://a-fairly-long-origin.example.test|ua:${'u'.repeat(32)}`
      );
    }

    const bytes = Buffer.byteLength(JSON.stringify(getRouteCallerSnapshot()), 'utf8');
    // Comfortably inside the /health 4 KiB contract, with room for the rest of
    // the payload. The real end-to-end guard is
    // tests/route-caller-telemetry.size.test.ts.
    expect(bytes).toBeLessThan(1600);
  });
});

describe('prometheus rendering', () => {
  it('POSITIVE CONTROL: renders a counter line per route×caller', () => {
    recordRouteCall('/v1/run', 'kf:12345678|o:-|ua:-');

    const text = renderRouteCallerMetrics();
    expect(text).toContain('plot_route_caller_requests_total');
    expect(text).toContain('route="/v1/run"');
    expect(text).toContain('caller="kf:12345678|o:-|ua:-"');
  });

  it('never leaks a bearer token into the metrics text', () => {
    recordRouteCall('/v1/run', callerClass({ headers: { authorization: `Bearer ${SECRET}` } }));

    expect(renderRouteCallerMetrics()).not.toContain(SECRET);
  });

  it('renders nothing at all when there is no traffic', () => {
    expect(renderRouteCallerMetrics()).toBe('');
  });
});
