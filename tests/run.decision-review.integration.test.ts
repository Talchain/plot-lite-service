import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

// Focused /v1/run + CEE Decision Review integration tests using the SDK port shim.
// Verifies:
// - Gating on CEE_ORCHESTRATOR_ENABLE + Idempotency-Key.
// - Best-effort behaviour when CEE is unreachable.

describe('/v1/run CEE Decision Review integration (SDK port shim)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.CEE_ORCHESTRATOR_ENABLE = '1';
    process.env.CEE_BASE_URL = 'http://127.0.0.1:1'; // unreachable → forces degraded path
    process.env.CEE_API_KEY = 'test-decision-review-key';
    process.env.CEE_TIMEOUT_MS = '100';
    process.env.RATE_LIMIT_ENABLED = '0';

    app = await createServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.CEE_ORCHESTRATOR_ENABLE;
    delete process.env.CEE_BASE_URL;
    delete process.env.CEE_API_KEY;
    delete process.env.CEE_TIMEOUT_MS;
    delete process.env.RATE_LIMIT_ENABLED;
  });

  const payload = {
    graph: {
      nodes: [
        { id: 'A', label: 'Input' },
        { id: 'B', label: 'Output' },
      ],
      edges: [
        { from: 'A', to: 'B', weight: 0.5 },
      ],
    },
    seed: 123,
    outcome_node: 'B',
  };

  it('attaches cee* fields when flag enabled and Idempotency-Key present', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'cee-sdk-port-integration-1',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Core response present
    expect(body.result).toBeDefined();
    expect(body.result.response_hash).toBeDefined();

    // With flag+Idempotency-Key, CEE should have been attempted.
    // We allow any combination of cee* fields, as long as at least one is present.
    expect(
      body.ceeReview !== undefined ||
      body.ceeTrace !== undefined ||
      body.ceeError !== undefined,
    ).toBe(true);
  });

  it('does not attach cee* fields without Idempotency-Key', async () => {
    const res = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.result).toBeDefined();
    expect(body.result.response_hash).toBeDefined();
    expect(body.ceeReview).toBeUndefined();
    expect(body.ceeTrace).toBeUndefined();
    expect(body.ceeError).toBeUndefined();
  });
});
