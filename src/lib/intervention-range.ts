/**
 * TEMPORAL step 2 — a per-option stated RANGE for a value the option sets (e.g. downtime days).
 *
 * Brief: olumi-programme-docs `dl/claude-27fbe09b` → `dl-claude-27fbe09b/briefs/TEMPORAL.md`.
 * ISL reader: Inference-Service-Layer #216 (R3 KEEP, #75 5911436566; AIQ PASS 5912321226).
 *
 * The caller states the range in RAW units (the same units as the option's point) and what it
 * MEANS; ISL chooses the distribution (quartiles of a lognormal for "likely_range") and echoes
 * what it sampled. PLoT's jobs: validate at the boundary, widen the node's frame so it sits above
 * the range's fitted P99 (R3 (3): never truncate), forward the affine map it used for the point,
 * and withhold any limit whose range ISL did not confirm sampling.
 *
 * ONE definition, shared by the ingress guard, the normaliser and the translator, so "what the
 * boundary accepts" and "what reaches ISL" cannot drift apart.
 */

/** The raw → [0,1] map PLoT's normaliser used for the node (computational only, never a bound). */
export interface InterventionRangeNormalisation {
  raw_at_zero: number;
  raw_at_one: number;
}

export interface InterventionRangeV3 {
  /** Stated good case, raw units (> 0). */
  low: number;
  /** Stated bad case, raw units (> low). */
  high: number;
  /** What the user's words say the range is. ISL samples only 'likely_range'; others refuse. */
  meaning: string;
  /** Set by Phase 4a: the node's affine map. Absent when Phase 4a did not run (values already in frame). */
  normalisation?: InterventionRangeNormalisation;
}

const MAX_MEANING_LENGTH = 64;

/** The stated range as a validated value, or undefined for any malformed shape (→ 422 at ingress). */
export function readInterventionRange(raw: unknown): InterventionRangeV3 | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { low, high, meaning } = raw as Record<string, unknown>;
  if (typeof low !== 'number' || typeof high !== 'number') return undefined;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return undefined;
  if (!(low > 0) || !(high > low)) return undefined;
  if (typeof meaning !== 'string' || meaning.length === 0 || meaning.length > MAX_MEANING_LENGTH) return undefined;
  return { low, high, meaning };
}

// Standard-normal quantiles. The stated bounds are the fitted QUARTILES (ISL RATIFIED_COVERAGE 0.5).
const Z75 = 0.6744897501960817;
const Z99 = 2.3263478740408408;

/**
 * The fitted lognormal's P99 in raw units. R3 5911436566 (3): the node's frame must sit strictly
 * above it, so nothing the range can plausibly produce falls off the top of the frame.
 */
export function interventionRangeP99(range: Pick<InterventionRangeV3, 'low' | 'high'>): number {
  const mu = 0.5 * (Math.log(range.low) + Math.log(range.high));
  const sigma = Math.log(range.high / range.low) / (2 * Z75);
  return Math.exp(mu + Z99 * sigma);
}
