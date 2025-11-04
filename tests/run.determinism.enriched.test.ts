import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

describe('Determinism: enriched templates', () => {
  let app: FastifyInstance;
  let port: number;

  beforeAll(async () => {
    app = await createServer({});
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => { await app.close(); });

  it('small template: same seed → identical response_hash', async () => {
    const template = await fetch(`http://127.0.0.1:${port}/v1/templates/small/graph`).then(r => r.json());
    
    const run1 = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: template, seed: 4242 })
    }).then(r => r.json());
    
    const run2 = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: template, seed: 4242 })
    }).then(r => r.json());
    
    expect(run1.model_card.response_hash).toBe(run2.model_card.response_hash);
    expect(run1.model_card.response_hash).toBeTruthy();
  });
});
