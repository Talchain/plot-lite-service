/**
 * Auth-token reconciliation — the guard's expected Bearer token now resolves from
 * a single source (getExpectedAuthToken): PLOT_AUTH_TOKEN first (the caller-facing
 * name every live caller — CEE PLoTClient — already sends, and the ONLY auth var
 * provisioned on PLoT staging), falling back to the historical AUTH_TOKEN.
 *
 * Before this change the guard read process.env.AUTH_TOKEN directly, so a future
 * AUTH_ENABLED flip on staging (where AUTH_TOKEN is unset) would 403 every Bearer
 * caller. These tests pin the reconciled behaviour, using the same /v2 onRequest
 * harness as v2-auth-guard.test.ts (enforcement needs AUTH_ENABLED=1 + AUTH_V2_ENABLED=1).
 *
 * RED-first: against the pre-change guard, "valid PLOT_AUTH_TOKEN → 400" gets a 403
 * (expected token resolves empty from the unset AUTH_TOKEN), so the accept case fails.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerV2Routes } from '../src/routes/v2/index.js';

const ENV_KEYS = ['AUTH_ENABLED', 'AUTH_V2_ENABLED', 'AUTH_TOKEN', 'PLOT_AUTH_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // Start from a clean slate so a leaked shell/CI value can't mask a RED.
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerV2Routes(app);
  await app.ready();
  return app;
}

async function postRun(app: FastifyInstance, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'content-type': 'application/json', ...headers },
    // Deliberately schema-INVALID: an authorized request reaches validation and
    // gets a plain 400; an unauthorized one is rejected by auth first (401/403).
    payload: {},
  });
}

describe('auth-token reconcile — PLOT_AUTH_TOKEN is the resolved expected token', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = '1';
    process.env.AUTH_V2_ENABLED = '1';
    process.env.PLOT_AUTH_TOKEN = 'plot-secret-token';
    // AUTH_TOKEN deliberately UNSET — mirrors staging (only PLOT_AUTH_TOKEN provisioned).
  });

  it('valid PLOT_AUTH_TOKEN Bearer passes the auth layer (400 from validation, not 403)', async () => {
    const app = await buildApp();
    const res = await postRun(app, { authorization: 'Bearer plot-secret-token' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('wrong Bearer token → 403', async () => {
    const app = await buildApp();
    const res = await postRun(app, { authorization: 'Bearer wrong-token' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('missing Authorization → 401', async () => {
    const app = await buildApp();
    const res = await postRun(app);
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('auth-token reconcile — precedence and fallback', () => {
  it('PLOT_AUTH_TOKEN takes precedence over AUTH_TOKEN when both are set', async () => {
    process.env.AUTH_ENABLED = '1';
    process.env.AUTH_V2_ENABLED = '1';
    process.env.PLOT_AUTH_TOKEN = 'plot-wins';
    process.env.AUTH_TOKEN = 'legacy-loses';

    const app = await buildApp();
    // The PLOT value authenticates...
    const ok = await postRun(app, { authorization: 'Bearer plot-wins' });
    expect(ok.statusCode).toBe(400);
    // ...and the legacy value does NOT (it was not the resolved expected token).
    const bad = await postRun(app, { authorization: 'Bearer legacy-loses' });
    expect(bad.statusCode).toBe(403);
    await app.close();
  });

  it('falls back to AUTH_TOKEN when PLOT_AUTH_TOKEN is unset (prod/dev/CI alias)', async () => {
    process.env.AUTH_ENABLED = '1';
    process.env.AUTH_V2_ENABLED = '1';
    process.env.AUTH_TOKEN = 'legacy-only-token';
    // PLOT_AUTH_TOKEN deliberately UNSET.

    const app = await buildApp();
    const res = await postRun(app, { authorization: 'Bearer legacy-only-token' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
