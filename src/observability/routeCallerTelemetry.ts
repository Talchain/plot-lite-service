/**
 * Route × caller-class request counters (D-PLoT evidence, arch step 1).
 *
 * WHY THIS EXISTS
 * ---------------
 * Deciding whether a route can be removed requires knowing whether anyone
 * calls it. Today that question cannot be answered from outside the process:
 * request logs are not retained, and /health exposes only aggregate latency
 * and 429 counters. "No one uses it" has therefore been an assertion, not a
 * measurement.
 *
 * This module makes the zero-use window READABLE — a claim of "zero calls in
 * N days" backed by a counter that would have moved if it were false. That is
 * the whole design goal: the evidence must be capable of refuting the claim.
 *
 * WHAT IS RECORDED
 * ----------------
 * The matched route PATTERN (`req.routeOptions.url`, e.g. `/v1/templates/:id/graph`)
 * crossed with a coarse caller CLASS. Never the raw URL — that carries path
 * params and query strings, which are caller data.
 *
 * PRIVACY / SECRETS
 * -----------------
 * The caller class is built from three non-secret components:
 *
 *   k:  a one-way key identity. An explicit non-secret id header
 *       (x-api-key-id / x-client-id) when the caller sends one, otherwise the
 *       first 8 hex of sha256(bearer token). The TOKEN ITSELF IS NEVER STORED,
 *       LOGGED OR RETURNED — only its digest, which is not reversible and not
 *       usable as a credential. `anon` when there is no credential at all.
 *   o:  the Origin header reduced to scheme://host (no path, no query).
 *   ua: the User-Agent, truncated and character-restricted.
 *
 * No request body, no headers beyond those three, no IP address, no user
 * content of any kind. Nothing here is PII and nothing here is a secret.
 *
 * BOUNDED BY CONSTRUCTION
 * -----------------------
 * This is a long-lived in-process map fed by unauthenticated traffic (the hook
 * runs before the auth preHandler, deliberately — a rejected attempt is still
 * evidence someone tried). An attacker rotating Origin/User-Agent could
 * otherwise grow it without limit, so the distinct-key count is hard-capped at
 * MAX_ENTRIES; past the cap, new keys are counted in `overflow` and dropped
 * rather than stored. Memory is O(MAX_ENTRIES), not O(traffic).
 *
 * The /health snapshot is likewise fixed-size: /health is contract-bound to
 * stay under 4 KiB, so the snapshot exposes counts plus a small capped sample,
 * never the whole map. tests/route-caller-telemetry.size.test.ts fills the map
 * to its caps and asserts /health still fits.
 */

import { createHash } from 'node:crypto';

/** Hard cap on distinct route×caller keys held in memory for ordinary routes. */
export const MAX_ENTRIES = 200;
/**
 * SEPARATE, RESERVED cap for the withdrawn (501-refusing) routes.
 *
 * These counters are the evidence a removal decision rests on, so they get
 * their own budget that ordinary traffic cannot consume. Sharing one map was
 * the first implementation and it was wrong: saturating the general map (250
 * junk callers on unrelated routes — trivially reachable, and reachable
 * unauthenticated) evicted the withdrawn routes from the evidence entirely, so a
 * real call to a route we were about to delete would have gone unrecorded
 * while /health still reported a confident zero. A positive control in
 * tests/route-caller-telemetry.size.test.ts caught it.
 */
export const MAX_REFUSED_ENTRIES = 50;
/** Max callers listed in the /health withdrawn-route sample. */
export const MAX_SAMPLE = 5;
/** Max entries in the /health top-routes list. */
export const MAX_TOP = 5;

const MAX_UA_LEN = 32;
const MAX_ORIGIN_LEN = 40;
const MAX_KEY_ID_LEN = 24;

/**
 * Every route now answering a typed 501 refusal. Broken out in the health
 * snapshot because "did anyone call these?" is the question the removal
 * decision turns on.
 *
 * Two distinct findings, one disposition:
 *   - the seven `/v1/analysis/*` routes ruled VACUOUS by the authenticity
 *     matrix of 2026-07-26 (no option-discriminating output);
 *   - `/v1/sensitivity` and `/v1/score`, ruled FABRICATING by the numerics
 *     science review of the same date (numbers derived from the seed and array
 *     index, stamped `inference_mode: 'model_based'`).
 */
export const REFUSED_ROUTES = [
  '/v1/analysis/dominance',
  '/v1/analysis/pareto',
  '/v1/analysis/multi-criteria',
  '/v1/analysis/risk-adjust',
  '/v1/analysis/thresholds',
  '/v1/analysis/conditional-recommend',
  '/v1/analysis/optimise',
  '/v1/sensitivity',
  '/v1/score',
] as const;

