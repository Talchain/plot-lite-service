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

// =============================================================================
// (1) /v2/run response — downstream_calls bodies carry no raw labels/values
// =============================================================================

describe('/v2/run response: downstream_calls bodies are digested (F8)', () => {
  let app: FastifyInstance;
  const originalFetch = globalThis.fetch;
  const ISL_HOST = 'isl.pii-test.example.com';
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ['ISL_ENABLE', 'ISL_BASE_URL', 'ISL_API_KEY', 'RATE_LIMIT_ENABLED', 'CEE_ORCHESTRATOR_ENABLED', 'DECISION_REVIEW_ENABLE', 'ENABLE_REVIEW_PASS']) {
      savedEnv[k] = process.env[k];
    }
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
