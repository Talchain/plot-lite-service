/**
 * ROADMAP 2.685 — fallback flip rows get the SAME denormalise-or-drop rule as
 * the main path (2.676) before they reach CEE.
 *
 * The defect: when ISL emits no `factor_flip_values`, run.ts passes
 * `preResolvedFlipData: undefined` and the orchestrator keeps
 * `computeFlipThresholdData`'s heuristic rows VERBATIM — normalised
 * `current_value` (e.g. 0.5) wearing the user's unit (e.g. "GBP"). Every
 * fallback row is `flip_value: null`, so no flip MAGNITUDE can fabricate, but
 * Tier-7 (`validateFlipThresholds`) checks the review's `current_display`
 * against that normalised number: an HONEST model correction ("16000 GBP")
 * trips BLOCKING `MODIFIED_VALUES` and the entire review is discarded.
 *
 * The rule mirrored here is not re-implemented — the fix composes the exact
 * 2.676 leaves (`denormaliseFlipThresholds` + `toPromptFlipThresholdData`), so
 * these tests pin the COMPOSITION on the fallback path, identity-bound to the
 * witnessed 2.676 factor shape (value 0.5, raw_value 16000, cap 32000, GBP —
 * probe evidence PHASE0-EVIDENCE-2026-07-28/probe2676-2026-08-07/).
 *
 * Assertions bind rows by factor_id (identity), never by a value predicate
 * another row could satisfy (trap 19). Every absence assertion is paired with
 * an in-test presence control (trap 13).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  orchestrateDecisionReview,
  type DecisionReviewInput,
} from '../../../src/cee/decision-review-orchestrator.js';
import { clearReviewCache } from '../../../src/cee/validation/review-cache.js';
import type {
  DecisionReviewRequest,
  FlipThresholdInputData,
} from '../../../src/cee/validation/m1-review-types.js';
import * as ceeClient from '../../../src/cee/client.js';
import {
  BASE_BRIEF,
  BASE_GRAPH,
  BASE_ISL_RESULTS,
  VALID_READY_REVIEW,
} from './fixtures.js';

// Mock FLAGS (same pattern as orchestrator.test.ts)
vi.mock('../../../src/config/flags.ts', () => ({
  FLAGS: {
    DECISION_REVIEW_ENABLE: true,
  },
}));

const CONFIG = { baseUrl: 'https://cee.test', apiKey: 'test-key' };

/**
 * The 2.676-witnessed factor, observed_state supplied per case.
 * `fac_price` is the identity-bound TARGET row of every assertion below.
 */
function priceNode(observedState: Record<string, unknown>) {
  return {
    id: 'fac_price',
    label: 'Unit Price',
    kind: 'factor',
    observed_state: observedState,
  };
}

/**
 * Unitless sibling factor — the in-test PRESENCE control. An "fac_price row is
 * absent/dropped" assertion is vacuous unless the same request proves the
 * fallback path emitted rows at all (trap 13).
 */
const RATE_NODE = {
  id: 'fac_rate',
  label: 'Conversion Rate',
  kind: 'factor',
  observed_state: { value: 0.29 },
};

let hashCounter = 0;

function buildInput(
  priceObserved: Record<string, unknown>,
  overrides: Partial<DecisionReviewInput> = {}
): DecisionReviewInput {
  hashCounter += 1;
  return {
    brief: BASE_BRIEF,
    graph: {
      ...BASE_GRAPH,
      nodes: [...BASE_GRAPH.nodes, priceNode(priceObserved), RATE_NODE],
    } as any,
    options: [
      { id: 'option-a', label: 'Option A' },
      { id: 'option-b', label: 'Option B' },
    ] as any,
    islResult: {
      options: BASE_ISL_RESULTS.option_comparison,
      factor_sensitivity: [
        // fac_price ranked first (highest |elasticity|); fac_rate second.
        // The BASE_GRAPH factors carry no observed_state, so the fallback
        // builder skips them — the emitted rows are exactly these two.
        { factor_id: 'fac_price', factor_label: 'Unit Price', elasticity: 0.9, confidence: 0.7 },
        { factor_id: 'fac_rate', factor_label: 'Conversion Rate', elasticity: 0.6, confidence: 0.6 },
      ],
      robustness: {
        ...BASE_ISL_RESULTS.robustness,
        fragile_edges: BASE_ISL_RESULTS.fragile_edges,
      },
    } as any,
    m1Coaching: {
      readiness: 'ready',
      headline_type: 'clear_winner',
      story_headlines: {
        'option-a': 'Strong market positioning',
        'option-b': 'Viable alternative',
      },
      evidence_gaps: [],
      model_critiques: [],
      next_actions: [],
      coaching_version: '1.1.0',
      computed_at: new Date().toISOString(),
    } as any,
    // Unique per input so the review cache can never satisfy a later test.
    responseHash: `fallbackflip${String(hashCounter).padStart(12, '0')}`,
    requestId: `test-2685-${hashCounter}`,
    // NO preResolvedFlipData — the 2.685 fallback path is exactly this arm.
    ...overrides,
  };
}

function spyOnCee(review: unknown = VALID_READY_REVIEW) {
  return vi.spyOn(ceeClient, 'callDecisionReview').mockResolvedValue({
    review: review as any,
    error: null,
    meta: { model: 'test-model', latency_ms: 100, tokens: 500 },
  });
}

