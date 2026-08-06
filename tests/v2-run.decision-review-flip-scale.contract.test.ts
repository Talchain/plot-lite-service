/**
 * /v2/run route-level contract for ROADMAP 2.676 — the flip rows PLoT hands to
 * CEE's `decision_review` prompt must be the SAME numbers its own response
 * publishes.
 *
 * ⚠ THIS FILE'S FIXTURE IS COMMITTED EVIDENCE, NOT SELF-AUTHORED (trap
 * 16-inverse). The request body is byte-for-byte
 * `PHASE0-EVIDENCE-2026-07-28/probe2676-2026-08-07/probe-request.json`, and the
 * CEE reply is that probe's own `m1_review` object
 * (`tests/fixtures/probe-2676-m1-review.json`, lifted verbatim from
 * `probe-response.json`). Both were taken against the DEPLOYED builds, so the
 * shapes here are what the wire actually carries rather than what this lane
 * imagines it carries.
 *
 * WHAT THE PROBE MEASURED, and what each test below pins:
 *
 *   probe-response.json   `review_status: 'complete'`, and inside it
 *                         `"0.5 GBP" → "0.382593 GBP"` for a factor whose true
 *                         pair the SAME response publishes as
 *                         `16000 GBP → 12243 GBP`. A fabricated magnitude
 *                         shipped to the user.  → test 1
 *   probe-response-2.json `review_status: 'failed'`,
 *                         `review_failure_codes: ['MODIFIED_VALUES']`. Same
 *                         request, same build: when the model declined the
 *                         fabricated pairing and wrote the honest number,
 *                         PLoT's own Tier-7 guard — enforcing identity against
 *                         the WRONG number — discarded the entire review.
 *                                                                → test 2
 *
 * One cause (`run.ts` passing UN-denormalised rows as `preResolvedFlipData`),
 * two faces, split by LLM variance.
 *
 * ISL is mocked at module level — the pattern
 * `tests/v2-run.flip-display-scale.contract.test.ts` uses — because a real ISL
 * is unreachable in CI and without one `flip_thresholds` is `[]` and every
 * assertion below would pass by testing nothing.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const OPTION_IDS = ['opt_marketing_push', 'opt_new_channel'] as const;

/** `opt_marketing_push` is the alternative winner on every flip row below. */
function mockOptions(options: Array<{ id: string }>): unknown[] {
  return options.map((opt, idx) => ({
    option_id: opt.id,
    label: opt.id === OPTION_IDS[0] ? 'Marketing push' : 'New sales channel',
    win_probability: idx === 0 ? 0.42 : 0.58,
    outcome: {
      mean: 0.6 - idx * 0.1,
      std: 0.1,
      p10: 0.4,
      p50: 0.6,
      p90: 0.8,
      n_samples: 1000,
      n_valid_samples: 1000,
      validity_ratio: 1.0,
    },
    rank: idx + 1,
  }));
}

const MOCK_FACTOR_SENSITIVITY = [
  { node_id: 'fac_price', factor_id: 'fac_price', factor_label: 'Unit price', sensitivity_score: 0.62, elasticity: 0.62, direction: 'positive', value_of_information: 0.1 },
  { node_id: 'fac_retention', factor_id: 'fac_retention', factor_label: 'Customer retention rate', sensitivity_score: 0.41, elasticity: 0.41, direction: 'positive', value_of_information: 0.1 },
  { node_id: 'fac_headcount', factor_id: 'fac_headcount', factor_label: 'Engineering headcount', sensitivity_score: 0.3, elasticity: 0.3, direction: 'positive', value_of_information: 0.1 },
  { node_id: 'fac_budget', factor_id: 'fac_budget', factor_label: 'Marketing budget', sensitivity_score: 0.25, elasticity: 0.25, direction: 'positive', value_of_information: 0.1 },
];

/**
 * ISL's closed-form block, in NORMALISED space — which is the only space ISL
 * ever works in. These are the probe's own numbers: `0.382593 × 32000 = 12243`,
 * the flip value the deployed response published at top level.
 *
 * The two extra factors are the un-liftable cases, carried on the SAME response
 * as controls:
 *   `fac_headcount` — unit, no cap, no raw_value ⇒ scale ABSENT + unit present.
 *                     CEE's own committed staging capture is this exact shape
 *                     (`current_value: 0.3, unit: 'engineers'`).
 *   `fac_budget`    — unit + raw_value but NO cap ⇒ scale positively
 *                     attested `'normalised'`.
 */
