/**
 * TRANSPORT CONTINUITY ACROSS HOP 6 — CEE → PLoT → CEE/UI.
 *
 * §9.8 of `parallel-briefs/BIAS-REAL-GRAPH-SEAM-DESIGN-2026-08-05.md`. Unlike
 * every other fixture in that RED set, this one REPRODUCES A LIVE DEFECT rather
 * than guarding a future seam.
 *
 * THE DEFECT. `BiasFindingSchema` was a bare `z.object()`. A bare Zod object
 * STRIPS unknown keys — no error, no warning, the key simply ceases to exist.
 * PLoT parses CEE's review with that schema on the live path
 * (`decision-review-orchestrator.ts:220`, `safeParseM1Review(ceeResult.review)`),
 * so `dsk_claim_id` and `evidence_strength` — the DSK science citation that CEE
 * *hard-rejects a review for getting wrong* (`shape-check.ts:459`, "not found in
 * loaded DSK bundle" → 422) — were produced, enforced at the producer, and then
 * silently deleted one hop later, before any user could see them.
 *
 * WHY A PIN BUMP WOULD NOT HAVE FIXED IT. PLoT validates `m1_review` with this
 * OWN hand-written Zod, not with `@talchain/schemas`. The hazard here is not
 * version skew — it is a second, independent contract, which is worse.
 *
 * WHY `.passthrough()` IS THE WRONG FIX, and is guarded below. A passthrough
 * carries the value at runtime but declares nothing: consumers cannot see the
 * field, no type describes it, and nothing rejects a malformed one. That trades
 * a silent strip (hazard 1) for a silent untyped passthrough (hazard 2). The
 * "DECLARED" test below is the guard: it fails under `.passthrough()` even
 * though the value-continuity tests would pass.
 *
 * SCOPE NOTE, stated so it is not over-read: this file asserts what the ZOD
 * SCHEMA declares. No gate in this repo typechecks `tests/` — `tsconfig.json`
 * includes `src/**` only, and `tsconfig.strict.json` extends it — so a
 * type-level assertion here would not be enforced by `npm run typecheck`. The
 * `BiasFinding` INTERFACE must therefore carry the fields too (it does, and
 * `safeParseM1Review` casts to it, so it is the type consumers actually see);
 * that half is enforced by `src/` typecheck at the consumer, not here.
 *
 * FIXTURE PROVENANCE. The review below is shaped from CEE's producer contract
 * at CEE `staging` f1482c0b — `Prompts/canonical/decision_review.txt` (the
 * bias_findings object contract, and "a finding matching a listed claim MUST
 * carry dsk_claim_id and evidence_strength copied exactly from that section")
 * cross-checked against CEE's own consumer declaration in
 * `src/orchestrator-v5/compose/phase3-blocks.ts` (header, the decision_review
 * shape). It is NOT derived from this repo's own golden fixtures: those were
 * authored to PLoT's schema, so they encode PLoT's model of CEE rather than
 * CEE's output, and could never have caught this.
 */

import { describe, it, expect } from 'vitest';
import { safeParseM1Review, M1ReviewSchema } from '../src/cee/validation/m1-review-types.js';

/**
 * A CEE-shaped decision review carrying the DSK citation on its bias findings.
 *
 * Two findings with DISTINCT identities, so assertions can bind by identity
 * rather than by position or by a value predicate another finding could satisfy
 * (trap 19). `flip_thresholds` is deliberately ABSENT — the producer's
 * flip-threshold row shape diverges from this repo's `FlipThresholdSchema` in a
 * way that is a separate, larger finding, and including it here would make this
 * fixture fail for a reason that is not the one under test.
 */
const CEE_SHAPED_REVIEW = {
  narrative_summary: 'Option A leads with a narrow lead of about 7 percentage points.',
  story_headlines: { 'opt-a': 'Leads on delivery certainty' },
  robustness_explanation: {
    summary: 'The ordering holds in about 71% of variations.',
    primary_risk: 'The link from Price to Revenue is the single biggest threat.',
    stability_factors: ['Delivery certainty anchors the result'],
    fragility_factors: ['The link from Price to Revenue could flip it'],
  },
  readiness_rationale: 'Two gaps still hold this back.',
  evidence_enhancements: {},
  bias_findings: [
    {
      type: 'DOMINANT_FACTOR',
      source: 'structural',
      description: 'One factor appears to dominate the modelled impact. Is that concentration intentional?',
      affected_elements: ['factor-market'],
      linked_critique_code: 'DOMINANT_FACTOR',
      dsk_claim_id: 'DSK-B-007',
      evidence_strength: 'strong',
    },
    {
      type: 'SUNK_COST',
      source: 'semantic',
      description: 'Past investment appears to weigh in the go-forward choice. Is that intended?',
      affected_elements: [],
      brief_evidence: 'already spent four months',
      dsk_claim_id: 'DSK-B-003',
      evidence_strength: 'medium',
    },
  ],
  key_assumptions: ['The link from Price to Revenue assumes current market conditions hold'],
  decision_quality_prompts: [],
} as const;

