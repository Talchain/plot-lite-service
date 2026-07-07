/**
 * Unit mapping-table tests for the display-safe robustness verdict
 * derivation (lane PLoT-W5). Route-level behaviour (live-capture fixtures,
 * blocked path, CIL fallback) is pinned separately in
 * tests/robustness-display-verdict.fixture.test.ts — this file pins the pure
 * function's mapping table and its honesty invariants exhaustively.
 */

import { describe, it, expect } from 'vitest';
import {
  deriveRobustnessDisplayVerdict,
  ROBUSTNESS_DISPLAY_VERDICT_REASONS,
  type RobustnessDisplayVerdict,
} from '../src/routes/v2/robustness-display-verdict.js';

const derive = (facts: { is_robust?: unknown; level?: unknown } | undefined, computed: boolean) =>
  deriveRobustnessDisplayVerdict(facts, computed).display_verdict;

describe('deriveRobustnessDisplayVerdict — mapping table (provisional_doctrine_v0)', () => {
  it("is_robust=true + level='high' → 'robust'", () => {
    expect(derive({ is_robust: true, level: 'high' }, true)).toBe('robust');
  });

  it("level='medium' → 'moderate' (regardless of is_robust=true)", () => {
    expect(derive({ is_robust: true, level: 'medium' }, true)).toBe('moderate');
    expect(derive({ is_robust: undefined, level: 'medium' }, true)).toBe('moderate');
  });

  it("level='moderate' tolerated as 'moderate' (UI vocabulary variant)", () => {
    expect(derive({ is_robust: true, level: 'moderate' }, true)).toBe('moderate');
  });

  it("is_robust=false → 'fragile' regardless of level (explicit negative never softened)", () => {
    expect(derive({ is_robust: false, level: 'high' }, true)).toBe('fragile');
    expect(derive({ is_robust: false, level: 'medium' }, true)).toBe('fragile');
    expect(derive({ is_robust: false, level: 'low' }, true)).toBe('fragile');
    expect(derive({ is_robust: false, level: undefined }, true)).toBe('fragile');
  });

  it("level='low' | 'very_low' → 'fragile' even without is_robust", () => {
    expect(derive({ level: 'low' }, true)).toBe('fragile');
    expect(derive({ level: 'very_low' }, true)).toBe('fragile');
  });

  it("level='high' WITHOUT is_robust=true never upgrades to 'robust'", () => {
    expect(derive({ level: 'high' }, true)).toBe('not_assessed');
    expect(derive({ is_robust: undefined, level: 'high' }, true)).toBe('not_assessed');
  });

  it("is_robust=true WITHOUT a level is not a determinate verdict", () => {
    expect(derive({ is_robust: true }, true)).toBe('not_assessed');
  });

  it("verdict-bearing facts missing entirely → 'not_assessed'", () => {
    expect(derive({}, true)).toBe('not_assessed');
    expect(derive(undefined, true)).toBe('not_assessed');
  });

  it("robustness not computed → 'not_assessed' even when facts LOOK determinate", () => {
    expect(derive({ is_robust: true, level: 'high' }, false)).toBe('not_assessed');
    expect(derive({ is_robust: false, level: 'low' }, false)).toBe('not_assessed');
    expect(derive(undefined, false)).toBe('not_assessed');
  });

  it('unrecognised external values degrade honestly, never crash or fabricate', () => {
    expect(derive({ is_robust: 'yes', level: 'HIGH' }, true)).toBe('not_assessed');
    expect(derive({ is_robust: 1, level: 42 }, true)).toBe('not_assessed');
    expect(derive({ is_robust: null, level: null }, true)).toBe('not_assessed');
    // Unrecognised level with a valid explicit negative still reads the negative
    expect(derive({ is_robust: false, level: 'garbage' }, true)).toBe('fragile');
  });
});

describe('display_verdict_reason — claim safety', () => {
  const VERDICTS: RobustnessDisplayVerdict[] = ['robust', 'moderate', 'fragile', 'not_assessed'];

  it('every verdict has a non-empty producer-owned reason with no numbers', () => {
    for (const verdict of VERDICTS) {
      const reason = ROBUSTNESS_DISPLAY_VERDICT_REASONS[verdict];
      expect(reason.length).toBeGreaterThan(0);
      expect(reason).not.toMatch(/\d/);
    }
  });

  it('the emitted reason always matches the emitted verdict (single source of truth)', () => {
    const cases: Array<[{ is_robust?: unknown; level?: unknown } | undefined, boolean]> = [
      [{ is_robust: true, level: 'high' }, true],
      [{ is_robust: true, level: 'medium' }, true],
      [{ is_robust: false, level: 'low' }, true],
      [undefined, false],
    ];
    for (const [facts, computed] of cases) {
      const { display_verdict, display_verdict_reason } = deriveRobustnessDisplayVerdict(facts, computed);
      expect(display_verdict_reason).toBe(ROBUSTNESS_DISPLAY_VERDICT_REASONS[display_verdict]);
    }
  });

  it("fragile reason carries the doctrine phrase 'small changes could flip this result'", () => {
    expect(ROBUSTNESS_DISPLAY_VERDICT_REASONS.fragile).toBe('small changes could flip this result');
  });
});