function sentRequest(spy: ReturnType<typeof spyOnCee>): DecisionReviewRequest {
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0][1] as DecisionReviewRequest;
}

describe('2.685 fallback flip rows: denormalise-or-drop before CEE', () => {
  beforeEach(() => {
    clearReviewCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T1: liftable row (explicit cap) reaches CEE DENORMALISED — 16000, never 0.5 wearing GBP', async () => {
    const spy = spyOnCee();
    // The witnessed shape: normalised 0.5, raw 16000, cap 32000, GBP.
    const input = buildInput({ value: 0.5, raw_value: 16000, cap: 32000, unit: 'GBP' });

    await orchestrateDecisionReview(input, CONFIG);

    const rows = sentRequest(spy).flip_threshold_data;
    // Presence control first: the unitless sibling must be there, unchanged.
    const rate = rows.find((r: FlipThresholdInputData) => r.factor_id === 'fac_rate');
    expect(rate).toBeDefined();
    expect(rate!.current_value).toBe(0.29);

    // Identity-bound target: user-scale current value, null flip preserved.
    const price = rows.find((r: FlipThresholdInputData) => r.factor_id === 'fac_price');
    expect(price).toBeDefined();
    expect(price!.current_value).toBe(16000);
    expect(price!.flip_value).toBeNull();
    expect(price!.unit).toBe('GBP');
  });

  it('T2: attested-normalised but UNLIFTABLE row (raw_value, no cap) is DROPPED, not sent wearing a unit', async () => {
    const spy = spyOnCee();
    // raw_value attests normalisation; no cap means no explicit_cap range to
    // lift with — the denormaliser stamps value_scale 'normalised' and the
    // 2.676 drop rule refuses the row.
    const input = buildInput({ value: 0.5, raw_value: 16000, unit: 'GBP' });

    await orchestrateDecisionReview(input, CONFIG);

    const rows = sentRequest(spy).flip_threshold_data;
    // Presence control: the path emitted rows (absence assertion non-vacuous).
    expect(rows.find((r: FlipThresholdInputData) => r.factor_id === 'fac_rate')).toBeDefined();
    // The unliftable unit-bearing row must be gone.
    expect(rows.some((r: FlipThresholdInputData) => r.factor_id === 'fac_price')).toBe(false);
  });

  it('T3 (control): unattested user-scale row passes through unchanged', async () => {
    const spy = spyOnCee();
    // No raw_value, no cap: scale genuinely unknown — a direct /v2/run caller
    // may post user-scale values. The main-path rule admits these; the
    // fallback must not start dropping them (no over-reach).
    const input = buildInput({ value: 16000, unit: 'GBP' });

    await orchestrateDecisionReview(input, CONFIG);

    const rows = sentRequest(spy).flip_threshold_data;
    const price = rows.find((r: FlipThresholdInputData) => r.factor_id === 'fac_price');
    expect(price).toBeDefined();
    expect(price!.current_value).toBe(16000);
    expect(price!.unit).toBe('GBP');
  });

  it('T4 (control): preResolvedFlipData is forwarded verbatim — the fallback rule never reprocesses the main path', async () => {
    const spy = spyOnCee();
    const preResolved: FlipThresholdInputData[] = [
      {
        factor_id: 'fac_price',
        factor_label: 'Unit Price',
        current_value: 12243,
        flip_value: 9000,
        direction: 'decrease',
        flip_reason: 'isl_flip_values',
        iterations_used: 0,
        probes_used: 0,
        alternative_winner_id: null,
        unit: 'GBP',
      },
    ];
    const input = buildInput(
      { value: 0.5, raw_value: 16000, cap: 32000, unit: 'GBP' },
      { preResolvedFlipData: preResolved }
    );

    await orchestrateDecisionReview(input, CONFIG);

    expect(sentRequest(spy).flip_threshold_data).toEqual(preResolved);
  });

  it('T5: the 2.685 face itself — an HONEST current_display no longer kills the review (Tier-7 agrees with the denormalised row)', async () => {
    // CEE returns the honest user-scale correction for the fallback row.
    const honestReview = {
      ...VALID_READY_REVIEW,
      flip_thresholds: [
        {
          factor_id: 'fac_price',
          factor_label: 'Unit Price',
          current_display: '16000 GBP',
          // flip_value is null on fallback rows, so Tier-7 must not constrain
          // this; a placeholder display exercises exactly that.
          flip_display: '12000 GBP',
          narrative: 'If Unit Price falls far enough, the leading option changes.',
        },
      ],
    };
    const spy = spyOnCee(honestReview);
    const input = buildInput({ value: 0.5, raw_value: 16000, cap: 32000, unit: 'GBP' });

    const result = await orchestrateDecisionReview(input, CONFIG);

    expect(spy).toHaveBeenCalledTimes(1);
    // At pristine this is 'failed': Tier-7 compared "16000 GBP" against the
    // normalised 0.5 and BLOCKING MODIFIED_VALUES discarded the whole review.
    expect(result.review_status).toBe('complete');
    expect(result.review_failure_codes ?? []).toEqual([]);
  });
});
