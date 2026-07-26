/**
 * The engine's typed capability refusal must reach an HTTP caller as a typed
 * 501 — never as the generic 500 "Something went wrong".
 *
 * `ModelBasedInference.run()` throws `CapabilityUnavailableError` rather than
 * returning a number it cannot honestly compute (see
 * tests/inference.interventions-fail-closed.test.ts). That refusal is only
 * useful if it survives the trip to the caller with its meaning intact: a
 * refusal that arrives as an opaque 500 is, from the caller's side, just
 * another outage.
 *
 * These assertions are on the full HTTP envelope — status, headers, and the
 * complete error.v1 body — not on handler internals.
 *
 * A throwing probe route is registered on the real `createServer()` app so the
 * app-level `setErrorHandler` under test is the one that runs. The same
 * technique is used by tests/unhandled-error-logging.test.ts. No probe route
 * ships: it exists only inside this test process.
 *
 * The NEGATIVE CONTROL is load-bearing. It proves the 501 branch is selective
 * — that an ordinary throw from an adjacent route still produces the 500 it
 * always did. Without it, a handler that answered 501 for everything would
 * pass every other assertion here.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import { ModelBasedInference } from '../src/inference/model_based.js';
import { CapabilityUnavailableError } from '../src/inference/capability.js';

const REFUSAL_ROUTE = '/__lane_capability_refusal';
const ORDINARY_THROW_ROUTE = '/__lane_ordinary_throw';

let app: FastifyInstance;

const prevAuth = process.env.AUTH_ENABLED;
const prevSecret = process.env.TOKEN_HMAC_SECRET;
const prevScm = process.env.SCM_LITE_ENABLE;

beforeAll(async () => {
  process.env.AUTH_ENABLED = '0';
  process.env.SCM_LITE_ENABLE = '0';
  process.env.TOKEN_HMAC_SECRET =
    process.env.TOKEN_HMAC_SECRET ||
    'abc123456789012345678901234567890123456789012345678901234567890123';

  app = await createServer({});

  // The refusal is raised by the REAL engine on the REAL fallback path, not by
  // a hand-rolled throw — so this test fails if the guard in model_based.ts is
  // removed, not merely if the error handler changes.
  app.post(REFUSAL_ROUTE, async () => {
    const engine = new ModelBasedInference();
    return engine.run(
      {
        nodes: [
          { id: 'A', label: 'A', value: 0.4 },
          { id: 'B', label: 'B', value: 0.6 },
        ],
        edges: [{ from: 'A', to: 'B', weight: 1.5, belief: 0.9 }],
      },
      {
        seed: 4242,
        k_samples: 200,
        outcome_node: 'B',
        baseline_value: 100,
        interventions: [{ node_id: 'A', value: 99 }],
      }
    );
  });

  app.post(ORDINARY_THROW_ROUTE, async () => {
    throw new TypeError('an ordinary failure, not a refusal');
  });

  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  if (prevAuth === undefined) delete process.env.AUTH_ENABLED;
  else process.env.AUTH_ENABLED = prevAuth;
  if (prevSecret === undefined) delete process.env.TOKEN_HMAC_SECRET;
  else process.env.TOKEN_HMAC_SECRET = prevSecret;
  if (prevScm === undefined) delete process.env.SCM_LITE_ENABLE;
  else process.env.SCM_LITE_ENABLE = prevScm;
});

describe('CapabilityUnavailableError → HTTP 501 typed refusal', () => {
  it('is a real throw from the engine, not a test fixture', () => {
    const engine = new ModelBasedInference();
    expect(() =>
      engine.run(
        { nodes: [{ id: 'B', label: 'B' }], edges: [] },
        {
          seed: 1,
          k_samples: 8,
          outcome_node: 'B',
          baseline_value: 100,
          interventions: [{ node_id: 'B', value: 1 }],
        }
      )
    ).toThrow(CapabilityUnavailableError);
  });

  it('returns HTTP 501 with a JSON content type', async () => {
    const res = await app.inject({ method: 'POST', url: REFUSAL_ROUTE, payload: {} });

    expect(res.statusCode).toBe(501);
    expect(String(res.headers['content-type'])).toContain('application/json');
  });

  it('returns the full error.v1 envelope with the typed capability code', async () => {
    const res = await app.inject({ method: 'POST', url: REFUSAL_ROUTE, payload: {} });
    const body = res.json();

    expect(body.schema).toBe('error.v1');
    expect(body.code).toBe('CAPABILITY_UNAVAILABLE');
    expect(body.retryable).toBe(false);
    expect(body.status).toBe('not_computed');
    expect(body.capability).toBe('interventional_inference');
    expect(body.source).toBe('plot');
    expect(typeof body.request_id).toBe('string');
    expect(String(body.reason)).toContain('SCM_LITE_ENABLE');
  });

  it('never returns a computed outcome on the refusal path', async () => {
    const res = await app.inject({ method: 'POST', url: REFUSAL_ROUTE, payload: {} });
    const raw = res.body;

    // No distribution, no outcome — the whole point of failing closed.
    expect(raw).not.toContain('most_likely');
    expect(raw).not.toContain('conservative');
    expect(raw).not.toContain('optimistic');
    expect(res.json().most_likely).toBeUndefined();
  });

  it('NEGATIVE CONTROL: an ordinary throw on an adjacent route still yields 500', async () => {
    const res = await app.inject({
      method: 'POST',
      url: ORDINARY_THROW_ROUTE,
      payload: {},
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().code).not.toBe('CAPABILITY_UNAVAILABLE');
  });
});
