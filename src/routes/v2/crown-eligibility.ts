/**
 * CROWN ELIGIBILITY — may an option be badged as leading, given the user's
 * stated limits? (Step 5 of the hard-constraint chain.)
 *
 * WHY THIS EXISTS. `deriveRecommendedOption` was pure `argmax(win_probability)`
 * with zero constraint input, so a £90,000 option against a stated £50,000 cap
 * was badged "Leading option" while the SAME payload reported
 * `constraint_probabilities: {c_cap: 0}`, `probability_of_joint_goal: 0` and an
 * exact `failure_margin_median` of 40000. The run contradicted its own badge.
 *
 * ⚠ TWO QUESTIONS, TWO PREDICATES (trap 21). `isCrownableCandidate` answers
 * *"did ISL compute a usable result for this option?"* — an ISL-status
 * question, deliberately SHARED with `computeNearTie` so the two cannot drift.
 * This module answers a different question: *"is this option PERMITTED to be
 * badged as leading, given the user's stated limits?"* The UI contract already
 * settles which kind of question that is — *"whether a lever may be CROWNED is
 * a permission question, not a producer one"* (`contracts/isl-to-ui.contract.ts`).
 * The two are NOT merged: near-tie keeps consuming the status predicate alone,
 * because constraint compliance has nothing to say about whether two
 * win-probabilities are close.
 *
 * ⚠⚠ NO INVENTED THRESHOLD, AND THIS IS THE LOAD-BEARING CONSTRAINT ON THE
 * DESIGN. Derived at ISL staging `28fe0c95` with controlled absence:
 *
 *   · `prob_satisfied` is a plain Monte Carlo FRACTION over all draws
 *     (`satisfied_count / n_samples`, robustness_analyzer_v2.py:8071), with
 *     `>=` / `<=` inclusive at the boundary. Those are the only two operators
 *     the wire admits.
 *   · **ISL exposes NO satisfied/breached threshold anywhere.** The sole
 *     numeric band applied to `prob_satisfied` in the whole estate is
 *     `binding = 0.4 <= prob_satisfied <= 0.6` — a *borderline* flag, not a
 *     verdict. Any binarisation is therefore a CONSUMER policy ISL has
 *     deliberately declined to make.
 *
 * So this module binarises at EXACTLY ONE point, and that point is not a chosen
 * cut: **`prob_satisfied === 0` means no sampled draw satisfied the
 * constraint.** That is the boundary of the producer's own range, and it is a
 * statement of fact rather than a policy. Everything strictly between 0 and 1
 * is reported as UNCERTAIN and never as a breach — inventing a cut there is
 * precisely the fabrication class this chain exists to remove.
 *
 * ⚠ `binding` IS NOT A BREACH FLAG AND MUST NEVER BE READ AS ONE. It is
 * non-monotonic in satisfaction: `prob_satisfied: 0.0` (always violated) gives
 * `binding: false`, while `0.5` (a coin flip) gives `binding: true`. A consumer
 * mapping `binding → breached` inverts the signal at BOTH extremes. This module
 * does not consult it.
 *
 * ⚠ ABSENCE IS NOT ZERO. ISL omits the ENTIRE `constraint_analysis` block when
 * any constraint is unresolvable (robustness_analyzer_v2.py:8243-8248) and the
 * wire drops `None` via `exclude_none=True`. A missing probability therefore
 * means "not established", never "zero satisfaction", and is classified
 * `not_assessed` — never a breach.
 *
 * TRUST GATE. A breach claim is only made when the option's scale is
 * trustworthy: `constraints_decision_grade === true`. After the clamp-erasure
 * fix, `decision_grade` can never read `true` over a CLAMPED threshold, so this
 * cannot certify compliance against a limit the service pinned to a range
 * endpoint. Where the scale is not trustworthy the verdict is `unverified` and
 * the crown is left alone — unknown remains unknown, in BOTH directions: an
 * untrusted scale licenses neither a compliance claim nor a breach claim.
 *
 * NOT AN EMPTY DEAD END. When no option is eligible the crown is withheld AND
 * `no_eligible_option` is emitted with a claim-safe reason, so the product can
 * say something the user can act on. Silence here would breach the ratified
 * eligibility doctrine's third clause — *"if compliance cannot be evaluated,
 * say so and name what is missing"* (quoted at `routes/v2/run.ts`).
 *
 * SHAPE follows the house producer-verdict pattern already ratified for
 * `robustness.display_verdict` (`robustness-display-verdict.ts`): a strictly
 * ordered ladder, an explicit negative that is never softened, claim-safe
 * reason phrases carrying no numbers, and a fail-closed default.
 */

/** Facts a single option carries at the crown. All optional — absence is honest. */
export interface CrownCandidateFacts {
  option_id: string;
  /** Per-constraint P(satisfied), keyed by constraint_id. Absent ⇒ not established. */
  constraint_probabilities?: Record<string, number>;
  /** AND over participating constraints' decision_grade. Absent ⇒ not trustworthy. */
  constraints_decision_grade?: boolean;
}

