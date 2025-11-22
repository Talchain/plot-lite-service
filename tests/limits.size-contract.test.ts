import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/createServer.js';
import { BODY_LIMIT_BYTES } from '../src/config/constants.js';

let app: any;

beforeEach(async () => {
  app = await createServer();
  await app.ready();
});

afterEach(async () => {
  if (app) await app.close();
});

describe('GET /v1/limits size contract', () => {
  it('returns limits.v1 schema with numeric fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/limits',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    
    // Schema validation
    expect(data.schema).toBe('limits.v1');
    
    // Type validation
    expect(typeof data.max_nodes).toBe('number');
    expect(typeof data.max_edges).toBe('number');
    expect(typeof data.max_body_kb).toBe('number');
    
    // Sanity checks
    expect(data.max_nodes).toBeGreaterThan(0);
    expect(data.max_edges).toBeGreaterThan(0);
    expect(data.max_body_kb).toBeGreaterThan(0);
  });

  it('max_body_kb matches BODY_LIMIT_BYTES constant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/limits',
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    
    // Critical: advertised limit must match enforced limit
    const expectedKb = Math.floor(BODY_LIMIT_BYTES / 1024);
    expect(data.max_body_kb).toBe(expectedKb);
  });

  it('POST /v1/run enforces the advertised body limit', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/limits',
    });
    
    const limits = JSON.parse(res.body);
    const advertisedBytes = limits.max_body_kb * 1024;
    
    // Verify the constant matches what we advertise
    expect(BODY_LIMIT_BYTES).toBe(advertisedBytes);
    
    // Verify oversized request gets 413
    const oversizedPayload = {
      graph: {
        nodes: Array(1000).fill(null).map((_, i) => ({ 
          id: `node_${i}`, 
          label: 'x'.repeat(100) 
        })),
        edges: []
      }
    };
    
    const oversizedRes = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: { 'content-type': 'application/json' },
      payload: oversizedPayload,
    });
    
    expect(oversizedRes.statusCode).toBe(413);
  });
});
