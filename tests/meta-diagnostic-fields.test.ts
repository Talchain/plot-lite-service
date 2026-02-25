/**
 * Meta Diagnostic Fields Tests
 *
 * Verifies the 4 new diagnostic fields added to `_meta` in the /v2/run response:
 *   - feature_flags_snapshot: snapshot of all feature flags
 *   - decision_brief_assembled: whether assembleBrief() returned non-null
 *   - review_cards_count: number of review cards assembled
 *   - evidence_priority_card_present: whether the EP card was emitted
 *
 * Also verifies:
 *   - _meta fields are excluded from response_hash (regression)
 *   - decision_brief.lineage.response_hash matches top-level response_hash
 *
 * Uses createServer() + app.inject() with ISL disabled (graph_fallback path).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { KNOWN_FEATURE_FLAGS } from '../src/config/feature-flags.js';

// ---------------------------------------------------------------------------
// Fixtures
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('_meta diagnostic fields (debug output audit)', () => {
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

  async function postV2Run(body: object = VALID_BODY): Promise<any> {
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.payload);
  }

  // -------------------------------------------------------------------------
  // 1. feature_flags_snapshot
  // -------------------------------------------------------------------------

  it('_meta.feature_flags_snapshot is present with known flag keys', async () => {
    const data = await postV2Run();
    const flags = data._meta?.feature_flags_snapshot;

    expect(flags).toBeDefined();
    expect(typeof flags).toBe('object');

    // Must contain at least a subset of known flags
    const flagKeys = Object.keys(flags);
    expect(flagKeys.length).toBeGreaterThan(0);

    // Every key in the snapshot should be from the known set
    for (const key of flagKeys) {
      expect(
        (KNOWN_FEATURE_FLAGS as readonly string[]).includes(key),
      ).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // 2. decision_brief_assembled
  // -------------------------------------------------------------------------

  it('_meta.decision_brief_assembled is true when analysis succeeds', async () => {
    const data = await postV2Run();

    expect(typeof data._meta?.decision_brief_assembled).toBe('boolean');

    // On the graph_fallback path with a valid graph, analysis should succeed
    // and brief should be assembled (computed or partial → non-null)
    if (data.analysis_status === 'computed' || data.analysis_status === 'partial') {
      expect(data._meta.decision_brief_assembled).toBe(true);
      expect(data.decision_brief).not.toBeNull();
    }
  });

  // -------------------------------------------------------------------------
  // 3. review_cards_count
  // -------------------------------------------------------------------------

  it('_meta.review_cards_count is a non-negative integer', async () => {
    const data = await postV2Run();

    expect(typeof data._meta?.review_cards_count).toBe('number');
    expect(Number.isInteger(data._meta.review_cards_count)).toBe(true);
    expect(data._meta.review_cards_count).toBeGreaterThanOrEqual(0);

    // Count should match actual review_cards array length
    const actualCards = data.review_cards ?? [];
    expect(data._meta.review_cards_count).toBe(actualCards.length);
  });

  // -------------------------------------------------------------------------
  // 4. evidence_priority_card_present
  // -------------------------------------------------------------------------

  it('_meta.evidence_priority_card_present is boolean and matches review_cards', async () => {
    const data = await postV2Run();

    expect(typeof data._meta?.evidence_priority_card_present).toBe('boolean');

    const cards = data.review_cards ?? [];
    const hasEP = cards.some((c: any) => c.card_type === 'evidence_priority');
    expect(data._meta.evidence_priority_card_present).toBe(hasEP);
  });

  // -------------------------------------------------------------------------
  // 5. _meta excluded from response_hash (regression test)
  // -------------------------------------------------------------------------

  it('response_hash is computed from request inputs only, not _meta', async () => {
    // Send the same request twice — response_hash must be identical
    // even though _meta may differ (e.g., different request_id)
    const data1 = await postV2Run();
    const data2 = await postV2Run();

    expect(data1.response_hash).toBeDefined();
    expect(data2.response_hash).toBeDefined();
    expect(data1.response_hash).toBe(data2.response_hash);

    // Verify _meta exists and request_id differs (auto-generated),
    // proving _meta variability does not affect response_hash
    expect(data1._meta).toBeDefined();
    expect(data2._meta).toBeDefined();
    expect(data1._meta.request_id).not.toBe(data2._meta.request_id);
  });

  // -------------------------------------------------------------------------
  // 6. decision_brief.lineage.response_hash matches top-level response_hash
  // -------------------------------------------------------------------------

  it('decision_brief.lineage.response_hash matches top-level response_hash', async () => {
    const data = await postV2Run();

    if (data.decision_brief != null) {
      expect(data.decision_brief.lineage).toBeDefined();
      expect(data.decision_brief.lineage.response_hash).toBe(data.response_hash);
    }
  });
});
