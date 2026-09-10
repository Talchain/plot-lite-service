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
  ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP,
  type RobustnessDisplayVerdict,
} from '../src/routes/v2/robustness-display-verdict.js';
import { GOAL_FIT_PHRASE } from '../src/constants/result-voice.js';

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

  it('fragile reason is the goal-anchored change phrase, built from GOAL_FIT_PHRASE', () => {
    // Byte pin, but built from the shared constant rather than retyped: the two
    // emitters (this record and the brief's robustness_caveat) must say the same
    // thing, and a hand-typed copy here is the mirror that drifts (trap 12).
    expect(ROBUSTNESS_DISPLAY_VERDICT_REASONS.fragile).toBe(
      `small changes to your assumptions could change ${GOAL_FIT_PHRASE}`,
    );
  });
});

// =============================================================================
// VOICE (Paul's ruling, 2026-09-10) — applied to BOTH reason records in this
// module, not just the one a PR happened to edit.
//
// WHY THIS EXISTS. PR #355 re-anchored `..._ATTESTED_NO_FLIP` and the decision
// brief to the user's goal and left the BASE record untouched — and the base
// record is the `??` fallback for every non-attested run, i.e. the majority
// branch and the one the deployed footer renders. Three of its four entries
// still spoke of "this result" while the brief said "this run", so the two
// emitters `result-voice.ts` exists to keep aligned had different subjects, and
// `fragile` still said the answer could "flip" with nothing anchoring it to
// what the user asked for.
//
// The guard iterates BOTH records by KEY so a failure names the offending
// entry (identity binding), and it covers records added later by construction.
// =============================================================================

describe('display_verdict_reason — result voice (2026-09-10 ruling)', () => {
  const ALL_REASONS: Array<[string, string]> = [
    ...Object.entries(ROBUSTNESS_DISPLAY_VERDICT_REASONS).map(
      ([k, v]) => [`base.${k}`, v] as [string, string],
    ),
    ...Object.entries(ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP).map(
      ([k, v]) => [`attested_no_flip.${k}`, v as string] as [string, string],
    ),
  ];

  it('the guard actually has reasons to look at (precondition, not a tautology)', () => {
    // A zero-length iteration would make every assertion below pass by testing
    // nothing (trap 13). Six today: four base + two attested.
    expect(ALL_REASONS.length).toBe(6);
    expect(ALL_REASONS.every(([, v]) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  it('no reason speaks of "this result" — the subject is THIS RUN and its data', () => {
    for (const [key, reason] of ALL_REASONS) {
      expect(reason, `${key}: "${reason}"`).not.toMatch(/\bthis result\b/i);
    }
  });

  it('no reason frames the analysis as a contest', () => {
    // There is never a winner. Renaming `leads` to `ahead` would keep the race,
    // so the predicate covers the framing, not one token.
    const RACE_FRAMING =
      /\b(?:winner|winners|leader|leaders|leads|leading|ahead|beats|wins|ranking|rankings|front[- ]runner|top\s+(?:choice|option)|out\s+in\s+front|comes?\s+out\s+on\s+top)\b/i;
    // Positive control: the predicate can see the wording this surface actually
    // shipped before ROADMAP 2.278 / the 2026-09-10 ruling. HISTORIC, append-only.
    expect('none of the factors we could test changed which option leads on its own')
      .toMatch(RACE_FRAMING);
    for (const [key, reason] of ALL_REASONS) {
      expect(reason, `${key}: "${reason}"`).not.toMatch(RACE_FRAMING);
    }
  });

  it('no reason carries an em dash (ruling D) and none carries a number', () => {
    for (const [key, reason] of ALL_REASONS) {
      expect(reason, `${key}: "${reason}"`).not.toMatch(/\u2014/);
      expect(reason, `${key}: "${reason}"`).not.toMatch(/\d/);
    }
  });

  it('every reason that names the run uses the same subject as the brief ("this run")', () => {
    const namesTheRun = ALL_REASONS.filter(([, r]) => /\bthis (?:run|result|ranking)\b/i.test(r));
    // Precondition: some reason names the run, or the invariant below is vacuous.
    expect(namesTheRun.length).toBeGreaterThan(0);
    for (const [key, reason] of namesTheRun) {
      expect(reason, `${key}: "${reason}"`).toMatch(/\bthis run\b/);
    }
  });
});
