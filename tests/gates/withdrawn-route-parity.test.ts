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
 * paths it withdraws are the path literals it registers with `app.post(`. Both
 * halves come from the code that actually runs, so a newly-added withdrawn route
 * is picked up with no list to update.
 *
 * QUOTE-AGNOSTIC, and the reason is a correction to this file's own first
 * version (adversarial review of #292, finding F1). That version matched only
 * SINGLE-quoted literals and justified it as "enforced by the repo's own
 * lint/format". **That justification was false in its load-bearing word.**
 * Measured at the bytes: `eslint.config.js` has no quote rule at all, and while
 * `.prettierrc.json` does exist and does set `"singleQuote": true`, neither
 * `format` nor `format:check` runs in any CI workflow or in
 * scripts/pre-push-validate.sh — so the preference is expressed and never
 * enforced. A gate must not rest on a config that no gate runs; that is the
 * guarantee-theatre shape this repo hunts in the product. Accepts `'`, `"` and
 * backtick.
 *
 * A NON-LITERAL PATH IS A HARD FAIL, NOT A SKIP — the other half of F1. The
 * original code `continue`d when it extracted nothing, which was the escape
 * hatch for the helper module but ALSO silently swallowed a withdrawal
 * registered with a variable or interpolated path: extract zero, skip the file,
 * and every parity assertion below still passes green while the advertised drift
 * class walks through. The two cases are now distinguished by whether the file
 * registers anything at all: no `app.post(` means a helper module (skip);
 * `app.post(` present but no literal extracted means a registration this
 * scanner cannot read (RED, via `nonconforming`). `refuse-unavailable.ts`
 * mentions the paths in prose and registers nothing, so it is still excluded by
 * the `app.post` half rather than by name.
 *
 * `readFileSync` + regex rather than a TS parse keeps this dependency-free for
 * what is two tokens per registration; the hard-fail above is what makes the
 * regex's limits loud instead of silent.
 */
const POST_REGISTRATION =
  /app\.post\(\s*(['"`])([^'"`]+)\1\s*,\s*([A-Za-z_$][\w$]*)?/g;

interface Registration {
  file: string;
  route: string;
  /** Whether the shared options const is the SECOND argument to app.post. */
  hasSharedOptions: boolean;
}

function deriveRegisteredWithdrawnRoutes(): {
  registrations: Registration[];
  routes: string[];
  files: string[];
  /** Files that register a route this scanner could not read — never silent. */
  nonconforming: string[];
} {
  const registrations: Registration[] = [];
  const files: string[] = [];
  const nonconforming: string[] = [];

  for (const entry of readdirSync(ROUTES_DIR).sort()) {
    if (!entry.endsWith('.ts')) continue;
    const src = readFileSync(path.join(ROUTES_DIR, entry), 'utf8');
    if (!src.includes('refuseUnavailable(')) continue;

    const found = [...src.matchAll(POST_REGISTRATION)].map((m) => ({
      file: entry,
      route: m[2]!,
      hasSharedOptions: m[3] === 'WITHDRAWN_ROUTE_OPTIONS',
    }));

    if (found.length === 0) {
      // No registration AT ALL -> helper module, legitimately skipped.
      // A registration the scanner cannot parse -> loud failure, not a skip.
      if (src.includes('app.post(')) nonconforming.push(entry);
      continue;
    }

    files.push(entry);
    registrations.push(...found);
  }

  return {
    registrations,
    routes: registrations.map((r) => r.route),
    files,
    nonconforming,
  };
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
    // F1: a withdrawn route registered with a path this scanner cannot read
    // (variable, interpolated template, computed) must RED here rather than be
    // silently skipped — a skip would let the exact drift this gate advertises
    // pass green.
    expect(
      derived.nonconforming,
      'file registers a route with a non-literal path the scanner cannot read — it would be skipped, not checked',
    ).toEqual([]);
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

  it('each REGISTRATION passes the shared bodyLimit options object to app.post', () => {
    // The 2.165 bodyLimit fix used ONE shared const across ten registrations
    // precisely so it could not disagree with itself. This asserts a NEW
    // withdrawn route cannot be registered without it — the drift that would
    // otherwise silently reintroduce the 128KB server-wide default on a path
    // that reads no body.
    //
    // ⚠ WHAT THIS ASSERTION USED TO BE, AND WHY IT DID NOT TEST ITS OWN NAME
    // (adversarial review of #292, finding F2). The first version ran
    // `expect(fileBytes).toContain('WITHDRAWN_ROUTE_OPTIONS')` — a substring
    // check over the WHOLE FILE, which the surviving IMPORT LINE satisfies on
    // its own. Strip the options argument from `app.post` but keep the import
    // and the gate passed 5/5; only the behavioural 413 test caught it. So the
    // system caught the mutant, but this named assertion did not, and a claim
    // that passes for the wrong reason is the thing this file exists to prevent.
    //
    // Now anchored to the call: `hasSharedOptions` is true only when the const
    // is the token immediately following the path literal in `app.post(`, i.e.
    // the second argument position, per registration rather than per file.
    for (const reg of derived.registrations) {
      expect(
        reg.hasSharedOptions,
        `${reg.file}: app.post('${reg.route}', …) does not pass WITHDRAWN_ROUTE_OPTIONS as its options argument`,
      ).toBe(true);
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
      // Quote-agnostic on both sides, for the F1 reason recorded on the deriver.
      const registered = derived.registrations
        .filter((r) => r.file === entry)
        .map((r) => r.route);
      const reported = [
        ...src.matchAll(/refuseUnavailable\(\s*req,\s*reply,\s*(['"`])([^'"`]+)\1/g),
      ].map((m) => m[2]!);

      expect(reported.length, `${entry}: no refuseUnavailable path literal found`).toBeGreaterThan(0);
      expect(
        [...reported].sort(),
        `${entry}: the path reported to refuseUnavailable differs from the path registered`,
      ).toEqual([...registered].sort());
    }
  });
});
