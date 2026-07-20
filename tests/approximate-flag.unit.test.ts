/**
 * Unit pin for sub-item 2: the `approximate` derivation rule.
 *
 * `approximate` must be TRUE only for 'partial' (usable-but-degraded). A
 * 'failed'/'blocked' run carries NO usable answer and must NOT read approximate
 * (a 'failed' body ships on a 200 — e.g. the ISL-disabled path), else a UI badge
 * would present "no results" as "usable but rough" — the opposite of the truth.
 *
 * This discriminates the correct rule from the earlier `!== 'computed'` formula
 * (which wrongly folded failed/blocked into true). Mutation-check: reverting
 * isApproximateAnalysis to `status !== 'computed'` turns the failed + blocked
 * cases below RED. The integration golden (isl-v2-golden-response.pin) pins the
 * computed→false case on a real wire response; this pins the rule itself.
 */
import { describe, it, expect } from 'vitest';
import { isApproximateAnalysis } from '../src/routes/v2/run.js';

describe('isApproximateAnalysis — approximate flag semantics (sub-item 2)', () => {
  it('is TRUE only for partial (usable but degraded)', () => {
    expect(isApproximateAnalysis('partial')).toBe(true);
  });
  it('is FALSE for computed (clean, not approximate)', () => {
    expect(isApproximateAnalysis('computed')).toBe(false);
  });
  it('is FALSE for failed (no usable answer — must not read approximate)', () => {
    expect(isApproximateAnalysis('failed')).toBe(false);
  });
  it('is FALSE for blocked (no usable answer)', () => {
    expect(isApproximateAnalysis('blocked')).toBe(false);
  });
});
