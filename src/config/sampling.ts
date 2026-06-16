/**
 * Track S — Standard Monte Carlo sample depth (base analysis).
 *
 * PR-E raises the standard base-analysis depth from 1,000 to 4,000. Seed-sweep
 * evidence (live ISL, 12 seeds × 4 fixtures) showed 1,000 is unstable/fragile on
 * harder fixtures while 4,000 is the first depth where all fixtures meet the
 * provisional ±3pp displayed-probability stability target; 8,000 gives only
 * diminishing returns. The seed-sweep evidence is summarised in the PR
 * description and reproducible via tools/seed-sweep.mjs.
 *
 * Rollback: set the `STANDARD_N_SAMPLES` env var (e.g. `1000`) to override the
 * default without a code change. This is the emergency knob if latency or
 * operational issues appear after the raise.
 *
 * Flip-threshold probes intentionally do NOT inherit this depth — they have an
 * independent control (see resolveFlipProbeNSamples / FLIP_PROBE_N_SAMPLES in
 * src/analysis/flip-thresholds.ts). Raising the base must not slow flip probes.
 */

import { resolveBoundedIntEnvOrWarn, MIN_N_SAMPLES, MAX_N_SAMPLES } from './env-int.js';

/**
 * Compile-time standard base-analysis sample depth. Fixed (not env-derived) so
 * it can anchor deterministic, environment-independent fallbacks (e.g. the
 * canonical-hash default). The live request path uses resolveStandardNSamples().
 */
export const STANDARD_N_SAMPLES_DEFAULT = 4000;

/**
 * Resolve the standard base-analysis sample depth for a request whose
 * `n_samples` was omitted.
 *
 * Precedence:
 *  1. `STANDARD_N_SAMPLES` env — strictly parsed, in-bounds (100..10000)
 *     emergency rollback / override; malformed (`1,000`, `1000abc`) or
 *     out-of-bounds values are ignored (with a one-time warning) so they cannot
 *     bypass the /v2/run schema bound or forward a garbage depth to ISL;
 *  2. otherwise `STANDARD_N_SAMPLES_DEFAULT` (4,000).
 *
 * Read at call time so the override takes effect without a rebuild and is
 * trivially testable. An explicit `n_samples` in the request always wins over
 * this default (the route applies `body.n_samples ?? resolveStandardNSamples()`).
 */
export function resolveStandardNSamples(): number {
  return resolveBoundedIntEnvOrWarn('STANDARD_N_SAMPLES', MIN_N_SAMPLES, MAX_N_SAMPLES) ?? STANDARD_N_SAMPLES_DEFAULT;
}
