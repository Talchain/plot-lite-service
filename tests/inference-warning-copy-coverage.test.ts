/**
 * Inference-warning copy coverage — the channel `isl-critique-copy-coverage`
 * deliberately scoped OUT.
 *
 * That file's own words: "NOT included, deliberately: ISL's `InferenceWarning`
 * channel (14 further codes, e.g. ROOT_NODE_DEFAULT_VALUE ...). Whether that
 * channel puts a bare code on a user surface is a separate question with a
 * separate owner." This suite is that owner.
 *
 * TWO GUARDS THAT ARE DELIBERATELY NOT REDUNDANT (trap 12d):
 *
 *   1. A DERIVED guard over PLoT's own `INFERENCE_WARNING_CODES`. It IMPORTS
 *      the registry, so a 16th PLoT code minted with no copy REDs on its own,
 *      with no list here to remember to update. Derivation proves AGREEMENT.
 *
 *   2. A hand-written ISL set, declared as the mirror it is. Derivation cannot
 *      prove COMPLETENESS and cannot see a code that lives in another repo, so
 *      the only thing that can notice a SHORT list is a corpus written by hand.
 *      Ship both or a whole defect class goes unobserved.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  INFERENCE_WARNING_COPY,
  humaniseInferenceWarning,
  addInferenceWarningUserMessages,
  getKnownInferenceWarningCodes,
  INFERENCE_WARNING_BUCKET,
  inferenceWarningBucket,
  DELIBERATELY_NO_USER_MESSAGE,
  RANGE_FIT_REFUSAL_CODES,
  RANGE_REFUSAL_CAUSE_NOT_NAMED,
} from '../src/inference-warning-humaniser.js';
// Imported for RED 15b: the severity premise is read out of the EMITTER by
// execution, not out of its docstring (review F7).
import { describeEdgeEValueDrop } from '../src/routes/v2/run.js';
import { REPO_ROOT } from './helpers/isl-pinned-artifacts.js';
import { INFERENCE_WARNING_CODES } from '../src/types/engine-v3.js';
import type { InferenceWarning } from '../src/types/engine-v3.js';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

/** DERIVED, never mirrored — PLoT's own registry, imported. */
const PLOT_CODES: readonly string[] = Object.values(INFERENCE_WARNING_CODES);

/**
 * ISL-forwarded codes, evidenced INSIDE THIS REPO so the set is not a guess:
 *   ROOT_NODE_DEFAULT_VALUE      tests/fixtures/isl-pinned/isl-openapi.json
 *                                ("no observed value was provided, so it fell
 *                                 back to 0.0"), plus the sampler transcript.
 *   CONSTRAINT_NODE_DEFAULT_BASE captured in inference_warnings AND critiques,
 *   CONSTRAINT_FRAME_UNSPECIFIED captured in inference_warnings,
 *   CONSTRAINT_NOT_CONVERTIBLE   captured in inference_warnings,
 *     all three in tests/fixtures/isl-constraint-value-frame-20260807/.
 * EVPI_UNAVAILABLE is ISL-originated too but already sits in PLoT's registry,
 * so it arrives via PLOT_CODES and is not repeated here.
 */
const ISL_FORWARDED_CODES: readonly string[] = [
  'ROOT_NODE_DEFAULT_VALUE',
  'CONSTRAINT_NODE_DEFAULT_BASE',
  'CONSTRAINT_FRAME_UNSPECIFIED',
  'CONSTRAINT_NOT_CONVERTIBLE',
];

/**
 * ⭐ ISL's CLOSED range-fit refusal vocabulary, DERIVED from an exhaustive
 * `Record<RangeFitRefusalCode, string>` in the humaniser, so it can never go
 * short the way the hand list above did (review F5). Folded into ALL_COVERED so
 * every RED below sweeps it without anyone editing a list here.
 */
const RANGE_CODES: readonly string[] = RANGE_FIT_REFUSAL_CODES;

