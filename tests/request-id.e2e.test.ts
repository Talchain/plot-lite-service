import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Request ID E2E', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer();
  });

  afterAll(async () => {
    await server.kill();
  });

  it('generates non-empty X-Request-Id when no header provided', async () => {
    const res = await fetch(`${server.baseUrl}/v1/limits`);
    const reqId = res.headers.get('x-request-id');
    expect(reqId).toBeTruthy();
    expect(reqId?.length).toBeGreaterThan(0);
  });

  it('echoes X-Request-Id exactly when provided', async () => {
    const customId = 'windsurf-test-123';
    const res = await fetch(`${server.baseUrl}/v1/limits`, {
      headers: { 'X-Request-Id': customId }
    });
    const reqId = res.headers.get('x-request-id');
    expect(reqId).toBe(customId);
  });
});
