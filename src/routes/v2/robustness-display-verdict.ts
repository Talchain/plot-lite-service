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
 * Honesty invariants:
 *  - NEVER a determinate-looking verdict ('robust'/'moderate'/'fragile') when
 *    robustness was not actually computed.
 *  - `confidence` is NEVER an input — the function signature does not accept
 *    it, so confidence alone can never upgrade (or create) a verdict.
 *  - The reason phrases are producer-owned, claim-safe, and carry no numbers.
 */

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
): { display_verdict: RobustnessDisplayVerdict; display_verdict_reason: string } {
  const display_verdict = deriveVerdict(facts, robustnessComputed);
  return {
    display_verdict,
    display_verdict_reason: ROBUSTNESS_DISPLAY_VERDICT_REASONS[display_verdict],
  };
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
