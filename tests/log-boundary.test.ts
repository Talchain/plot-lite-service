/**
 * Wave1-L1 logger-boundary tests.
 *
 * THE test in this file is "a naive NEW log site is redacted by default"
 * (see the `default-safety` block). Everything else is supporting evidence.
 * If that test cannot be written, the mechanism is not at the boundary and the
 * fix has regressed to per-call-site edits — which is the thing ROADMAP 2.56
 * ruled out after three failed rounds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import Fastify, { type FastifyInstance } from 'fastify';
import { redactLogRecord, redactLogArgs, installConsoleBoundary } from '../src/logging/log-boundary.js';
import { beginDecisionTokenScope, registerDecisionTokens, withDecisionTokenScope, runOutsideDecisionTokenScope } from '../src/logging/decision-tokens.js';

// A label + value that cannot occur by accident anywhere in the codebase.
const MARKER_LABEL = 'ZQXPII-Acquire-FintechCo-For-50m';
const MARKER_NODE = 'zqxpii-acquire-fintechco-for-50m';
const MARKER_VALUE = 125000901;

/**
 * Build a server whose log lines we can capture, with the real boundary wired.
 * Mirrors createServer's logger config EXACTLY — both hooks. If these drift
 * apart this harness stops testing the shipped configuration.
 */
async function makeServer(routes: (app: FastifyInstance) => void): Promise<{ app: FastifyInstance; lines: () => string[] }> {
  const captured: string[] = [];
  const app = Fastify({
    disableRequestLogging: true,
    logger: {
      level: 'info',
      formatters: { log: redactLogRecord },
      hooks: {
        logMethod(this: unknown, args: unknown[], method: (...a: unknown[]) => void) {
          return (method as (...a: unknown[]) => void).apply(this, redactLogArgs(args));
        },
      },
      // Capture the fully-serialised line, i.e. exactly what ships to the log sink.
      stream: { write: (s: string) => { captured.push(s); } },
    },
  });
  app.addHook('onRequest', async () => { beginDecisionTokenScope(); });
  app.addHook('preValidation', async (req) => { registerDecisionTokens(req.body); });
  routes(app);
  await app.ready();
  return { app, lines: () => captured };
}

describe('log boundary — default-safety (THE property)', () => {
  it('redacts a NAIVE, BRAND-NEW log site that does nothing to protect itself', async () => {
    const { app, lines } = await makeServer((a) => {
      a.post('/naive', async (req) => {
        const body = req.body as { graph: { nodes: Array<{ id: string; label: string }> } };
        const node = body.graph.nodes[0];

        // ── The whole point of the mechanism. ─────────────────────────────
        // This is what a future author writes when they have never heard of
        // Wave1-L1, pii-redact.ts, or sha8(). Raw id, raw label, raw value,
        // under key names that DO NOT APPEAR anywhere in the redaction code,
        // plus raw prose. Nothing here opts in to protection.
        req.log.info({
          evt: 'some_brand_new_event',
          a_key_nobody_listed: node.id,
          another_unlisted_key: node.label,
          deeply: { nested: { thing: [{ zzz_unlisted: MARKER_VALUE }] } },
          free_prose: `computing ${node.label} at value ${MARKER_VALUE}`,
        });
        return { ok: true };
      });
    });

    await app.inject({
      method: 'POST',
      url: '/naive',
      payload: { graph: { nodes: [{ id: MARKER_NODE, label: MARKER_LABEL, value: MARKER_VALUE }] } },
    });

    const out = lines().join('\n');

    // Positive control FIRST: the line must exist, or "absence" proves nothing.
    expect(out).toContain('some_brand_new_event');
    expect(out).toContain('a_key_nobody_listed');
    expect(out).toMatch(/sha8:[0-9a-f]{8}/);

    // The actual claim: no raw decision content survived, at any key or depth.
    expect(out).not.toContain(MARKER_LABEL);
    expect(out).not.toContain(MARKER_NODE);
    expect(out).not.toContain(String(MARKER_VALUE));

    await app.close();
  });

  /**
   * REGRESSION PIN for a hole found by adversarial review of this very lane:
   * pino's formatters.log receives the merged object but NOT `msg`, so a
   * formatters-only boundary emitted every interpolated message RAW. Closed by
   * also installing hooks.logMethod. If someone removes that hook "because
   * formatters already covers it", this test fails.
   */
  it('redacts raw content in `msg` — both info(obj, msg) and info(msg) shapes', async () => {
    const { app, lines } = await makeServer((a) => {
      a.post('/msg', async (req) => {
        const node = (req.body as any).graph.nodes[0];
        req.log.info({ evt: 'with_obj_and_msg' }, `failed for ${node.label} (${node.id})`);
        req.log.warn(`bare message mentioning ${node.id} and ${MARKER_VALUE}`);
        return { ok: true };
      });
    });

    await app.inject({
      method: 'POST',
      url: '/msg',
      payload: { graph: { nodes: [{ id: MARKER_NODE, label: MARKER_LABEL, value: MARKER_VALUE }] } },
    });

    const out = lines().join('\n');
    // Positive controls: both messages were emitted.
    expect(out).toContain('with_obj_and_msg');
    expect(out).toContain('bare message mentioning');
    // The claim: no raw content in msg, in EITHER shape.
    expect(out).not.toContain(MARKER_LABEL);
    expect(out).not.toContain(MARKER_NODE);
    expect(out).not.toContain(String(MARKER_VALUE));

    await app.close();
  });

  it('redacts a naive NEW console.* site (the channel pino does not see)', async () => {
    const seen: string[] = [];
    const fake = { log: (...a: unknown[]) => { seen.push(a.map((x) => JSON.stringify(x)).join(' ')); } } as unknown as Console;
    installConsoleBoundary(fake);

    withDecisionTokenScope(() => {
      registerDecisionTokens({ graph: { nodes: [{ id: MARKER_NODE, label: MARKER_LABEL }] } });
      // Naive console site: no protection, unlisted key.
      fake.log(JSON.stringify({ brand_new_console_key: MARKER_NODE, prose: `re ${MARKER_LABEL}` }));
    });

    const out = seen.join('\n');
    expect(out).toContain('brand_new_console_key'); // positive control
    expect(out).toMatch(/sha8:[0-9a-f]{8}/);
    expect(out).not.toContain(MARKER_NODE);
    expect(out).not.toContain(MARKER_LABEL);
  });
});

