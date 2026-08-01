/**
 * Display-safe robustness verdict (lane PLoT-W5, roadmap Tier 1.6 — producer side).
 *
 * WHY: the UI hardcodes robustnessVerdict = undefined ("Robustness unknown")
 * because no display-safe field exists on the /v2/run wire. The wire carries
 * the raw producer facts (robustness.is_robust / level / confidence) but the
 * UI is forbidden to re-derive meaning from raw facts (claim-safety doctrine:
 * meaning is producer-owned). This module derives the ADDITIVE
 * `robustness.display_verdict` + `robustness.display_verdict_reason` fields
 * honestly and ONLY from producer facts.
 *
 * Mapping table (provisional_doctrine_v0 — evaluated strictly in order):
 *
 *   1. robustness not computed (absent / failed / blocked)  → 'not_assessed'
 *   2. is_robust === false                                  → 'fragile'
 *      (an explicit negative always wins — NEVER softened by level/confidence)
 *   3. level === 'low' | 'very_low'                         → 'fragile'
 *   4. level === 'medium' | 'moderate'                      → 'moderate'
 *      (ISL V2 wire sends 'medium'; 'moderate' accepted for vocabulary
 *      tolerance — same normalisation the UI applies)
 *   5. is_robust === true AND level === 'high'              → 'robust'
 *      (BOTH facts required — level alone never upgrades to 'robust')
 *   6. anything else (verdict-bearing facts missing or
 *      unrecognised)                                        → 'not_assessed'
 *
 * ⚠ THE REASON HAS A SECOND AXIS SINCE ROADMAP 2.278 — the mapping table above
 * describes the VERDICT only. The verdict is still derived from robustness
 * marginals alone and nothing below changes it. But the REASON is additionally
 * a function of the same run's FLIP EVIDENCE, because the two used to
 * contradict each other on the wire (see
 * `ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP` for the full account).
 * Reason = f(verdict, flip-evidence status); verdict = f(producer facts).
 *
 * Honesty invariants:
 *  - NEVER a determinate-looking verdict ('robust'/'moderate'/'fragile') when
 *    robustness was not actually computed.
 *  - `confidence` is NEVER an input — the function signature does not accept
 *    it, so confidence alone can never upgrade (or create) a verdict.
 *  - The reason phrases are producer-owned, claim-safe, and carry no numbers.
 *  - Flip evidence may reword a reason but must NEVER move a verdict.
 */

import type { DenormalisedFlipThreshold } from '../../lib/flip-threshold-denormaliser.js';
import { classifyFlipThresholdsStatus } from '../../lib/flip-threshold-status.js';

/** The four display-safe verdict values. Additive /v2/run wire enum. */
export type RobustnessDisplayVerdict =
  | 'robust'
  | 'moderate'
  | 'fragile'
  | 'not_assessed';

/**
 * Producer-owned display reason per verdict (provisional_doctrine_v0 wording).
 * Claim-safe: one short phrase, no numbers, no re-derivable statistics.
 * Single source of truth — the route emits these verbatim.
 */
export const ROBUSTNESS_DISPLAY_VERDICT_REASONS: Record<
  RobustnessDisplayVerdict,
  string
> = {
  robust: 'this result held up under the changes we tested',
  moderate: 'this result mostly held up, but could shift under some changes',
  fragile: 'small changes could flip this result',
  not_assessed: 'robustness was not assessed for this run',
};

/**
 * ROADMAP 2.278 — the SAME verdicts, worded for a run whose own flip evidence
 * ATTESTS that no factor flips the leading option.
 *
 * WHY THIS EXISTS. The verdict above is derived purely from robustness
 * marginals and never consulted the flip evidence sitting in the same
 * response. Witnessed live (`witness-2267-onscreen-flip.md`): across four
 * analysed scenarios, 19 of 19 flip-threshold rows came back
 * `structurally_invariant` — ISL's MATHEMATICAL ATTESTATION that no value of
 * that factor can move the argmax — and the product rendered no flip card,
 * because there was no flip to render. On those same turns the robustness
 * verdict shipped `fragile` + "small changes could flip this result". The run
 * asserted a flip and denied one, in the same payload.
 *
 * WHAT CHANGES AND WHAT DOES NOT. Only the REASON STRING changes. The VERDICT
 * is untouched: a run with no flippable factor can still be genuinely
 * non-robust for other reasons this module already measures (an explicit
 * `is_robust: false`, a low robustness level — and, on the witnessed turn,
 * fragile EDGES with a high switch probability, which is a different
 * measurement from factor flips and is not contradicted by them). Softening
 * the verdict on flip evidence alone would be the mirror-image error: using
 * one measurement to overrule another that never claimed the same thing.
 *
 * So these strings do two things the originals did not: they say WHAT WAS
 * MEASURED, and they stop claiming flippability that this run's own evidence
 * refutes.
 *
 * `robust` and `not_assessed` are intentionally absent — neither original
 * carries flip language, so neither has anything to correct, and restating
 * them here would create a second copy to drift.
 */
