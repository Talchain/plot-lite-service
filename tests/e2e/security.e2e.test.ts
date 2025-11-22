/**
 * E2E Tests: Security & Headers
 * Validates no secret leakage, header safety, CORS
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, stopServer, type ServerInstance } from './helpers/server.js';
import { useFakeTime, useRealTime } from './helpers/time.js';
import goldenFixture from './fixtures/graphs/golden.json';

describe('E2E: Security & Headers', () => {
  let server: ServerInstance;

  beforeAll(async () => {
    useFakeTime('2024-01-01T00:00:00Z');
    server = await startServer({
      PRINCIPAL_HMAC_SECRET: 'a'.repeat(64),
      RATE_LIMIT_ENABLED: '0',
      SENSITIVE_SECRET: 'should-never-appear',
    });
  });

  afterAll(async () => {
    await stopServer(server);
    useRealTime();
  });

  it('no environment secrets in response body', async () => {
    const res = await fetch(`${server.url}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ graph: goldenFixture.graph }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const bodyStr = JSON.stringify(body);

    // No secrets leaked
    expect(bodyStr).not.toContain('should-never-appear');
    expect(bodyStr).not.toContain('PRINCIPAL_HMAC_SECRET');
    expect(bodyStr).not.toContain('aaaaaaaaaa'); // 64-char secret
  });

  it('authorization header not echoed back', async () => {
    const res = await fetch(`${server.url}/v1/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer secret-token-12345',
      },
      body: JSON.stringify({ graph: goldenFixture.graph }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const bodyStr = JSON.stringify(body);

    // Authorization not echoed
    expect(bodyStr).not.toContain('secret-token-12345');
    expect(bodyStr).not.toContain('Bearer');
  });

  it('health endpoint does not leak secrets', async () => {
    const res = await fetch(`${server.url}/v1/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const bodyStr = JSON.stringify(body);

    expect(bodyStr).not.toContain('should-never-appear');
    expect(bodyStr).not.toContain('PRINCIPAL_HMAC_SECRET');
  });
});
