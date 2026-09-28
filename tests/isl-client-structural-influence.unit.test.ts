/**
 * R3-5 — DL condition 1 (#72 5872746926, "schema skew"): PLoT's ISL-response parse must ADMIT ISL's new
 * top-level `structural_influence`. A strict or stripping parse would drop it silently, and PLoT would
 * then keep the walk on every identity graph with nobody noticing.
 *
 * This row drives the REAL `ISLClient.request` (only `fetch` is stubbed — the HTTP body is ISL's wire
 * JSON), then the real envelope reader. The body is the shape ISL's `StructuralInfluence` serialises
 * (`exclude_none`), values from ISL's walk on the served wire (see factor-influence-identity-authority).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ISLClient } from '../src/integrations/isl/client.js';
import { getIslStructuralInfluence } from '../src/integrations/isl/v2-envelope.js';

const STRUCTURAL_INFLUENCE = [
  { node_id: 'pro_paying_subscribers', influence_score: 1.0, influence_rank: 1 },
  { node_id: 'pro_plan_price', influence_score: 0.6381328979591836, influence_rank: 2 },
  { node_id: 'fac_existing_customers_grandfathered', influence_score: 0.14907816711590297, influence_rank: 3 },
  { node_id: 'monthly_churn', influence_score: 0.12, influence_rank: 4 },
  { node_id: 'other_mrr_growth', influence_score: 0.08086253369272237, influence_rank: 5 },
  { node_id: 'monthly_new_pro_subscribers', influence_score: 0.08000000000000002, influence_rank: 6 },
];

describe('R3-5 — the real ISL client parse admits `structural_influence` (no strip)', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('the list ISL sends reaches getIslStructuralInfluence deep-equal', async () => {
    const wire = { options: [], identity_evaluations: [{ node_id: 'mrr', evaluated: true }], structural_influence: STRUCTURAL_INFLUENCE };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(wire), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const client = new ISLClient({ baseUrl: 'https://isl.test', apiKey: 'k', timeoutMs: 5_000, maxRetries: 1 });
    const { data } = await client.request<any>({ endpoint: '/api/v1/robustness/analyze/v2', body: { options: [] }, requestId: 'r35' });
    expect(getIslStructuralInfluence(data)).toEqual(STRUCTURAL_INFLUENCE);
  });

  it('CONTROL: an ISL build before the list — the reader returns undefined, never a fabricated list', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ options: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const client = new ISLClient({ baseUrl: 'https://isl.test', apiKey: 'k', timeoutMs: 5_000, maxRetries: 1 });
    const { data } = await client.request<any>({ endpoint: '/api/v1/robustness/analyze/v2', body: { options: [] }, requestId: 'r35c' });
    expect(getIslStructuralInfluence(data)).toBeUndefined();
  });
});
