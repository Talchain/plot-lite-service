/**
 * Enrichment egress guard — /v2/run route surface (A3 lane 1).
 *
 * Drives the REAL route (mock ISL service serving mutated copies of the
 * live V2 capture — same harness as isl-wire-generation.assertion.test.ts)
 * and pins the producer-side contract guard at the egress boundary:
 *
 *   - `_meta.evidence.enrichment_contract_ok: true` on a conformant body —
 *     on BOTH buildResponse callers (main computed path AND the
 *     ISL-not-enabled early return: the guard lives at the owner layer,
 *     run.ts buildResponse epilogue, so every run-body send site inherits
 *     it by construction);
 *   - a corrupted egress body (required-string envelope leaf carrying a
 *     number, injected via the verbatim ISL→egress passthrough field
 *     robustness.edge_e_values[].flip_direction) → ok false + exactly one
 *     ENRICHMENT_CONTRACT_MISMATCH warning naming the issue path, NEVER the
 *     corrupted value;
 *   - FAIL-OPEN: the corrupted response still delivers HTTP 200,
 *     analysis_status 'computed', and the corrupted field byte-identical on
 *     the wire — the guard discloses, never blocks or mutates;
 *   - hash ordering: the disclosure warning is INSIDE the hashed content
 *     (`_meta.response_content_hash` recomputes over the delivered body).
 *
 * RED before the guard is wired into buildResponse:
 * `_meta.evidence.enrichment_contract_ok` does not exist on any response
 * and no ENRICHMENT_CONTRACT_MISMATCH warning fires on a corrupted body.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const captureA = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260707', 'isl-staging-capture.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260707', 'isl-v2-request.json'), 'utf8'),
);

// Distinctive corrupted value: must be non-string (violates the REQUIRED
// ZodString leaf) and greppable so leak assertions are unambiguous.
const CORRUPTED_FLIP_DIRECTION = 424242;

// Per-test hooks: the mock deep-clones captureA and applies the mutation,
// so the checked-in fixture is never touched. islEnabled drives the
// ISL-not-enabled early return (read per-request at run.ts ~4274).
let islEnabled = true;
let mutateCapture: ((capture: any) => void) | null = null;

const mockISLService = {
  isEnabled(): boolean { return islEnabled; },
  async isAvailable(): Promise<boolean> { return islEnabled; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: string | null }> {
    const payload = JSON.parse(JSON.stringify(captureA));
    if (mutateCapture) mutateCapture(payload);
    return { data: payload as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';
import { computeResponseContentHash } from '../src/util/response-content-hash.js';

function buildPlotBody() {
  return {
    graph: {
      nodes: requestA.graph.nodes.map((n: any) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: requestA.graph.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: requestA.options.map((o: any) => ({
      id: o.id,
      label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId,
          { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: requestA.goal_node_id,
    seed: String(requestA.seed),
  };
}

describe('enrichment contract egress guard on /v2/run (A3 lane 1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    islEnabled = true;
    mutateCapture = null;
  });

  async function run(mutation: ((c: any) => void) | null, opts: { islEnabled?: boolean } = {}) {
    islEnabled = opts.islEnabled ?? true;
    mutateCapture = mutation;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v2/run',
        headers: { 'Content-Type': 'application/json' },
        payload: buildPlotBody(),
      });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.body);
    } finally {
      islEnabled = true;
      mutateCapture = null;
    }
  }

  it('conformant body (main computed path) → enrichment_contract_ok true, no mismatch warning', async () => {
    const body = await run(null);
    expect(body.analysis_status).toBe('computed');
    expect(body._meta.evidence.enrichment_contract_ok).toBe(true);
    const markers = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'ENRICHMENT_CONTRACT_MISMATCH',
    );
    expect(markers).toHaveLength(0);
  }, 60_000);

  it('ISL-not-enabled early return ALSO carries the stamp (owner-layer coverage of every run-body send site)', async () => {
    const body = await run(null, { islEnabled: false });
    expect(body.analysis_status).toBe('failed');
    expect(body.status_reason).toBe('ISL service is not enabled');
    // The failed shape is still a conformant envelope ('failed' is in the
    // analysis_status enum) — the guard must have assessed it and said so.
    expect(body._meta.evidence.enrichment_contract_ok).toBe(true);
  }, 60_000);

  it('corrupted egress body → ok false + ONE mismatch warning naming the path, value never leaked', async () => {
    const body = await run((c) => {
      // Verbatim ISL→egress passthrough (transformEdgeEValues copies
      // flip_direction untouched; its numeric filter only drops non-finite
      // e_value/current_mean/flip_mean) — the OUTGOING body then violates
      // the envelope's REQUIRED-string leaf edge_e_values[].flip_direction.
      c.robustness.edge_e_values[0].flip_direction = CORRUPTED_FLIP_DIRECTION;
    });

    expect(body._meta.evidence.enrichment_contract_ok).toBe(false);
    const markers = (body.inference_warnings ?? []).filter(
      (w: any) => w.code === 'ENRICHMENT_CONTRACT_MISMATCH',
    );
    expect(markers).toHaveLength(1);
    expect(markers[0].severity).toBe('warning');
    // Issue PATH disclosed…
    expect(markers[0].message).toContain('flip_direction');
    expect(markers[0].message).toContain('invalid_type');
    // …corrupted VALUE never (PII discipline).
    expect(markers[0].message).not.toContain(String(CORRUPTED_FLIP_DIRECTION));
  }, 60_000);

  it('FAIL-OPEN: the corrupted response still delivers — 200, computed, corrupted field on the wire untouched', async () => {
    const body = await run((c) => {
      c.robustness.edge_e_values[0].flip_direction = CORRUPTED_FLIP_DIRECTION;
    });
    expect(body.analysis_status).toBe('computed');
    // Delivery unmutated: the corrupted leaf reaches the consumer verbatim
    // (disclosure, never repair — repair would hide the producer defect).
    expect(
      body.edge_e_values.some((e: any) => e.flip_direction === CORRUPTED_FLIP_DIRECTION),
    ).toBe(true);
    // Science delivered unchanged alongside the disclosure.
    expect(body.edge_e_values.length).toBeGreaterThan(0);
  }, 60_000);

  it('hash ordering: the disclosure warning is INSIDE the hashed content (response_content_hash recomputes)', async () => {
    const body = await run((c) => {
      c.robustness.edge_e_values[0].flip_direction = CORRUPTED_FLIP_DIRECTION;
    });
    expect(body._meta.evidence.enrichment_contract_ok).toBe(false);
    // The warning was appended BEFORE the content hash was computed, so an
    // independent recompute over the delivered body must match the stamp.
    expect(computeResponseContentHash(body)).toBe(body._meta.response_content_hash);
  }, 60_000);
});
