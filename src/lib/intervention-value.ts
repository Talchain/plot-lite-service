/**
 * Intervention value reader — the SINGLE definition of "what /v2/run accepts as
 * an intervention value", shared by the request-boundary guard and the request
 * normaliser so the two can never disagree about which entries are valid.
 *
 * WHY THIS EXISTS (ROADMAP 1.278)
 * ------------------------------------------------------------------------
 * `/v2/run` accepts TWO intervention wire shapes:
 *
 *     simple   { "factor_price": 10 }
 *     rich     { "factor_price": { "value": 10, "source": "user_specified" } }
 *
 * The Ajv body schema types `interventions` as `{ type: 'object' }` — the
 * container only, the VALUES entirely unvalidated — so every shape decision was
 * made by hand, in two places, with two different answers:
 *
 *   - `normalizeInterventions` (routes/v2/run.ts) DROPPED any entry that was
 *     neither a number nor an object carrying a `value` key, under the comment
 *     "Skip invalid entries (will be caught by validation)".
 *   - preflight's `INVALID_INTERVENTION_VALUE` check then validated the
 *     ALREADY-NORMALISED options — i.e. the view the drop had already edited.
 *
 * So the comment was false for exactly the entries the drop removed: preflight
 * could not catch them because preflight could no longer see them. `{"f": null,
 * "g": 60}` lost `f` silently and passed preflight with a one-intervention
 * option the caller never asked for. (Measured; see the ingress guard in
 * routes/v2/run.ts and tests/intervention-ingress-shape-guard.test.ts.)
 *
 * A hand-maintained mirror WILL drift, and the drift reads as green. This module
 * is the derive-don't-mirror fix: one predicate, two consumers.
 */

/**
 * Read the numeric value out of either accepted intervention wire shape.
 *
 * ABSENCE IN ⇒ ABSENCE OUT. The parameter is `unknown` on purpose — this reads
 * UNVALIDATED request data, so a `number` parameter here would be the same
 * compile-time fiction that ROADMAP 1.277 removed from `denormaliseValue`.
 *
 * A rich object may carry additional keys (`source`, `raw_value`, `uncertainty`,
 * …); only `value` is read, and unknown keys are preserved by the caller.
 *
 * @param raw One entry of an `options[].interventions` map, exactly as received
 * @returns The finite intervention value, or `undefined` when the entry carries
 *          none (null / missing / non-numeric / NaN / ±Infinity / a rich object
 *          with no finite `value`)
 */
export function readInterventionValue(raw: unknown): number | undefined {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw) {
    const value = (raw as { value: unknown }).value;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  }
  return undefined;
}
