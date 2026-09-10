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
import { GOAL_FIT_PHRASE } from '../../constants/result-voice.js';

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
 *
 * ⚠ THIS IS THE MAJORITY BRANCH, not a fallback nobody sees. It is the `??`
 * default for every run whose flip evidence does NOT attest a no-flip, which is
 * most of them, and the UI renders it verbatim in the post-analysis footer.
 *
 * ⚠ VOICE (2026-09-10, Paul's ruling) — applied here on 2026-09-10 after review
 * found the record untouched while its sibling and the decision brief had both
 * moved. Two things changed:
 *
 *  1. THE SUBJECT IS THIS RUN AND ITS DATA, never "the result". The analysis is
 *     a tool for helping a team think, not an oracle handing down an answer, and
 *     "this result held up" states a verdict about the world where "this run
 *     held up under the changes we tested" states what was measured. The brief's
 *     `robustness_caveat` says "this run"; when this record still said "this
 *     result" the two emitters `constants/result-voice.ts` exists to align were
 *     using different subjects on the same screen.
 *  2. `fragile` NO LONGER SAYS THE ANSWER COULD "FLIP". It says what could
 *     change and relative to what the user asked: {@link GOAL_FIT_PHRASE}. The
 *     old phrase asserted the answer could move while anchoring that movement to
 *     nothing at all, which is precisely what the ruling forbids, and it is now
 *     word-for-word the lowercase fragment of the brief's fragile sentence.
 *
 * `not_assessed` is unchanged: it already named the run, made no claim about a
 * contest, and its "not assessed" literal is pinned as an honesty invariant.
 *
 * ⚠ These strings are rendered VERBATIM as a "·"-separated meta segment (UI
 * `postAnalysisFooter.ts`), so they stay LOWERCASE, unterminated fragments and
 * carry no em dash and no numbers.
 *
 * ⚠ The historical wording is deliberately preserved where this repo RECORDS
 * what shipped (the ROADMAP 2.278 account below, the flip-evidence test's
 * header, `docs/lanes/LANE18-*`). Those are evidence of sentences the product
 * actually emitted on dated builds; rewriting them would falsify the record.
 */
export const ROBUSTNESS_DISPLAY_VERDICT_REASONS: Record<
  RobustnessDisplayVerdict,
  string
> = {
  robust: 'this run held up under the changes we tested',
  moderate: 'this run was only moderately stable under the changes we tested',
  fragile: `small changes to your assumptions could change ${GOAL_FIT_PHRASE}`,
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
 * ⚠ ROADMAP 2.292 — SCOPED TO WHAT WAS TESTED. The first wording claimed "no
 * single factor on its own changed which option leads" — a UNIVERSAL over every
 * factor in the graph. ISL emits flip-threshold rows only for ELIGIBLE ROOT
 * factors carrying observed values/uncertainty (robustness_analyzer_v2.py
 * factor-eligibility selection, ISL tip f35975dc), so a non-root or unobserved
 * factor was never probed and may still move the answer. The attestation is
 * real but its scope is the PROBED SET; the copy says "the factors we could
 * test" so the claim matches the measurement. Same claim-safety rules as every
 * reason here: one short phrase, no numbers.
 *
 * ⚠ 2.292's scoping SURVIVES the 2026-09-10 voice change below, deliberately.
 * The natural phrasing for the new voice is "no single factor we tested", and
 * `S3`/`S4` in `robustness-display-verdict.flip-evidence.test.ts` RED on a bare
 * "no single factor" because that regex cannot tell the universal claim from a
 * scoped one. Two rulings, two questions (trap 21): 2.292 governs the SCOPE of
 * the attestation, the ruling below governs WHAT THE CLAIM IS ABOUT. Changing
 * the scope wording to suit the voice would silently reopen an overclaim that
 * was measured and closed.
 *
 * ⚠ VOICE (2026-09-10, Paul's ruling). Both strings named the leading option's
 * position: "changed WHICH OPTION LEADS" states the analysis as a contest with
 * a front-runner, and there is never a winner. They now name the same fact
 * against the user's goal: "changed which option is most likely to achieve your
 * goal". This is not a banned-words substitution (renaming `leads` to `ahead`
 * would keep the race) — it re-anchors the claim from option-versus-option to
 * option-versus-the-user's-goal, which is what they asked and what the model
 * can honestly speak to. The `display_verdict` WIRE ENUM is untouched.
 *
 * ⚠ These strings are rendered VERBATIM as a "·"-separated meta segment (UI
 * `postAnalysisFooter.ts`), so they stay LOWERCASE, unterminated fragments and
 * carry no em dash.
 *
 * `robust` and `not_assessed` are intentionally absent — neither original
 * carries flip language, so neither has anything to correct, and restating
 * them here would create a second copy to drift.
 */
export const ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP: Partial<
  Record<RobustnessDisplayVerdict, string>
> = {
  fragile:
    `varying any one of the factors we could test did not change ${GOAL_FIT_PHRASE}, but this run scored low on our other robustness checks`,
  moderate:
    `varying any one of the factors we could test did not change ${GOAL_FIT_PHRASE}, and this run mostly held up under the other changes we tested`,
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