const MOCK_FACTOR_FLIP_VALUES = [
  {
    factor_id: 'fac_price',
    current_value: 0.5,
    flip_value: 0.382593,
    direction: 'decrease',
    flip_reason: 'found',
    alternative_winner_id: OPTION_IDS[0],
    baseline_winner_id: OPTION_IDS[1],
  },
  {
    factor_id: 'fac_retention',
    current_value: 0.29,
    flip_value: 0.407407,
    direction: 'increase',
    flip_reason: 'found',
    alternative_winner_id: OPTION_IDS[0],
    baseline_winner_id: OPTION_IDS[1],
  },
  {
    factor_id: 'fac_headcount',
    current_value: 0.3,
    flip_value: 0.62,
    direction: 'increase',
    flip_reason: 'found',
    alternative_winner_id: OPTION_IDS[0],
    baseline_winner_id: OPTION_IDS[1],
  },
  {
    factor_id: 'fac_budget',
    current_value: 0.4,
    flip_value: 0.7,
    direction: 'increase',
    flip_reason: 'found',
    alternative_winner_id: OPTION_IDS[0],
    baseline_winner_id: OPTION_IDS[1],
  },
];

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable' as const,
      confidence: 'high' as const,
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' },
      source: 'isl' as const,
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'fragile', sensitive_parameters: [], recommendations: [], source: 'isl' as const };
  },
  async analyseRobustness(_graph: unknown, _goalNodeId: string, options: Array<{ id: string }>) {
    return {
      options: mockOptions(options),
      edges: [],
      edges_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      edge_sensitivity_status: 'available' as const,
      factor_sensitivity: MOCK_FACTOR_SENSITIVITY,
      factors: [], value_of_information: [],
      factors_provenance: 'isl:/api/v1/robustness/analyze/v2' as const,
      factor_sensitivity_status: 'available' as const,
      overall_robustness: 'fragile' as const, robustness_score: 0.4,
      fragile_edges: [], robust_edges: [], latency_ms: 10, source: 'isl' as const,
    };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'fragile' as const, robustness_score: 0.4, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(_endpoint: string, body: { options?: Array<{ id: string }> }): Promise<{ data: T | null; error: string | null }> {
    const options = body.options ?? [];
    return {
      data: {
        options: mockOptions(options),
        edges: [],
        factor_sensitivity: MOCK_FACTOR_SENSITIVITY,
        factor_flip_values: MOCK_FACTOR_FLIP_VALUES,
        conditional_winners: [],
        overall_robustness: 'fragile', robustness_score: 0.4,
        fragile_edges: [], robust_edges: [],
      } as T,
      error: null,
    };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';
import { clearReviewCache } from '../src/cee/validation/review-cache.js';

/**
 * The probe's graph, verbatim from `probe-request.json`, plus the two
 * un-liftable control factors. `fac_price` is the subject: normalised `value`,
 * the user's own `raw_value`, and the authoritative `cap` — the shape CEE's V5
 * payload carries, with every intervention value inside [0,1] so Phase 4a never
 * builds a `normalisationContext` and the node itself is the only scale source.
 */
const REQUEST_BODY = {
  graph: {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Maximise annual profit' },
      { id: 'fac_price', kind: 'factor', label: 'Unit price', observed_state: { value: 0.5, raw_value: 16000, cap: 32000, unit: 'GBP' } },
      { id: 'fac_retention', kind: 'factor', label: 'Customer retention rate', observed_state: { value: 0.29 } },
      // Un-liftable control A: a unit, but nothing to invert it with.
      { id: 'fac_headcount', kind: 'factor', label: 'Engineering headcount', observed_state: { value: 0.3, unit: 'engineers' } },
      // Un-liftable control B: raw_value attests normalisation, but no cap.
      { id: 'fac_budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.4, raw_value: 4000, unit: 'GBP' } },
      { id: 'fac_marketing', kind: 'factor', label: 'Marketing intensity', observed_state: { value: 0.4 } },
      { id: 'fac_channel', kind: 'factor', label: 'Sales channel reach', observed_state: { value: 0.4 } },
    ],
    edges: [
      { from: 'fac_price', to: 'fac_marketing', exists_probability: 0.9, strength: { mean: 0.6, std: 0.12 } },
      { from: 'fac_price', to: 'goal', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
      { from: 'fac_retention', to: 'fac_channel', exists_probability: 0.9, strength: { mean: 0.6, std: 0.12 } },
      { from: 'fac_retention', to: 'goal', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
      { from: 'fac_headcount', to: 'goal', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
      { from: 'fac_budget', to: 'goal', exists_probability: 0.9, strength: { mean: 0.3, std: 0.1 } },
      { from: 'fac_marketing', to: 'goal', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
      { from: 'fac_channel', to: 'goal', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
    ],
  },
  options: [
    { id: OPTION_IDS[0], label: 'Marketing push', interventions: { fac_marketing: { value: 0.85 } } },
    { id: OPTION_IDS[1], label: 'New sales channel', interventions: { fac_channel: { value: 0.8 } } },
  ],
  goal_node_id: 'goal',
  seed: 20260806,
  brief: 'Should we invest in a marketing push or open a new sales channel to maximise annual profit? Our unit price and customer retention both matter and we are unsure which choice is safer.',
};

const PROBE_M1_REVIEW = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/probe-2676-m1-review.json', import.meta.url)), 'utf8'),
) as Record<string, unknown>;

/**
 * The probe's review with its flip block rewritten to the HONEST user-scale
 * numbers — i.e. what a model that obeys the prompt writes once the prompt is
 * fed the truth. On the deployed build this is precisely what triggered
 * `MODIFIED_VALUES`, because Tier-7 was comparing against `0.5`.
 */
function honestFlipReview(): Record<string, unknown> {
  return {
    ...PROBE_M1_REVIEW,
    flip_thresholds: [
      {
        factor_id: 'fac_price',
        factor_label: 'Unit price',
        current_display: '16000 GBP',
        flip_display: '12243 GBP',
        narrative: 'If Unit price decreases from 16000 GBP to 12243 GBP, Marketing push becomes the leading option.',
      },
      {
        factor_id: 'fac_retention',
        factor_label: 'Customer retention rate',
        current_display: '0.29',
        flip_display: '0.407407',
        narrative: 'If Customer retention rate increases from 0.29 to 0.407407, Marketing push would lead.',
      },
    ],
  };
}

interface Captured { url: string; body: Record<string, unknown> }

/**
 * Drive one `/v2/run`, intercepting the outbound CEE call.
 *
 * `fetch` is stubbed rather than the client module: the assertion subject is
 * the WIRE BODY, and stubbing the module would let a serialisation-layer defect
 * through. Any non-CEE fetch is failed loudly rather than silently allowed —
 * a stub that answers everything is a stub that hides what it answered.
 */
async function runOnce(
  ceeReview: Record<string, unknown> | null,
): Promise<{ response: Record<string, unknown>; captured: Captured[] }> {
  // ⚠ SELF-CAUGHT INSTRUMENT DEFECT, kept as a guard. The review cache is keyed
  // on `responseHash + briefHash` ONLY (`review-cache.ts:66`), and this file
  // replays the SAME request body twice. Without this reset the second run
  // logged `decision_review.cache_hit`, served run 1's review, and never called
  // CEE at all — so the Tier-7 rejection test passed judgement on a validation
  // that never ran. Each run's `captured` length is asserted by its caller, so
  // a future regression here fails loudly rather than going vacuous.
  clearReviewCache();

  const captured: Captured[] = [];
  const stub = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    if (!url.includes('/assist/v1/decision-review')) {
      throw new Error(`unexpected outbound fetch in this suite: ${url}`);
    }
    captured.push({ url, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
    return new Response(
      JSON.stringify({ review: ceeReview, _meta: { model: 'gpt-4.1', latency_ms: 12, tokens: 900 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', stub);

  const app: FastifyInstance = await createServer();
  try {
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'content-type': 'application/json' },
      payload: REQUEST_BODY,
    });
    expect(res.statusCode).toBe(200);
    return { response: JSON.parse(res.body) as Record<string, unknown>, captured };
  } finally {
    await app.close();
    vi.unstubAllGlobals();
  }
}

type FlipRow = Record<string, unknown>;

describe('V2 Run · decision-review flip scale (ROADMAP 2.676)', () => {
  let sent: FlipRow[];
  let topLevel: FlipRow[];
  let honestRunStatus: unknown;
  let honestRunFailureCodes: unknown;
  let honestRunCallCount = 0;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = 'true';
    process.env.CEE_BASE_URL = 'http://cee.invalid';
    process.env.CEE_API_KEY = 'test-2676-key';

    const honest = await runOnce(honestFlipReview());
    sent = (honest.captured[0]?.body.flip_threshold_data as FlipRow[]) ?? [];
    topLevel = (honest.response.flip_thresholds as FlipRow[]) ?? [];
    honestRunStatus = honest.response.review_status;
    honestRunFailureCodes = honest.response.review_failure_codes;
    honestRunCallCount = honest.captured.length;
  }, 120_000);

  afterAll(() => {
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.DECISION_REVIEW_ENABLE;
    delete process.env.CEE_BASE_URL;
    delete process.env.CEE_API_KEY;
  });

  it('ANTI-VACUITY: the run reached CEE with flip rows, and published its own', () => {
    // Without this, an empty array would let every assertion below pass by
    // testing nothing (trap 13). Both arrays are asserted because the whole
    // subject of this file is that the two must AGREE.
    expect(honestRunCallCount).toBe(1);
    expect(sent.length).toBeGreaterThan(0);
    expect(topLevel.length).toBeGreaterThan(0);
    expect(topLevel.some((r) => r.factor_id === 'fac_price')).toBe(true);
  });

  it('THE FIX: the CEE request carries 16000, not 0.5, for the display-scale row', () => {
    // Bound by IDENTITY (factor_id), never by a value predicate another row
    // could satisfy — trap 19.
    const price = sent.find((r) => r.factor_id === 'fac_price');
    expect(price).toBeDefined();

    // The measured lie, named so a regression reads as itself in the diff.
    expect(price!.current_value).not.toBe(0.5);
    expect(price!.flip_value).not.toBe(0.382593);

    expect(price!.current_value).toBe(16000);
    expect(price!.flip_value).toBe(12243);
    // The unit is what makes the number quotable; it must survive the lift.
    expect(price!.unit).toBe('GBP');
  });

  it('the request and the response publish the SAME pair for the same factor', () => {
    // The invariant behind the fix, stated once: one factor, one number. This is
    // what makes a future refactor that re-splits the two paths go red.
    const sentPrice = sent.find((r) => r.factor_id === 'fac_price');
    const shownPrice = topLevel.find((r) => r.factor_id === 'fac_price');
    expect(sentPrice).toBeDefined();
    expect(shownPrice).toBeDefined();
    expect(sentPrice!.current_value).toBe(shownPrice!.current_value);
    expect(sentPrice!.flip_value).toBe(shownPrice!.flip_value);
  });

  it('TIER-7 FOLLOWS: an honest 16000 GBP review is no longer killed by MODIFIED_VALUES', () => {
    // probe-response-2.json's second face, reproduced and closed. Tier-7 reads
    // `request.flip_threshold_data` through `buildValidationContext(request)`,
    // so correcting that array is the whole fix — there is no separate guard to
    // change, and this test is what proves it.
    const codes = (honestRunFailureCodes as string[] | undefined) ?? [];
    expect(codes).not.toContain('MODIFIED_VALUES');
    expect(honestRunStatus).toBe('complete');
  });

  it('TIER-7 STILL BITES: the probe\'s fabricated "0.5 GBP" review is REJECTED', async () => {
    // The negative half of the pair. A fix that made Tier-7 stop firing would
    // pass the test above and fail this one — the guard must still enforce
    // identity, now against the TRUE number.
    const fabricated = await runOnce(PROBE_M1_REVIEW);
    // Pin this run's own precondition: the verdict below is only evidence about
    // Tier-7 if CEE was actually called and actually returned the fabricated
    // review (trap 13b — a discriminator must pin what makes it discriminate).
    expect(fabricated.captured).toHaveLength(1);
    const codes = (fabricated.response.review_failure_codes as string[] | undefined) ?? [];
    expect(codes).toContain('MODIFIED_VALUES');
    expect(fabricated.response.m1_review).toBeNull();
  }, 120_000);

  it('UN-LIFTABLE ROWS: no row reaches the prompt wearing a unit it cannot honour', () => {
    // The property, stated over the WHOLE array rather than one row — a new
    // un-liftable shape is caught without anyone remembering to add a case.
    for (const row of sent) {
      const unit = typeof row.unit === 'string' ? row.unit.trim() : '';
      if (unit.length === 0) continue;
      expect(Math.abs(row.current_value as number)).toBeGreaterThan(1);
      expect(Math.abs(row.flip_value as number)).toBeGreaterThan(1);
    }

    // And the two specific un-liftable factors, by identity: PLoT holds no cap
    // for either, so neither can be quoted in user units.
    expect(sent.find((r) => r.factor_id === 'fac_headcount')).toBeUndefined();
    expect(sent.find((r) => r.factor_id === 'fac_budget')).toBeUndefined();
  });

  it('CONTROL AGAINST OVER-CORRECTION: the unitless normalised row is PRESERVED', () => {
    // A refusal rule that dropped everything it could not lift would also pass
    // the test above. `fac_retention` has no unit, so "0.29" IS its value — the
    // prompt's documented probability-like case, and the probe shipped it
    // honestly. Dropping it would be a silent capability loss.
    const retention = sent.find((r) => r.factor_id === 'fac_retention');
    expect(retention).toBeDefined();
    expect(retention!.current_value).toBe(0.29);
    expect(retention!.flip_value).toBe(0.407407);
    expect(retention!.unit).toBeUndefined();
  });
});
