/**
 * Enrichment contract egress guard (A3 lane 1 — producer-side adoption of
 * the typed PLoT→CEE enrichment envelope, ROLLOUT.md step 3 in
 * olumi-schemas docs/enrichment-v1).
 *
 * The /v2/run success body IS the enrichment payload CEE persists verbatim
 * (`RunAnalysisHandlerFact.result.enrichment`, CEE run-analysis.ts:808) and
 * shadow-validates against `AnalysisEnrichmentSchema` — but until this lane
 * the PRODUCER asserted nothing: a PLoT change that broke the typed envelope
 * would surface only in CEE's (default-off) shadow telemetry, far from the
 * code that caused it. This module validates the outgoing body against the
 * SAME vendored schema at the egress boundary.
 *
 * FAIL-OPEN by design: validation never blocks or mutates delivery — the
 * envelope is enrichment, and absence/degradation of enrichment is
 * degraded-but-usable (fail-closed stays reserved for the analysis core).
 * A mismatch is surfaced three ways, mirroring the wire-generation
 * assertion (lane 29, src/integrations/isl/wire-generation.ts):
 *   - `_meta.evidence.enrichment_contract_ok: false`
 *   - one ENRICHMENT_CONTRACT_MISMATCH inference warning (issue paths only)
 *   - one `enrichment_contract_mismatch` structured log event
 *
 * PII discipline: zod issues are reduced to {path, code} — issue MESSAGES
 * are never carried (zod embeds received values in enum/literal messages)
 * and payload values are never logged. This matches CEE's shadow validator
 * (`v5.enrichment.schema_mismatch` — {path, code} only).
 *
 * The envelope (vendored @talchain/schemas, byte-identical to the tarball CEE and
 * DGAI vendor; see vendor/README.md for the five-way derivation) is passthrough
 * at every level with all root keys optional:
 * producer-ahead fields can never fail it; only type/enum corruption on the
 * typed keys can. So `ok: false` always means a REAL contract break, never
 * "PLoT moved ahead of the schema".
 *
 * ⚠ THE PINNED VERSION IS DELIBERATELY NOT RESTATED IN THIS COMMENT. It used to
 * be ("0.30.0 at this tip"), and it was still saying so while the repo was on
 * 0.31.0 — a hand-maintained mirror of a number that went stale exactly as trap
 * 12 predicts. `package.json` is the pin. The two version facts BELOW are
 * historical (what 0.22.0 lacked, what 0.30.0 added) and stay true as it moves.
 *
 * ⚠ THE COROLLARY IS THE TRAP (ROADMAP 2.160). `.passthrough()` means a key the
 * envelope does not TYPE is not validated at all — it is waved through, and this
 * guard still stamps `enrichment_contract_ok: true`. That is not a hypothetical:
 * up to 0.22.0 the envelope typed NONE of the four VOI keys
 * (`correlation_model`, `decision_evpi`, `factor_evppi`, `p_win_sensitivity`)
 * that `islEnrichmentPassthrough` forwards as top-level keys, so
 * `decision_evpi: 'NOT-A-NUMBER'` parsed clean and this guard's own disclosure
 * field asserted a validation that had never happened for them. 0.30.0 types all
 * four. `tests/contract/voi-enrichment-typed.test.ts` now DERIVES the check —
 * every key in `ISL_TOPLEVEL_ENRICHMENT_KEYS` must be a typed property of
 * `AnalysisEnrichmentSchema.shape` — so adding a fifth forwarded key that the
 * contract does not type fails LOUD instead of silently re-opening the hole.
 */

import { AnalysisEnrichmentSchema } from '@talchain/schemas/boundary';
import { INFERENCE_WARNING_CODES } from '../../types/engine-v3.js';
import type { InferenceWarning } from '../../types/engine-v3.js';
import { parseBoundedIntEnv } from '../../config/env-int.js';
import { finiteNum, isNonNegInt } from '../../util/numeric.js';

/**
 * Cap on reported issues (wire message + log event). A pathological body
 * could produce thousands of issues; the first few paths identify the
 * defect and `issue_count` carries the true total.
 */
export const ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES = 10;

// ----------------------------------------------------------------------------
// Sampling (A3 remediation item 8, efficiency)
// ----------------------------------------------------------------------------

