/**
 * PII residual closure (Codex F8 residuals — Wave1-L1).
 *
 * PR #223 (F1/F3/F9) minimised the boundary-LOG path but explicitly DEFERRED
 * three residual leak paths. This suite pins their closure:
 *
 *  (1) /v2/run RESPONSE body: `downstream_calls.isl[].request_payload` /
 *      `response_payload` echoed the full ISL exchange — node/factor labels
 *      and raw decision values — into the API response (and `_meta.payloads`
 *      when UI_CANONICAL_META is on). Bodies must now be shape-preserving
 *      digests ("sha8:xxxxxxxx"): same keys, same nesting, no raw
 *      labels/values.
 *  (2) /v1/run INFO logs: `plot_run_request_received` logged raw node ids;
 *      `constraints_violation` logged raw node ids AND raw decision values
 *      (value/min/max). Must log digests/counts only.
 *  (3) translator-v3 console.warn: `[PARAMETER_UNCERTAINTY]` warns logged raw
 *      node ids and raw prior range values. Must log digests only.
 *
 * Marker discipline: a distinctive label (ZQXPII_MARKER_LABEL) and value
 * (125000901) must appear in NEITHER the /v2/run echoed-exchange carriers
 * (downstream_calls + _meta; the raw VALUE nowhere in the whole response)
 * NOR captured log output. Product display fields (factor_sensitivity
 * labels etc.) legitimately return the caller's own data and are out of
 * scope. Each test carries a positive control proving the leak path was
 * actually exercised (no false-green via an absent field).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'node:child_process';
import type { FastifyInstance } from 'fastify';

const MARKER_LABEL = 'ZQXPII_MARKER_LABEL';
const MARKER_VALUE = 125000901;
const MARKER_NODE_ID = 'zqxpii-marker-node';
/**
 * A label-derived node-id slug of the kind CEE mints ("Acquire FintechCo for
 * £50m" → "acquire-fintechco-for-50m"). The id ITSELF is the decision content.
 * Used as an `interventions` Record KEY — the review-3 residual the original
 * suite missed by planting markers only in label/value POSITIONS.
 */
const MARKER_ID_SLUG = 'zqxpii-acquire-fintechco-for-50m';

// =============================================================================
// (1) /v2/run response — downstream_calls bodies carry no raw labels/values
// =============================================================================