export const ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP: Partial<
  Record<RobustnessDisplayVerdict, string>
> = {
  fragile:
    'no single factor on its own changed which option leads, but this result scored low on our other robustness checks',
  moderate:
    'no single factor on its own changed which option leads, and this result mostly held up under the other changes we tested',
};

/**
 * The verdict-bearing producer facts. `unknown`-typed on purpose: the ISL
 * payload is external input — unrecognised values must degrade to
 * 'not_assessed', never crash or fabricate a determinate verdict.
 *
 * NOTE deliberately absent: `confidence`. It is not a verdict input
 * (invariant: confidence alone can never upgrade a verdict).
 */
export interface RobustnessVerdictFacts {
  is_robust?: unknown;
  level?: unknown;
}

/**
 * Derive the display-safe verdict + reason from producer facts.
 *
 * @param facts               is_robust / level as assembled from the ISL
 *                            response (undefined when ISL returned no
 *                            robustness object).
 * @param robustnessComputed  true ONLY when the response's
 *                            robustness_status is 'computed' — any other
 *                            status (unavailable / skipped / error, or a
 *                            blocked run that never reached ISL) must yield
 *                            'not_assessed'.
 */
export function deriveRobustnessDisplayVerdict(
  facts: RobustnessVerdictFacts | undefined,
  robustnessComputed: boolean,
  flipThresholds?: DenormalisedFlipThreshold[] | null,
): { display_verdict: RobustnessDisplayVerdict; display_verdict_reason: string } {
  const display_verdict = deriveVerdict(facts, robustnessComputed);

  // ROADMAP 2.278. The no-flip wording is used ONLY on `all_no_effect`, and the
  // classification is DERIVED by the shared classifier rather than re-read from
  // `flip_reason` strings here. That matters twice over:
  //
  //  · `classifyFlipThresholdsStatus` is the single source of truth for which
  //    reasons ATTEST a no-flip (`NO_EFFECT_REASONS`) and which merely mean "we
  //    did not finish". Restating that vocabulary here would be the
  //    hand-maintained-mirror defect — and it would drift SILENTLY, because a
  //    new unresolved reason misfiled as no-effect reads as a cleaner result.
  //  · `all_no_effect` is the ONLY status that means "every factor was probed
  //    and none can flip the winner". Every other status is left on the
  //    original wording, deliberately and for distinct reasons:
  //      - `unavailable`  → empty or absent array. This is the dominant LEGACY
  //                         and degraded shape and it means "nobody computed
  //                         this", NOT "nothing can flip". Blinding it would be
  //                         asserting an absence from a measurement that never
  //                         ran.
  //      - `unresolved` / `partial_no_effect` → at least one row timed out,
  //                         errored, or was never evaluated. An unfinished
  //                         probe attests nothing.
  //      - `computed`     → a real flip WAS found; flip language is earned.
  const attestedNoFlip =
    classifyFlipThresholdsStatus(flipThresholds).status === 'all_no_effect';

  const display_verdict_reason =
    (attestedNoFlip
      ? ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP[display_verdict]
      : undefined) ?? ROBUSTNESS_DISPLAY_VERDICT_REASONS[display_verdict];

  return { display_verdict, display_verdict_reason };
}

function deriveVerdict(
  facts: RobustnessVerdictFacts | undefined,
  robustnessComputed: boolean,
): RobustnessDisplayVerdict {
  // Rule 1: no computed robustness → never a determinate-looking verdict.
  if (!robustnessComputed || facts === undefined) return 'not_assessed';

  const isRobust =
    typeof facts.is_robust === 'boolean' ? facts.is_robust : undefined;
  const level = typeof facts.level === 'string' ? facts.level : undefined;

  // Rule 2: explicit negative always wins — never softened.
  if (isRobust === false) return 'fragile';

  // Rule 3
  if (level === 'low' || level === 'very_low') return 'fragile';

  // Rule 4 (ISL wire vocabulary 'medium'; 'moderate' tolerated)
  if (level === 'medium' || level === 'moderate') return 'moderate';

  // Rule 5: BOTH facts required for the strongest claim.
  if (isRobust === true && level === 'high') return 'robust';

  // Rule 6: verdict-bearing facts missing or unrecognised.
  return 'not_assessed';
}
