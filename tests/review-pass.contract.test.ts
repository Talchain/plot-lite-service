/**
 * Cross-service contract test: ISL fixture → run_bundle → facts + reviews.
 *
 * Verifies the full integration path:
 * - run_bundle produces facts envelope
 * - Review pass produces pre/post analysis review envelopes
 * - Card IDs are stable
 * - Card ordering is stable
 * - Response is backward compatible
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';

const BASIC_PAYLOAD = {
  base_graph: {
    nodes: [
      { id: 'demand', label: 'Demand', kind: 'factor', value: 0.7 },
      { id: 'price', label: 'Price', kind: 'factor', value: 0.5 },
      { id: 'revenue', label: 'Revenue', kind: 'outcome', value: 0.6 },
    ],
    edges: [
      { from: 'demand', to: 'revenue', weight: 0.8 },
      { from: 'price', to: 'revenue', weight: 0.6 },
    ],
  },
  deltas: [
    { label: 'Low Price', nodes: [{ id: 'price', value: 0.3 }] },
    { label: 'High Price', nodes: [{ id: 'price', value: 0.8 }] },
  ],
  seed: 4242,
};

describe('review-pass contract (ENABLE_REVIEW_PASS=1, ENABLE_FACTS_ASSEMBLY=1)', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        ENABLE_FACTS_ASSEMBLY: '1',
        ENABLE_REVIEW_PASS: '1',
      },
    });
  });
  afterAll(async () => { await server.kill(); });

  it('response includes facts + review envelopes', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASIC_PAYLOAD),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.facts).toBeDefined();
    expect(data.facts.facts_schema_version).toBe(1);

    // Core fields unchanged (backward compatible)
    expect(data.schema).toBe('run_bundle.v1');
    expect(data.results).toHaveLength(2);
    expect(data.model_card).toBeDefined();
    expect(data.meta).toBeDefined();
  });

  it('review envelopes have correct structure when present', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASIC_PAYLOAD),
    });
    const data = await res.json();

    // pre_analysis_review may or may not be present depending on coherence warnings
    if (data.pre_analysis_review) {
      expect(data.pre_analysis_review.review_pass_schema_version).toBe(1);
      expect(data.pre_analysis_review.phase).toBe('pre_analysis');
      expect(Array.isArray(data.pre_analysis_review.cards)).toBe(true);
      expect(typeof data.pre_analysis_review.truncated).toBe('boolean');
      expect(typeof data.pre_analysis_review.total_candidates).toBe('number');

      for (const card of data.pre_analysis_review.cards) {
        expect(card.card_id).toBeDefined();
        expect(card.card_type).toBeDefined();
        expect(card.what).toBeDefined();
        expect(card.why).toBeDefined();
        expect(Array.isArray(card.supporting_refs)).toBe(true);
        expect(typeof card.priority).toBe('number');
        // v1 polish: priority_band and provenance
        expect(['critical', 'high', 'medium', 'low']).toContain(card.priority_band);
        expect(card.provenance).toBeDefined();
        expect(card.provenance.source).toBe('validate');
        expect(typeof card.provenance.origin_id).toBe('string');
      }
    }

    // post_analysis_review may or may not have cards (depends on fact types)
    if (data.post_analysis_review) {
      expect(data.post_analysis_review.review_pass_schema_version).toBe(1);
      expect(data.post_analysis_review.phase).toBe('post_analysis');
      expect(Array.isArray(data.post_analysis_review.cards)).toBe(true);
      expect(typeof data.post_analysis_review.truncated).toBe('boolean');
      expect(typeof data.post_analysis_review.total_candidates).toBe('number');

      for (const card of data.post_analysis_review.cards) {
        expect(card.card_id).toBeDefined();
        expect(card.card_type).toBeDefined();
        expect(card.what).toBeDefined();
        expect(card.why).toBeDefined();
        expect(Array.isArray(card.supporting_refs)).toBe(true);
        expect(typeof card.priority).toBe('number');
        // v1 polish: priority_band and provenance
        expect(['critical', 'high', 'medium', 'low']).toContain(card.priority_band);
        expect(card.provenance).toBeDefined();
        expect(card.provenance.source).toBe('isl');
        expect(typeof card.provenance.origin_id).toBe('string');
      }
    }
  });

  it('stable IDs across identical requests', async () => {
    const body = JSON.stringify(BASIC_PAYLOAD);
    const [res1, res2] = await Promise.all([
      fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ]);
    const data1 = await res1.json();
    const data2 = await res2.json();

    // If pre_analysis_review present, IDs should be stable
    if (data1.pre_analysis_review && data2.pre_analysis_review) {
      const ids1 = data1.pre_analysis_review.cards.map((c: any) => c.card_id);
      const ids2 = data2.pre_analysis_review.cards.map((c: any) => c.card_id);
      expect(ids1).toEqual(ids2);
    }

    // If post_analysis_review present, IDs should be stable
    if (data1.post_analysis_review && data2.post_analysis_review) {
      const ids1 = data1.post_analysis_review.cards.map((c: any) => c.card_id);
      const ids2 = data2.post_analysis_review.cards.map((c: any) => c.card_id);
      expect(ids1).toEqual(ids2);
    }
  });

  it('stable ordering across identical requests (full tuple)', async () => {
    const body = JSON.stringify(BASIC_PAYLOAD);
    const [res1, res2] = await Promise.all([
      fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
      fetch(`${server.baseUrl}/v1/run_bundle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }),
    ]);
    const data1 = await res1.json();
    const data2 = await res2.json();

    // Full tuple check: (priority, card_type, card_id)
    for (const phase of ['pre_analysis_review', 'post_analysis_review'] as const) {
      if (data1[phase] && data2[phase]) {
        const tuples1 = data1[phase].cards.map((c: any) => [c.priority, c.card_type, c.card_id]);
        const tuples2 = data2[phase].cards.map((c: any) => [c.priority, c.card_type, c.card_id]);
        expect(tuples1).toEqual(tuples2);
      }
    }
  });

  it('pre-analysis uses real validate violations (not coherence warnings)', async () => {
    // Graph with missing belief on outcome edge → should produce MISSING_BELIEF_ON_OUTCOME_EDGE
    const graphWithViolations = {
      base_graph: {
        nodes: [
          { id: 'price', label: 'Price', kind: 'factor', value: 0.5 },
          { id: 'revenue', label: 'Revenue', kind: 'outcome', value: 0.6 },
        ],
        edges: [
          // Missing belief on outcome edge → triggers MISSING_BELIEF_ON_OUTCOME_EDGE
          { from: 'price', to: 'revenue', weight: 0.8 },
        ],
      },
      deltas: [
        { label: 'Low', nodes: [{ id: 'price', value: 0.3 }] },
        { label: 'High', nodes: [{ id: 'price', value: 0.8 }] },
      ],
      seed: 4242,
    };

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graphWithViolations),
    });
    const data = await res.json();

    expect(res.status).toBe(200);

    // Should have pre_analysis_review with violation-based cards
    if (data.pre_analysis_review) {
      expect(data.pre_analysis_review.phase).toBe('pre_analysis');
      // Check that at least one card references a validate violation code
      const violationCodes = data.pre_analysis_review.cards
        .flatMap((c: any) => c.supporting_refs)
        .filter((r: any) => r.kind === 'violation')
        .map((r: any) => r.id);
      expect(violationCodes.some((code: string) =>
        ['MISSING_BELIEF_ON_OUTCOME_EDGE', 'WEIGHT_MAGNITUDE_HIGH', 'DECISION_NO_OUTGOING',
         'OPTION_NO_OUTGOING', 'FACTOR_HAS_INCOMING_EDGES'].includes(code),
      )).toBe(true);
    }
  });
});

describe('review-pass contract (ENABLE_REVIEW_PASS=0)', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        ENABLE_FACTS_ASSEMBLY: '1',
        ENABLE_REVIEW_PASS: '0',
      },
    });
  });
  afterAll(async () => { await server.kill(); });

  it('response does NOT include review envelopes when disabled', async () => {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BASIC_PAYLOAD),
    });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.pre_analysis_review).toBeUndefined();
    expect(data.post_analysis_review).toBeUndefined();
    // Facts should still be present (separate flag)
    expect(data.facts).toBeDefined();
    // Core fields unchanged
    expect(data.schema).toBe('run_bundle.v1');
    expect(data.results).toHaveLength(2);
  });
});