/**
 * Production sample rate for the SCHEMA-PARSE arm only: parse 1 in N bodies.
 *
 * SCOPE MATTERS HERE - read `assessEnrichmentContract` before changing this.
 * The guard has two arms with different detection semantics, and only one of
 * them may be sampled:
 *
 *   SCHEMA-PARSE arm (sampled, this constant). The full-body
 *   `AnalysisEnrichmentSchema.safeParse` duplicates CEE's shadow parse. Its
 *   faults ARE deterministic: a type or enum corruption on a typed key is a
 *   property of the CODE, so it breaks every response and a 1-in-N sample
 *   surfaces it within N requests while cutting ~(N-1)/N of the cost.
 *
 *   STABILITY-BAND arm (NEVER sampled, see assessStabilityBands). It validates
 *   PER-RESPONSE ISL PAYLOAD DATA - ordered finite endpoints, non-negative
 *   width, counts consistent with the per-seed list. A malformed band arrives
 *   in the data for ONE request. It is not a property of the code and it does
 *   not repeat, so sampling does not delay detection, it DESTROYS it: at
 *   N=16 roughly 15 of every 16 malformed bands shipped to CEE stamped
 *   `enrichment_contract_ok: true`.
 *
 * That distinction was missed originally because the arms landed in the wrong
 * order. The sampling rationale was written in b9f825a (#230) and said, of the
 * guard as it then was, "a real contract regression is DETERMINISTIC". True at
 * the time. The data-dependent band arm was added later the same day in
 * 9700d8b (#232) and inherited a sampling policy that had been justified
 * against a check it is not. (`git merge-base --is-ancestor b9f825a 9700d8b`
 * confirms the ordering.)
 *
 * The split is cheap because the arm that must NOT be sampled is the cheap one.
 * Measured at this tip, 2000 iterations on a realistic body:
 *
 *   edge_e_values   band arm     schema arm   band share of total
 *   10              0.0015 ms    0.2100 ms    0.7%
 *   50              0.0065 ms    0.8652 ms    0.7%
 *   200             0.0250 ms    3.1816 ms    0.8%
 *
 * So running the band sweep on every response costs microseconds, while the
 * schema parse - the part actually worth sampling - keeps its saving. An
 * earlier always-on figure of 0.047 ms mean (#225) does NOT reproduce here:
 * the full guard measures 0.21-3.21 ms and scales with edge_e_values length.
 * That figure was most likely taken on a minimal body, which is why the numbers
 * above were re-measured rather than assumed.
 *
 * Outside production BOTH arms run on every request (staging + tests want the
 * immediate, complete signal). Ops override: `ENRICHMENT_GUARD_SAMPLE_N`
 * (integer >= 1; 1 = every request). Note the override governs the SCHEMA arm
 * only - no value of it can switch the band sweep off.
 */
export const DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD = 16;

/** Round-robin request counter for the 1-in-N sampler (per process). */
let enrichmentGuardCounter = 0;

/** Test-only: reset the sampler so 1-in-N sequences are deterministic per test. */
export function __resetEnrichmentGuardSampler(): void {
  enrichmentGuardCounter = 0;
}

/**
 * Resolve the sample denominator. `ENRICHMENT_GUARD_SAMPLE_N` (strict, ≥1)
 * overrides; otherwise every request outside production, 1-in-N in production.
 */
export function resolveEnrichmentGuardSampleN(): number {
  const parsed = parseBoundedIntEnv(process.env.ENRICHMENT_GUARD_SAMPLE_N, 1, 1_000_000);
  if (parsed !== null) return parsed;
  return process.env.NODE_ENV === 'production' ? DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD : 1;
}

/**
 * True when THIS request should run the egress guard. Deterministic round-robin
 * (assess request 1, N+1, 2N+1, …) so a deterministic envelope break surfaces
 * within N. `N <= 1` ⇒ always true (every request).
 */
export function shouldAssessEnrichmentContract(): boolean {
  const n = resolveEnrichmentGuardSampleN();
  if (n <= 1) return true;
  const shouldAssess = enrichmentGuardCounter % n === 0;
  enrichmentGuardCounter = (enrichmentGuardCounter + 1) % n;
  return shouldAssess;
}

