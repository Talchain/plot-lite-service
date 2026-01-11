import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createServer } from '../src/createServer.js';

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

describe('Evidence freshness integration on /v1/run', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.AUTH_ENABLED = '0';
    app = await createServer({ enableTestRoutes: false });
  });

  afterAll(async () => {
    await app.close();
  });

  it('includes evidence_freshness on model_card when evidence is present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1 },
          ],
        },
        evidence: [
          { node_id: 'A', source: 'recent', timestamp: daysAgo(5) },
          { node_id: 'B', source: 'older', timestamp: daysAgo(200) },
          { node_id: 'B', source: 'stale', timestamp: daysAgo(400) },
          { node_id: 'A', source: 'no-timestamp' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    const freshness = body.model_card?.evidence_freshness;
    expect(freshness).toBeDefined();
    expect(freshness.total).toBe(4);
    expect(freshness.with_timestamp).toBe(3);
    expect(freshness.buckets.FRESH + freshness.buckets.AGING + freshness.buckets.STALE + freshness.buckets.UNKNOWN).toBe(4);
  });

  it('omits evidence_freshness when no evidence is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1 },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.model_card.evidence_freshness).toBeUndefined();
  });

  it('classifies fresh, aging, and stale evidence via buckets', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1 },
          ],
        },
        evidence: [
          { node_id: 'A', source: 'fresh', timestamp: daysAgo(1) },
          { node_id: 'B', source: 'aging', timestamp: daysAgo(180) },
          { node_id: 'B', source: 'stale', timestamp: daysAgo(400) },
        ],
      },
    });

    const body = JSON.parse(res.body);
    const buckets = body.model_card.evidence_freshness.buckets;
    expect(buckets.FRESH).toBeGreaterThanOrEqual(1);
    expect(buckets.AGING).toBeGreaterThanOrEqual(1);
    expect(buckets.STALE).toBeGreaterThanOrEqual(1);
  });

  it('handles missing or invalid timestamps as UNKNOWN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1 },
          ],
        },
        evidence: [
          { node_id: 'A', source: 'missing-ts' },
          { node_id: 'B', source: 'bad-ts', timestamp: 'not-a-date' },
        ],
      },
    });

    const body = JSON.parse(res.body);
    const freshness = body.model_card.evidence_freshness;
    expect(freshness.total).toBe(2);
    expect(freshness.with_timestamp).toBe(0);
    expect(freshness.buckets.UNKNOWN).toBe(2);
  });

  it('adds a stale evidence warning to critique when stale items are present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1 },
          ],
        },
        // Standard detail level (default) runs critique
        evidence: [
          { node_id: 'A', source: 'stale', timestamp: daysAgo(400) },
        ],
      },
    });

    const body = JSON.parse(res.body);
    const stale = body.critique.find((c: any) => c.code === 'EVIDENCE_STALE');
    expect(stale).toBeDefined();
    expect(stale.severity).toBe('IMPROVEMENT');
    expect(stale.semantic_severity).toBe('WARNING');
  });

  it('does not add stale evidence warning when no stale items are present', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1 },
          ],
        },
        evidence: [
          { node_id: 'A', source: 'fresh', timestamp: daysAgo(5) },
          { node_id: 'B', source: 'aging', timestamp: daysAgo(120) },
        ],
      },
    });

    const body = JSON.parse(res.body);
    const stale = body.critique.find((c: any) => c.code === 'EVIDENCE_STALE');
    expect(stale).toBeUndefined();
  });

  it('does not add stale evidence critique in quick detail level', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      payload: {
        seed: 4242,
        detail_level: 'quick',
        graph: {
          nodes: [
            { id: 'A', label: 'A' },
            { id: 'B', label: 'B' },
          ],
          edges: [
            { from: 'A', to: 'B', weight: 1 },
          ],
        },
        evidence: [
          { node_id: 'A', source: 'stale', timestamp: daysAgo(400) },
        ],
      },
    });

    const body = JSON.parse(res.body);
    // Quick detail_level skips critique entirely
    expect(Array.isArray(body.critique)).toBe(true);
    const stale = body.critique.find((c: any) => c.code === 'EVIDENCE_STALE');
    expect(stale).toBeUndefined();
  });
});
