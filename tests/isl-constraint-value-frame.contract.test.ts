/**
 * ROADMAP 2.855 — PLoT's half of the `value_frame` chain (row 2.798:
 * ISL declares -> CEE stamps -> PLoT forwards -> a result is delivered).
 *
 * ⚠ WHY A GREEN BUILD PROVES NOTHING HERE. ISL's `GoalConstraint` is
 * `extra: "ignore"`. A misspelled or undeclared key does not 4xx and does not
 * warn — it dies at parse and the run returns a perfectly ordinary 200. So
 * "PLoT compiles and emits the key" and "ISL acted on it" are different
 * claims, and only the second one closes this row.
 *
 * THE ARMS ARE A DISCRIMINATING SET, NOT A DEMONSTRATION. All five were
 * captured through the REAL HTTP ENDPOINT (`POST
 * /api/v1/robustness/analyze/v2`) of ISL at commit `c695feb7` — see
 * `CAPTURED-AT-ISL-COMMIT.txt` beside the fixtures — on 2026-08-07:
 *
 *   A control-no-frame   → 200, FOUR results, ZERO constraint_analysis, and
 *                          `CONSTRAINT_FRAME_UNSPECIFIED / frame_not_stamped`.
 *                          Today's live behaviour: the gap this row closes.
 *   B valid-delta        → 200 and a REAL COMPUTATION — every option carries
 *                          `constraint_analysis` with `prob_satisfied`,
 *                          `failure_margin_median`, `near_miss_fraction`,
 *                          `binding` and a `joint_probability`. Nothing but
 *                          the constraint evaluator running produces that.
 *   C invalid-frame      → 'normalised' ⇒ HTTP 422, `analysis_status:
 *                          "blocked"`, and a TYPED reason naming the exact
 *                          field path. The refusal path is live too, not just
 *                          the happy path.
 *   D misspelled-key     → `value_frmae`, two letters transposed. 200, and
 *                          NOTHING — byte-for-byte the same outcome as A.
 *                          THIS IS THE LOAD-BEARING ARM: it shows what "ISL
 *                          ignored it" looks like, and it looks EXACTLY like
 *                          the control. Without D, B is a 200 being read as a
 *                          computation.
 *   E level-no-baseline  → 200, ZERO constraint_analysis, and
 *                          `CONSTRAINT_NOT_CONVERTIBLE /
 *                          missing_target_baseline`. Recorded because it is
 *                          the honest limit of this row: see the closing test.
 *
 * Trap 12b: these are HISTORICAL artefacts pinned BY CONTENT at a named
 * commit, not a control pointed at "whatever is deployed now", so they cannot
 * decay into a tautology when ISL next moves. They are evidence about
 * `c695feb7` and they say so.
 *
 * ⚠ SCOPE, STATED HONESTLY: this is a LOCAL-BUILD witness at that commit, NOT
 * a deployed-staging witness. Capturing against `isl-staging.onrender.com`
 * needs an API key this lane did not have. The deployed-build arm is still
 * owed before the chain may be called live.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = 'tests/fixtures/isl-constraint-value-frame-20260807';
const REPO_ROOT = resolve(__dirname, '..');
const load = (f: string): Record<string, any> =>
  JSON.parse(readFileSync(resolve(REPO_ROOT, DIR, f), 'utf8'));

/** Rows that actually carry a constraint verdict, bound by option IDENTITY. */
const withConstraintAnalysis = (resp: Record<string, any>) =>
  ((resp.results ?? []) as any[]).filter((r) => r && r.constraint_analysis);

describe('2.855 T1: the arms are real captures that differ in the way they claim', () => {
  it('every arm was captured against the SAME ISL commit', () => {
    const sha = readFileSync(resolve(REPO_ROOT, DIR, 'CAPTURED-AT-ISL-COMMIT.txt'), 'utf8').trim();
    expect(sha).toBe('c695feb74778c385482ee13b44ac1c77916e97f6');
  });

  it('PINS ITS OWN PRECONDITION: the request bodies differ EXACTLY as the arms claim', () => {
    // Trap 13b, third face — a discriminator whose fixture nothing pins can
    // silently stop discriminating while every assertion below stays green.
    const c = (f: string) => load(f).goal_constraints[0];

    expect(c('A-control-no-frame.request.json').value_frame).toBeUndefined();
    expect(c('B-valid-delta.request.json').value_frame).toBe('delta');
    expect(c('C-invalid-frame.request.json').value_frame).toBe('normalised');
    expect(c('E-level-no-baseline.request.json').value_frame).toBe('level');

    // D's key is MISSPELLED — the whole discrimination rests on this.
    const d = c('D-misspelled-key.request.json');
    expect(d.value_frame).toBeUndefined();
    expect(d.value_frmae).toBe('delta');

    // …and all five ask the SAME question of the SAME target, so any
    // difference in outcome is attributable to the frame and nothing else.
    for (const f of [
      'A-control-no-frame', 'B-valid-delta', 'C-invalid-frame',
      'D-misspelled-key', 'E-level-no-baseline',
    ]) {
      const row = c(`${f}.request.json`);
      expect(row.node_id).toBe('out_throughput');
      expect(row.operator).toBe('>=');
      expect(row.value).toBe(0.05);
    }
  });
});

