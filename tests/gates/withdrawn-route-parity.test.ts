/**
 * DERIVE-OR-RED parity gate for the withdrawn-route set (trap 12, altitude
 * sweep A-5). ROADMAP 2.165, 2026-07-30.
 *
 * THE DEFECT CLASS. The set of withdrawn routes existed in THREE independent
 * hand-maintained copies, and nothing connected them:
 *
 *   1. THE REGISTRATIONS — ten `app.post('<path>', …)` calls across
 *      src/routes/v1/*.ts, each also repeating its own path as the third
 *      argument to `refuseUnavailable`. This is the only copy that is TRUE by
 *      construction: it is what is actually mounted.
 *   2. THE TELEMETRY SET — `REFUSED_ROUTES` in
 *      src/observability/routeCallerTelemetry.ts, which decides whether a
 *      request is counted in `refusedCounters` (with its own smaller cap) or in
 *      the ordinary counters, and which routes appear in
 *      `refused_routes.by_route` on /health.
 *   3. THE TEST FIXTURES — the VACUOUS/FABRICATING/PLACEHOLDER arrays in
 *      tests/analysis-routes.refusal.test.ts, i.e. what is actually PROVEN to
 *      refuse.
 *
 * WHY THE DRIFT WOULD READ AS GREEN — which is what makes this worth a gate.
 * Add an eleventh withdrawn route and register it (copy 1), and every existing
 * test still passes. But:
 *   - omit it from copy 2 and its traffic is filed in the ORDINARY counters, so
 *     it never appears in `refused_routes` on /health — the caller telemetry
 *     that is the entire stated reason for keeping these paths mounted rather
 *     than deleting them is silently absent for the newest one;
 *   - omit it from copy 3 and nothing ever asserts it refuses at all.
 * Both failures are invisible: no test goes red, and /health looks healthy.
 * This is the vitest-flags-mock / KNOWN_OLUMI_TOP_LEVEL_KEYS shape exactly —
 * a list a human must remember to sync, whose drift always reads as green.
 *
 * THE FIX APPLIED HERE. Copy 1 is DERIVED, not listed: this gate scans the
 * route sources for the registrations, so the side that is true by construction
 * needs no maintenance and cannot drift. Copies 2 and 3 must remain declared —
 * `REFUSED_ROUTES` is consumed inside the telemetry module that
 * `refuse-unavailable` imports, so deriving it from the routes would be
 * circular; and the fixtures carry per-route payloads and reasons that are real
 * test data, not a mirror. So both are pinned to the derived set by parity
 * assertions that RED on drift. No FOURTH list is introduced: every assertion
 * here compares against the derived set or against the already-exported
 * `REFUSED_ROUTES`.
 *
 * The companion assertion for copy 3 lives in analysis-routes.refusal.test.ts
 * (its fixtures are local to that file), and is the same shape.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REFUSED_ROUTES } from '../../src/observability/routeCallerTelemetry.js';

const ROUTES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/routes/v1',
);

/**
 * Derive the withdrawn-route registrations from source.
 *
 * RULE: a file that calls `refuseUnavailable(` IS a withdrawn route, and the
 * paths it withdraws are the string literals it registers with `app.post(`.
 * Both halves come from the code that actually runs, so a newly-added withdrawn
 * route is picked up with no list to update.
 *
 * `readFileSync` + a regex rather than a TS parse is deliberate: the shape being
 * matched is a single-quoted literal in the first argument position, which is
 * enforced by the repo's own lint/format. A parser would add a dependency to
 * read one token. Note `refuse-unavailable.ts` itself mentions the paths in
 * prose only and registers nothing, so it is excluded by the `app.post` half
 * rather than by name.
 */
