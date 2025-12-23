import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';

let app: FastifyInstance;
let port = 0;
const prevs: Record<string, string | undefined> = {
  TEST_ROUTES: process.env.TEST_ROUTES,
  AUTH_ENABLED: process.env.AUTH_ENABLED,
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED,
  IDEMPOTENCY_ENABLE: process.env.IDEMPOTENCY_ENABLE,
};

beforeAll(async () => {
  process.env.TEST_ROUTES = '1';
  process.env.AUTH_ENABLED = '0';
  process.env.RATE_LIMIT_ENABLED = '0'; // Disable rate limiting to focus on idempotency
  process.env.IDEMPOTENCY_ENABLE = '1';
  app = await createServer({ enableTestRoutes: true });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  port = typeof addr === 'object' && addr ? (addr.port as number) : 0;
});

afterAll(async () => {
  await app.close();
  for (const k of Object.keys(prevs)) {
    const v = (prevs as any)[k];
    if (v === undefined) delete (process.env as any)[k]; else (process.env as any)[k] = v;
  }
});

describe('idempotency cache replay semantics', () => {
  it('replays cached response for same key and sets Idempotent-Replayed header', async () => {
    const baseBody = {
      ...GOLDEN_SCENARIO,
      treatment_node: GOLDEN_SCENARIO.graph.nodes[0]?.id,
      outcome_node: GOLDEN_SCENARIO.graph.nodes[GOLDEN_SCENARIO.graph.nodes.length - 1]?.id,
      baseline_value: 100,
    };

    // First request - should be processed normally
    const r1 = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'replay-test-key' },
      body: JSON.stringify(baseBody),
    });
    expect(r1.status).toBe(200);
    expect(r1.headers.get('Idempotent-Replayed')).toBe('0');
    const j1 = await r1.json();

    // Second request with same key - should replay from cache
    const r2 = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'replay-test-key' },
      body: JSON.stringify(baseBody),
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get('Idempotent-Replayed')).toBe('1');
    const j2 = await r2.json();

    // Response hashes should match (same response)
    expect(j2?.model_card?.response_hash).toBe(j1?.model_card?.response_hash);

    // Third request with new key - should be processed normally
    const r3 = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'different-key' },
      body: JSON.stringify(baseBody),
    });
    expect(r3.status).toBe(200);
    expect(r3.headers.get('Idempotent-Replayed')).toBe('0');
  });
});
