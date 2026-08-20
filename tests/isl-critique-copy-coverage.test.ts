/**
 * ISL critique copy coverage — "never render a bare machine code to a user".
 *
 * Context (derived 19 Aug 2026, this lane):
 *   PLoT is the CANONICAL OWNER of critique user-facing copy. ISL emits
 *   machine-readable facts (`code`, `severity`, `affected_*_ids`) plus a
 *   `message` whose templates interpolate RAW NODE IDS
 *   (e.g. "Edge {from_node}->{to_node} strength {value} outside [-3, 3]",
 *   src/models/critique.py) — so ISL's `message` is a debug string and is
 *   deliberately never shown to a user. `critique-humaniser.ts` turns the
 *   code into product copy. That split is correct and stays.
 *
 *   The defect this file pins: `TEMPLATE_MAP` was written against PLoT's OWN
 *   validator vocabulary (`engine-v3.ts` BLOCKER_CODES / CONSTRAINT_WARNING_CODES
 *   / INLINE_CRITIQUE_CODES) and the existing coverage guard in
 *   critique-humaniser.test.ts compares against exactly those constants. It is
 *   therefore STRUCTURALLY BLIND to the ISL namespace, which is a separate set
 *   of codes that reaches `addUserMessages` verbatim via `mapISLCritiquesToV2`
 *   (src/routes/v2/run.ts:4458, merged on the success path at :7677 and on the
 *   ISL-error path at :7575). 26 of ISL's 34 codes had no template and fell
 *   through to a fallback that PRINTED THE RAW CODE at the user.
 *
 *   ISL_CRITIQUE_CODES below is a pinned mirror of ISL's critique registry,
 *   derived from Talchain/Inference-Service-Layer `staging`
 *   @ 28fe0c950f6ca5737f4555c863353d37b734dddf, src/models/critique.py.
 *   It is a MIRROR and mirrors drift — which is exactly why the runtime
 *   fallback is ALSO made safe (test 3): drift can then only cost specificity,
 *   never leak a machine code onto a user surface.
 */

import { describe, it, expect } from 'vitest';
import {
  humaniseCritique,
  addUserMessages,
  getKnownCodes,
} from '../src/critique-humaniser.js';
import type { CritiqueV3 } from '../src/types/engine-v3.js';

/**
 * Every code ISL can put on the wire, derived from its CritiqueDefinition
 * declarations (`code="..."`) in src/models/critique.py at the SHA above.
 */
const ISL_CRITIQUE_CODES: readonly string[] = [
  'BASELINE_NEAR_ZERO',
  'CONSTRAINT_NODE_DEFAULT_BASE',
  'DEGENERATE_OPTION_ZERO_VARIANCE',
  'DEGENERATE_OUTCOMES',
  'DUPLICATE_NODE_ID',
  'DUPLICATE_OPTION_ID',
  'EDGE_ENDPOINT_MISSING',
  'EDGE_STD_INVALID',
  'EDGE_STRENGTH_OUT_OF_RANGE',
  'EMPTY_INTERVENTIONS',
  'GOAL_ANCESTOR_DATA_GAP',
  'GRAPH_CYCLE_DETECTED',
  'GRAPH_DISCONNECTED',
  'GRAPH_EMPTY',
  'HIGH_TIE_RATE',
  'IDENTICAL_OPTIONS',
  'IDENTIFIABILITY_ISSUE',
  'INFERENCE_TIMEOUT',
  'INSUFFICIENT_OPTIONS',
  'INTERNAL_ERROR',
  'INTERVENTION_VALUE_INVALID',
  'INVALID_INTERVENTION_TARGET',
  'INVALID_NODE_ID',
  'LOW_EFFECTIVE_SAMPLES',
  'MARGINAL_SWITCH_TRUNCATED',
  'MISSING_GOAL_NODE',
  'MONTE_CARLO_FAILED',
  'NEGLIGIBLE_EDGE_STRENGTH',
  'NO_EFFECTIVE_PATH_TO_GOAL',
  'NO_OPTIONS',
  'NUMERICAL_INSTABILITY',
  'OPTION_NO_INTERVENTIONS',
  'SEED_INVALID',
  'STRUCTURAL_INFLUENCE_TRUNCATED',
];

