/**
 * Decision-input minimiser (Codex F1/F8/F9) — PLoT must not leak decision-input
 * PII (node/factor labels, raw factor values, baseline means,
 * parameter_uncertainties, full ISL request/response bodies) into INFO
 * structured logs.
 *
 * These tests pin the LOG path (finding F1/F3): the boundary-log projection
 * carries only hashes/digests/timing/status/request-IDs — never raw
 * labels/values/bodies — unless the explicit default-off diagnostic gate is on.
 * They also pin the camelCase credential-redaction fix (F9) and green-pin that
 * hashes/timing/status/credential-redaction still work.
 *
 * NOTE: the /v2/run RESPONSE `downstream_calls` bodies (finding F8) are
 * DEFERRED, not stripped — a consumer (the A1 diligence lane, which captures
 * `enrichment.downstream_calls.isl[0].response_payload.factor_sensitivity` from
 * persisted facts; and PLoT's own `_meta.builds.isl` reading
 * `response_payload.build`) depends on them. See PR description.
 */

import { describe, it, expect } from 'vitest';
import {
  initDownstreamTracking,
  recordDownstreamCall,
  clearDownstreamTracking,
  getDownstreamCallsForBoundaryLog,
  sanitizePayloadForDebug,
  computePayloadDigest,
} from '../../src/util/downstream-tracker.js';

// A decision-input body of exactly the kind PLoT exchanges with ISL: it carries
// person-identifying labels, raw factor values, baseline means and
// parameter_uncertainties — plus a camelCase credential field.
function sensitiveIslBody() {
  return {
    apiKey: 'sk-super-secret-do-not-log',
    graph: {
      nodes: [
        { node_id: 'fac_salary', label: 'Alice Smith salary £125000', kind: 'factor' },
      ],
    },
    parameter_uncertainties: [
      { node_id: 'fac_salary', mean: 125000, std: 5000 },
    ],
    baseline: { mean: 125000 },
  };
}

describe('decision-input minimiser — boundary log projection (F1/F3)', () => {
  it('drops raw labels, values and bodies from the log-safe projection, keeping hashes/digests/timing/status', () => {
    const requestId = 'test-req-minimise-1';
    initDownstreamTracking(requestId);
    try {
      const body = sensitiveIslBody();
      const bodyText = JSON.stringify(body);
      const responseData = {
        robustness: { factor_sensitivity: [{ label: 'Alice Smith salary £125000', node_id: 'fac_salary' }] },
      };
      const responseText = JSON.stringify(responseData);

      recordDownstreamCall({
        service: 'isl',
        endpoint: '/v2/robustness/analyze',
        status: 200,
        elapsedMs: 342,
        payloadHash: 'abc123def456',
        responseHash: 'xyz789012345',
        requestId,
        // Bodies are stored exactly as the ISL client stores them today.
        requestPayload: sanitizePayloadForDebug(body),
        responsePayload: sanitizePayloadForDebug(responseData),
        requestDigest: computePayloadDigest(bodyText, body),
        responseDigest: computePayloadDigest(responseText, responseData),
        echoedRequestId: requestId,
      });

      const projected = getDownstreamCallsForBoundaryLog(requestId);
      expect(projected).toHaveLength(1);
      const serialised = JSON.stringify(projected);

      // No decision-input PII of ANY kind rides the log.
      expect(serialised).not.toContain('Alice Smith');
      expect(serialised).not.toContain('125000');
      expect(serialised).not.toContain('salary');
      // No body carriers.
      expect(projected[0]).not.toHaveProperty('request_payload');
      expect(projected[0]).not.toHaveProperty('response_payload');
      expect(projected[0]).not.toHaveProperty('error_body');

      // Correlation/observability metadata is RETAINED.
      expect(projected[0].payload_hash).toBe('abc123def456');
      expect(projected[0].response_hash).toBe('xyz789012345');
      expect(projected[0].elapsed_ms).toBe(342);
      expect(projected[0].status).toBe(200);
      expect(projected[0].service).toBe('isl');
      expect(projected[0].endpoint).toBe('/v2/robustness/analyze');
      expect(projected[0].request_id).toBe(requestId);
      // Digests (sha256 + byte size + key manifest) survive for verification.
      expect(projected[0].request_digest?.sha256).toBeTruthy();
      expect(projected[0].request_digest?.bytes).toBeGreaterThan(0);
      expect(projected[0].request_digest?.key_manifest).toContain('graph');
      expect(projected[0].response_digest?.sha256).toBeTruthy();
    } finally {
      clearDownstreamTracking(requestId);
    }
  });

  it('includes bodies ONLY under the explicit default-off diagnostic gate', () => {
    const requestId = 'test-req-minimise-gate';
    const prev = process.env.PLOT_DIAGNOSTIC_LOG_BODIES;
    initDownstreamTracking(requestId);
    try {
      const body = sensitiveIslBody();
      recordDownstreamCall({
        service: 'isl',
        endpoint: '/v2/robustness/analyze',
        status: 200,
        elapsedMs: 10,
        payloadHash: 'h',
        requestId,
        requestPayload: sanitizePayloadForDebug(body),
        requestDigest: computePayloadDigest(JSON.stringify(body), body),
      });

      // Default (unset): body dropped.
      delete process.env.PLOT_DIAGNOSTIC_LOG_BODIES;
      expect(getDownstreamCallsForBoundaryLog(requestId)[0]).not.toHaveProperty('request_payload');

      // Gate on: body present (still credential-redacted).
      process.env.PLOT_DIAGNOSTIC_LOG_BODIES = '1';
      const gated = getDownstreamCallsForBoundaryLog(requestId)[0];
      expect(gated).toHaveProperty('request_payload');
      expect(JSON.stringify(gated.request_payload)).toContain('[REDACTED]');
    } finally {
      if (prev === undefined) delete process.env.PLOT_DIAGNOSTIC_LOG_BODIES;
      else process.env.PLOT_DIAGNOSTIC_LOG_BODIES = prev;
      clearDownstreamTracking(requestId);
    }
  });
});

describe('decision-input minimiser — credential redaction (F9)', () => {
  it('redacts camelCase apiKey (case-insensitive) as well as snake_case and other credential keys', () => {
    const out = sanitizePayloadForDebug({
      apiKey: 'sk-camel',
      api_key: 'sk-snake',
      Authorization: 'Bearer token',
      password: 'p',
      secret: 's',
      token: 't',
      keep_me: 'visible',
    }) as Record<string, unknown>;

    expect(out.apiKey).toBe('[REDACTED]'); // was leaking before the fix
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.Authorization).toBe('[REDACTED]');
    expect(out.password).toBe('[REDACTED]');
    expect(out.secret).toBe('[REDACTED]');
    expect(out.token).toBe('[REDACTED]');
    // Non-credential fields are untouched.
    expect(out.keep_me).toBe('visible');
  });
});