/**
 * Bind to a finding by its IDENTITY (`type`), and prove the binding is unique.
 *
 * A positional `[0]` or a value predicate (`f.evidence_strength === 'strong'`)
 * could be satisfied by a different finding, so an extractor could be deleted
 * while this file stayed green — the exact defect trap 19 names.
 */
function findingByType(
  findings: readonly { readonly type: string }[],
  type: string,
): Record<string, unknown> {
  const matches = findings.filter((f) => f.type === type);
  expect(matches, `expected exactly one bias finding with type "${type}"`).toHaveLength(1);
  return matches[0] as unknown as Record<string, unknown>;
}

describe('hop 6 transport continuity — CEE bias findings survive PLoT s M1Review parse', () => {
  it('CONTROL: the parse succeeds and an ALREADY-DECLARED optional field survives the hop', () => {
    // Trap 13: an assertion about a field SURVIVING is worthless unless the
    // harness is first shown able to observe a field that does survive. If this
    // control ever fails, the tests below prove nothing about the new fields.
    const parsed = safeParseM1Review(CEE_SHAPED_REVIEW);
    expect(parsed.success, JSON.stringify((parsed as { error?: unknown }).error)).toBe(true);

    const findings = (parsed as { data: { bias_findings: { type: string }[] } }).data.bias_findings;
    expect(findings).toHaveLength(2);

    expect(findingByType(findings, 'DOMINANT_FACTOR').linked_critique_code).toBe('DOMINANT_FACTOR');
    expect(findingByType(findings, 'SUNK_COST').brief_evidence).toBe('already spent four months');
  });

  it('carries dsk_claim_id through the hop, bound to the finding that produced it', () => {
    const parsed = safeParseM1Review(CEE_SHAPED_REVIEW);
    expect(parsed.success).toBe(true);
    const findings = (parsed as { data: { bias_findings: { type: string }[] } }).data.bias_findings;

    // Bound per-finding: a schema that carried only ONE finding's citation, or
    // that swapped them, fails here.
    expect(findingByType(findings, 'DOMINANT_FACTOR').dsk_claim_id).toBe('DSK-B-007');
    expect(findingByType(findings, 'SUNK_COST').dsk_claim_id).toBe('DSK-B-003');
  });

  it('carries evidence_strength through the hop, bound to the finding that produced it', () => {
    const parsed = safeParseM1Review(CEE_SHAPED_REVIEW);
    expect(parsed.success).toBe(true);
    const findings = (parsed as { data: { bias_findings: { type: string }[] } }).data.bias_findings;

    expect(findingByType(findings, 'DOMINANT_FACTOR').evidence_strength).toBe('strong');
    expect(findingByType(findings, 'SUNK_COST').evidence_strength).toBe('medium');
  });

  it('DECLARES both fields on the bias-finding schema — the guard against the .passthrough() wrong fix', () => {
    // This is the assertion the value-continuity tests above CANNOT make. Under
    // `.passthrough()` every assertion above still passes — the values ride
    // through untyped — and only this one reds. Present-and-TYPED is the
    // property; present alone is hazard 2 wearing hazard 1's clothes.
    const biasElement = M1ReviewSchema.shape.bias_findings.element;
    const declaredKeys = Object.keys(biasElement.shape);

    expect(declaredKeys).toContain('dsk_claim_id');
    expect(declaredKeys).toContain('evidence_strength');

    // And the declaration is load-bearing, not decorative: a declared field
    // REJECTS a wrong-typed value, where a passthrough would carry it onward.
    const malformed = {
      ...CEE_SHAPED_REVIEW,
      bias_findings: [{ ...CEE_SHAPED_REVIEW.bias_findings[0], dsk_claim_id: 42 }],
    };
    expect(
      safeParseM1Review(malformed).success,
      'a non-string dsk_claim_id must be rejected, not carried through untyped',
    ).toBe(false);
  });
});