describe('2.855 T2: the deployed handler CONSUMED the field', () => {
  it('B — a delta-framed constraint DELIVERS a real constraint verdict on every option', () => {
    const rows = withConstraintAnalysis(load('B-valid-delta.response.json'));
    expect(rows).toHaveLength(4);

    // Bound by option IDENTITY, never by a value predicate another option
    // could satisfy (trap 19).
    const one = rows.find((r) => r.option_id === 'opt_one_dev');
    expect(one, 'opt_one_dev must carry a constraint verdict').toBeDefined();

    const c = one!.constraint_analysis.constraints.find(
      (x: any) => x.constraint_id === 'c_throughput_floor',
    );
    expect(c, 'the verdict must be keyed by the constraint id we sent').toBeDefined();
    expect(c.node_id).toBe('out_throughput');

    // A real Monte Carlo verdict: a probability strictly inside (0,1) plus the
    // companion statistics only the evaluator computes. A structural zero —
    // the defect this whole channel exists to kill — would read 0 here.
    expect(c.prob_satisfied).toBeGreaterThan(0);
    expect(c.prob_satisfied).toBeLessThan(1);
    expect(typeof c.near_miss_fraction).toBe('number');
    expect(typeof c.binding).toBe('boolean');
    expect(one!.constraint_analysis.joint_probability).toBeGreaterThan(0);
  });

  it('A — the control is REFUSED, and names why', () => {
    const resp = load('A-control-no-frame.response.json');
    expect(withConstraintAnalysis(resp)).toHaveLength(0);
    // Four results still came back: this is a constraint-scoped refusal, not a
    // failed run — the honest gap, not an outage.
    expect((resp.results as any[]).length).toBe(4);

    const w = (resp.inference_warnings as any[]).filter(
      (x) => x.code === 'CONSTRAINT_FRAME_UNSPECIFIED',
    );
    expect(w).toHaveLength(1);
    expect(w[0].detail.reason).toBe('frame_not_stamped');
    expect(w[0].detail.constraint_id).toBe('c_throughput_floor');
    expect(w[0].severity).toBe('warning');
  });

  it('C — an out-of-enum frame is a TYPED refusal naming the field path, not a silent drop', () => {
    const resp = load('C-invalid-frame.response.json');
    expect(resp.analysis_status).toBe('blocked');
    expect(resp.status_reason).toContain('goal_constraints');
    expect(resp.status_reason).toContain('value_frame');
    expect(resp.status_reason).toContain("Input should be 'level' or 'delta'");

    const blocker = (resp.critiques as any[]).find((x) => x.code === 'VALIDATION_ERROR');
    expect(blocker.severity).toBe('blocker');
  });

  it('D — THE DISCRIMINATOR: two transposed letters ⇒ 200 and NOTHING, exactly like the control', () => {
    // If this ever fails by finding a verdict on D, the instrument has gone
    // blind and the B arm proves nothing. If A ever grows one, the field is
    // not request-gated and the "no default payload growth" claim is false.
    const d = load('D-misspelled-key.response.json');
    expect(withConstraintAnalysis(d)).toHaveLength(0);
    expect(
      (d.inference_warnings as any[]).filter((x) => x.code === 'CONSTRAINT_FRAME_UNSPECIFIED'),
    ).toHaveLength(1);

    // Stated as a PAIR: the misspelling is indistinguishable from absence, and
    // the correctly-spelled arm is the only one that produced a computation.
    expect(withConstraintAnalysis(load('A-control-no-frame.response.json'))).toHaveLength(0);
    expect(withConstraintAnalysis(load('B-valid-delta.response.json'))).toHaveLength(4);
  });
});

describe("2.855 T3: the HONEST LIMIT — 'level' is forwarded correctly and still cannot deliver", () => {
  it("E — a level-framed constraint is refused for a MISSING TARGET BASELINE, not for a missing frame", () => {
    // This is the finding this row must not paper over. Forwarding the frame
    // is necessary and NOT sufficient for the level branch: ISL recovers a
    // level per draw as `baseline + (option_sample - status_quo_sample)`, so
    // it needs `observed_state.baseline` ON THE CONSTRAINT'S TARGET NODE.
    // Nothing upstream writes one for constraint targets today (PLoT forwards
    // a baseline but never mints one; ROADMAP 2.281 covers the GOAL node
    // only, and a constraint target is usually a factor/outcome node).
    //
    // The discrimination that matters: the refusal REASON MOVED. A frame-blind
    // reading of "still no result" would call this row a failure; in fact the
    // frame was consumed and the chain advanced to the NEXT precondition.
    const resp = load('E-level-no-baseline.response.json');
    expect(withConstraintAnalysis(resp)).toHaveLength(0);

    const codes = (resp.inference_warnings as any[])
      .filter((w) => String(w.code).startsWith('CONSTRAINT_'))
      .map((w) => w.code);
    expect(codes).toContain('CONSTRAINT_NOT_CONVERTIBLE');
    expect(codes).not.toContain('CONSTRAINT_FRAME_UNSPECIFIED');

    const w = (resp.inference_warnings as any[]).find(
      (x) => x.code === 'CONSTRAINT_NOT_CONVERTIBLE',
    );
    expect(w.detail.reason).toBe('missing_target_baseline');
    expect(w.detail.value_frame).toBe('level');
  });
});
