import { describe, it, expect } from 'vitest';
import { createServer } from './server.js';

describe('Server', () => {
  it('should start and respond to health check', async () => {
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('ok', true);
    expect(body).toHaveProperty('queueDepth');
    expect(body).toHaveProperty('running');
    expect(body).toHaveProperty('worker');
    expect(body).toHaveProperty('repo');
    expect(body.repo.kind).toBe('memory');
    expect(body.worker).toHaveProperty('running');
    expect(body.worker).toHaveProperty('processed');

    await app.close();
  });

  it('should include X-Request-ID header', async () => {
    const app = await createServer();

    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.headers['x-request-id']).toBeDefined();
    expect(typeof response.headers['x-request-id']).toBe('string');

    await app.close();
  });
});