/**
 * A3 PLoT remediation (2026-07-18) — robustness/correctness fixes.
 *
 * Covers spec items 1-3 (flip-thresholds.ts):
 *  1. NaN-safe env parse for the flip-search time budgets (was `parseInt`).
 *  2. Unknown-base probe-depth fallback = explicit 4,000 floor (not the 10k cap).
 *  3. resolveFlipValues bounds ISL fan-out to FLIP_MAX_CONCURRENT_ISL_CALLS.
 *
 * @see acceptance-evidence/a3-verify-2026-07-16/REMEDIATION-SPEC.md (PLoT LANE)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveFlipOverallTimeoutMs,
  resolveFlipPerFactorTimeoutMs,
  resolveFlipProbeNSamples,
  resolveFlipValues,
  DEFAULT_FLIP_OVERALL_TIMEOUT_MS,
  DEFAULT_FLIP_PER_FACTOR_TIMEOUT_MS,
  DEFAULT_FLIP_PROBE_N_SAMPLES,
  FLIP_PROBE_UNKNOWN_BASE_N_SAMPLES,
  FLIP_MAX_CONCURRENT_ISL_CALLS,
  type ISLInferenceFn,
} from '../src/analysis/flip-thresholds.js';
import { MAX_N_SAMPLES } from '../src/config/env-int.js';
import type { FlipThresholdInputData } from '../src/cee/validation/m1-review-types.js';

const OVERALL_ENV = 'FLIP_SEARCH_OVERALL_TIMEOUT_MS';
const PERFACTOR_ENV = 'FLIP_SEARCH_PER_FACTOR_TIMEOUT_MS';

beforeEach(() => {
  delete process.env[OVERALL_ENV];
  delete process.env[PERFACTOR_ENV];
  // Invalid-env cases trip a once-per-process operator warning; silence it.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  delete process.env[OVERALL_ENV];
  delete process.env[PERFACTOR_ENV];
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// Item 1 — NaN-safe env parse
// -----------------------------------------------------------------------------
describe('item 1 — flip-timeout env parsing is NaN-safe (strict, bounded)', () => {
  it('unset env → the raised defaults (positive control)', () => {
    expect(resolveFlipOverallTimeoutMs()).toBe(DEFAULT_FLIP_OVERALL_TIMEOUT_MS); // 30_000
    expect(resolveFlipPerFactorTimeoutMs()).toBe(DEFAULT_FLIP_PER_FACTOR_TIMEOUT_MS); // 10_000
  });

  it('a valid integer env override wins', () => {
    process.env[OVERALL_ENV] = '25000';
    process.env[PERFACTOR_ENV] = '8000';
    expect(resolveFlipOverallTimeoutMs()).toBe(25000);
    expect(resolveFlipPerFactorTimeoutMs()).toBe(8000);
  });

  it.each(['', '30_000', '30000abc', '1.5', '-5', 'nan'])(
    'malformed/empty env %o falls back to the default (never NaN/garbage — old parseInt bug)',
    (bad) => {
      process.env[OVERALL_ENV] = bad;
      process.env[PERFACTOR_ENV] = bad;
      const overall = resolveFlipOverallTimeoutMs();
      const perFactor = resolveFlipPerFactorTimeoutMs();
      // The core of the bug: a NaN deadline (Date.now() + NaN) disables every
      // `Date.now() >= deadline` guard. Assert finiteness explicitly.
      expect(Number.isFinite(overall)).toBe(true);
      expect(Number.isFinite(perFactor)).toBe(true);
      expect(overall).toBe(DEFAULT_FLIP_OVERALL_TIMEOUT_MS);
      expect(perFactor).toBe(DEFAULT_FLIP_PER_FACTOR_TIMEOUT_MS);
      // parseInt('30_000') === 30 and parseInt('30000abc') === 30000 — prove we
      // did NOT silently accept those truncations. (perFactor default is 10_000,
      // which discriminates the 30000-truncation; overall default is 30_000 so it
      // cannot, hence the truncation check rides perFactor.)
      expect(overall).not.toBe(30);
      expect(perFactor).not.toBe(30);
      expect(perFactor).not.toBe(30000);
    },
  );
});

// -----------------------------------------------------------------------------
// Item 2 — unknown-base fallback floor + cap derives from MAX_N_SAMPLES
// -----------------------------------------------------------------------------
describe('item 2 — probe-depth cap + unknown-base fallback floor', () => {
  it('the cap constant DERIVES from MAX_N_SAMPLES (value-pin, no drift)', () => {
    expect(DEFAULT_FLIP_PROBE_N_SAMPLES).toBe(MAX_N_SAMPLES);
    expect(DEFAULT_FLIP_PROBE_N_SAMPLES).toBe(10_000);
  });

  it('the unknown-base fallback is the explicit 4,000 floor (value-pin)', () => {
    expect(FLIP_PROBE_UNKNOWN_BASE_N_SAMPLES).toBe(4_000);
  });

  it('unknown base depth → 4,000 floor, NEVER the 10k cap (the item-2 fix)', () => {
    // Pre-fix this returned min(10k, STANDARD_N_SAMPLES_DEFAULT=10k) = 10k,
    // contradicting the "assume 4000 floor, never the 10k cap" contract.
    expect(resolveFlipProbeNSamples(undefined)).toBe(4_000);
    expect(resolveFlipProbeNSamples(undefined)).not.toBe(DEFAULT_FLIP_PROBE_N_SAMPLES);
    expect(resolveFlipProbeNSamples(NaN)).toBe(4_000);
    expect(resolveFlipProbeNSamples(0)).toBe(4_000);
    expect(resolveFlipProbeNSamples(-1)).toBe(4_000);
  });

  it('known base depth still matches the base up to the cap (unchanged)', () => {
    expect(resolveFlipProbeNSamples(4000)).toBe(4000);
    expect(resolveFlipProbeNSamples(8000)).toBe(8000);
    expect(resolveFlipProbeNSamples(20_000)).toBe(10_000);
    expect(resolveFlipProbeNSamples(500)).toBe(500);
  });
});

// -----------------------------------------------------------------------------
// Item 3 — concurrency cap on ISL fan-out
// -----------------------------------------------------------------------------
describe('item 3 — resolveFlipValues bounds ISL fan-out to max 2', () => {
  const candidate = (id: string): FlipThresholdInputData => ({
    factor_id: id,
    factor_label: id,
    current_value: 0.5,
    flip_value: null,
    direction: 'increase',
  });

  /**
   * Mock inferenceFn that (a) tracks concurrent in-flight calls and records the
   * peak, and (b) forces a strict flip at both bounds so each factor runs the
   * full 3-probe Step-0 fan-out + bisection (maximal ISL calls per factor).
   */
  function makeTracker() {
    let active = 0;
    let peak = 0;
    const fn: ISLInferenceFn = async (_factorId, overrideMean) => {
      active++;
      peak = Math.max(peak, active);
      // Yield so overlapping calls actually coexist in-flight.
      await new Promise((r) => setTimeout(r, 2));
      active--;
      // winner flips away from 'opt1' at both bounds (0 and 1), toward 'opt2'
      const opt1Wins = overrideMean === 0.5;
      return {
        options: [
          { option_id: 'opt1', win_probability: opt1Wins ? 0.7 : 0.3 },
          { option_id: 'opt2', win_probability: opt1Wins ? 0.3 : 0.7 },
        ],
      };
    };
    return { fn, peak: () => peak };
  }

  it('positive control: the tracker CAN observe >2 concurrency when unbounded', async () => {
    const { fn, peak } = makeTracker();
    // Fire 5 raw calls in parallel, bypassing the semaphore.
    await Promise.all([0, 0, 0, 0, 0].map((v) => fn('x', v)));
    expect(peak()).toBeGreaterThan(FLIP_MAX_CONCURRENT_ISL_CALLS);
    expect(peak()).toBe(5);
  });

  it('caps in-flight ISL calls at 2 across 4 candidates (each fans out 3-wide)', async () => {
    const { fn, peak } = makeTracker();
    const candidates = [candidate('a'), candidate('b'), candidate('c'), candidate('d')];
    const { results } = await resolveFlipValues(candidates, fn, 'opt1', {
      // generous budgets so the cap — not a timeout — governs concurrency
      overallTimeoutMs: 60_000,
      perFactorTimeoutMs: 60_000,
    });
    expect(results).toHaveLength(4);
    // Without the cap, peak would be up to 4×3 = 12 (or ≥3 for a single factor).
    expect(peak()).toBeLessThanOrEqual(FLIP_MAX_CONCURRENT_ISL_CALLS);
    expect(peak()).toBeGreaterThan(0);
  });
});
