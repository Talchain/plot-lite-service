/**
 * A3 remediation item 12 (2026-07-18) — CROSS-REPO complexity-budget drift guard.
 *
 * PLoT mirrors ISL's request-complexity budget (`ISL_MAX_COMPUTE_COMPLEXITY`) in
 * `ISL_COMPLEXITY_BUDGET_DEFAULT` so it can ADAPT n_samples BEFORE calling ISL
 * (avoiding a raw ISL 422). The two values MUST match: if PLoT's mirror exceeds
 * ISL's enforced budget, PLoT under-reduces and dense graphs get a raw ISL 422
 * instead of PLoT's disclosed adaptive reduction.
 *
 * The per-repo "lenient limits" value pins (PLoT tests/lenient-latency-values.pin,
 * ISL tests/unit/test_lenient_limits.py) each pin their OWN side INDEPENDENTLY —
 * that is exactly the hand-maintained mirror that drifts silently (CLAUDE.md
 * trap #12). This test is the explicit cross-repo contract: it names ISL's
 * enforced value and goes RED the moment PLoT's mirror moves away from it, so a
 * change on either side forces a conscious update here + a deploy-order check.
 *
 * ⚠ DEPLOY-ORDER COUPLING: a change to this number must land on ISL (or be set
 * via `ISL_MAX_COMPUTE_COMPLEXITY` on BOTH services) BEFORE/with the PLoT deploy.
 */

import { describe, it, expect } from 'vitest';
import { ISL_COMPLEXITY_BUDGET_DEFAULT } from '../src/config/sampling.js';

/**
 * The value ISL enforces as its complexity cap (`_DEFAULT_MAX_COMPLEXITY` /
 * env `ISL_MAX_COMPUTE_COMPLEXITY`), raised 10M → 30M in the ISL lenient-limits
 * lane (ISL PR #77). Update BOTH repos + this constant together.
 */
const ISL_ENFORCED_COMPLEXITY_BUDGET = 30_000_000;

describe('item 12 — PLoT complexity mirror equals ISL enforced budget', () => {
  it('ISL_COMPLEXITY_BUDGET_DEFAULT === the value ISL enforces (30M)', () => {
    expect(ISL_COMPLEXITY_BUDGET_DEFAULT).toBe(ISL_ENFORCED_COMPLEXITY_BUDGET);
  });
});
