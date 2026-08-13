/**
 * ISL'S CONSTRAINT-EVALUATION CONTRACT — DERIVED FROM REAL CAPTURES, NOT BELIEF.
 *
 * WHY THIS FILE EXISTS (ROADMAP 2.1025, the root cause of audit finding C).
 * PLoT's in-repo ISL mocks used to return a `constraint_analysis` block whenever
 * ANY constraint was sent. Real ISL does not: it evaluates only constraints
 * stamped `value_frame: 'delta'` and returns NOTHING otherwise. Because the mock
 * fabricated the consumer's answer, a whole class of defect was invisible —
 * PLoT could send an unstamped constraint, receive a fabricated verdict in test,
 * and ship a product where that verdict silently does not exist. **A mock that
 * fabricates the consumer's response is a test agreeing with itself.**
 *
 * THE ORACLE IS ISL'S OWN BYTES. Every rule below is read off the dated capture
 * corpus in `tests/fixtures/isl-constraint-value-frame-20260807/` (captured
 * against ISL commit `c695feb7`), whose arms are:
 *
 *   A  no `value_frame`            -> constraint_analysis ABSENT
 *   B  `value_frame: 'delta'`      -> constraint_analysis PRESENT (0.856 / 0.032)
 *   C  out-of-enum frame           -> TYPED refusal naming the field path
 *   D  key misspelled (`value_frmae`) -> ABSENT, exactly like A (unknown keys are
 *                                        IGNORED, never errored — so a typo is
 *                                        indistinguishable from omission)
 *   E  `value_frame: 'level'`      -> ABSENT (refused for a missing baseline)
 *
 * ⚠ THE CORPUS IS EVIDENCE, NOT A FIXTURE. Those files record what ISL actually
 * answered on a dated build. They are APPEND-ONLY: add arms, never edit them.
 * `assertCapturedContract()` reads them at test time so this module can never
 * drift from them silently — if ISL's behaviour changes, a NEW capture is the
 * deliverable and this helper's rule changes with it, loudly.
 *
 * ⚠ WHAT THIS IS NOT. It is not a live consumer. A genuine live-ISL CI step is
 * out of PLoT's reach today (no ISL image PLoT's CI can pull, and standing up
 * the Python service cross-repo is an ISL-side change). This is the strongest
 * in-repo instrument available: an oracle taken from ISL's real bytes rather
 * than from the author's head.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';

/** The ONLY frame ISL evaluates a constraint in, per corpus arms B vs A/D/E. */
export const ISL_EVALUABLE_FRAME = 'delta';

export interface WireConstraint {
  constraint_id: string;
  node_id?: string;
  operator?: string;
  value?: number;
  label?: string;
  value_frame?: string;
}

/**
 * ISL's rule: only `value_frame: 'delta'` constraints are evaluated.
 * Anything else — absent, misspelled, 'level' — yields no verdict at all.
 */
export function evaluableConstraints<T extends WireConstraint>(constraints: T[]): T[] {
  return (constraints ?? []).filter((c) => c.value_frame === ISL_EVALUABLE_FRAME);
}

/**
 * Build the `constraint_analysis` block exactly as ISL would, or `undefined`
 * when ISL would omit it entirely.
 *
 * ⚠ OMISSION IS WHOLE-BLOCK, NOT PER-CONSTRAINT. In every captured arm where
 * the frame was unusable, the ENTIRE block is absent — not a block carrying a
 * null verdict. Mocks must reproduce that, because "absent block" and "block
 * with an empty list" travel through PLoT's assembly very differently.
 */
export function islConstraintAnalysis(
  constraints: WireConstraint[],
  probSatisfied = 0.856,
): { constraints: Array<{ constraint_id: string; prob_satisfied: number; satisfied: boolean }>; joint_probability: number } | undefined {
  const evaluable = evaluableConstraints(constraints);
  if (evaluable.length === 0) return undefined;
  return {
    constraints: evaluable.map((c) => ({
      constraint_id: c.constraint_id,
      prob_satisfied: probSatisfied,
      satisfied: probSatisfied >= 0.5,
    })),
    joint_probability: probSatisfied,
  };
}

/**
 * Re-derive the rule above from the captured bytes. Call this from any suite
 * that relies on `islConstraintAnalysis`, so the helper cannot drift from the
 * evidence it claims to encode.
 *
 * Includes its own POSITIVE CONTROL: arm B must carry a real numeric verdict.
 * Without it, a corpus that had silently become empty would satisfy every
 * "absent" assertion and prove nothing (trap 13).
 */
export function assertCapturedContract(): void {
  const dir = fileURLToPath(
    new URL('../fixtures/isl-constraint-value-frame-20260807/', import.meta.url),
  );
  const read = (n: string) => JSON.parse(readFileSync(dir + n, 'utf8'));

  const arms = [
    { name: 'A-control-no-frame', frame: undefined, expectAnalysis: false },
    { name: 'B-valid-delta', frame: 'delta', expectAnalysis: true },
    { name: 'D-misspelled-key', frame: undefined, expectAnalysis: false },
    { name: 'E-level-no-baseline', frame: 'level', expectAnalysis: false },
  ] as const;

  for (const arm of arms) {
    const req = read(`${arm.name}.request.json`);
    const res = read(`${arm.name}.response.json`);

    // Precondition: the arm really is the shape it claims to be.
    expect(req.goal_constraints?.[0]?.value_frame, `${arm.name} request frame`).toBe(arm.frame);

    // Positive control: the capture actually contains results to reason about.
    expect(res.results?.length, `${arm.name} must have captured results`).toBeGreaterThan(0);

    for (const r of res.results) {
      if (arm.expectAnalysis) {
        expect(r.constraint_analysis?.joint_probability, `${arm.name} ${r.option_id}`).toBeTypeOf('number');
      } else {
        expect(r.constraint_analysis ?? null, `${arm.name} ${r.option_id}`).toBeNull();
      }
    }
  }
}