/** One schema violation, reduced to non-sensitive coordinates. */
export interface EnrichmentContractIssue {
  /** Dot-joined zod issue path, e.g. 'edge_e_values.3.flip_direction' */
  path: string;
  /** Zod issue code, e.g. 'invalid_type' | 'invalid_enum_value' */
  code: string;
}

/** Result of assessing one outgoing /v2/run body against the envelope. */
export interface EnrichmentContractAssessment {
  /** True when `AnalysisEnrichmentSchema.safeParse(body).success` */
  ok: boolean;
  /** First ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES issues (empty when ok) */
  issues: EnrichmentContractIssue[];
  /** TOTAL issue count (may exceed issues.length) */
  issue_count: number;
}

/**
 * F12 (Codex deep review, A3 r2) — PLoT-LOCAL refined validation of the nested
 * `edge_e_values[].stability` band.
 *
 * The shared `EnrichmentEdgeEValueSchema` is `.passthrough()` and does NOT type
 * the `stability` object, so the schema parse alone cannot see a malformed band.
 * This is the FAIL-LOUD local interim (the canonical shared stability schema is
 * a separate A1 schemas-PR): a band that violates any invariant below is
 * reported as a contract issue so the response is NOT stamped valid.
 *
 * Invariants (per Codex F12 + ISLFlipStabilityBandV2 semantics):
 * - finite ORDERED endpoints: band_min ≤ band_median ≤ band_max (each finite);
 * - non-negative INTEGER counts: n_seeds ≥ 0, 0 ≤ n_seeds_flipped ≤ n_seeds;
 * - count/list consistency: seed_flip_means length === n_seeds; each cell is a
 *   finite number or null;
 * - non-negative band_width (finite).
 *
 * Absent band (nothing to sweep) is valid — returns no issues. Codes are
 * zod-flavoured strings ({path, code} only, no values — same PII discipline as
 * the schema path).
 */
export function assessStabilityBands(body: unknown): EnrichmentContractIssue[] {
  const issues: EnrichmentContractIssue[] = [];
  if (!body || typeof body !== 'object') return issues;
  const edges = (body as { edge_e_values?: unknown }).edge_e_values;
  if (!Array.isArray(edges)) return issues;

  edges.forEach((edge, i) => {
    if (!edge || typeof edge !== 'object') return;
    const stability = (edge as { stability?: unknown }).stability;
    if (stability === undefined) return; // absent band — nothing to validate.
    const base = `edge_e_values.${i}.stability`;
    if (typeof stability !== 'object' || stability === null || Array.isArray(stability)) {
      issues.push({ path: base, code: 'invalid_type' });
      return;
    }
    const s = stability as Record<string, unknown>;

    // Counts.
    const nSeeds = s.n_seeds;
    const nFlipped = s.n_seeds_flipped;
    if (!isNonNegInt(nSeeds)) issues.push({ path: `${base}.n_seeds`, code: 'invalid_type' });
    if (!isNonNegInt(nFlipped)) issues.push({ path: `${base}.n_seeds_flipped`, code: 'invalid_type' });
    if (isNonNegInt(nSeeds) && isNonNegInt(nFlipped) && nFlipped > nSeeds) {
      issues.push({ path: `${base}.n_seeds_flipped`, code: 'too_big' });
    }

    // Per-seed list: length matches n_seeds; each cell finite-or-null.
    const means = s.seed_flip_means;
    if (means !== undefined) {
      if (!Array.isArray(means)) {
        issues.push({ path: `${base}.seed_flip_means`, code: 'invalid_type' });
      } else {
        if (isNonNegInt(nSeeds) && means.length !== nSeeds) {
          issues.push({ path: `${base}.seed_flip_means`, code: 'custom' }); // count/list mismatch
        }
        means.forEach((m, j) => {
          if (m !== null && !(typeof m === 'number' && Number.isFinite(m))) {
            issues.push({ path: `${base}.seed_flip_means.${j}`, code: 'invalid_type' });
          }
        });
      }
    }

    // Endpoints + width: each finite when present.
    for (const k of ['band_min', 'band_median', 'band_max', 'band_width'] as const) {
      const v = s[k];
      if (v !== undefined && finiteNum(v) === undefined) {
        issues.push({ path: `${base}.${k}`, code: 'invalid_type' });
      }
    }
    // Ordered endpoints (only when both sides are finite).
    const bMin = finiteNum(s.band_min);
    const bMed = finiteNum(s.band_median);
    const bMax = finiteNum(s.band_max);
    if (bMin !== undefined && bMed !== undefined && bMin > bMed) issues.push({ path: `${base}.band_median`, code: 'too_small' });
    if (bMed !== undefined && bMax !== undefined && bMed > bMax) issues.push({ path: `${base}.band_max`, code: 'too_small' });
    if (bMin !== undefined && bMax !== undefined && bMin > bMax) issues.push({ path: `${base}.band_max`, code: 'too_small' }); // reversed band
    // Non-negative width.
    const bW = finiteNum(s.band_width);
    if (bW !== undefined && bW < 0) issues.push({ path: `${base}.band_width`, code: 'too_small' });
  });

  return issues;
}

