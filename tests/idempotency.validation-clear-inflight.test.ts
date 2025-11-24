import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';

let app: FastifyInstance;

const prevs: Record<string, string | undefined> = {
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
  AUTH_ENABLED: process.env.AUTH_ENABLED,
};

beforeAll(async () => {
  process.env.RATE_LIMIT_ENABLED = '0';
  process.env.AUTH_ENABLED = '0';
  app = await createServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const k of Object.keys(prevs)) {
    const v = (prevs as any)[k];
    if (v === undefined) {
      delete (process.env as any)[k];
    } else {
      (process.env as any)[k] = v;
    }
  }
});

describe('idempotency + validation errors', () => {
  it('clears inflight key on validation error so retry with same key succeeds', async () => {
    const headers = {
      'content-type': 'application/json',
      'idempotency-key': 'idem-validation-clear-1',
    };

    const baseBody = {
      ...GOLDEN_SCENARIO,
      treatment_node: GOLDEN_SCENARIO.graph.nodes[0]?.id,
      outcome_node:
        GOLDEN_SCENARIO.graph.nodes[
          GOLDEN_SCENARIO.graph.nodes.length - 1
        ]?.id,
      baseline_value: 100,
    } as any;

    // 1) First request: invalid due to unknown top-level field → 400 BAD_INPUT
    const invalidBody = {
      ...baseBody,
      extra_field: 1, // triggers additionalProperties guard
    };

    const r1 = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers,
      payload: invalidBody,
    });

    expect(r1.statusCode).toBe(400);
    const body1 = r1.json();
    expect(body1?.schema).toBe('error.v1');
    expect(body1?.code).toBe('BAD_INPUT');

    // 2) Second request: valid body, same key → treated as fresh run (not replay)
    const r2 = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers,
      payload: baseBody,
    });

    expect(r2.statusCode).toBe(200);
    const replayHeader2 =
      (r2.headers['idempotent-replayed'] as string | undefined) ??
      (r2.headers['Idempotent-Replayed'] as string | undefined) ??
      '0';
    expect(String(replayHeader2)).toBe('0');

    // 3) Third request: same valid body + key → replay from cache
    const r3 = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers,
      payload: baseBody,
    });

    expect(r3.statusCode).toBe(200);
    const replayHeader3 =
      (r3.headers['idempotent-replayed'] as string | undefined) ??
      (r3.headers['Idempotent-Replayed'] as string | undefined);
    expect(String(replayHeader3)).toBe('1');
  });
});