/**
 * The tests above build their own Fastify to isolate the mechanism. That proves
 * the mechanism WORKS; it does NOT prove it is INSTALLED in the real server —
 * exactly the gap that makes machinery read as a guarantee while never
 * executing. This block closes it against a REAL spawned server process.
 *
 * Why a subprocess and not app.inject + a stdout hook: pino writes to fd 1 via
 * sonic-boom, so neither app.log spies nor process.stdout.write hooks observe
 * real log output in-process. An in-process capture returns EMPTY and every
 * absence assertion then passes VACUOUSLY. (Observed while writing this file:
 * the in-process attempt captured 0 bytes and only the positive control caught
 * the false green.)
 */
describe('log boundary — installed in the REAL server (anti-theatre)', () => {
  let child: ReturnType<typeof spawn> | null = null;
  let logs = '';
  const PORT = '4387';
  const BASE = `http://127.0.0.1:${PORT}`;

  async function waitForHealth(timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try { const r = await fetch(`${BASE}/health`); if (r.ok) return; } catch { /* retry */ }
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

  it('a real /v1/run through the real server leaks no raw id, label or value on EITHER channel', async () => {
    const res = await fetch(`${BASE}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [{ id: MARKER_NODE, label: MARKER_LABEL, value: MARKER_VALUE, kind: 'option' }],
          edges: [],
        },
        constraints: { bounds: { [MARKER_NODE]: { min: MARKER_VALUE + 7 } } },
      }),
    });
    expect(res.status).toBe(400); // the bounds_min violation path fired
    await new Promise((r) => setTimeout(r, 300));

    // Positive controls: BOTH channels actually emitted during this request.
    // Without these, an empty or absent log makes the absence claims vacuous.
    expect(logs).toContain('constraints_violation'); // pino channel
    expect(logs).toContain('plot_run_request_received'); // console channel
    expect(logs).toContain('bounds_min');

    // Claim: scope = ALL stdout+stderr the real server process wrote for this
    // request. No raw decision content on either channel.
    expect(logs).not.toContain(MARKER_NODE);
    expect(logs).not.toContain(MARKER_LABEL);
    expect(logs).not.toContain(String(MARKER_VALUE));
  });
});

describe('log boundary — keys are content too', () => {
  it('digests a data-derived KEY (interventions keyed by node id)', () => {
    withDecisionTokenScope(() => {
      registerDecisionTokens({ options: [{ interventions: { [MARKER_NODE]: { value: 3 } } }] });
      const out = redactLogRecord({ evt: 'x', interventions: { [MARKER_NODE]: { value: 3 } } });
      const s = JSON.stringify(out);
      expect(s).toContain('interventions'); // structural key survives
      expect(s).not.toContain(MARKER_NODE); // data-derived key digested
      expect(s).toMatch(/sha8:[0-9a-f]{8}/);
    });
  });
});

describe('log boundary — Error handling', () => {
  it('scrubs an Error message but keeps name and own diagnostic props', () => {
    withDecisionTokenScope(() => {
      registerDecisionTokens({ graph: { nodes: [{ id: MARKER_NODE }] } });
      const err = Object.assign(new Error(`boom for ${MARKER_NODE}`), { code: 'ISL_ERROR', statusCode: 502 });
      const out = redactLogRecord({ evt: 'e', err }) as Record<string, any>;
      expect(out.err).toBeInstanceOf(Error);
      expect(out.err.message).not.toContain(MARKER_NODE); // scrubbed
      expect(out.err.message).toContain('boom for'); // positive control
      // Diagnostic props survive: a redactor that eats these gets ripped out.
      expect(out.err.code).toBe('ISL_ERROR');
      expect(out.err.statusCode).toBe(502);
    });
  });
});

describe('log boundary — blast radius', () => {
  // runOutsideDecisionTokenScope is required here because an earlier
  // app.inject() in this file leaves the hook's enterWith scope on the test's
  // own async context. That is an inject artifact: verified against a live
  // server (two real sequential HTTP requests) that requests do NOT bleed into
  // each other, nor into the server context. See beginDecisionTokenScope.
  it('is a NO-OP outside a request scope (boot/tool logs unchanged)', () => {
    const record = { evt: 'feature_flags_boot', node: 'some-node', value: 42 };
    runOutsideDecisionTokenScope(() => {
      expect(redactLogRecord({ ...record })).toEqual(record);
    });
  });

  it('preserves pino envelope keys and event vocabulary', () => {
    withDecisionTokenScope(() => {
      registerDecisionTokens({ label: MARKER_LABEL });
      const out = redactLogRecord({ level: 30, time: 1, evt: 'compare_inference_fallback', msg: 'hi' }) as Record<string, unknown>;
      expect(out.level).toBe(30);
      expect(out.time).toBe(1);
      expect(out.evt).toBe('compare_inference_fallback');
    });
  });
});

describe('log boundary — real leak loci from the manifest', () => {
  it('closes v2/run.ts:2026 constraint_direction_suspect raw values', () => {
    withDecisionTokenScope(() => {
      registerDecisionTokens({ goal_constraints: [{ node_id: MARKER_NODE, value: MARKER_VALUE }] });
      const out = JSON.stringify(
        redactLogRecord({
          event: 'constraint_direction_suspect',
          option_id: MARKER_NODE,
          node_id: MARKER_NODE,
          auto_threshold: MARKER_VALUE,
          outcome_p90: MARKER_VALUE,
        }),
      );
      expect(out).toContain('constraint_direction_suspect'); // positive control
      expect(out).not.toContain(MARKER_NODE);
      expect(out).not.toContain(String(MARKER_VALUE));
    });
  });

  it('closes ROADMAP 2.56(b) compare.ts / run-bundle.ts raw labels', () => {
    withDecisionTokenScope(() => {
      registerDecisionTokens({ graphs: [{ label: MARKER_LABEL }] });
      const a = JSON.stringify(redactLogRecord({ evt: 'compare_inference_fallback', label: MARKER_LABEL }));
      const b = JSON.stringify(redactLogRecord({ evt: 'run_bundle_inference_error', label: MARKER_LABEL, index: 2 }));
      expect(a).toContain('compare_inference_fallback');
      expect(a).not.toContain(MARKER_LABEL);
      expect(b).not.toContain(MARKER_LABEL);
      expect(JSON.parse(b).index).toBe(2); // unrelated metric survives
    });
  });
});

describe('digest safety', () => {
  it('digests are salted — not a bare sha256 of the value', async () => {
    const { createHash } = await import('node:crypto');
    const { sha8 } = await import('../src/util/pii-redact.js');
    const unsalted = 'sha8:' + createHash('sha256').update(String(MARKER_VALUE), 'utf8').digest('hex').slice(0, 8);
    // If this ever equals, the digest is offline-reversible (review 3 did it in 79ms).
    expect(sha8(MARKER_VALUE)).not.toBe(unsalted);
  });
});