const REFUSED_SET: ReadonlySet<string> = new Set(REFUSED_ROUTES);

/**
 * Infrastructure probes. Render health-checks /v1/health continuously, so
 * counting it would bury real caller traffic under platform noise and tell us
 * nothing about PLoT consumers. Excluded deliberately, and documented in the
 * snapshot's own field names (`plot_requests_total`, not `requests_total`).
 */
const PROBE_PREFIXES = ['/health', '/v1/health', '/ready', '/live', '/version', '/v1/version', '/metrics', '/ops/'];

interface Entry {
  route: string;
  caller: string;
  n: number;
  first: string;
  last: string;
}

/** Ordinary routes. */
const counters = new Map<string, Entry>();
/** Withdrawn routes — reserved budget, never evicted by general traffic. */
const refusedCounters = new Map<string, Entry>();
let plotRequestsTotal = 0;
let overflow = 0;
/**
 * Refusals that actually reached a handler, per route.
 *
 * Distinct from the request counters above, which are incremented at
 * onRequest — i.e. BEFORE auth. The difference between the two is exactly the
 * traffic that was rejected before reaching the route, which is worth being
 * able to see separately when reading the evidence.
 *
 * Bounded without a cap because the key set is the fixed, compile-time list of
 * withdrawn routes.
 */
const refusalsByRoute = new Map<string, number>();
let refusedTotal = 0;
let since = new Date().toISOString();

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** Strip anything that is not a conservative, log-safe character. */
function sanitize(s: string): string {
  return s.replace(/[^\w.:/+@ -]/g, '');
}

function headerStr(h: unknown): string {
  if (typeof h === 'string') return h.trim();
  if (Array.isArray(h) && typeof h[0] === 'string') return h[0].trim();
  return '';
}

/**
 * One-way key identity. Never returns, and never has access to, a usable
 * credential: the bearer token is digested and only 8 hex of the digest is
 * kept.
 */
function keyIdentity(headers: Record<string, unknown>): string {
  const explicit = headerStr(headers['x-api-key-id']) || headerStr(headers['x-client-id']);
  if (explicit) return 'id:' + truncate(sanitize(explicit), MAX_KEY_ID_LEN);

  const auth = headerStr(headers['authorization']) || headerStr(headers['Authorization' as never]);
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) {
      return 'kf:' + createHash('sha256').update(token).digest('hex').slice(0, 8);
    }
  }
  return 'anon';
}

function originClass(headers: Record<string, unknown>): string {
  const raw = headerStr(headers['origin']);
  if (!raw) return '-';
  try {
    const u = new URL(raw);
    return truncate(sanitize(`${u.protocol}//${u.host}`), MAX_ORIGIN_LEN);
  } catch {
    return truncate(sanitize(raw), MAX_ORIGIN_LEN);
  }
}

function uaClass(headers: Record<string, unknown>): string {
  const raw = headerStr(headers['user-agent']);
  if (!raw) return '-';
  return truncate(sanitize(raw), MAX_UA_LEN);
}

/**
 * Derive the coarse caller class for a request.
 *
 * Exported so route handlers can put the SAME string in their own log lines,
 * letting a log record and a counter be joined without a second derivation
 * that might drift.
 */
export function callerClass(req: {
  headers?: Record<string, unknown> | null;
}): string {
  const headers = (req?.headers ?? {}) as Record<string, unknown>;
  return `${keyIdentity(headers)}|o:${originClass(headers)}|ua:${uaClass(headers)}`;
}

/** Should this route pattern be counted at all? */
export function isCountedRoute(route: string | undefined | null): boolean {
  if (!route) return false;
  return !PROBE_PREFIXES.some((p) => route === p || route.startsWith(p));
}

/**
 * Record one request against a route pattern and caller class.
 * Safe to call on every request: O(1), no allocation past the cap.
 */
export function recordRouteCall(route: string, caller: string): void {
  plotRequestsTotal++;

  // Withdrawn-route traffic is held in its own RESERVED map so that a flood
  // of junk callers on unrelated routes cannot evict the very evidence the
  // deletion decision rests on. See MAX_REFUSED_ENTRIES.
  const isRefusedRoute = REFUSED_SET.has(route);
  const map = isRefusedRoute ? refusedCounters : counters;
  const cap = isRefusedRoute ? MAX_REFUSED_ENTRIES : MAX_ENTRIES;

  // NUL cannot occur in a route pattern or in a sanitized caller class, so the
  // composite key is unambiguous.
  const key = `${route}\u0000${caller}`;
  const existing = map.get(key);
  const now = new Date().toISOString();

  if (existing) {
    existing.n++;
    existing.last = now;
    return;
  }

  if (map.size >= cap) {
    // Cap reached: count the drop, never grow past the cap. `overflow` and
    // `at_capacity` are both exposed so a reader can tell a genuine zero from
    // a truncated breakdown.
    overflow++;
    return;
  }

  map.set(key, { route, caller, n: 1, first: now, last: now });
}

