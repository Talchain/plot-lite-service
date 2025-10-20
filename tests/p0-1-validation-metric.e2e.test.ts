import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('P0-1: Validation Metrics E2E', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.PROMETHEUS_ENABLE = '1';
    process.env.PRINCIPAL_HMAC_SECRET_ACTIVE = 'a'.repeat(64);
    app = await createServer();
    await app.listen({ port: 0 }); // Listen on random available port
    const address = app.server.address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await app.close();
    process.env = originalEnv;
  });

  it('increments validation_errors_total for invalid request to /v1/run', async () => {
    // Get baseline metrics
    const metricsBefore = await fetch(`${baseUrl}/metrics`).then(r => r.text());
    const beforeMatch = metricsBefore.match(/plot_engine_validation_errors_total\{route="\/v1\/run",phase="request",error_type="ajv"\} (\d+)/);
    const beforeCount = beforeMatch ? parseInt(beforeMatch[1], 10) : 0;

    // Send invalid request (empty body, missing required fields)
    const response = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(400);

    // Poll metrics with retries (up to 2s)
    let afterCount = beforeCount;
    for (let i = 0; i < 10; i++) {
      const metricsAfter = await fetch(`${baseUrl}/metrics`).then(r => r.text());
      const afterMatch = metricsAfter.match(/plot_engine_validation_errors_total\{route="\/v1\/run",phase="request",error_type="ajv"\} (\d+)/);
      afterCount = afterMatch ? parseInt(afterMatch[1], 10) : 0;
      
      if (afterCount > beforeCount) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    expect(afterCount).toBeGreaterThan(beforeCount);
  });

  it('does not increment validation counter for valid request', async () => {
    // Get baseline
    const metricsBefore = await fetch(`${baseUrl}/metrics`).then(r => r.text());
    const beforeMatch = metricsBefore.match(/plot_engine_validation_errors_total\{route="\/v1\/run",phase="request",error_type="ajv"\} (\d+)/);
    const beforeCount = beforeMatch ? parseInt(beforeMatch[1], 10) : 0;

    // Send valid request
    const validPayload = {
      graph: {
        nodes: [
          { id: 'A', label: 'Price', type: 'input' },
          { id: 'B', label: 'Demand', type: 'output' }
        ],
        edges: [{ from: 'A', to: 'B', label: 'affects' }]
      },
      query: { target: 'B', intervention: { node: 'A', delta: 0.1 } }
    };

    const response = await fetch(`${baseUrl}/v1/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload)
    });

    expect(response.status).toBe(200);

    // Check metrics didn't change
    await new Promise(resolve => setTimeout(resolve, 100));
    const metricsAfter = await fetch(`${baseUrl}/metrics`).then(r => r.text());
    const afterMatch = metricsAfter.match(/plot_engine_validation_errors_total\{route="\/v1\/run",phase="request",error_type="ajv"\} (\d+)/);
    const afterCount = afterMatch ? parseInt(afterMatch[1], 10) : beforeCount;

    expect(afterCount).toBe(beforeCount);
  });
});
