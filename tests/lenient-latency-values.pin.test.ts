/**
 * A3 lane 5 — VALUE PINS for the Paul-ruled lenient latency defaults (2026-07-17).
 *
 * Paul's ruling: raise latency limits to be much more lenient — better to learn
 * something is slow than have analysis cut off; prioritise analysis quality and
 * scientific credibility.
 *
 * Every raised default is pinned to its EXACT value so a silent revert (merge
 * accident, "helpful" tidy-up, stale-mirror re-introduction) goes RED, not
 * quiet. If you change one of these numbers deliberately, update the pin in the
 * same commit WITH the reasoning — that is the point of the pin.
 *
 * Envelope (derived at the bytes + scout-measured, 2026-07-17 — see PR body
 * and acceptance-evidence/a3-verify-2026-07-16/budget-review.md):
 * UI /v2 adapter 120s = the BINDING hop; CEE non-brief 30s (CALLER ASK
 * recorded to raise); CEE brief 75s; Render platform cap 100 MINUTES
 * (never binds).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DEFAULT_FLIP_PROBE_N_SAMPLES,
  DEFAULT_FLIP_PER_FACTOR_TIMEOUT_MS,
  DEFAULT_FLIP_OVERALL_TIMEOUT_MS,
  FLIP_PROBE_UNKNOWN_BASE_N_SAMPLES,
  resolveFlipProbeNSamples,
  resolveFlipPerFactorTimeoutMs,
  resolveFlipOverallTimeoutMs,
  resolveFlipValues,
  type ISLInferenceFn,
} from '../src/analysis/flip-thresholds.js';
import {
  ISL_TIMEOUT_MS,
  ISL_THRESHOLDS_TIMEOUT_MS_CAP,
  REQUEST_BUDGET_MS,
} from '../src/config/timeouts.js';
import {
  STANDARD_N_SAMPLES_DEFAULT,
  ISL_COMPLEXITY_BUDGET_DEFAULT,
} from '../src/config/sampling.js';
import type { FlipThresholdInputData } from '../src/cee/validation/m1-review-types.js';

const ENV_KEYS = [
  'FLIP_PROBE_N_SAMPLES',
  'FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS',
  'FLIP_SEARCH_OVERALL_TIMEOUT_MS',
] as const;

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

describe('Paul-ruled lenient defaults 2026-07-17 — exact value pins', () => {
  it('flip-probe depth cap is 10,000 (probes at base precision up to 10k)', () => {
    expect(DEFAULT_FLIP_PROBE_N_SAMPLES).toBe(10_000);
  });

  it('flip-search budgets are 10s per factor / 30s overall (scout-measured raise)', () => {
    expect(DEFAULT_FLIP_PER_FACTOR_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_FLIP_OVERALL_TIMEOUT_MS).toBe(30_000);
    // The resolvers feed getDefaultConfig AND the run.ts probe/clamp call sites —
    // pin them too so the constants cannot be silently bypassed.
    expect(resolveFlipPerFactorTimeoutMs()).toBe(10_000);
    expect(resolveFlipOverallTimeoutMs()).toBe(30_000);
  });

  it('base MC depth default is 10,000 and the complexity mirror is 30M (paired raise)', () => {
    // Scout task 2e: raising K without raising the complexity budget silently
    // no-ops on graphs with nodes x edges > 1000 (measured: 10000 -> 4873).
    expect(STANDARD_N_SAMPLES_DEFAULT).toBe(10_000);
    expect(ISL_COMPLEXITY_BUDGET_DEFAULT).toBe(30_000_000);
  });

  it('ISL request timeout default is 60s', () => {
    // NOTE: read at module import from env; the test env must not set
    // ISL_TIMEOUT_MS / ISL_REQUEST_TIMEOUT_MS (env-guard setup does not).
    expect(ISL_TIMEOUT_MS).toBe(60_000);
  });

  it('ISL thresholds per-call cap default is 30s', () => {
    expect(ISL_THRESHOLDS_TIMEOUT_MS_CAP).toBe(30_000);
  });

  it('/v2/run request budget default is 70s (70% of the ~100s platform bound)', () => {
    expect(REQUEST_BUDGET_MS).toBe(70_000);
  });
});

describe('flip probes run at base precision (behavioural, not just the constant)', () => {
  it('inherits the base depth up to the 10k cap — the old 1,000 pin is gone', () => {
    // RED against the pre-ruling code, which returned min(1000, base):
    expect(resolveFlipProbeNSamples(4000)).toBe(4000);
    expect(resolveFlipProbeNSamples(8000)).toBe(8000);
    expect(resolveFlipProbeNSamples(10_000)).toBe(10_000);
  });

  it('still never probes deeper than the base, and caps at 10k', () => {
    expect(resolveFlipProbeNSamples(500)).toBe(500);
    expect(resolveFlipProbeNSamples(20_000)).toBe(10_000);
  });

  it('unknown base depth falls back to the explicit 4,000 floor, NOT the 10k cap', () => {
    // A3 remediation item 2 (2026-07-18): the fallback was STANDARD_N_SAMPLES_DEFAULT,
    // which was raised 4000 → 10_000 (the cap) on 2026-07-17 — so min(10k, 10k) = 10k
    // silently contradicted resolveFlipProbeNSamples's "assume 4000 floor, never the
    // 10k cap" contract. Now the fallback is the explicit FLIP_PROBE_UNKNOWN_BASE_N_SAMPLES.
    expect(resolveFlipProbeNSamples(undefined)).toBe(FLIP_PROBE_UNKNOWN_BASE_N_SAMPLES);
    expect(resolveFlipProbeNSamples(undefined)).toBe(4_000);
    expect(resolveFlipProbeNSamples(undefined)).not.toBe(STANDARD_N_SAMPLES_DEFAULT);
  });
});

describe('timeout trips are visible: elapsed_ms on flip diagnostics', () => {
  const candidate: FlipThresholdInputData = {
    factor_id: 'factor-a',
    factor_label: 'Factor A',
    current_value: 0.5,
    flip_value: null,
    direction: 'increase',
  };

  const neverFlips: ISLInferenceFn = async () => ({
    options: [
      { option_id: 'opt1', win_probability: 0.7 },
      { option_id: 'opt2', win_probability: 0.3 },
    ],
  });

  it('a timeout trip carries elapsed_ms (slowness is diagnosable)', async () => {
    const { results, diagnostics } = await resolveFlipValues(
      [candidate],
      neverFlips,
      'opt1',
      { perFactorTimeoutMs: 0, overallTimeoutMs: 0 }
    );
    expect(results[0]!.flip_reason).toBe('timeout');
    expect(typeof diagnostics[0]!.elapsed_ms).toBe('number');
    expect(diagnostics[0]!.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  it('positive control: a completed (non-timeout) search carries elapsed_ms too', async () => {
    const { results, diagnostics } = await resolveFlipValues(
      [candidate],
      neverFlips,
      'opt1'
    );
    expect(results[0]!.flip_reason).toBe('no_effect_within_bounds');
    expect(typeof diagnostics[0]!.elapsed_ms).toBe('number');
  });
});