/**
 * A bare machine code: SCREAMING_SNAKE with at least one underscore.
 * Verified at pristine to match NO existing template's prose, so a hit is
 * always a leak and never a false positive on legitimate copy.
 */
const BARE_MACHINE_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

/**
 * The generic fallback text, DERIVED by asking the humaniser for a code that
 * cannot have a template — never hand-copied.
 *
 * A hand-copied constant here would decay the moment the fallback copy is
 * reworded: the assertion "this code does not produce the fallback" would
 * silently start passing for every code, including ones with no template at
 * all. (That is exactly what happened to an earlier draft of this file, caught
 * by a mutant that deleted a template and bit nothing.)
 */
const FALLBACK_TEXT = humaniseCritique({
  id: 'probe',
  code: '__NO_SUCH_CODE_CAN_EXIST__',
  severity: 'warning',
  message: '',
  source: 'isl',
  blocks_analysis: false,
} as CritiqueV3);

function makeCritique(code: string): CritiqueV3 {
  return {
    id: 'test-id',
    code,
    severity: 'warning',
    message: 'internal debug text',
    source: 'isl',
    blocks_analysis: false,
  } as CritiqueV3;
}

describe('ISL critique copy coverage (never render a bare machine code)', () => {
  it('sanity: the pinned ISL vocabulary is non-empty and plausible', () => {
    // Guards against a vacuous suite if the constant is ever emptied.
    expect(ISL_CRITIQUE_CODES.length).toBe(34);
  });

  it('RED 1 — every ISL critique code has an explicit template (no fallback)', () => {
    const known = new Set(getKnownCodes());
    const missing = ISL_CRITIQUE_CODES.filter((c) => !known.has(c));
    expect(missing).toEqual([]);
  });

  it('RED 2 — no ISL code produces a user_message containing a bare machine code', () => {
    const leaking = ISL_CRITIQUE_CODES.filter((code) =>
      BARE_MACHINE_CODE.test(humaniseCritique(makeCritique(code))),
    );
    expect(leaking).toEqual([]);
  });

  it('RED 2b — every ISL code gets SPECIFIC copy, not the generic fallback', () => {
    // The property RED 2 cannot see: once the fallback is itself code-free,
    // a MISSING template is invisible to a bare-code scan. This binds the
    // stronger claim — each code has copy of its own.
    const generic = ISL_CRITIQUE_CODES.filter(
      (code) => humaniseCritique(makeCritique(code)) === FALLBACK_TEXT,
    );
    expect(generic).toEqual([]);
  });

  it('RED 3 — an UNKNOWN code still never leaks the code, and still routes the user onward', () => {
    // The durable half: this must hold for codes that do not exist yet, so
    // vocabulary drift can never reintroduce the leak.
    const msg = humaniseCritique(makeCritique('SOME_FUTURE_ISL_CODE_XYZ'));
    expect(msg).not.toContain('SOME_FUTURE_ISL_CODE_XYZ');
    expect(BARE_MACHINE_CODE.test(msg)).toBe(false);
    // Not a dead end: the user is told where to go next.
    expect(msg.length).toBeGreaterThan(0);
    expect(msg.toLowerCase()).toMatch(/advanced details|support|try again|next/);
  });

  it('RED 4 — the diagnostic is NOT deleted: `code` survives on the wire for every ISL critique', () => {
    const rows = addUserMessages(ISL_CRITIQUE_CODES.map(makeCritique));
    expect(rows.map((r) => r.code)).toEqual([...ISL_CRITIQUE_CODES]);
    // ...and `message` (the debug channel a user does not read) is untouched.
    for (const r of rows) expect(r.message).toBe('internal debug text');
  });

  it('RED 5 — DEGENERATE_OUTCOMES, the captured instance, gets real copy', () => {
    const msg = humaniseCritique(makeCritique('DEGENERATE_OUTCOMES'));
    expect(msg).not.toContain('DEGENERATE_OUTCOMES');
    // Bound to the DERIVED fallback, not to a hand-copied sentence — so this
    // still bites if the fallback wording changes.
    expect(msg).not.toBe(FALLBACK_TEXT);
    // Bound by IDENTITY to this code's own copy, so deleting a DIFFERENT
    // template cannot make this test red (proved by the M1/M3 mutant pair).
    expect(msg).toContain('Every option produced almost the same outcome');
  });
});
