/**
 * GET /health — the four contract-health-manifest fields, in BOTH payloads.
 *
 * WHY THIS FILE EXISTS. `CLAUDE.md` names schema-version skew as this estate's
 * DOMINANT cross-cutting risk: each repo pins its own `@talchain/schemas`, the
 * versions drift, and a consumer on an older version SILENTLY DROPS fields it
 * does not know. A value that validates at the producer vanishes at the
 * consumer with no error anywhere. That risk was unmeasurable from outside the
 * box: nothing PLoT published said which contract bytes it was running.
 *
 * `@talchain/schemas` has shipped the remedy since 2026-07-26
 * (`src/contracts/health-manifest.ts`): four fields every Olumi service must
 * expose at the TOP LEVEL of its health response, plus a strict parser and a
 * reader/writer comparator. CEE adopted it first (#1606, live on staging).
 * PLoT is the second of two comparable producers, which is what makes
 * `compareHealthManifest` usable across the CEE→PLoT hop at all.
 *
 * ⚠ THE FIELDS ARE READ FROM THE RUNTIME-RESOLVED MODULE, NOT THE PIN.
 * `package.json:86` is a DECLARATION; the loaded module is the FACT, and they
 * diverge exactly when it matters — a stale `node_modules`, a hoisted
 * duplicate, a vendored tarball re-cut under the same version string. This
 * repo's `@talchain/schemas` IS a vendored tarball, and the divergence is live
 * TODAY: the vendored 0.55.0 carries `CONTRACT_MANIFEST_SHA = 088fb46a…` while
 * olumi-schemas `main`, also calling itself 0.55.0, carries `4d3b0995…`
 * (`src/contracts/generated-constants.ts:10`). One version string, two
 * adoption manifests. A pin-derived value could never see it.
 *
 * ⚠ EVERY ASSERTION BINDS BY IDENTITY TO THE IMPORTED CONSTANT, never to a
 * literal '0.55.0'. A literal would be a hand-maintained mirror (CLAUDE.md
 * trap 12): stale on the next contract bump, and failing as though the product
 * were broken rather than as though this file had drifted.
 *
 * ⭐ THE PLoT-SPECIFIC OBLIGATION, WHICH CEE DID NOT HAVE.
 * `/health` enforces a 4 KiB budget (src/routes/health.ts:98) and, on
 * overflow, returns a `minimal` payload instead (:101-112). `parseHealthManifest`
 * throws on ANY missing key, so a manifest emitted only in the full payload
 * would VANISH ENTIRELY at the first overflow — and every reader would then
 * read "this producer is broken" rather than "this producer degraded". That is
 * indistinguishable from the failure the manifest exists to detect. The same
 * argument is already recorded in that file for `route_callers`: dropping it
 * under budget pressure "would turn 'no calls recorded' into 'no counter
 * present' without anyone noticing". This file holds the manifest to that
 * precedent, by FORCING the degraded branch rather than trusting it by reading.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  SCHEMA_PACKAGE_VERSION,
  SCHEMA_SHA,
  CONTRACT_MANIFEST_SHA,
  HEALTH_MANIFEST_FIELDS,
  parseHealthManifest,
  compareHealthManifest,
  releaseLine,
} from '@talchain/schemas';

// Controls whether the CEE circuit-breaker stats are padded. Hoisted because a
// `vi.mock` factory is lifted above ordinary module-scope declarations.
const pad = vi.hoisted(() => ({ bytes: 0 }));

// THE FORCING MECHANISM, chosen by identity rather than convenience:
// `cee_circuit_breaker` appears in the FULL payload ONLY (src/routes/health.ts:72)
// and is absent from `minimal` (:101-112). Padding it therefore pushes the full
// payload over the 4 KiB budget WITHOUT inflating the degraded payload we then
// want to inspect — so the degraded branch is entered for the real reason the
// route implements it, and what comes back is the real `minimal` object.
// `importOriginal` is spread so every other export of the module stays real
// (CLAUDE.md trap 12: a `vi.mock` factory REPLACES the module wholesale).
vi.mock('../src/cee/circuit-breaker.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cee/circuit-breaker.js')>();
  return {
    ...actual,
    getCeeCircuitBreakerStats: () => ({
      ...actual.getCeeCircuitBreakerStats(),
      ...(pad.bytes > 0 ? { __test_only_pad: 'x'.repeat(pad.bytes) } : {}),
    }),
  };
});

const { createServer } = await import('../src/createServer.js');

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
  pad.bytes = 0;
  if (app) await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED;
  else process.env.AUTH_ENABLED = prevAuth;
  if (prevSecret === undefined) delete process.env.TOKEN_HMAC_SECRET;
  else process.env.TOKEN_HMAC_SECRET = prevSecret;
});

async function getHealth(): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  return res.json() as Record<string, unknown>;
}

describe('/health — contract health manifest (full payload)', () => {
  it('PRECONDITION: the full payload is being served, not the degraded one', async () => {
    pad.bytes = 0;
    const body = await getHealth();
    // `runtime` exists only in the full payload. Without this pin, every
    // assertion below could be measuring the degraded arm and agreeing anyway.
    expect(body.runtime, 'expected the FULL /health payload').toBeDefined();
    expect(body.cee_circuit_breaker).toBeDefined();
  });

  it('exposes all four HEALTH_MANIFEST_FIELDS at the TOP level', async () => {
    pad.bytes = 0;
    const body = await getHealth();
    // The contract is explicit that these are NOT nested under a `contract`
    // key: "a nested object is easy to add and easy for a load balancer /
    // smoke test to never look at." Asserting the nesting IS asserting the
    // mechanism, so this iterates the contract's own field list.
    for (const field of HEALTH_MANIFEST_FIELDS) {
      expect(body, `missing top-level "${field}"`).toHaveProperty(field);
    }
  });

  it("satisfies the contract's OWN strict parser", async () => {
    pad.bytes = 0;
    const body = await getHealth();
    // `parseHealthManifest` narrows to the four keys then parses `.strict()`,
    // so a typo like `schema_read_version` throws rather than being ignored.
    // Using the contract's validator instead of a local re-implementation is
    // what stops this test drifting from the rule it claims to enforce.
    expect(() => parseHealthManifest(body)).not.toThrow();
  });

  it('reports the RUNTIME-RESOLVED contract version and byte digests', async () => {
    pad.bytes = 0;
    const body = await getHealth();
    expect(body.schema_write_version).toBe(SCHEMA_PACKAGE_VERSION);
    expect(body.schema_sha).toBe(SCHEMA_SHA);
    expect(body.contract_manifest_sha).toBe(CONTRACT_MANIFEST_SHA);
  });

  it('declares a read set that includes what it writes', async () => {
    pad.bytes = 0;
    const body = await getHealth();
    const readVersions = body.schema_read_versions as string[];
    expect(Array.isArray(readVersions)).toBe(true);
    expect(readVersions.length).toBeGreaterThan(0);
    expect(readVersions).toContain(SCHEMA_PACKAGE_VERSION);
  });

  it('is judged on RELEASE LINES, which is how 0.x compatibility is defined', async () => {
    pad.bytes = 0;
    const body = await getHealth();
    // `@talchain/schemas` is 0.x, so per semver-caret the breaking axis is
    // MINOR: releaseLine('0.55.0') === '0.55'. A peer compares these, never
    // the exact strings.
    const readVersions = body.schema_read_versions as string[];
    const writeLine = releaseLine(body.schema_write_version as string);
    expect(writeLine).toBe(releaseLine(SCHEMA_PACKAGE_VERSION));
    expect(readVersions.map(releaseLine)).toContain(writeLine);
  });

  it('publishes only a version, a read set and two digests — no secrets', async () => {
    pad.bytes = 0;
    const body = await getHealth();
    // `/health` is UNAUTHENTICATED (contracts/openapi.yaml:64-66 `security: []`,
    // and a live probe of staging returns 200 with no bearer while `/v1/health`
    // returns 401), so anything added here is public. A semver string and two
    // sha256 digests over PUBLIC contract bytes carry no key, host, path or
    // magnitude. This asserts the shape stays that narrow.
    expect(typeof body.schema_write_version).toBe('string');
    expect(body.schema_sha).toMatch(/^[0-9a-f]{64}$/);
    expect(body.contract_manifest_sha).toMatch(/^[0-9a-f]{64}$/);
    for (const v of body.schema_read_versions as string[]) {
      expect(v).toMatch(/^\d+\.\d+\.\d+(?:[-+].*)?$/);
    }
  });

  it('is READABLE BY THE COMPARATOR that gives the field its purpose', async () => {
    pad.bytes = 0;
    const body = await getHealth();
    // The point of publishing is that a peer can run this across the hop.
    // Comparing the service against itself must be compatible with no
    // advisories — if this ever reports drift, the producer is inconsistent
    // with itself, which is a real defect and not a test artefact.
    const self = parseHealthManifest(body);
    const verdict = compareHealthManifest(self, self);
    expect(verdict.compatible).toBe(true);
    expect(verdict.reasons).toEqual([]);
    expect(verdict.advisories).toEqual([]);
  });
});

describe('/health — the manifest SURVIVES the 4 KiB degraded payload', () => {
  // The obligation CEE's /healthz did not have. See the file header.
  const PAD = 5 * 1024;

  it('PRECONDITION: padding really does force the degraded branch', async () => {
    pad.bytes = 0;
    const full = await getHealth();
    expect(full.runtime, 'baseline should be the FULL payload').toBeDefined();

    pad.bytes = PAD;
    const degraded = await getHealth();
    // This is the discrimination the whole block depends on. Without it, a
    // padding mechanism that silently stopped working would leave every
    // assertion below passing against the FULL payload and proving nothing —
    // exactly the "guard agreeing with itself" shape (CLAUDE.md trap 13b).
    expect(degraded.runtime, 'expected the DEGRADED payload').toBeUndefined();
    expect(degraded.cee_circuit_breaker).toBeUndefined();
    // And it is the real minimal object, not some other failure:
    expect(degraded.status).toBe('ok');
    expect(degraded.route_callers).toBeDefined();
  });

  it('still emits all four fields when /health degrades', async () => {
    pad.bytes = PAD;
    const body = await getHealth();
    expect(body.runtime, 'precondition: must be the DEGRADED payload').toBeUndefined();
    for (const field of HEALTH_MANIFEST_FIELDS) {
      expect(body, `degraded payload dropped "${field}"`).toHaveProperty(field);
    }
  });

  it('still satisfies parseHealthManifest when /health degrades', async () => {
    pad.bytes = PAD;
    const body = await getHealth();
    expect(body.runtime, 'precondition: must be the DEGRADED payload').toBeUndefined();
    // THE WHOLE POINT. `parseHealthManifest` throws on any missing key, so a
    // partial emission is indistinguishable from a broken producer. Every
    // reader of this field must keep working across a budget overflow.
    expect(() => parseHealthManifest(body)).not.toThrow();
    const m = parseHealthManifest(body);
    expect(m.schema_write_version).toBe(SCHEMA_PACKAGE_VERSION);
    expect(m.schema_sha).toBe(SCHEMA_SHA);
    expect(m.contract_manifest_sha).toBe(CONTRACT_MANIFEST_SHA);
  });

  it('degraded and full payloads report the SAME manifest', async () => {
    pad.bytes = 0;
    const full = parseHealthManifest(await getHealth());
    pad.bytes = PAD;
    const degradedBody = await getHealth();
    expect(degradedBody.runtime).toBeUndefined();
    const degraded = parseHealthManifest(degradedBody);
    // A reader must not get a different answer depending on how loaded the
    // box was when it asked.
    expect(degraded).toEqual(full);
    expect(compareHealthManifest(degraded, full).compatible).toBe(true);
  });
});
