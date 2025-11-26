import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

describe('detail_level parameter', () => {
  let app: any;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    const { registerRunRoute } = await import('../src/routes/v1/run.js');
    await registerRunRoute(app);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const minimalGraph = {
    nodes: [
      { id: 'A', label: 'Input' },
      { id: 'B', label: 'Output' },
    ],
    edges: [{ from: 'A', to: 'B', weight: 0.5 }],
  };

  it('accepts quick detail_level', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: minimalGraph, detail_level: 'quick' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.model_card.detail_level).toBe('quick');
  });

  it('accepts standard detail_level', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: minimalGraph, detail_level: 'standard' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.model_card.detail_level).toBe('standard');
  });

  it('accepts deep detail_level', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: minimalGraph, detail_level: 'deep' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.model_card.detail_level).toBe('deep');
  });

  it('defaults to standard when not specified', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: minimalGraph },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.model_card.detail_level).toBe('standard');
  });

  it('rejects invalid detail_level', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: minimalGraph, detail_level: 'invalid' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('quick mode skips critique', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: minimalGraph, detail_level: 'quick' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    // Quick mode should have empty critique array
    expect(body.critique).toEqual([]);
  });

  it('standard mode includes critique', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: { graph: minimalGraph, detail_level: 'standard' },
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    // Standard mode should run critique (may or may not have items depending on graph)
    expect(Array.isArray(body.critique)).toBe(true);
  });
});
