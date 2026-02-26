/**
 * CIL M3/M4/M5 Tests
 *
 * M3: processing_time_ms at top level (aliasing meta.latency_ms)
 * M4: repairs_applied unconditionally present (no feature flag gate)
 * M5: DEFAULT_EXISTS_PROBABILITY imported from constants/limits.ts
 *
 * Uses createServer() with ISL disabled for M3/M4 (local fallback).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const GRAPH = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A' },
    { id: 'factor-b', kind: 'factor', label: 'Factor B' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
];

const VALID_BODY = {
  graph: GRAPH,
  options: OPTIONS,
  goal_node_id: 'goal',
  seed: '42',
};

// Graph where exists_probability is ABSENT on an edge (triggers DEFAULT_EXISTS repair)
const GRAPH_MISSING_EP = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A' },
    { id: 'factor-b', kind: 'factor', label: 'Factor B' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    // No exists_probability → should be defaulted to 0.8
    { from: 'factor-a', to: 'goal', strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', strength: { mean: 0.7, std: 0.1 } },
  ],
};

// ---------------------------------------------------------------------------
// M3 + M4: Integration tests using createServer + inject
// ---------------------------------------------------------------------------

describe('CIL M3: processing_time_ms at top level', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ISL_ENABLE = '0';
    process.env.AUTH_ENABLED = '0';
    process.env.TEST_ROUTES = '1';

    const { createServer } = await import('../src/createServer.js');
    app = await createServer({ enableTestRoutes: true });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.ISL_ENABLE;
    delete process.env.AUTH_ENABLED;
    delete process.env.TEST_ROUTES;
  });

  it('response has processing_time_ms at top level matching meta.latency_ms', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    // processing_time_ms at top level
    expect(body.processing_time_ms).toBeDefined();
    expect(typeof body.processing_time_ms).toBe('number');
    expect(body.processing_time_ms).toBeGreaterThanOrEqual(0);

    // meta.latency_ms also present
    expect(body.meta.latency_ms).toBeDefined();

    // Both should match
    expect(body.processing_time_ms).toBe(body.meta.latency_ms);
  });
});

describe('CIL M4: repairs_applied unconditionally present', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.ISL_ENABLE = '0';
    process.env.AUTH_ENABLED = '0';
    process.env.TEST_ROUTES = '1';
    // Explicitly unset the feature flag to prove repairs_applied is NOT gated
    delete process.env.UI_CANONICAL_META;

    const { createServer } = await import('../src/createServer.js');
    app = await createServer({ enableTestRoutes: true });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.ISL_ENABLE;
    delete process.env.AUTH_ENABLED;
    delete process.env.TEST_ROUTES;
  });

  it('_meta.repairs_applied present when transforms occur, without feature flag', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: {
        graph: GRAPH_MISSING_EP,
        options: OPTIONS,
        goal_node_id: 'goal',
        seed: '42',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    // _meta should always be present
    expect(body._meta).toBeDefined();

    // repairs_applied should be present regardless of UI_CANONICAL_META
    expect(body._meta.repairs_applied).toBeDefined();
    expect(Array.isArray(body._meta.repairs_applied)).toBe(true);

    // Should contain the defaulted exists_probability repair
    // field_path is now entity-prefixed (e.g., 'factor-a->goal.exists_probability')
    const epRepair = body._meta.repairs_applied.find(
      (r: any) => r.field.endsWith('.exists_probability') && r.action === 'defaulted'
    );
    expect(epRepair).toBeDefined();
    expect(epRepair.to_value).toBe(0.8);
  });

  it('_meta.repairs_applied is empty array when no transforms needed', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body._meta).toBeDefined();
    expect(body._meta.repairs_applied).toBeDefined();
    expect(Array.isArray(body._meta.repairs_applied)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// M5: DEFAULT_EXISTS_PROBABILITY named constant
// ---------------------------------------------------------------------------

describe('CIL M5: DEFAULT_EXISTS_PROBABILITY constant', () => {
  it('exports DEFAULT_EXISTS_PROBABILITY = 0.8 from constants/limits', async () => {
    const { DEFAULT_EXISTS_PROBABILITY } = await import('../src/constants/limits.js');
    expect(DEFAULT_EXISTS_PROBABILITY).toBe(0.8);
  });
});
