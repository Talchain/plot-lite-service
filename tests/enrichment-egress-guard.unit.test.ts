/**
 * Enrichment egress guard — pure-function unit tests (A3 lane 1).
 *
 * Pins the assessment/disclosure building blocks in isolation:
 *   - assessEnrichmentContract: ok on conformant bodies (incl. {} — all root
 *     keys optional BY DESIGN), not-ok with {path, code} coordinates on
 *     corruption, issue cap honoured, corrupted VALUES never leak into the
 *     assessment (PII discipline — positive control: the value IS absent
 *     while its path IS present);
 *   - buildEnrichmentContractWarning: conforms to the envelope's own
 *     inference_warnings element schema (appending it can never create a
 *     contract violation), names paths not values;
 *   - logEnrichmentContractMismatch: exactly one warn per mismatch, silent
 *     on ok, {path, code} payload only.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnalysisEnrichmentSchema } from '@talchain/schemas/boundary';
import {
  assessEnrichmentContract,
  buildEnrichmentContractWarning,
  logEnrichmentContractMismatch,
  ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES,
} from '../src/routes/v2/enrichment-egress-guard.js';
import { INFERENCE_WARNING_CODES } from '../src/types/engine-v3.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const realFixture = () =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, 'tests', 'golden', 'pricing-canary', 'plot-response.json'), 'utf8'),
  );

describe('assessEnrichmentContract', () => {
  it('empty object conforms (all 19 root keys optional by design)', () => {
    const a = assessEnrichmentContract({});
    expect(a).toEqual({ ok: true, issues: [], issue_count: 0 });
  });

  it('real checked-in /v2/run fixture conforms', () => {
    const a = assessEnrichmentContract(realFixture());
    expect(a.ok).toBe(true);
    expect(a.issue_count).toBe(0);
  });

  it('producer-ahead unknown keys are NOT violations (passthrough envelope)', () => {
    const body = realFixture();
    body.some_future_plot_field = { anything: true };
    expect(assessEnrichmentContract(body).ok).toBe(true);
  });

  it('corrupted enum → not-ok with {path, code}; the corrupted VALUE never appears in the assessment', () => {
    const body = realFixture();
    body.confidence_tier = 'banana_leak_canary';
    const a = assessEnrichmentContract(body);
    expect(a.ok).toBe(false);
    expect(a.issue_count).toBeGreaterThanOrEqual(1);
    expect(a.issues.some((i) => i.path === 'confidence_tier' && i.code === 'invalid_enum_value')).toBe(true);
    // PII discipline positive control: path present (above) AND value absent.
    expect(JSON.stringify(a)).not.toContain('banana_leak_canary');
  });

  it('non-object body → not-ok (never throws)', () => {
    expect(assessEnrichmentContract('not an object').ok).toBe(false);
    expect(assessEnrichmentContract(null).ok).toBe(false);
    expect(assessEnrichmentContract(undefined).ok).toBe(false);
  });

  it(`caps reported issues at ${ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES} while issue_count carries the true total`, () => {
    const body = realFixture();
    // One invalid_type issue per corrupted required-string leaf.
    body.edge_e_values = Array.from({ length: ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES + 5 }, (_, i) => ({
      edge_id: `a${i}::b${i}`, from_id: `a${i}`, to_id: `b${i}`,
      e_value: 1, flip_direction: 42, current_mean: 0, flip_mean: 0,
    }));
    const a = assessEnrichmentContract(body);
    expect(a.ok).toBe(false);
    expect(a.issues).toHaveLength(ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES);
    expect(a.issue_count).toBeGreaterThan(ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES);
  });
});

describe('buildEnrichmentContractWarning', () => {
  function mismatchedAssessment() {
    const body = realFixture();
    body.confidence_tier = 'banana_leak_canary';
    return assessEnrichmentContract(body);
  }

  it('carries the registered code, warning severity, and the issue paths', () => {
    const w = buildEnrichmentContractWarning(mismatchedAssessment());
    expect(w.code).toBe(INFERENCE_WARNING_CODES.ENRICHMENT_CONTRACT_MISMATCH);
    expect(w.severity).toBe('warning');
    expect(w.message).toContain('confidence_tier');
    expect(w.message).toContain('invalid_enum_value');
    // Values never leak into the wire message.
    expect(w.message).not.toContain('banana_leak_canary');
  });

  it('the warning entry itself conforms to the envelope inference_warnings element schema', () => {
    const w = buildEnrichmentContractWarning(mismatchedAssessment());
    // Appending the disclosure can never create a new contract violation.
    const probe = AnalysisEnrichmentSchema.safeParse({ inference_warnings: [w] });
    expect(probe.success).toBe(true);
  });

  it('discloses the surplus when issues were capped', () => {
    const body = realFixture();
    body.edge_e_values = Array.from({ length: ENRICHMENT_CONTRACT_MAX_REPORTED_ISSUES + 5 }, (_, i) => ({
      edge_id: `a${i}::b${i}`, from_id: `a${i}`, to_id: `b${i}`,
      e_value: 1, flip_direction: 42, current_mean: 0, flip_mean: 0,
    }));
    const w = buildEnrichmentContractWarning(assessEnrichmentContract(body));
    expect(w.message).toContain('and 5 more');
  });
});

describe('logEnrichmentContractMismatch', () => {
  it('emits exactly one warn with {path, code} coordinates only', () => {
    const body = realFixture();
    body.confidence_tier = 'banana_leak_canary';
    const a = assessEnrichmentContract(body);
    const warn = vi.fn();
    logEnrichmentContractMismatch({ warn }, a, 'req-123');
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0]![0];
    expect(payload).toMatchObject({
      event: 'enrichment_contract_mismatch',
      request_id: 'req-123',
      issue_count: a.issue_count,
    });
    expect(JSON.stringify(payload)).not.toContain('banana_leak_canary');
  });

  it('is silent when the assessment verified', () => {
    const warn = vi.fn();
    logEnrichmentContractMismatch({ warn }, assessEnrichmentContract({}), 'req-123');
    expect(warn).not.toHaveBeenCalled();
  });
});