/**
 * The compliance verdict attached to the crown. Additive /v2/run wire enum.
 *
 *  - `not_applicable`     no constraints were stated on this run
 *  - `compliant`          every participating constraint satisfied in every draw
 *  - `uncertain`          satisfaction is partial — reported, never binarised
 *  - `unverified`         the scale is not decision-grade; no claim either way
 *  - `not_assessed`       constraints were stated but carry no evaluated probability
 *  - `no_eligible_option` every option breaches; the crown is withheld
 */
export type CrownCompliance =
  | 'not_applicable'
  | 'compliant'
  | 'uncertain'
  | 'unverified'
  | 'not_assessed'
  | 'no_eligible_option';

/**
 * Producer-owned reason per verdict. Claim-safe: one short phrase, no numbers,
 * nothing a consumer could re-derive a statistic from. Single source of truth —
 * the route emits these verbatim.
 */
export const CROWN_COMPLIANCE_REASONS: Record<CrownCompliance, string> = {
  not_applicable: 'no limits were set for this decision',
  compliant: 'this option met every limit you set, in all the scenarios we tested',
  uncertain: 'this option met your limits in some scenarios but not others',
  unverified: 'we could not check this option against your limits on a reliable scale',
  not_assessed: 'your limits were not evaluated on this run',
  no_eligible_option: 'no option met the limits you set, so none is being recommended',
};

/**
 * Is this option PERMITTED to be badged as leading?
 *
 * Ineligible on exactly one condition, both halves required:
 *   1. the scale is trustworthy (`constraints_decision_grade === true`), AND
 *   2. some participating constraint has `prob_satisfied === 0` — not satisfied
 *      in any sampled draw.
 *
 * Everything else is eligible. Note the direction of the default: an option we
 * cannot assess stays ELIGIBLE (and is disclosed as unverified/not_assessed)
 * rather than being silently removed from consideration. Suppressing on a
 * doubt would make an unevaluable run indistinguishable from a run where every
 * option genuinely failed, and would hand the user an empty screen with nothing
 * to act on.
 */
export function isCrownPermittedByConstraints(facts: CrownCandidateFacts): boolean {
  if (facts.constraints_decision_grade !== true) return true;
  const probs = facts.constraint_probabilities;
  if (probs === undefined) return true;
  // `=== 0` and nothing else. A NEGATIVE or non-finite value is upstream
  // garbage that the egress guards already reject before this point; treating
  // it as a breach here would be a second, divergent opinion about the same
  // wire. Guarding by SPEC (a probability lies within [0,1]) rather than by the
  // failure mode in hand.
  for (const p of Object.values(probs)) {
    if (typeof p === 'number' && Number.isFinite(p) && p === 0) return false;
  }
  return true;
}

/**
 * Classify the crowned option's compliance. Strictly ordered — the first
 * matching rung wins — and fail-closed at the end.
 *
 * @param facts             the crowned option's facts, or `undefined` when no
 *                          option was crowned
 * @param constraintsStated whether the run carried any goal constraint at all;
 *                          this is what separates "no limits were set" from
 *                          "limits were set and not evaluated", which are
 *                          byte-identical at the option level
 * @param anyCandidate      whether at least one option was a crownable
 *                          candidate on ISL status grounds — distinguishes
 *                          "every option breached" from "ISL computed nothing"
 */
export function classifyCrownCompliance(
  facts: CrownCandidateFacts | undefined,
  constraintsStated: boolean,
  anyCandidate: boolean,
): CrownCompliance {
  // 1. No limits were set ⇒ nothing to say, and the common case must not regress.
  if (!constraintsStated) return 'not_applicable';

  // 2. No crown, but candidates existed ⇒ constraints removed every one of them.
  if (facts === undefined) {
    return anyCandidate ? 'no_eligible_option' : 'not_assessed';
  }

  // 3. Untrustworthy scale ⇒ no claim in EITHER direction (unknown stays unknown).
  //    Ordered ABOVE the probability rungs deliberately: a probability computed
  //    against a scale we do not trust is not evidence of compliance, however
  //    clean it looks.
  if (facts.constraints_decision_grade !== true) return 'unverified';

  // 4. Limits stated but nothing evaluated ⇒ absence, never zero.
  const probs = facts.constraint_probabilities;
  if (probs === undefined) return 'not_assessed';
  const values = Object.values(probs).filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p),
  );
  if (values.length === 0) return 'not_assessed';

  // 5. Satisfied in every draw, on a trusted scale.
  if (values.every((p) => p === 1)) return 'compliant';

  // 6. Anything else is partial. NOT binarised — ISL publishes no threshold and
  //    this module refuses to mint one.
  return 'uncertain';
}
