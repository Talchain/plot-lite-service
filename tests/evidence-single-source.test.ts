/**
 * Phase 3: Evidence single source of truth
 * Proves sanitizeEvidence() is the single source and only returns node_id + source
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

describe('Evidence single source of truth', () => {
  let server: ServerHandle;

  beforeAll(async () => { server = await spawnServer({ profile: 'fallback' }); });
  afterAll(async () => { await server.kill(); });

  const testGraph = {
    nodes: [
      { id: 'A', label: 'Node A' },
      { id: 'B', label: 'Node B' }
    ],
    edges: [{ id: 'e1', from: 'A', to: 'B', weight: 0.7 }]
  };

  const evidenceWithExtraFields = [
    {
      node_id: 'A',
      source: 'user_input',
      weight: 0.9,  // Should be stripped
      note: 'test note',  // Should be stripped
      confidence: 0.95,  // Should be stripped
      timestamp: '2024-01-01'  // Should be stripped
    }
  ];

  describe('/v1/run: uses single sanitizer', () => {
    it('strips all fields except node_id and source', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          evidence: evidenceWithExtraFields,
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      
      expect(body.meta.evidence_applied).toBeDefined();
      expect(body.meta.evidence_applied).toHaveLength(1);
      
      const sanitized = body.meta.evidence_applied[0];
      expect(sanitized).toEqual({
        node_id: 'A',
        source: 'user_input'
      });
      expect(Object.keys(sanitized)).toHaveLength(2);
    });
  });

  describe('/v1/optimise: uses single sanitizer', () => {
    it('strips all fields except node_id and source', async () => {
      const res = await fetch(`${server.baseUrl}/v1/optimise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          graph: testGraph,
          budget: 100,
          actions: [{ id: 'a1', cost: 50, do: [] }],
          objective: { type: 'utility_linear', weights: { B: 1.0 } },
          evidence: evidenceWithExtraFields,
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      
      expect(body.meta.evidence_applied).toBeDefined();
      expect(body.meta.evidence_applied).toHaveLength(1);
      
      const sanitized = body.meta.evidence_applied[0];
      expect(sanitized).toEqual({
        node_id: 'A',
        source: 'user_input'
      });
      expect(Object.keys(sanitized)).toHaveLength(2);
    });
  });

  describe('/v1/run_bundle: uses single sanitizer', () => {
    it('strips all fields except node_id and source', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_graph: testGraph,
          deltas: [{ label: 's1' }],
          evidence: evidenceWithExtraFields,
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      
      expect(body.meta.evidence_applied).toBeDefined();
      expect(body.meta.evidence_applied).toHaveLength(1);
      
      const sanitized = body.meta.evidence_applied[0];
      expect(sanitized).toEqual({
        node_id: 'A',
        source: 'user_input'
      });
      expect(Object.keys(sanitized)).toHaveLength(2);
    });
  });

  describe('/v1/run_timeslices: uses single sanitizer', () => {
    it.skip('strips all fields except node_id and source', async () => {
      const res = await fetch(`${server.baseUrl}/v1/run_timeslices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_graph: testGraph,
          timeslices: [{ slice: 'Q1', overrides: [] }],
          evidence: evidenceWithExtraFields,
          seed: 4242
        })
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      
      expect(body.meta.evidence_applied).toBeDefined();
      expect(body.meta.evidence_applied).toHaveLength(1);
      
      const sanitized = body.meta.evidence_applied[0];
      expect(sanitized).toEqual({
        node_id: 'A',
        source: 'user_input'
      });
      expect(Object.keys(sanitized)).toHaveLength(2);
    });
  });

  describe('Uniform sanitization across all endpoints', () => {
    it('all endpoints return identical sanitized shape', async () => {
      const endpoints = [
        {
          url: '/v1/run',
          body: { graph: testGraph, evidence: evidenceWithExtraFields, seed: 4242 }
        },
        {
          url: '/v1/optimise',
          body: {
            graph: testGraph,
            budget: 100,
            actions: [{ id: 'a1', cost: 50, do: [] }],
            objective: { type: 'utility_linear', weights: { B: 1.0 } },
            evidence: evidenceWithExtraFields,
            seed: 4242
          }
        },
        {
          url: '/v1/run_bundle',
          body: {
            base_graph: testGraph,
            deltas: [{ label: 's1' }],
            evidence: evidenceWithExtraFields,
            seed: 4242
          }
        }
      ];

      const sanitizedResults = [];

      for (const endpoint of endpoints) {
        const res = await fetch(`${server.baseUrl}${endpoint.url}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(endpoint.body)
        });

        const body = await res.json();
        sanitizedResults.push(body.meta.evidence_applied[0]);
      }

      // All endpoints should return identical sanitized evidence
      const expected = { node_id: 'A', source: 'user_input' };
      for (const result of sanitizedResults) {
        expect(result).toEqual(expected);
        expect(Object.keys(result)).toHaveLength(2);
      }
    });
  });
});