const ALL_COVERED = [...PLOT_CODES, ...ISL_FORWARDED_CODES, ...RANGE_CODES];

/** SCREAMING_SNAKE with at least one underscore — a leaked machine code. */
const BARE_MACHINE_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

function warn(code: string, over: Partial<InferenceWarning> = {}): InferenceWarning {
  return { code, message: 'internal debug text', severity: 'warning', ...over };
}

describe('inference-warning copy coverage', () => {
  it('sanity: the derived registry is non-empty and plausible', () => {
    // Without this a registry that silently became empty would make every
    // coverage assertion below pass by iterating nothing.
    expect(PLOT_CODES.length).toBeGreaterThanOrEqual(15);
    expect(ISL_FORWARDED_CODES.length).toBe(4);
    // Pinned so a SHRINK is visible. A GROWTH is already a compile error in the
    // humaniser's exhaustive record, which is the half a test cannot give you.
    expect(RANGE_CODES.length).toBe(7);
    // PIN THE SUITE'S OWN PRECONDITION. RED 4, 5 and 6 iterate the copy map and
    // therefore PASS VACUOUSLY when it is empty — measured: at an emptied map
    // they were green while nine siblings were red. A guard whose silence is
    // indistinguishable from success is a guard agreeing with itself, so the
    // non-emptiness it depends on is asserted here rather than assumed.
    // ⚠ MINUS THE DELIBERATELY-UNCOVERED SET. A code withheld on purpose (see
    // RED 1b) legitimately lowers the registry count, so comparing against the
    // raw ALL_COVERED length would RED on a correct state. The subtraction is
    // derived from the exported set, not a hand-tuned constant, so it cannot
    // drift from it.
    expect(getKnownInferenceWarningCodes().length).toBeGreaterThanOrEqual(
      ALL_COVERED.length - DELIBERATELY_NO_USER_MESSAGE.size,
    );
  });

  it('RED 1 — every PLoT inference-warning code has copy (DERIVED from the registry)', () => {
    const known = new Set(getKnownInferenceWarningCodes());
    expect(
      PLOT_CODES.filter((c) => !known.has(c) && !DELIBERATELY_NO_USER_MESSAGE.has(c)),
    ).toEqual([]);
  });

  it('RED 1b — the deliberately-uncovered set is EXACTLY what it claims, and is real', () => {
    // ⭐ PINNED EXACTLY, so this REDs if the set GROWS (a code quietly loses its
    // copy) or SHRINKS (someone "fixes" the gap by adding the generic template
    // that review F2 removed on purpose). A known gap recorded in the suite is
    // honest; a known gap invisible to it is how it comes back.
    expect([...DELIBERATELY_NO_USER_MESSAGE].sort()).toEqual(['CONSTRAINT_TARGET_UNRELIABLE']);

    // PRECONDITION, so the exclusion above cannot pass by naming a code that
    // does not exist: every member must be a REAL registry code, and must
    // genuinely resolve to no user_message.
    const registry = new Set(getKnownInferenceWarningCodes());
    for (const c of DELIBERATELY_NO_USER_MESSAGE) {
      expect(PLOT_CODES.includes(c) || ISL_FORWARDED_CODES.includes(c)).toBe(true);
      expect(registry.has(c)).toBe(false);
      expect(humaniseInferenceWarning(c)).toBeUndefined();
    }
  });

  it('RED 2 — every ISL-forwarded code evidenced in this repo has copy', () => {
    const known = new Set(getKnownInferenceWarningCodes());
    expect(ISL_FORWARDED_CODES.filter((c) => !known.has(c))).toEqual([]);
  });

  it('RED 2b — the range-fit refusal set IS ISL\'s, derived at the pinned OpenAPI', () => {
    // Review F5 charged that a hand list goes short, and this one had. The fix
    // is not a longer hand list: it is a record tsc keeps exhaustive against
    // ISL's closed union. This RED checks the two ends agree with ISL's own
    // machine-generated artefact, so the suite cannot bless a vocabulary that
    // has drifted from the producer's.
    const known = new Set(getKnownInferenceWarningCodes());
    expect(RANGE_CODES.filter((c) => !known.has(c))).toEqual([]);

    const openapi = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'tests/fixtures/isl-pinned/isl-openapi.json'), 'utf8'),
    ) as { components: { schemas: Record<string, { properties: { code: { enum: string[] } } }> } };
    const islEnum = openapi.components.schemas.RangeFitRefusalPayload.properties.code.enum;
    // POSITIVE CONTROL first: an empty or absent enum would make the comparison
    // below pass by comparing nothing (trap 13).
    expect(islEnum.length).toBe(7);
    expect([...islEnum].sort()).toEqual([...RANGE_CODES].sort());
  });

  it('RED 2c — the LIVE-CAPTURED refused range now reaches the user, instead of nothing', () => {
    // The evidence review F5 rests on, read from the dated capture rather than a
    // fixture written here: a real ISL response to a real backwards range. A
    // fixture you wrote yourself is not evidence about the wire.
    const capture = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, 'tests/fixtures/isl-range-fit-live-20260807/C-invalid-order.response.json'),
        'utf8',
      ),
    ) as { inference_warnings: { code: string; severity: 'info' | 'warning'; field?: string; detail: { message: string } }[] };
    const row = capture.inference_warnings.find((w) => w.code === 'RANGE_INVALID_ORDER');
    expect(row, 'the capture this finding rests on no longer carries the code').toBeDefined();
    expect(row!.detail.message.length).toBeGreaterThan(20);

    // Shaped the way PLoT's ISL merge shapes it: detail.message is promoted to
    // `message` (src/routes/v2/run.ts, the ISL inference_warnings merge).
    const out = addInferenceWarningUserMessages([
      {
        code: row!.code,
        message: row!.detail.message,
        severity: row!.severity,
        ...(row!.field !== undefined && { field: row!.field }),
      },
    ]);
    expect(out[0].user_message, 'a refused user-stated range showed NOTHING before this').toBeDefined();
    expect(out[0].user_message).toMatch(/lower bound/i);
    expect(out[0].disclosure_bucket).toBe('not_your_number');
    // The producer's own sentence survives untouched on the diagnostic channel.
    expect(out[0].message).toBe(row!.detail.message);
  });

  it('RED 2d — a refusal names a CAUSE only where the producer guarantees one', () => {
    // ⭐ The recorded gap, pinned EXACTLY: it REDs if the set grows (a grounded
    // cause was dropped) or shrinks (a cause was invented from a code NAME,
    // which is review F10's defect and trap 13c's).
    expect([...RANGE_REFUSAL_CAUSE_NOT_NAMED].sort()).toEqual([
      'RANGE_AT_DOMAIN_EDGE',
      'RANGE_NON_FINITE',
      'RANGE_OUT_OF_DOMAIN',
      'RANGE_ZERO_WIDTH',
    ]);

    // The four ungrounded codes share ONE string...
    const ungrounded = new Set([...RANGE_REFUSAL_CAUSE_NOT_NAMED].map((c) => humaniseInferenceWarning(c)));
    expect(ungrounded.size).toBe(1);
    const familyText = [...ungrounded][0]!;
    // ...and the three grounded ones do NOT, so this cannot pass by every
    // refusal having collapsed to the same generic sentence.
    const grounded = RANGE_CODES.filter((c) => !RANGE_REFUSAL_CAUSE_NOT_NAMED.has(c as never));
    expect(grounded.length).toBe(3);
    for (const c of grounded) expect(humaniseInferenceWarning(c)).not.toBe(familyText);

    // The one clause ISL's model guarantees for ALL seven: never a fallback,
    // nothing minted in place of the refused fit.
    for (const c of RANGE_CODES) {
      expect(humaniseInferenceWarning(c)).toMatch(/nothing was substituted in its place/i);
    }
    // ⛔ And none of them may claim the range would otherwise have moved the
    // numbers: engine-v3.ts is explicit that the field is CARRIED, NOT APPLIED.
    for (const c of RANGE_CODES) {
      expect(humaniseInferenceWarning(c)).not.toMatch(/would have changed|now counts|has been applied/i);
    }
  });

  it('RED 3 — every covered code resolves to a NON-EMPTY user_message', () => {
    const empty = ALL_COVERED.filter((c) => {
      if (DELIBERATELY_NO_USER_MESSAGE.has(c)) return false;
      const m = humaniseInferenceWarning(c);
      return m === undefined || m.trim().length === 0;
    });
    expect(empty).toEqual([]);
    // The exclusion is not a hole: RED 1b pins the excluded set exactly and
    // asserts each member really does resolve to `undefined`.
  });

  it('RED 4 — no copy leaks a bare machine code at the user', () => {
    const leaking = ALL_COVERED.filter((c) =>
      BARE_MACHINE_CODE.test(humaniseInferenceWarning(c) ?? ''),
    );
    expect(leaking).toEqual([]);
  });

  it('RED 5 — copy obeys the house style (no markdown, no shouting, no em dashes)', () => {
    const offenders: string[] = [];
    for (const [code, text] of Object.entries(INFERENCE_WARNING_COPY)) {
      if (/[*_`#]/.test(text)) offenders.push(`${code}: markdown`);
      if (text.includes('!')) offenders.push(`${code}: exclamation mark`);
      // Producer-copy ruling, recorded in isl-v2-golden-response.pin.test.ts.
      if (text.includes('—')) offenders.push(`${code}: em dash`);
      // ⭐ REVIEW F9. "unaffected" is a claim about TRUST; every degradation on
      // this channel is a fact about DELIVERY. A figure can be byte-identical
      // and still be worth less to a reader who has just lost the thing that
      // would have let them judge it — so "the comparison between your options
      // is unaffected" is true of the numbers and false of the confidence, and
      // the reader takes the second reading. "unchanged" says the true half.
      // This product's job is to keep someone thinking, and "unaffected" is an
      // instruction to stop.
      if (/\bunaffected\b/i.test(text)) offenders.push(`${code}: "unaffected" claims trust, not delivery`);
      // American -ize/-yze spellings. British English is the house standard.
      if (/\b\w+(?:iz|yz)(?:e|es|ed|ing|ation)\b/.test(text)) offenders.push(`${code}: US spelling`);
      if (!/[.]$/.test(text.trim())) offenders.push(`${code}: no full stop`);
    }
    expect(offenders).toEqual([]);
  });

  it('RED 6 — jargon is never printed unexpanded at the user', () => {
    const jargon = /\bEVPI\b|\bepsilon\b|\bvariance\b|ParameterUncertainty|observed_state|p_win_sensitivity|n_samples/;
    const offenders = Object.entries(INFERENCE_WARNING_COPY)
      .filter(([, t]) => jargon.test(t))
      .map(([c]) => c);
    expect(offenders).toEqual([]);
  });

  // =========================================================================
  // The substituted-zero family. Bound BY IDENTITY to each code's own copy, so
  // deleting a DIFFERENT template cannot make these pass or fail (trap 19).
  // =========================================================================

  it('RED 7 — ROOT_NODE_DEFAULT_VALUE says ZERO plainly, and does not call it an estimate', () => {
    const m = humaniseInferenceWarning('ROOT_NODE_DEFAULT_VALUE')!;
    expect(m).toContain('no measured value');
    expect(m).toContain('zero');
    // The whole point of the string: a substituted zero must never be dressed
    // up as an estimate of the real value.
    expect(m).toMatch(/not an estimate/i);
  });

  it('RED 8 — CONSTRAINT_NODE_DEFAULT_BASE says ZERO plainly', () => {
    const m = humaniseInferenceWarning('CONSTRAINT_NODE_DEFAULT_BASE')!;
    expect(m).toContain('no measured starting value');
    expect(m).toContain('zero');
    // ISL is explicit that with every root ancestor carrying data this figure
    // is "model-derived, not a missing-data placeholder", so the copy must NOT
    // call it unreliable. This binds that restraint.
    expect(m).not.toMatch(/unreliable|cannot be trusted/i);
  });

  it('RED 9 — FLIP_THRESHOLDS_UNAVAILABLE does not claim nothing could flip', () => {
    // The producer added this marker precisely to stop "empty" being read as
    // "no factor could change the leading option".
    const m = humaniseInferenceWarning('FLIP_THRESHOLDS_UNAVAILABLE')!;
    expect(m).toMatch(/could not check/i);
    expect(m).toMatch(/does not mean/i);
  });

  it('RED 10 — EVPI_UNAVAILABLE names no cause, because the captured instance is not a timeout', () => {
    // tests/fixtures/isl-constraint-value-frame-20260807/A-control-no-frame
    // carries EVPI_UNAVAILABLE with reason "constraints_not_convertible" at
    // 60ms. Copy asserting a time limit would be false on the only instance
    // this repo has actually captured.
    const m = humaniseInferenceWarning('EVPI_UNAVAILABLE')!;
    expect(m).not.toMatch(/ran out of time|time limit|timed out|too long/i);
  });

  it('RED 14 — every code with copy also has a disclosure bucket (DERIVED)', () => {
    // A consumer rendering these needs to know which are reassurance and which
    // mean a number is compromised. Derived from the copy map, so a code added
    // with copy but no bucket REDs rather than defaulting to a silent guess.
    const missing = getKnownInferenceWarningCodes().filter((c) => inferenceWarningBucket(c) === undefined);
    expect(missing).toEqual([]);
    // ...and no bucket for a code that has no copy.
    const orphan = Object.keys(INFERENCE_WARNING_BUCKET).filter(
      (c) => humaniseInferenceWarning(c) === undefined,
    );
    expect(orphan).toEqual([]);
  });

  it('RED 15 — the two calibration anchors are bucketed as ruled', () => {
    // Bound by IDENTITY to the anchors the coordinator confirmed at the
    // emitting sites, so a later re-bucketing of either has to argue with this.
    expect(inferenceWarningBucket('ROOT_NODE_DEFAULT_VALUE')).toBe('not_your_number');
    expect(inferenceWarningBucket('CONSTRAINT_NODE_DEFAULT_BASE')).toBe('not_your_number');
    expect(inferenceWarningBucket('EDGE_E_VALUE_NON_FINITE_DROPPED')).toBe('expected');
    // Severity CANNOT produce this split: both of these are `info` and they
    // land in different buckets. Pinning it stops anyone "simplifying" the
    // bucket map into a severity lookup.
    expect(inferenceWarningBucket('ROOT_NODE_DEFAULT_VALUE')).not.toBe(
      inferenceWarningBucket('EDGE_E_VALUE_NON_FINITE_DROPPED'),
    );
  });

  it('RED 15b — the severity premise RED 15 rests on is MEASURED at both producers', () => {
    // ⛔ REVIEW F7. RED 15 above closes with "Severity CANNOT produce this split:
    // both of these are `info` and they land in different buckets" — and until
    // now that premise lived ONLY in that comment. Nothing asserted the severity
    // of either code, so if one moved to `warning` the whole justification for a
    // separate bucket map would evaporate with NO RED anywhere. A justification
    // nothing can falsify is not a justification.

    // (a) PLoT's own emitter, BY EXECUTION — never by reading its docstring.
    const drop = describeEdgeEValueDrop(4, 0);
    expect(drop, 'the emitter no longer produces a disclosure for a pure input-null drop').toBeDefined();
    expect(drop!.code).toBe('EDGE_E_VALUE_NON_FINITE_DROPPED');
    expect(drop!.severity).toBe('info');
    expect(inferenceWarningBucket(drop!.code)).toBe('expected');

    // (b) an ISL-ORIGINATED code in the OTHER bucket at the SAME severity, read
    // out of a dated LIVE capture rather than a fixture written here.
    const capture = JSON.parse(
      readFileSync(
        resolve(REPO_ROOT, 'tests/fixtures/isl-constraint-value-frame-20260807/A-control-no-frame.response.json'),
        'utf8',
      ),
    ) as { inference_warnings: { code: string; severity: string }[] };
    const anchor = capture.inference_warnings.find((w) => w.code === 'CONSTRAINT_NODE_DEFAULT_BASE');
    expect(anchor, 'the capture this premise rests on no longer carries the anchor').toBeDefined();
    expect(anchor!.severity).toBe('info');
    expect(inferenceWarningBucket('CONSTRAINT_NODE_DEFAULT_BASE')).toBe('not_your_number');

    // The premise itself, now as an assertion: same severity, different bucket.
    expect(drop!.severity).toBe(anchor!.severity);
    expect(inferenceWarningBucket(drop!.code)).not.toBe(
      inferenceWarningBucket('CONSTRAINT_NODE_DEFAULT_BASE'),
    );
  });

  // =========================================================================
  // Wire behaviour
  // =========================================================================

  it('RED 11 — addUserMessages attaches copy without touching the diagnostic channel', () => {
    const input: InferenceWarning[] = [
      warn('ROOT_NODE_DEFAULT_VALUE', { severity: 'info', field: 'factor_sensitivity' }),
      warn('EVPI_UNAVAILABLE', { elapsed_ms: 60.6 }),
    ];
    const out = addInferenceWarningUserMessages(input);

    expect(out.map((w) => w.code)).toEqual(['ROOT_NODE_DEFAULT_VALUE', 'EVPI_UNAVAILABLE']);
    for (const w of out) expect(w.message).toBe('internal debug text');
    expect(out[0].severity).toBe('info');
    expect(out[0].field).toBe('factor_sensitivity');
    expect(out[1].elapsed_ms).toBe(60.6);
    // `toBeDefined` FIRST: without it both sides are `undefined` on an empty
    // map and this assertion passes while attaching nothing (measured).
    expect(out[0].user_message).toBeDefined();
    expect(out[1].user_message).toBeDefined();
    expect(out[0].user_message).toBe(humaniseInferenceWarning('ROOT_NODE_DEFAULT_VALUE'));
    expect(out[1].user_message).toBe(humaniseInferenceWarning('EVPI_UNAVAILABLE'));
    // Input not mutated.
    expect((input[0] as InferenceWarning).user_message).toBeUndefined();
  });

  it('RED 16 — the disclosure bucket REACHES THE WIRE, so the taxonomy is not dark', () => {
    // ⛔ REVIEW F6: the bucket map had ZERO references outside its own module and
    // this suite, with a contrast control proving the sweep could see. A
    // taxonomy nothing consumes cannot be wrong in production and cannot be
    // right either — and it becomes a trap the moment a consumer arrives and
    // inherits whichever reading it happens to carry. It now rides the warning.
    const out = addInferenceWarningUserMessages([
      warn('ROOT_NODE_DEFAULT_VALUE', { severity: 'info' }),
      warn('EDGE_E_VALUE_NON_FINITE_DROPPED', { severity: 'info' }),
      warn('SOME_FUTURE_ISL_CODE_XYZ'),
    ]);
    expect(out[0].disclosure_bucket).toBe('not_your_number');
    expect(out[1].disclosure_bucket).toBe('expected');
    // A code with no copy gets no bucket either, so absence keeps meaning the
    // one thing it meant: no producer-grounded reading exists yet.
    expect(out[2].disclosure_bucket).toBeUndefined();
    // PIN THE PRECONDITION: the two buckets on THIS payload must differ, or a
    // silent collapse to a single value would satisfy both assertions above.
    expect(out[0].disclosure_bucket).not.toBe(out[1].disclosure_bucket);
    // Additive only — the diagnostic channel is untouched.
    for (const w of out) expect(w.message).toBe('internal debug text');
  });

  it('RED 12 — a code with no copy gets NO user_message, rather than a vague sentence', () => {
    const out = addInferenceWarningUserMessages([warn('SOME_FUTURE_ISL_CODE_XYZ')]);
    expect(out[0].user_message).toBeUndefined();
    // The diagnostic survives, which is what the advanced details consume.
    expect(out[0].message).toBe('internal debug text');
    expect(out[0].code).toBe('SOME_FUTURE_ISL_CODE_XYZ');
  });

  it('RED 13 — user_message is additive-safe against the real egress envelope', async () => {
    // The change ships a new key on an element the enrichment guard parses. If
    // AnalysisEnrichmentSchema were strict there, every response carrying a
    // warning would raise ENRICHMENT_CONTRACT_MISMATCH. Proven by execution,
    // with a CONTRAST CONTROL that must FAIL so a green result cannot be
    // vacuous (trap 13).
    const { AnalysisEnrichmentSchema } = await import('@talchain/schemas/boundary');
    const humanised = addInferenceWarningUserMessages([warn('ROOT_NODE_DEFAULT_VALUE')]);

    expect(humanised[0].user_message).toBeDefined();
    // review F6 ships a SECOND additive key on the same element; it needs the
    // same proof, and it gets it in the same run rather than by analogy.
    expect(humanised[0].disclosure_bucket).toBeDefined();
    expect(AnalysisEnrichmentSchema.safeParse({ inference_warnings: humanised }).success).toBe(true);

    // Contrast: a genuinely malformed element MUST be rejected, or the
    // assertion above proves only that the schema accepts everything.
    const bad = AnalysisEnrichmentSchema.safeParse({
      inference_warnings: [{ code: 123, message: 'x', severity: 'warning' }],
    });
    expect(bad.success).toBe(false);
  });
});

// ===========================================================================
// REACHABILITY — the half that decides whether any of this copy is worth
// writing. `user_message` on the wire is a field a consumer must choose to
// render; `decision_brief.defaulted_assumptions[].note` is ALREADY rendered,
// and until now it echoed the producer's engineer prose verbatim.
// ===========================================================================

describe('defaulted_assumptions[].note reaches the user with product copy', () => {
  function makeInput(warnings: InferenceWarning[]): BriefAssemblyInput {
    return {
      analysis_status: 'computed',
      critiques: [],
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Keep price', id: 'opt_a', label: 'Keep price', win_probability: 0.6 },
        { option_id: 'opt_b', option_label: 'Raise price', id: 'opt_b', label: 'Raise price', win_probability: 0.4 },
      ] as any[],
      robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
      inference_warnings: warnings as any,
      meta: { seed_used: '42' },
    } as BriefAssemblyInput;
  }

  /** The exact producer string captured from ISL, never paraphrased. */
  const CAPTURED_ISL_PROSE =
    "Node 'out_throughput' has no ParameterUncertainty — base offset defaulted to 0.0; " +
    'its samples are the forward-propagated composition of its parents';

  it('a humanised warning puts PRODUCT COPY on the note, not the producer prose', () => {
    const humanised = addInferenceWarningUserMessages([
      { code: 'CONSTRAINT_NODE_DEFAULT_BASE', message: CAPTURED_ISL_PROSE, severity: 'warning' },
    ]);
    const brief = assembleBrief(makeInput(humanised))!;

    const rows = (brief.defaulted_assumptions ?? []).filter(
      (r) => (r as Record<string, unknown>).code === 'CONSTRAINT_NODE_DEFAULT_BASE',
    );
    expect(rows, 'bound by code identity, not by position').toHaveLength(1);
    const note = (rows[0] as Record<string, unknown>).note as string;

    expect(note).toBe(humaniseInferenceWarning('CONSTRAINT_NODE_DEFAULT_BASE'));
    // The specific leak this closes.
    expect(note).not.toContain('ParameterUncertainty');
    expect(note).not.toContain('out_throughput');
    expect(note).not.toContain('forward-propagated');
  });

  it('a code with NO copy puts NO ROW on the rendered brief, and keeps its diagnostic', () => {
    // ⛔ REVIEW F8, and note what it replaces: this test previously asserted the
    // FALLBACK, i.e. it pinned the leak. `user_message`'s own contract says a
    // consumer should fall back to showing NOTHING rather than to `message`,
    // because `message` interpolates raw node ids and internal field names.
    const warnings: InferenceWarning[] = [
      { code: 'SOME_FUTURE_DEFAULT_CODE', message: CAPTURED_ISL_PROSE, severity: 'info' },
    ];
    const brief = assembleBrief(makeInput(warnings))!;
    const rows = (brief.defaulted_assumptions ?? []).filter(
      (r) => (r as Record<string, unknown>).code === 'SOME_FUTURE_DEFAULT_CODE',
    );
    expect(rows).toHaveLength(0);

    // ⭐ CONTRAST CONTROL IN THE SAME RUN, or "0 rows" is equally consistent with
    // the builder having stopped emitting default_disclosure rows at all.
    const withCopy = assembleBrief(
      makeInput(
        addInferenceWarningUserMessages([
          { code: 'CONSTRAINT_NODE_DEFAULT_BASE', message: CAPTURED_ISL_PROSE, severity: 'warning' },
        ]),
      ),
    )!;
    expect(
      (withCopy.defaulted_assumptions ?? []).filter(
        (r) => (r as Record<string, unknown>).code === 'CONSTRAINT_NODE_DEFAULT_BASE',
      ),
    ).toHaveLength(1);

    // NOTHING IS LOST: the full diagnostic survives on the channel that carries
    // it, which is where the advanced-details surface reads it from.
    expect(addInferenceWarningUserMessages(warnings)[0].message).toBe(CAPTURED_ISL_PROSE);
  });

  it('F4 — the TWO rows in this one array speak with ONE vocabulary about ONE substitution', () => {
    // ⭐ REVIEW F4. ISL's pinned OpenAPI on `value_defaulted`: "no observed value
    // was provided, so it fell back to 0.0 ... Derived from the SAME
    // observed-value check as the ROOT_NODE_DEFAULT_VALUE warning." So these two
    // rows describe ONE substitution. The factor row said "a default" while the
    // warning row said "zero ... not an estimate", and the factor row SORTS
    // FIRST — a reader meeting both reconciles them by taking the milder one as
    // the true reading. This binds the RELATIONSHIP, which is what F4 is about;
    // a per-string assertion cannot see a divergence between two strings.
    const input = makeInput(
      addInferenceWarningUserMessages([
        { code: 'ROOT_NODE_DEFAULT_VALUE', message: CAPTURED_ISL_PROSE, severity: 'info' },
      ]),
    );
    input.factor_sensitivity = [
      { factor_id: 'fac_team_maturity', factor_label: 'Team maturity', value_defaulted: true },
    ] as never;

    const rows = (assembleBrief(input)!.defaulted_assumptions ?? []) as Record<string, unknown>[];
    // Bound by IDENTITY (source / code), never by position or by a value
    // predicate the other row could satisfy.
    const factorRow = rows.find((r) => r.source === 'value_defaulted');
    const warnRow = rows.find((r) => r.code === 'ROOT_NODE_DEFAULT_VALUE');
    expect(factorRow, 'no value_defaulted row — the precondition of this test').toBeDefined();
    expect(warnRow, 'no ROOT_NODE_DEFAULT_VALUE row — the precondition of this test').toBeDefined();
    // And they really are in ONE array, adjacent, factor row first.
    expect(rows.indexOf(factorRow!)).toBeLessThan(rows.indexOf(warnRow!));

    for (const r of [factorRow!, warnRow!]) {
      const note = r.note as string;
      expect(note).toContain('zero');
      expect(note).toMatch(/not an estimate/i);
      expect(note, 'the euphemism this finding is about').not.toMatch(/\ba default\b/i);
    }
  });
});
