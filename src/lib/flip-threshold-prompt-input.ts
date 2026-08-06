/**
 * Flip Threshold → decision_review PROMPT INPUT
 *
 * ROADMAP 2.676. The rows PLoT hands to CEE's `decision_review` prompt as
 * `flip_threshold_data` must be the SAME numbers the response's top-level
 * `flip_thresholds` block already publishes — because the prompt is told those
 * numbers are user units and instructs the model to quote them WITH the unit
 * appended.
 *
 * ⚠ WHAT WENT WRONG, MEASURED ON THE DEPLOYED BUILDS (evidence:
 * `PHASE0-EVIDENCE-2026-07-28/probe2676-2026-08-07/`). `run.ts` denormalised the
 * rows for the response (`16000 GBP → 12243 GBP`, correct) and then passed the
 * UN-denormalised array as `preResolvedFlipData`. The same HTTP response
 * therefore carried both the true row and the review's
 * `"0.5 GBP" → "0.382593 GBP"` — same flip point, wrong scale
 * (0.382593 × 32000 = 12243). The prompt is INNOCENT: its caller violated the
 * assumption the prompt states.
 *
 * ⚠ AND IT HAS A SECOND FACE. PLoT's own Tier-7 integrity guard
 * (`m1-review-validator.ts:validateFlipThresholds`) reads the SAME array via
 * `buildValidationContext(request)`, so it enforced IDENTITY AGAINST THE WRONG
 * NUMBER: when the model declined the fabricated pairing and wrote the honest
 * figure, `MODIFIED_VALUES` — a BLOCKING code — discarded the entire review
 * (`review_status: 'failed'`, measured on the second probe sample). Heads a
 * fabricated magnitude ships, tails the whole review dies, split by LLM
 * variance. One cause, two faces; fixing the array fixes both, because the
 * guard and the prompt read the same array.
 *
 * This module is the single place that turns denormalised rows into prompt
 * input, so the two can no longer drift.
 */

import type { FlipThresholdInputData } from '../cee/validation/m1-review-types.js';
import type { DenormalisedFlipThreshold } from './flip-threshold-denormaliser.js';

/**
 * The normalised-scale band. A current/flip value with `|v| <= 1` could be an
 * uninverted model-scale number, so an ABSENT `value_scale` is not by itself
 * enough to license quoting it as a user-unit value.
 *
 * Mirrors CEE `MODEL_SCALE_SUSPECT_ABS`
 * (`src/orchestrator-v5/context/flip-threshold-rows.ts:227`, CEE `staging`
 * `d5b64246`). The two bands must agree: a row this module admits is a row that
 * predicate would also admit on the turn path.
 */
export const MODEL_SCALE_SUSPECT_ABS = 1;

/**
 * Is this row unsafe to hand to the `decision_review` prompt as a USER-UNIT
 * value? Fail-closed in every branch that is not a positive attestation.
 *
 * ⚠ DERIVED FROM CEE'S OWN REFUSAL RULE, NOT PARAPHRASED. CEE already faces
 * exactly this question on the TURN path and answers it in
 * `flipRowScaleUnsafeForPromptUnits`
 * (`src/orchestrator-v5/context/flip-threshold-rows.ts:269`, CEE `staging`
 * `d5b64246`), whose verdict it applies as
 * `pairs.filter((r) => !flipRowScaleUnsafeForPromptUnits(r))`
 * (`src/orchestrator-v5/coaching/decision-review-enricher.ts:1504`). The three
 * branches below are that function's three branches, in its order:
 *
 *  1. A non-empty `value_scale` token that is not `display` — `'normalised'`,
 *     or anything unrecognised — is a POSITIVE attestation that the numbers are
 *     NOT user-scale. Refused.
 *  2. An ABSENT `value_scale` on a UNITLESS row is ADMITTED. That is the
 *     prompt's documented probability-like case, which is gated on the unit
 *     being absent (`Prompts/canonical/decision_review.txt:416`). A normalised
 *     number with NO unit is honest — `"0.29"` for an uncapped rate IS the
 *     value. It is the number WEARING A UNIT that fabricates.
 *  3. An ABSENT `value_scale` on a UNIT-BEARING row is refused unless BOTH
 *     values sit outside the band. EITHER value in band is enough to refuse,
 *     because a pair is quoted as two numbers and one uninverted value is one
 *     wrong number on the screen.
 *
 * ⚠ ONE DELIBERATE NARROWING, DISCLOSED. CEE's `readRowValueScale` falls back
 * to `margin_sensitivity.value_scale` when the row carries no top-level token.
 * This module reads the ROW's own token only. `denormaliseMarginSensitivity`
 * stamps the margin `'display'` whenever ANY range was available, including a
 * `normalisationContext` range whose source is not `explicit_cap` — a source
 * the row-level stamp deliberately refuses. Honouring that fallback here would
 * let a non-`explicit_cap` range license a pair the denormaliser itself
 * declined to call user-scale. Reading the row only is therefore STRICTLY
 * FAIL-CLOSED relative to CEE: every row this refuses, CEE might admit; every
 * row this admits, CEE admits too.
 *
 * ⚠ WHY REFUSED ROWS ARE DROPPED RATHER THAN STRIPPED OF THEIR UNIT. Stripping
 * looks tempting — a unitless in-band row is admitted by branch 2, so removing
 * the unit would "rescue" the row. It would also hand the prompt's
 * probability-like case a value that is not a probability: a `months` or
 * `engineers` factor normalised to 0.4 would be rendered `"40%"`, which is a
 * DIFFERENT fabrication, not a fix. PLoT cannot invert what it has no cap for,
 * so it fails closed exactly where CEE does. Dropping costs one card; the
 * alternative puts a number on the screen that nothing computed.
 */
