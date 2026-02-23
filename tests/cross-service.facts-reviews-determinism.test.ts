/**
 * Cross-service determinism test: same input → identical facts + reviews + response_hash.
 *
 * Runs the same payload twice through a real server and asserts that all
 * output components (facts, pre/post analysis reviews, response_hash) are
 * stable across identical requests.
 *
 * Each test is driven by the assertions declared in the golden fixture.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnServer, type ServerHandle } from './utils.js';

const golden = JSON.parse(
  readFileSync(
    join(import.meta.dirname, '..', 'fixtures', 'cross-service', 'facts-reviews-determinism.golden.json'),
    'utf8',
  ),
);
const assertions = golden.assertions;

describe('cross-service determinism: facts + reviews', () => {
  let server: ServerHandle;

  beforeAll(async () => {
    server = await spawnServer({
      env: {
        ENABLE_FACTS_ASSEMBLY: '1',
        ENABLE_REVIEW_PASS: '1',
        IDEMPOTENCY_ENABLE: '0',
      },
    });
  });
  afterAll(async () => { await server.kill(); });

  async function runBundle(): Promise<any> {
    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(golden.input),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('fixture declares all expected assertion keys', () => {
    // Guard: fixture must declare all assertion keys the test checks
    const requiredKeys = [
      'facts_key_order_stable',
      'pre_analysis_card_ids_stable',
      'post_analysis_card_ids_stable',
      'response_hash_stable',
      'priority_band_present',
      'provenance_present',
      'full_tuple_stable',
    ];
    for (const key of requiredKeys) {
      expect(assertions[key]).toBe(true);
    }
  });

  it('facts key order is stable across identical requests (fixture: facts_key_order_stable)', async () => {
    expect(assertions.facts_key_order_stable).toBe(true);

    const data1 = await runBundle();
    const data2 = await runBundle();

    expect(data1.facts).toBeDefined();
    expect(data2.facts).toBeDefined();

    // Compare by fact_key (deterministic) — fact_id includes per-request UUID via lineage
    const keys1 = data1.facts.facts.map((f: any) => JSON.stringify(f.fact_key));
    const keys2 = data2.facts.facts.map((f: any) => JSON.stringify(f.fact_key));
    expect(keys1).toEqual(keys2);
  });

  it('pre_analysis card IDs are stable (fixture: pre_analysis_card_ids_stable)', async () => {
    expect(assertions.pre_analysis_card_ids_stable).toBe(true);

    const data1 = await runBundle();
    const data2 = await runBundle();

    if (data1.pre_analysis_review && data2.pre_analysis_review) {
      const ids1 = data1.pre_analysis_review.cards.map((c: any) => c.card_id);
      const ids2 = data2.pre_analysis_review.cards.map((c: any) => c.card_id);
      expect(ids1).toEqual(ids2);
    }
  });

  it('post_analysis card IDs are stable (fixture: post_analysis_card_ids_stable)', async () => {
    expect(assertions.post_analysis_card_ids_stable).toBe(true);

    const data1 = await runBundle();
    const data2 = await runBundle();

    if (data1.post_analysis_review && data2.post_analysis_review) {
      const ids1 = data1.post_analysis_review.cards.map((c: any) => c.card_id);
      const ids2 = data2.post_analysis_review.cards.map((c: any) => c.card_id);
      expect(ids1).toEqual(ids2);
    }
  });

  it('response_hash is stable (fixture: response_hash_stable)', async () => {
    expect(assertions.response_hash_stable).toBe(true);

    const data1 = await runBundle();
    const data2 = await runBundle();

    expect(data1.model_card.response_hash).toBeDefined();
    expect(data1.model_card.response_hash).toBe(data2.model_card.response_hash);
  });

  it('review cards include priority_band field (fixture: priority_band_present)', async () => {
    expect(assertions.priority_band_present).toBe(true);

    const data = await runBundle();
    const validBands = ['critical', 'high', 'medium', 'low'];

    for (const phase of ['pre_analysis_review', 'post_analysis_review'] as const) {
      if (data[phase]) {
        for (const card of data[phase].cards) {
          expect(card.priority_band).toBeDefined();
          expect(validBands).toContain(card.priority_band);
        }
      }
    }
  });

  it('review cards include provenance field (fixture: provenance_present)', async () => {
    expect(assertions.provenance_present).toBe(true);

    const data = await runBundle();
    const sourceByPhase: Record<string, string> = {
      pre_analysis_review: 'validate',
      post_analysis_review: 'isl',
    };

    for (const [phase, expectedSource] of Object.entries(sourceByPhase)) {
      if (data[phase]) {
        for (const card of data[phase].cards) {
          expect(card.provenance).toBeDefined();
          expect(card.provenance.source).toBe(expectedSource);
          expect(typeof card.provenance.origin_id).toBe('string');
        }
      }
    }
  });

  it('full card tuples are stable across identical requests (fixture: full_tuple_stable)', async () => {
    expect(assertions.full_tuple_stable).toBe(true);

    const data1 = await runBundle();
    const data2 = await runBundle();

    for (const phase of ['pre_analysis_review', 'post_analysis_review'] as const) {
      if (data1[phase] && data2[phase]) {
        const tuples1 = data1[phase].cards.map((c: any) => [
          c.priority, c.card_type, c.card_id, c.priority_band,
          c.provenance?.source, c.provenance?.origin_id,
        ]);
        const tuples2 = data2[phase].cards.map((c: any) => [
          c.priority, c.card_type, c.card_id, c.priority_band,
          c.provenance?.source, c.provenance?.origin_id,
        ]);
        expect(tuples1).toEqual(tuples2);
      }
    }
  });
});