/**
 * Assess an outgoing /v2/run success body against the typed enrichment
 * envelope PLUS the PLoT-local refined stability-band parse (F12). Pure and
 * non-throwing over any JSON-serialisable input; callers still wrap the call
 * site (fail-open) so a schema-library failure can never take down response
 * delivery.
 */
export function assessEnrichmentContract(
  body: unknown,
  opts: { runSchemaParse?: boolean } = {},
): EnrichmentContractAssessment {
  // The schema parse is the SAMPLED arm; the caller passes the sampler's
  // verdict. Defaults to true so every existing caller keeps running both arms.
  const runSchemaParse = opts.runSchemaParse ?? true;

  const schemaIssues: EnrichmentContractIssue[] = [];
  if (runSchemaParse) {
    const result = AnalysisEnrichmentSchema.safeParse(body);
    if (!result.success) {
      for (const issue of result.error.issues) {
        schemaIssues.push({ path: issue.path.join('.'), code: issue.code });
      }
    }
  }
  // F12: the passthrough envelope cannot see the nested stability band — add the
  // PLoT-local refinement so a malformed band is never stamped valid.
  //
  // UNCONDITIONAL, and it must stay that way: this arm validates per-response
  // ISL data, so a skipped response is a fault that ships undetected rather
  // than one caught a few requests later. See the sampling note above.
  const stabilityIssues = assessStabilityBands(body);
  const all = [...schemaIssues, ...stabilityIssues];
  if (all.length === 0) {
    return { ok: true, issues: [], issue_count: 0 };
  }
  return {
    ok: false,
    issues: all.slice(0, ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES),
    issue_count: all.length,
  };
}

/**
 * Build the on-wire disclosure warning for a failed assessment. The entry
 * `{code, message, severity}` conforms to the envelope's inference_warnings
 * element schema by construction, so appending it cannot itself create a
 * contract violation. Paths only — never values.
 */
export function buildEnrichmentContractWarning(
  assessment: EnrichmentContractAssessment,
): InferenceWarning {
  const paths = assessment.issues.map((i) => `${i.path} (${i.code})`).join(', ');
  const suffix =
    assessment.issue_count > assessment.issues.length
      ? ` and ${assessment.issue_count - assessment.issues.length} more`
      : '';
  return {
    code: INFERENCE_WARNING_CODES.ENRICHMENT_CONTRACT_MISMATCH,
    // provisional_doctrine_v0 — wording surface (diagnostic disclosure)
    message:
      'This response failed producer-side validation against the typed enrichment ' +
      `envelope (@talchain/schemas AnalysisEnrichmentSchema) at: ${paths}${suffix}. ` +
      'Delivery is unaffected (fail-open); downstream consumers of the named fields ' +
      'should treat them as untrusted for this response.',
    severity: 'warning',
  };
}

/**
 * Emit the structured log event — exactly ONE per mismatched response, none
 * when the body verified. {path, code} coordinates only; no payload values,
 * no zod messages.
 */
export function logEnrichmentContractMismatch(
  logger: { warn: (obj: object, msg?: string) => void },
  assessment: EnrichmentContractAssessment,
  requestId: string,
): void {
  if (assessment.ok) return;
  logger.warn({
    event: 'enrichment_contract_mismatch',
    request_id: requestId,
    issue_count: assessment.issue_count,
    issues: assessment.issues,
  });
}