function deriveRegisteredWithdrawnRoutes(): { routes: string[]; files: string[] } {
  const routes: string[] = [];
  const files: string[] = [];

  for (const entry of readdirSync(ROUTES_DIR).sort()) {
    if (!entry.endsWith('.ts')) continue;
    const src = readFileSync(path.join(ROUTES_DIR, entry), 'utf8');
    if (!src.includes('refuseUnavailable(')) continue;

    const registered = [...src.matchAll(/app\.post\(\s*'([^']+)'/g)].map((m) => m[1]!);
    if (registered.length === 0) continue; // helper module, not a route

    files.push(entry);
    routes.push(...registered);
  }

  return { routes, files };
}

const derived = deriveRegisteredWithdrawnRoutes();

describe('withdrawn-route parity gate · the three lists cannot drift apart', () => {
  it('SCANNER CONTROL: the derivation actually found the route sources', () => {
    // Trap 13, and the most important test in this file. Every parity assertion
    // below is of the form "derived === declared". If the scanner silently
    // returned nothing — a moved directory, a renamed helper, a reformatted
    // registration — those comparisons would collapse to [] === [] and this
    // whole gate would pass by testing NOTHING, while reporting green. A gate
    // that cannot fail is the theatre this repo hunts in the product.
    expect(derived.files.length, 'no withdrawn-route source files were found').toBeGreaterThan(0);
    expect(derived.routes.length, 'no registrations were extracted').toBeGreaterThan(0);
    // One registration per file is the current shape; a file registering two
    // withdrawn paths is legitimate but should be noticed, not absorbed.
    expect(derived.routes.length).toBe(derived.files.length);
    for (const r of derived.routes) {
      expect(r, `derived path looks malformed: ${r}`).toMatch(/^\/v1\//);
    }
  });

  it('the TELEMETRY set matches the REGISTRATIONS exactly, in both directions', () => {
    const registered = [...derived.routes].sort();
    const declared = [...REFUSED_ROUTES].sort();

    // Both directions, named separately, because the two failures are different
    // bugs with different consequences:
    //   missing from REFUSED_ROUTES -> the route's traffic is filed in the
    //     ORDINARY counters and never surfaces in refused_routes on /health, so
    //     the caller evidence these paths exist to collect is silently lost.
    //   extra in REFUSED_ROUTES -> a live or deleted route is being reported as
    //     a withdrawn one, which misstates /health.
    expect(
      registered.filter((r) => !declared.includes(r)),
      'registered as withdrawn but MISSING from REFUSED_ROUTES — its refusals would not be counted',
    ).toEqual([]);
    expect(
      declared.filter((r) => !registered.includes(r)),
      'listed in REFUSED_ROUTES but NOT registered as a withdrawn route',
    ).toEqual([]);

    expect(registered).toEqual(declared);
  });

  it('no duplicates in either list — a double-count would inflate the refusal evidence', () => {
    expect(new Set(derived.routes).size).toBe(derived.routes.length);
    expect(new Set(REFUSED_ROUTES).size).toBe(REFUSED_ROUTES.length);
  });

  it('each derived route also declares the shared bodyLimit options object', () => {
    // The 2.165 bodyLimit fix used ONE shared const across ten registrations
    // precisely so it could not disagree with itself. This asserts a NEW
    // withdrawn route cannot be registered without it — the drift that would
    // otherwise silently reintroduce the 128KB server-wide default on a path
    // that reads no body.
    for (const entry of derived.files) {
      const src = readFileSync(path.join(ROUTES_DIR, entry), 'utf8');
      expect(src, `${entry} registers a withdrawn route without WITHDRAWN_ROUTE_OPTIONS`).toContain(
        'WITHDRAWN_ROUTE_OPTIONS',
      );
    }
  });

  it('each route passes its OWN path to refuseUnavailable — the path is repeated per file', () => {
    // Within a file the path appears twice: in app.post(...) and as the third
    // argument to refuseUnavailable(...). That second copy is what lands in the
    // log line, the 501 message and recordRefusal, so a copy-paste slip between
    // the two would attribute one route's refusals to another — and no existing
    // test compares them.
    for (const entry of derived.files) {
      const src = readFileSync(path.join(ROUTES_DIR, entry), 'utf8');
      const registered = [...src.matchAll(/app\.post\(\s*'([^']+)'/g)].map((m) => m[1]!);
      const reported = [
        ...src.matchAll(/refuseUnavailable\(\s*req,\s*reply,\s*'([^']+)'/g),
      ].map((m) => m[1]!);

      expect(reported.length, `${entry}: no refuseUnavailable path literal found`).toBeGreaterThan(0);
      expect(
        [...reported].sort(),
        `${entry}: the path reported to refuseUnavailable differs from the path registered`,
      ).toEqual([...registered].sort());
    }
  });
});
