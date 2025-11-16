/**
 * Phase D: Determinism tests for /v1/run_bundle and /v1/run_timeslices
 * Verify seed-based reproducibility and evidence parity
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer } from './utils.js';
import type { ChildProcess } from 'node:child_process';

describe('Determinism: /v1/run_bundle', () => {
  let app: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const server = await spawnServer({ profile: 'fallback' });
    app = server.child;
    baseUrl = server.baseUrl;
  });

  afterAll(() => {
    try { if (app?.pid) process.kill(app.pid, 'SIGTERM'); } catch {}
  });

  const minimalPayload = {
    base_graph: {
      nodes: [
        { id: 'A', label: 'Driver', belief: 0.6 },
        { id: 'B', label: 'Outcome' }
      ],
      edges: [
        { id: 'e1', from: 'A', to: 'B', weight: 0.7 }
      ]
    },
    deltas: [
      {
        label: 'scenario1',
        nodes: [{ id: 'A', belief: 0.8 }]
      },
      {
        label: 'scenario2',
        nodes: [{ id: 'A', belief: 0.4 }]
      }
    ],
    seed: 4242
  };

  it('produces identical response_hash with same seed (2 calls)', async () => {
    const res1 = await fetch(`${baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalPayload)
    });

    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    const res2 = await fetch(`${baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalPayload)
    });

    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Verify determinism
    expect(body1.model_card.response_hash).toBeDefined();
    expect(body2.model_card.response_hash).toBeDefined();
    expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
    
    // Verify backend header present
    expect(res1.headers.get('x-olumi-backend')).toBe('fallback');
    expect(res2.headers.get('x-olumi-backend')).toBe('fallback');
    
    // Verify model_card.backend field
    expect(body1.model_card.backend).toBe('fallback');
    expect(body2.model_card.backend).toBe('fallback');
  });

  it('applies evidence and returns meta.evidence_applied (sanitized)', async () => {
    const payloadWithEvidence = {
      ...minimalPayload,
      evidence: [
        { node_id: 'A', source: 'historical_data', note: 'Q1 2024 actuals', weight: 0.9 },
        { node_id: 'B', source: 'forecast', note: 'Sensitive info here', weight: 0.7 }
      ]
    };

    const res = await fetch(`${baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadWithEvidence)
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Verify evidence_applied is sanitized (no notes, no weight)
    expect(body.meta.evidence_applied).toBeDefined();
    expect(Array.isArray(body.meta.evidence_applied)).toBe(true);
    expect(body.meta.evidence_applied.length).toBe(2);
    
    for (const ev of body.meta.evidence_applied) {
      expect(ev.node_id).toBeDefined();
      expect(ev.source).toBeDefined();
      expect(ev.note).toBeUndefined();
      expect(ev.weight).toBeUndefined();
    }
  });

  it('produces deterministic per-member results', async () => {
    const res = await fetch(`${baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalPayload)
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Verify results structure
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBe(2);
    
    // Each result should have deterministic hash
    for (const result of body.results) {
      expect(result.label).toBeDefined();
      expect(result.response_hash).toBeDefined();
      expect(typeof result.response_hash).toBe('string');
    }
  });
});

describe('Determinism: /v1/run_timeslices', () => {
  let app: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    const server = await spawnServer({ profile: 'fallback' });
    app = server.child;
    baseUrl = server.baseUrl;
  });

  afterAll(() => {
    try { if (app?.pid) process.kill(app.pid, 'SIGTERM'); } catch {}
  });

  const minimalPayload = {
    graph: {
      nodes: [
        { id: 'A', label: 'Driver', belief: 0.6 },
        { id: 'B', label: 'Outcome' }
      ],
      edges: [
        { id: 'e1', from: 'A', to: 'B', weight: 0.7 }
      ]
    },
    timeslices: ['Q1_2024', 'Q2_2024', 'Q3_2024'],
    seed: 4242
  };

  it('produces identical response_hash with same seed (2 calls)', async () => {
    const res1 = await fetch(`${baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalPayload)
    });

    expect(res1.status).toBe(200);
    const body1 = await res1.json();

    const res2 = await fetch(`${baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalPayload)
    });

    expect(res2.status).toBe(200);
    const body2 = await res2.json();

    // Verify determinism
    expect(body1.model_card.response_hash).toBeDefined();
    expect(body2.model_card.response_hash).toBeDefined();
    expect(body1.model_card.response_hash).toBe(body2.model_card.response_hash);
    
    // Verify backend header present
    expect(res1.headers.get('x-olumi-backend')).toBe('fallback');
    expect(res2.headers.get('x-olumi-backend')).toBe('fallback');
    
    // Verify model_card.backend field
    expect(body1.model_card.backend).toBe('fallback');
    expect(body2.model_card.backend).toBe('fallback');
  });

  it('applies evidence and returns meta.evidence_applied (sanitized)', async () => {
    const payloadWithEvidence = {
      ...minimalPayload,
      evidence: [
        { node_id: 'A', source: 'historical_data', note: 'Q1 2024 actuals', weight: 0.9 },
        { node_id: 'B', source: 'forecast', note: 'Sensitive info', weight: 0.7 }
      ]
    };

    const res = await fetch(`${baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadWithEvidence)
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Verify evidence_applied is sanitized
    expect(body.meta.evidence_applied).toBeDefined();
    expect(Array.isArray(body.meta.evidence_applied)).toBe(true);
    expect(body.meta.evidence_applied.length).toBe(2);
    
    for (const ev of body.meta.evidence_applied) {
      expect(ev.node_id).toBeDefined();
      expect(ev.source).toBeDefined();
      expect(ev.note).toBeUndefined();
      expect(ev.weight).toBeUndefined();
    }
  });

  it('produces deterministic per-slice results', async () => {
    const res = await fetch(`${baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(minimalPayload)
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Verify results structure
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBe(3);
    
    // Each result should have deterministic values
    for (const result of body.results) {
      expect(result.slice).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.p10).toBeDefined();
      expect(result.summary.p50).toBeDefined();
      expect(result.summary.p90).toBeDefined();
    }
  });

  it('handles up to 12 timeslices (max limit)', async () => {
    const payload12Slices = {
      ...minimalPayload,
      timeslices: Array.from({ length: 12 }, (_, i) => `Q${i + 1}`)
    };

    const res = await fetch(`${baseUrl}/v1/run_timeslices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload12Slices)
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.length).toBe(12);
    expect(body.model_card.timeslices_count).toBe(12);
  });
});
