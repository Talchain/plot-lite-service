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
 * The envelope (vendored @talchain/schemas 0.15.0, byte-identical to CEE's
 * 0.16.0 copy) is passthrough at every level with all root keys optional:
 * producer-ahead fields can never fail it; only type/enum corruption on the
 * typed keys can. So `ok: false` always means a REAL contract break, never
 * "PLoT moved ahead of the schema".
 */

import { AnalysisEnrichmentSchema } from '@talchain/schemas/boundary';
import { INFERENCE_WARNING_CODES } from '../../types/engine-v3.js';
import type { InferenceWarning } from '../../types/engine-v3.js';
import { parseBoundedIntEnv } from '../../config/env-int.js';

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
 * Production default sample rate: assess 1 in N outgoing bodies.
 *
 * The full-body `AnalysisEnrichmentSchema.safeParse` on EVERY /v2/run duplicates
 * CEE's shadow parse of the same envelope. A real contract regression is
 * DETERMINISTIC — it breaks the same field on EVERY response — so a 1-in-N
 * sample still surfaces it within N requests, while cutting the per-request
 * schema-parse cost by ~(N-1)/N. Outside production the guard runs on EVERY
 * request (staging + tests want the immediate, complete signal). Ops override:
 * `ENRICHMENT_GUARD_SAMPLE_N` (integer ≥ 1; 1 = every request).
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
 * Assess an outgoing /v2/run success body against the typed enrichment
 * envelope. Pure and non-throwing over any JSON-serialisable input; callers
 * still wrap the call site (fail-open) so a schema-library failure can never
 * take down response delivery.
 */
export function assessEnrichmentContract(body: unknown): EnrichmentContractAssessment {
  const result = AnalysisEnrichmentSchema.safeParse(body);
  if (result.success) {
    return { ok: true, issues: [], issue_count: 0 };
  }
  const all = result.error.issues;
  return {
    ok: false,
    issues: all.slice(0, ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES).map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
    })),
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