describe('/v2/run response: downstream_calls bodies are digested (F8)', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;
  const ISL_HOST = 'isl.pii-test.example.com';
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ['ISL_ENABLE', 'ISL_BASE_URL', 'ISL_API_KEY', 'RATE_LIMIT_ENABLED', 'CEE_ORCHESTRATOR_ENABLED', 'DECISION_REVIEW_ENABLE', 'ENABLE_REVIEW_PASS', 'UI_CANONICAL_META']) {
      savedEnv[k] = process.env[k];
    }
    // The reviewer observed the leak with UI_CANONICAL_META ON — that flag is
    // what populates `_meta.payloads.isl_request`. With it OFF the carrier is
    // absent and every `_meta` PII assertion below passes VACUOUSLY.
    process.env.UI_CANONICAL_META = '1';
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = `https://${ISL_HOST}`;
    process.env.ISL_API_KEY = 'test-key-not-a-secret';
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';

    // HTTP-level ISL mock: the REAL ISLClient runs, so downstream calls are
    // recorded exactly as in production (request_payload = the graph with its
    // labels). Any non-ISL external call is a tripwire failure.
    globalThis.fetch = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
      if (!url.includes(ISL_HOST)) {
        throw new Error(`NO-NETWORK TRIPWIRE: unmocked fetch to ${url}`);
      }
      const { makeComputedIslResponse } = await import('./helpers/run-fixtures.js');
      const bodyText = JSON.stringify(makeComputedIslResponse());
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'isl-echo' }),
        text: async () => bodyText,
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const { createServer } = await import('../src/createServer.js');
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await app?.close();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('echoed downstream bodies keep their shape but carry no raw labels or values', async () => {
    const { makeValidRunBody } = await import('./helpers/run-fixtures.js');
    const body = makeValidRunBody();
    // Plant the marker label + value on the factor node the ISL request echoes.
    (body.graph.nodes[0] as any).label = MARKER_LABEL;
    (body.graph.nodes[0] as any).observed_state = { value: MARKER_VALUE };

    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: body });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);

    // Positive control: the echo path was exercised — downstream ISL calls are
    // present in the response with digests and a request payload carrier.
    const islCalls = parsed.downstream_calls?.isl;
    expect(Array.isArray(islCalls)).toBe(true);
    expect(islCalls.length).toBeGreaterThanOrEqual(1);
    expect(islCalls[0].request_digest?.sha256).toBeTruthy();
    expect(islCalls[0].request_payload).toBeDefined();
    // Shape stability: the redacted request payload retains its key structure.
    expect(Object.keys(islCalls[0].request_payload as Record<string, unknown>)).toContain('graph');

    // THE PII ASSERTIONS.
    // (a) The echoed downstream-exchange carriers (downstream_calls + _meta)
    //     must carry NO raw label. NOTE deliberate scope: the envelope's own
    //     product fields (factor_sensitivity[].factor_label, m1_coaching
    //     key_drivers, fact_objects[].data.label) return the caller's own
    //     display data to the caller — that is the UI contract, not the F8
    //     echo leak, and stripping it would break rendering.
    expect(JSON.stringify(parsed.downstream_calls)).not.toContain(MARKER_LABEL);
    expect(JSON.stringify(parsed._meta ?? {})).not.toContain(MARKER_LABEL);
    // (b) The raw decision VALUE appears nowhere in the entire response —
    //     it only ever rode the echoed ISL exchange.
    expect(res.body).not.toContain(String(MARKER_VALUE));
    // (c) Redacted leaves use the digest format, shape intact.
    const nodes = (islCalls[0].request_payload as any)?.graph?.nodes;
    expect(Array.isArray(nodes)).toBe(true);
    expect(String(nodes[0].label)).toMatch(/^sha8:[0-9a-f]{8}$/);
  });

  it('digests data-derived object KEYS (interventions is keyed by node id)', async () => {
    const { makeValidRunBody } = await import('./helpers/run-fixtures.js');
    const body = makeValidRunBody();
    // Rename the factor node to a label-derived slug and re-key the options'
    // interventions maps by it. The slug now rides the echoed ISL exchange as
    // an object KEY, which redactPayloadShape passed through verbatim.
    (body.graph.nodes[0] as any).id = MARKER_ID_SLUG;
    (body.graph.edges[0] as any).from = MARKER_ID_SLUG;
    // Distinct values per option — identical interventions trip the
    // IDENTICAL_OPTIONS preflight blocker (422) and the echo path never runs.
    (body.options as any[])[0].interventions = { [MARKER_ID_SLUG]: { value: 0.8, source: 'user_specified' } };
    (body.options as any[])[1].interventions = { [MARKER_ID_SLUG]: { value: 0.2, source: 'user_specified' } };

    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: body });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);

    // Positive control: the interventions carrier reached the echoed payload,
    // so an absent field cannot false-green this test.
    const islCalls = parsed.downstream_calls?.isl;
    expect(Array.isArray(islCalls)).toBe(true);
    const sentOptions = (islCalls[0].request_payload as any)?.options;
    expect(Array.isArray(sentOptions)).toBe(true);
    const interventionKeys = Object.keys(sentOptions[0].interventions ?? {});
    expect(interventionKeys.length).toBeGreaterThanOrEqual(1);
    // Positive control for the _meta assertion below: the echoed-payload
    // carrier is actually present, so a missing field cannot false-green it.
    expect((parsed._meta ?? {}).payloads?.isl_request).toBeTruthy();

    // THE ASSERTION: the data-derived key is digested, not verbatim.
    for (const k of interventionKeys) {
      expect(k).toMatch(/^sha8:[0-9a-f]{8}$/);
    }
    // And the raw slug appears in NEITHER echoed-exchange carrier.
    expect(JSON.stringify(parsed.downstream_calls)).not.toContain(MARKER_ID_SLUG);
    // Scope: `_meta.payloads` is the echoed ISL exchange (the F8 leak carrier).
    // NOT asserted over all of `_meta`: `_meta.range_derivation_sources` is a
    // CONTRACT field (Record<factor_id, tier>, engine-v3.ts) that the UI joins
    // against factor_sensitivity for per-factor display. It returns the
    // caller's OWN node ids to that same caller — the documented product-field
    // carve-out above, not the echo leak. Digesting its keys would break the
    // UI join without denying an attacker anything they didn't send.
    expect(JSON.stringify((parsed._meta ?? {}).payloads ?? {})).not.toContain(MARKER_ID_SLUG);
  });

  it('factor_sensitivity_source log digests the raw factor_id', async () => {
    // Found while proving the interventions-key residual: this log site is NOT
    // debug-gated (unlike preflight_validation, which hashes outside
    // NODE_ENV!=production), so the raw node id reached PRODUCTION logs.
    //
    // Source-level assertion, deliberately: the site only fires on the ISL
    // path, and pino writes to fd 1 via sonic-boom — neither app.log spies nor
    // process.stdout.write hooks observe it in-process, and the spawned-server
    // pattern used below cannot mock ISL. The leak and its closure were both
    // verified behaviourally against an ISL-mocked run; this pins the fix.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/routes/v2/run.ts', import.meta.url), 'utf8');
    const at = src.indexOf("event: 'factor_sensitivity_source'");
    // Positive control: the log site still exists and still samples factors.
    expect(at).toBeGreaterThan(-1);
    const site = src.slice(at, at + 1200);
    expect(site).toContain('factor_id');
    // The raw binding `factor_id: f.factor_id` must be gone, digest in place.
    expect(site).not.toMatch(/factor_id:\s*f\.factor_id\b/);
    expect(site).toMatch(/factor_id:\s*sha8\(/);
  });

  it('preserves structural keys so shape stays debuggable', async () => {
    const { makeValidRunBody } = await import('./helpers/run-fixtures.js');
    const res = await app.inject({ method: 'POST', url: '/v2/run', payload: makeValidRunBody() });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    const reqPayload = (parsed.downstream_calls?.isl?.[0]?.request_payload ?? {}) as any;

    // Contract-defined keys survive: a debugger still navigates the shape.
    expect(Object.keys(reqPayload)).toEqual(expect.arrayContaining(['graph', 'options']));
    expect(Object.keys(reqPayload.graph)).toEqual(expect.arrayContaining(['nodes', 'edges']));
    expect(Object.keys(reqPayload.options[0])).toEqual(
      expect.arrayContaining(['id', 'label', 'interventions']),
    );
    expect(Object.keys(reqPayload.graph.edges[0].strength)).toEqual(
      expect.arrayContaining(['mean', 'std']),
    );
    // The `build` allowlist still reads through on the response payload —
    // _meta.builds.isl depends on it.
    const respPayload = (parsed.downstream_calls?.isl?.[0]?.response_payload ?? {}) as any;
    expect(Object.keys(respPayload)).toEqual(expect.arrayContaining(['analysis_status', 'options']));
  });
});

