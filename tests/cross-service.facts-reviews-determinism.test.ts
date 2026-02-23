/**
 * Cross-service determinism test: same input → identical facts + reviews + response_hash.
 *
 * Runs the same payload twice through a real server and asserts that all
 * output components (facts, pre/post analysis reviews, response_hash) are
 * stable across identical requests.
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

  it('facts order is stable across identical requests', async () => {
    const data1 = await runBundle();
    const data2 = await runBundle();

    expect(data1.facts).toBeDefined();
    expect(data2.facts).toBeDefined();

    // Compare by fact_key (deterministic) — fact_id includes per-request UUID via lineage
    const keys1 = data1.facts.facts.map((f: any) => JSON.stringify(f.fact_key));
    const keys2 = data2.facts.facts.map((f: any) => JSON.stringify(f.fact_key));
    expect(keys1).toEqual(keys2);
  });

  it('pre_analysis card IDs are stable', async () => {
    const data1 = await runBundle();
    const data2 = await runBundle();

    if (data1.pre_analysis_review && data2.pre_analysis_review) {
      const ids1 = data1.pre_analysis_review.cards.map((c: any) => c.card_id);
      const ids2 = data2.pre_analysis_review.cards.map((c: any) => c.card_id);
      expect(ids1).toEqual(ids2);
    }
  });

  it('post_analysis card IDs are stable', async () => {
    const data1 = await runBundle();
    const data2 = await runBundle();

    if (data1.post_analysis_review && data2.post_analysis_review) {
      const ids1 = data1.post_analysis_review.cards.map((c: any) => c.card_id);
      const ids2 = data2.post_analysis_review.cards.map((c: any) => c.card_id);
      expect(ids1).toEqual(ids2);
    }
  });

  it('response_hash is stable', async () => {
    const data1 = await runBundle();
    const data2 = await runBundle();

    expect(data1.model_card.response_hash).toBeDefined();
    expect(data1.model_card.response_hash).toBe(data2.model_card.response_hash);
  });

  it('review cards include priority_band field', async () => {
    const data = await runBundle();
    const validBands = ['critical', 'high', 'medium', 'low'];

    if (data.pre_analysis_review) {
      for (const card of data.pre_analysis_review.cards) {
        expect(card.priority_band).toBeDefined();
        expect(validBands).toContain(card.priority_band);
      }
    }

    if (data.post_analysis_review) {
      for (const card of data.post_analysis_review.cards) {
        expect(card.priority_band).toBeDefined();
        expect(validBands).toContain(card.priority_band);
      }
    }
  });

  it('review cards include provenance field', async () => {
    const data = await runBundle();

    if (data.pre_analysis_review) {
      for (const card of data.pre_analysis_review.cards) {
        expect(card.provenance).toBeDefined();
        expect(card.provenance.source).toBe('validate');
        expect(card.provenance.origin_id).toBeDefined();
      }
    }

    if (data.post_analysis_review) {
      for (const card of data.post_analysis_review.cards) {
        expect(card.provenance).toBeDefined();
        expect(card.provenance.source).toBe('isl');
        expect(card.provenance.origin_id).toBeDefined();
      }
    }
  });
});