export function flipRowUnsafeForPromptUnits(row: DenormalisedFlipThreshold): boolean {
  const scale = typeof row.value_scale === 'string' ? row.value_scale.trim().toLowerCase() : '';
  if (scale.length > 0) return scale !== 'display';

  // Absent scale. Unitless rows are the prompt's percentage case — admitted.
  const unit = typeof row.unit === 'string' ? row.unit.trim() : '';
  if (unit.length === 0) return false;

  // Not a pair: there is no second number to misquote, so there is nothing for
  // the band test to judge. Matches CEE's own null-guard.
  if (row.flip_value === null || row.flip_value === undefined) return false;

  const bothOutOfBand =
    Math.abs(row.current_value) > MODEL_SCALE_SUSPECT_ABS &&
    Math.abs(row.flip_value) > MODEL_SCALE_SUSPECT_ABS;
  return !bothOutOfBand;
}

/**
 * Project ONE denormalised row down to the `flip_threshold_data` wire shape.
 *
 * ⚠ THE KEY SET IS DELIBERATELY UNCHANGED FROM WHAT THIS PATH ALREADY SENT.
 * `DenormalisedFlipThreshold` is a superset of {@link FlipThresholdInputData}:
 * it additionally carries `alternative_winner_label`, `value_scale`,
 * `current_display` and `flip_display`. Forwarding those would not be rejected
 * — CEE's route derives its row schema from `EnrichmentFlipThresholdSchema`,
 * which is `.passthrough()` (`@talchain/schemas` 0.38.0,
 * `dist/boundary/enrichment.js:568`) — but it would be an unmeasured change to
 * what the prompt sees, bundled into a fix for a fabricated number. This lane
 * changes the VALUES, not the fields.
 *
 * Optional keys are carried by PRESENCE, never as explicit `undefined`: the
 * same rule the denormaliser follows for `direction`/`no_flip_in_range`, so a
 * key that was absent upstream stays absent to `in`-checks and key manifests.
 */
function toPromptRow(row: DenormalisedFlipThreshold): FlipThresholdInputData {
  return {
    factor_id: row.factor_id,
    factor_label: row.factor_label,
    // The denormalised pair — the whole point of this module.
    current_value: row.current_value,
    flip_value: row.flip_value,
    ...(row.direction !== undefined ? { direction: row.direction } : {}),
    ...(row.flip_reason !== undefined ? { flip_reason: row.flip_reason } : {}),
    ...(row.iterations_used !== undefined ? { iterations_used: row.iterations_used } : {}),
    ...(row.probes_used !== undefined ? { probes_used: row.probes_used } : {}),
    ...(row.alternative_winner_id !== undefined
      ? { alternative_winner_id: row.alternative_winner_id }
      : {}),
    ...(row.unit !== undefined ? { unit: row.unit } : {}),
    ...(row.no_flip_in_range === true ? { no_flip_in_range: true as const } : {}),
    ...(row.margin_sensitivity !== undefined
      ? { margin_sensitivity: row.margin_sensitivity }
      : {}),
  };
}

/**
 * Build the `preResolvedFlipData` array the decision-review orchestrator sends
 * to CEE — and, by the same object, the array Tier-7 validates the returned
 * review against (`buildValidationContext(request)` reads
 * `request.flip_threshold_data`, which the orchestrator assigns from this
 * value at `decision-review-orchestrator.ts:153`).
 *
 * @param rows The DENORMALISED rows — i.e. the exact array the response's
 *   top-level `flip_thresholds` block ships. Passing the pre-denormalisation
 *   rows here is the defect this module exists to prevent.
 * @returns Prompt-safe rows, in input order, with the unsafe ones removed.
 */
export function toPromptFlipThresholdData(
  rows: DenormalisedFlipThreshold[]
): FlipThresholdInputData[] {
  return rows.filter((row) => !flipRowUnsafeForPromptUnits(row)).map(toPromptRow);
}