// =============================================================================
// (2) /v1/run INFO logs — request-entry + constraints_violation carry digests
// =============================================================================

describe('/v1/run logs: no raw node ids or decision values (F8 residual)', () => {
  let child: ReturnType<typeof spawn> | null = null;
  let logs = '';
  const PORT = '4381';
  const BASE = `http://127.0.0.1:${PORT}`;

  async function waitForHealth(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = await fetch(`${BASE}/health`);
        if (r.ok) return;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error('test server did not become healthy');
  }

  beforeAll(async () => {
    child = spawn(process.execPath, ['tools/test-server.js'], {
      env: { ...process.env, TEST_PORT: PORT, TEST_ROUTES: '1', RATE_LIMIT_ENABLED: '0', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d) => { logs += d.toString(); });
    child.stderr?.on('data', (d) => { logs += d.toString(); });
    await waitForHealth();
  }, 30000);

  afterAll(async () => {
    try { if (child?.pid) process.kill(child.pid, 'SIGINT'); } catch { /* gone */ }
  });

  it('constraints_violation logs digest the node id and value/min/max', async () => {
    const res = await fetch(`${BASE}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: MARKER_NODE_ID, label: MARKER_LABEL, value: MARKER_VALUE }],
          edges: [],
        },
        constraints: { bounds: { [MARKER_NODE_ID]: { min: MARKER_VALUE + 7 } } },
      }),
    });
    expect(res.status).toBe(400); // bounds_min violation path fired
    await new Promise((r) => setTimeout(r, 300));

    // Positive control: the violation WAS logged.
    expect(logs).toContain('constraints_violation');
    expect(logs).toContain('bounds_min');

    // No raw node id, label, or decision value in any captured log line.
    expect(logs).not.toContain(MARKER_NODE_ID);
    expect(logs).not.toContain(MARKER_LABEL);
    expect(logs).not.toContain(String(MARKER_VALUE));
  });

  it('priors_validation_failed logs carry no raw unknown-node id', async () => {
    const res = await fetch(`${BASE}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'plain-node', label: 'Plain' }], edges: [] },
        // Prior on a node that does NOT exist → validate-priors emits
        // field "priors.<rawNodeId>" + "Prior specified for unknown node: <rawNodeId>".
        priors: { [MARKER_ID_SLUG]: 0.5 },
      }),
    });
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 300));

    // Positive control: the validation-failure log fired.
    expect(logs).toContain('priors_validation_failed');
    // The raw node id must not ride the log (field OR message).
    expect(logs).not.toContain(MARKER_ID_SLUG);
  });

  it('evidence_validation_failed logs carry no raw unknown-node id', async () => {
    const res = await fetch(`${BASE}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: { nodes: [{ id: 'plain-node', label: 'Plain' }], edges: [] },
        evidence: [
          { node_id: MARKER_ID_SLUG, source: 'zqxpii-source', strength: 0.5 },
        ],
      }),
    });
    expect(res.status).toBe(400);
    await new Promise((r) => setTimeout(r, 300));

    // Positive control: the validation-failure log fired.
    expect(logs).toContain('evidence_validation_failed');
    // The raw node id must not ride the log.
    expect(logs).not.toContain(MARKER_ID_SLUG);
  });

  it('plot_run_request_received logs digest node ids (options/outcome/goal)', async () => {
    const res = await fetch(`${BASE}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            { id: 'zqxpii-option-node', label: 'Option marker', kind: 'option' },
            { id: 'plain-node', label: 'Plain' },
          ],
          edges: [],
        },
        seed: 4242,
      }),
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));

    // Positive control: the entry log fired.
    expect(logs).toContain('plot_run_request_received');
    // Raw option node id must not ride the entry log.
    expect(logs).not.toContain('zqxpii-option-node');
  });
});