export interface RouteCallerSnapshot {
  since: string;
  /** Requests to non-probe routes since process start. */
  plot_requests_total: number;
  /** Distinct route patterns seen. */
  routes_seen: number;
  /** Distinct caller classes seen. */
  caller_classes: number;
  /** Requests dropped after the distinct-key cap was hit. */
  overflow: number;
  /**
   * Refusals that reached a withdrawn route's handler. Lower than the hit
   * counts below when requests were rejected by auth first.
   */
  refused_total: number;
  /** Whether the map is at its cap (i.e. the sample below may be partial). */
  at_capacity: boolean;
  refused_routes: {
    total: number;
    by_route: Record<string, number>;
    /** Up to MAX_SAMPLE caller classes seen on the withdrawn routes. */
    callers: string[];
  };
  /** Up to MAX_TOP busiest route patterns, as [route, count]. */
  top_routes: Array<[string, number]>;
}

/**
 * Fixed-size snapshot for /health.
 *
 * Size is bounded by MAX_SAMPLE / MAX_TOP and the per-component truncation in
 * the caller class — it does NOT grow with traffic or with the number of
 * distinct callers.
 */
export function getRouteCallerSnapshot(): RouteCallerSnapshot {
  const byRoute = new Map<string, number>();
  const callers = new Set<string>();
  const refusedByRoute: Record<string, number> = {};
  const refusedCallers = new Set<string>();
  let refusedRouteTotal = 0;

  for (const r of REFUSED_ROUTES) refusedByRoute[r] = 0;

  for (const e of [...counters.values(), ...refusedCounters.values()]) {
    byRoute.set(e.route, (byRoute.get(e.route) ?? 0) + e.n);
    callers.add(e.caller);
    if (REFUSED_SET.has(e.route)) {
      refusedByRoute[e.route] = (refusedByRoute[e.route] ?? 0) + e.n;
      refusedRouteTotal += e.n;
      if (refusedCallers.size < MAX_SAMPLE) refusedCallers.add(e.caller);
    }
  }

  const topRoutes = [...byRoute.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TOP) as Array<[string, number]>;

  return {
    since,
    plot_requests_total: plotRequestsTotal,
    routes_seen: byRoute.size,
    caller_classes: callers.size,
    overflow,
    refused_total: refusedTotal,
    at_capacity: counters.size >= MAX_ENTRIES || refusedCounters.size >= MAX_REFUSED_ENTRIES,
    refused_routes: {
      total: refusedRouteTotal,
      by_route: refusedByRoute,
      callers: [...refusedCallers],
    },
    top_routes: topRoutes,
  };
}

/** Prometheus exposition for the full map (only rendered when PROMETHEUS_ENABLE=1). */
export function renderRouteCallerMetrics(): string {
  if (counters.size === 0 && refusedCounters.size === 0 && overflow === 0) return '';

  const lines: string[] = [];
  lines.push('# HELP plot_route_caller_requests_total Requests per route pattern and caller class');
  lines.push('# TYPE plot_route_caller_requests_total counter');
  for (const e of [...counters.values(), ...refusedCounters.values()]) {
    const route = e.route.replace(/["\\\n]/g, '');
    const caller = e.caller.replace(/["\\\n]/g, '');
    lines.push(`plot_route_caller_requests_total{route="${route}",caller="${caller}"} ${e.n}`);
  }
  lines.push('# HELP plot_route_caller_overflow_total Requests dropped after the distinct-key cap');
  lines.push('# TYPE plot_route_caller_overflow_total counter');
  lines.push(`plot_route_caller_overflow_total ${overflow}`);
  return lines.join('\n');
}

/**
 * Record that a withdrawn route actually refused a request in its handler.
 * Called from src/routes/v1/refuse-unavailable.ts.
 */
export function recordRefusal(route: string): void {
  refusedTotal++;
  refusalsByRoute.set(route, (refusalsByRoute.get(route) ?? 0) + 1);
}

/** Test-only reset. Not called by production code. */
export function resetRouteCallerTelemetry(): void {
  counters.clear();
  refusedCounters.clear();
  refusalsByRoute.clear();
  plotRequestsTotal = 0;
  refusedTotal = 0;
  overflow = 0;
  since = new Date().toISOString();
}
