/**
 * /v2 auth guard (ROADMAP 3.4 — required-login, PLoT service-tier half).
 *
 * The login audit (parallel-briefs/PLATFORM-LOGIN-AUDIT-2026-07-10.md §0.4)
 * found /v2/* ungated regardless of AUTH_ENABLED — the browser calls
 * /v2/run directly with no credentials. This lane extends the EXISTING
 * Bearer authGuard to /v2 behind a new scope flag:
 *
 *   enforcement  ⇔  AUTH_ENABLED === '1'  AND  AUTH_V2_ENABLED === '1'
 *
 * AUTH_V2_ENABLED defaults OFF (dark ship): today's behaviour is pinned
 * byte-identical below, including the previously-implicit "AUTH_ENABLED
 * alone does not gate /v2" posture (that pin documents the audit finding
 * and will be consciously flipped at required-login rollout).
 *
 * Deliberate difference from the /v1 gate: /v2 hooks at onRequest (before
 * body parsing/validation), not preHandler, so unauthenticated callers
 * cannot probe schema-validation behaviour. authGuard reads only headers.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { registerV2Routes } from '../src/routes/v2/index.js';

const ENV_KEYS = ['AUTH_ENABLED', 'AUTH_V2_ENABLED', 'AUTH_TOKEN'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
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
    // Deliberately schema-INVALID: an unauthorized request must be rejected
    // by the auth layer BEFORE validation ever sees the body; an authorized
    // request reaches validation and gets a plain 400.
    payload: {},
  });
}

describe('/v2 auth guard — dark by default (today’s behaviour pinned)', () => {
  it('both flags unset: /v2/run needs no credentials (400 from validation, never 401/403)', async () => {
    delete process.env.AUTH_ENABLED;
    delete process.env.AUTH_V2_ENABLED;
    const app = await buildApp();
    const res = await postRun(app);
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('AUTH_ENABLED=1 alone still does NOT gate /v2 (the audit-documented posture, pinned until the rollout flip)', async () => {
    process.env.AUTH_ENABLED = '1';
    process.env.AUTH_TOKEN = 'secret-token';
    delete process.env.AUTH_V2_ENABLED;
    const app = await buildApp();
    const res = await postRun(app);
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('AUTH_V2_ENABLED=1 without AUTH_ENABLED: the global auth kill-switch wins (no gating)', async () => {
    delete process.env.AUTH_ENABLED;
    process.env.AUTH_V2_ENABLED = '1';
    process.env.AUTH_TOKEN = 'secret-token';
    const app = await buildApp();
    const res = await postRun(app);
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('/v2 auth guard — enforcement (AUTH_ENABLED=1 + AUTH_V2_ENABLED=1)', () => {
  beforeEach(() => {
    process.env.AUTH_ENABLED = '1';
    process.env.AUTH_V2_ENABLED = '1';
    process.env.AUTH_TOKEN = 'secret-token';
  });

  it('missing Authorization → 401 (auth fires before body validation: invalid body never sees a 400)', async () => {
    const app = await buildApp();
    const res = await postRun(app);
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('wrong Bearer token → 403', async () => {
    const app = await buildApp();
    const res = await postRun(app, { authorization: 'Bearer wrong-token' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('valid Bearer token → passes the auth layer (reaches validation: 400 for the invalid body)', async () => {
    const app = await buildApp();
    const res = await postRun(app, { authorization: 'Bearer secret-token' });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('OPTIONS preflight skips auth (browsers send no Authorization on preflight)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'OPTIONS', url: '/v2/run' });
    expect([401, 403]).not.toContain(res.statusCode);
    await app.close();
  });
});
