/**
 * SCIENTIFIC REGRESSION GATE — WP2: Intercept / root semantics (GUARD ONLY)
 * ----------------------------------------------------------------------------
 * These tests DO NOT change intercept/root behaviour. They pin the current,
 * deliberate PLoT translation semantics so that doctrine-deferred decisions
 * cannot be silently mutated by a future refactor:
 *
 *   - A genuine intercept-only root keeps its intercept as the sole baseline.
 *   - intercept defaults to 0.0 ONLY when absent (undefined); a present value
 *     (including an explicit 0) is preserved, never stripped.
 *   - A divergent root (observed_state.value !== intercept) is forwarded to ISL
 *     EXACTLY as given. PLoT must NOT auto-repair, equalise, or null either
 *     field — the base+intercept additive double-count is an ISL/CEE/doctrine
 *     concern (CEE `populateNodeIntercepts`), explicitly out of scope here.
 *   - A global "strip intercept" change cannot ship unnoticed.
 *
 * Pure-function unit pins on the exported translator (cheap, deterministic,
 * network-free). All assertions read source `.ts` directly via Vitest.
 *
 * Already covered elsewhere (NOT duplicated here):
 *   - intercept survives alongside epsilon_std: tests/boundary-plot-to-isl.contract.test.ts
 *   - intercept=0 default for unset nodes:      tests/golden/translator-fixtures.test.ts
 *   - value_defaulted / value_source provenance preserve-only-when-present:
 *                                               tests/track-s-provenance-passthrough.test.ts
 */

import { describe, it, expect } from 'vitest';
import { toISLNode } from '../../src/integrations/isl/translator-v3.js';
import type { EngineNodeV3 } from '../../src/types/engine-v3.js';

describe('WP2 gate · intercept/root semantics are protected, not changed', () => {
  it('genuine intercept-only root preserves its baseline (intercept forwarded, no value invented)', () => {
    const node = { id: 'root', kind: 'factor', label: 'R', intercept: 0.42 } as unknown as EngineNodeV3;
    const isl = toISLNode(node);
    expect(isl.intercept).toBe(0.42);           // sole baseline preserved
    expect(isl.observed_state).toBeUndefined();  // PLoT does not fabricate an observed value
  });

  it('intercept defaults to 0.0 ONLY when absent (undefined)', () => {
    const node = { id: 'n', kind: 'factor', label: 'N' } as unknown as EngineNodeV3;
    expect(toISLNode(node).intercept).toBe(0.0);
  });

  it('explicit intercept: 0 is preserved (present-zero is not "absent")', () => {
    const node = { id: 'n', kind: 'factor', label: 'N', intercept: 0 } as unknown as EngineNodeV3;
    expect(toISLNode(node).intercept).toBe(0);
  });

  it('DOCTRINE GUARD: divergent root forwards BOTH observed_state.value and intercept unchanged (no auto-repair)', () => {
    const node = {
      id: 'root', kind: 'factor', label: 'R',
      observed_state: { value: 0.9 }, intercept: 0.3,
    } as unknown as EngineNodeV3;
    const isl = toISLNode(node);
    expect(isl.observed_state?.value).toBe(0.9); // observed value untouched
    expect(isl.intercept).toBe(0.3);             // intercept untouched
    // PLoT does NOT equalise a divergent root (0.9 !== 0.3 must survive).
    expect(isl.observed_state?.value).not.toBe(isl.intercept);
  });

  it('ANTI-REGRESSION: every node carries a finite intercept field (global strip cannot ship)', () => {
    const nodes = [
      { id: 'a', kind: 'goal', label: 'A', intercept: 1.5 },
      { id: 'b', kind: 'factor', label: 'B', observed_state: { value: 1 }, intercept: 0.7 },
      { id: 'c', kind: 'factor', label: 'C' },
    ] as unknown as EngineNodeV3[];

    for (const node of nodes) {
      const isl = toISLNode(node);
      expect(isl).toHaveProperty('intercept');
      expect(typeof isl.intercept).toBe('number');
      expect(Number.isFinite(isl.intercept)).toBe(true);
    }

    // A present non-zero intercept is never replaced by the 0.0 default.
    const d = toISLNode({ id: 'd', kind: 'factor', label: 'D', intercept: 2.25 } as unknown as EngineNodeV3);
    expect(d.intercept).toBe(2.25);
  });
});
