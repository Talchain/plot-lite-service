/**
 * E2E Tests: /v1/self-check
 * Validates parity and round-trip hashing
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, stopServer, type ServerInstance } from './helpers/server.js';
import { sha256Stable } from './helpers/canon.js';
import { useFakeTime, useRealTime } from './helpers/time.js';
import goldenFixture from './fixtures/graphs/golden.json';

describe('E2E: /v1/self-check', () => {
  let server: ServerInstance;

  beforeAll(async () => {
    useFakeTime('2024-01-01T00:00:00Z');
    server = await startServer({
      PRINCIPAL_HMAC_SECRET: 'a'.repeat(64),
      RATE_LIMIT_ENABLED: '0',
      TEST_ROUTES: '1', // Required for self-check endpoint
    });
  });

  afterAll(async () => {
    await stopServer(server);
    useRealTime();
  });

  it('self-check returns deterministic hash', async () => {
    const selfCheckRes = await fetch(`${server.url}/v1/self-check`);
    expect(selfCheckRes.status).toBe(200);
    const selfCheckBody = await selfCheckRes.json();
    
    expect(selfCheckBody.schema).toBe('self_check.v1');
    expect(typeof selfCheckBody.hash).toBe('string');
    expect(selfCheckBody.hash.length).toBe(64); // SHA-256 hex
    expect(typeof selfCheckBody.bytes).toBe('number');
  });

  it('round-trip: response_hash equals sha256Stable(runBody)', async () => {
    const runRes = await fetch(`${server.url}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        graph: goldenFixture.graph,
        seed: 4242,
        k_samples: 1000,
      }),
    });

    expect(runRes.status).toBe(200);
    const runBody = await runRes.json();

    const serverHash = runBody.model_card.response_hash;
    const recomputedHash = sha256Stable(runBody);

    expect(serverHash).toBe(recomputedHash);
  });
});