// =============================================================================
// (2b) /v1 compare + run-bundle warns — raw scenario labels (ROADMAP 2.56 (b))
// =============================================================================

describe('/v1 compare + run-bundle fallback warns carry no raw labels', () => {
  it('compare_inference_fallback and run_bundle_inference_error digest the label', async () => {
    // Source-level assertion: these warn sites must not interpolate the raw
    // `label` field. A behavioural trigger needs an inference crash, which is
    // not reachable from a well-formed request; the RED signal is the raw
    // `label:` binding in the log object.
    const { readFile } = await import('node:fs/promises');
    for (const rel of ['src/routes/v1/compare.ts', 'src/routes/v1/run-bundle.ts']) {
      const src = await readFile(new URL(`../${rel}`, import.meta.url), 'utf8');
      // Isolate the req.log.warn(...) call bodies — the RESPONSE builders in
      // these files legitimately carry `label: g.label` (the caller's own data
      // returned to the caller), so the whole-file scan would false-RED.
      const warnCalls = [...src.matchAll(/req\.log\.warn\(\{[\s\S]*?\}\)/g)].map((m) => m[0]);
      // Positive control: the warn sites are still there to assert against.
      expect(warnCalls.length).toBeGreaterThanOrEqual(1);
      for (const call of warnCalls) {
        // No raw label binding: `label: g.label` / `label: scenario.label`.
        expect(call).not.toMatch(/\blabel:\s*(g|scenario)\.label\b/);
      }
      // The digested form must be present instead.
      expect(src).toMatch(/label_sha8:\s*sha8\(/);
    }
  });
});

// =============================================================================
// (3) translator-v3 warns — digests only
// =============================================================================

describe('translator-v3 [PARAMETER_UNCERTAINTY] warns carry no raw ids/values', () => {
  it('unsupported-distribution and swapped-range warns are digested', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { buildParameterUncertaintiesV3 } = await import('../src/integrations/isl/translator-v3.js');

      const nodes = [
        // Triggers "unsupported prior distribution" warn.
        {
          id: MARKER_NODE_ID,
          kind: 'factor',
          label: MARKER_LABEL,
          category: 'external',
          prior: { distribution: 'zqxpii_weird_dist', range_min: 0, range_max: 1 },
        },
        // Triggers "range_min > range_max, swapping" warn with raw values.
        {
          id: 'zqxpii-marker-node-2',
          kind: 'factor',
          label: 'Second marker',
          category: 'external',
          prior: { distribution: 'uniform', range_min: MARKER_VALUE, range_max: 42 },
        },
      ] as any[];

      buildParameterUncertaintiesV3(nodes as any);

      const warned = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      // Positive control: both warn paths fired.
      expect(warned).toContain('[PARAMETER_UNCERTAINTY]');
      expect(warned).toContain('unsupported prior distribution');
      expect(warned).toContain('swapping');

      // No raw node ids, no raw distribution text, no raw range values.
      expect(warned).not.toContain(MARKER_NODE_ID);
      expect(warned).not.toContain('zqxpii-marker-node-2');
      expect(warned).not.toContain('zqxpii_weird_dist');
      expect(warned).not.toContain(String(MARKER_VALUE));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// =============================================================================
// (4) sha8 is salted — digests are not dictionary-attackable
// =============================================================================

describe('sha8 digests resist offline recovery (per-process salt)', () => {
  /** Run an expression in a FRESH node process (via tsx) against the module. */
  async function inChildProcess(expr: string): Promise<string> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const run = promisify(execFile);
    const modPath = new URL('../src/util/pii-redact.ts', import.meta.url).pathname;
    const dir = await mkdtemp(join(tmpdir(), 'pii-salt-'));
    const script = join(dir, 'probe.ts');
    try {
      await writeFile(script, `import * as m from ${JSON.stringify(modPath)};\nprocess.stdout.write(${expr});\n`);
      const { stdout } = await run('npx', ['tsx', script], {
        cwd: new URL('..', import.meta.url).pathname,
        env: { ...process.env },
      });
      return stdout.trim();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('is self-consistent within one process (correlation survives)', async () => {
    const { sha8 } = await import('../src/util/pii-redact.js');
    expect(sha8('acquire-fintechco-for-50m')).toBe(sha8('acquire-fintechco-for-50m'));
    // Distinct inputs stay distinct — "is this the same node?" still answerable.
    expect(sha8('node-a')).not.toBe(sha8('node-b'));
    expect(sha8('node-a')).toMatch(/^sha8:[0-9a-f]{8}$/);
  });

  it('is NOT the unsalted sha256 prefix (defeats a rainbow table)', async () => {
    const { sha8 } = await import('../src/util/pii-redact.js');
    const { createHash } = await import('node:crypto');
    const input = 'acquire-fintechco-for-50m';
    const unsalted = 'sha8:' + createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 8);
    // The reviewer recovered a digested decision value in 79ms by brute-forcing
    // exactly this construction. It must no longer be reproducible offline.
    expect(sha8(input)).not.toBe(unsalted);
  });

  it('preflight-logger hashNodeId is salted too (production node-id path)', async () => {
    // The production preflight log hashes node ids via hashNodeId rather than
    // sha8. It was the SAME unsalted-sha256 construction — salting only sha8
    // would have left the identical offline attack open on the path that
    // actually runs in production, and made the PR's claim false.
    const { hashNodeId } = await import('../src/logging/preflight-logger.js');
    const { createHash } = await import('node:crypto');
    const id = 'acquire-fintechco-for-50m';
    const unsalted = createHash('sha256').update(id).digest('hex').substring(0, 12);
    expect(hashNodeId(id)).not.toBe(unsalted);
    // Log shape preserved (12 hex chars) and self-consistent in-process.
    expect(hashNodeId(id)).toMatch(/^[0-9a-f]{12}$/);
    expect(hashNodeId(id)).toBe(hashNodeId(id));
    expect(hashNodeId('node-a')).not.toBe(hashNodeId('node-b'));
  });

  it('differs across processes (salt is per-process, not derivable)', async () => {
    const expr = 'm.sha8("acquire-fintechco-for-50m")';
    const [a, b] = await Promise.all([inChildProcess(expr), inChildProcess(expr)]);
    // Positive control: both child processes produced a well-formed digest.
    expect(a).toMatch(/^sha8:[0-9a-f]{8}$/);
    expect(b).toMatch(/^sha8:[0-9a-f]{8}$/);
    // Two independent processes must not agree — an attacker with logs from
    // one process cannot precompute against another.
    expect(a).not.toBe(b);
  }, 30000);
});

// =============================================================================
// (F7, Codex) — the constraint/intervention normalisation INFO logs must not
// carry raw numeric decision VALUES (original / normalised).
// =============================================================================
// run.ts logs `sample[].original` / `sample[].normalised` at info level for both
// the intervention (Phase 4a) and constraint (Phase 4b) normalisation diagnostics.
// The log boundary hashes REGISTERED tokens (raw inputs), but a DERIVED value —
// the normalised [0,1] scalar, and the original user-unit quantity under the
// unlisted keys `original`/`normalised` — is neither registered nor a
// DECISION_DOMAIN_KEY, so it reaches info logs in plaintext.
//
// This site fires only on the normalisation path and pino writes to fd 1 via
// sonic-boom (no in-process capture; the spawned-server pattern cannot exercise
// the ISL-adjacent path deterministically here) — so, exactly as the
// `factor_sensitivity_source` pin above, this is a SOURCE-level assertion with
// positive controls that the sites still exist and still sample the safe fields.
describe('F7: constraint/intervention normalisation logs carry no raw numeric values', () => {
  async function runSource(): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    return readFile(new URL('../src/routes/v2/run.ts', import.meta.url), 'utf8');
  }

  it('intervention_normalisation info log drops original/normalised, keeps factor_id + range_source + clamped', async () => {
    const src = await runSource();
    const at = src.indexOf("event: 'intervention_normalisation'");
    expect(at).toBeGreaterThan(-1);
    // The info log (first occurrence) carries the sample; window covers it.
    const site = src.slice(at, at + 1300);
    // Positive control: the site still exists and still samples the SAFE fields.
    expect(site).toContain('sample:');
    expect(site).toMatch(/factor_id:\s*d\.factor_id\b/);
    expect(site).toMatch(/range_source:\s*d\.range\.source\b/);
    expect(site).toMatch(/clamped:\s*d\.clamped\b/);
    // THE FIX: the raw numeric decision values are gone.
    expect(site).not.toMatch(/original:\s*d\.original_value\b/);
    expect(site).not.toMatch(/normalised:\s*d\.normalised_value\b/);
  });

  it('constraint_normalisation info log drops original/normalised, keeps constraint_id + node_id + range_source', async () => {
    const src = await runSource();
    const at = src.indexOf("event: 'constraint_normalisation'");
    expect(at).toBeGreaterThan(-1);
    const site = src.slice(at, at + 1300);
    // Positive control: the site still exists and still samples identifiers + source.
    expect(site).toContain('sample:');
    expect(site).toMatch(/constraint_id:\s*d\.constraint_id\b/);
    expect(site).toMatch(/node_id:\s*d\.node_id\b/);
    expect(site).toMatch(/range_source:\s*d\.range\.source\b/);
    // THE FIX: the raw numeric decision values are gone.
    expect(site).not.toMatch(/original:\s*d\.original_value\b/);
    expect(site).not.toMatch(/normalised:\s*d\.normalised_value\b/);
  });
});
