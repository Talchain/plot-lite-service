/**
 * Byte-identity pin for /v2/run on a WELL-FORMED live V2 envelope (lane 29,
 * docs/enrichment-v1/PLOT-V2-READ-FIX-SPEC.md).
 *
 * Drives /v2/run with the raw live staging capture
 * (tests/fixtures/isl-v2-live-20260707, ISL build 9a22a1a) and compares the
 * response — after masking ONLY the documented volatile fields — against the
 * checked-in golden JSON, byte-for-byte (string equality of the serialised
 * normalised body, so key-order changes are caught too).
 *
 * The golden was generated on staging base 524c488 BEFORE the lane 29 code
 * changes, so this test proves the lane's fixes leave well-formed V2
 * responses byte-identical apart from the spec-mandated additive evidence
 * stamps, which the normaliser strips before comparison:
 *   _meta.evidence.isl_wire_generation_ok   (lane 29, spec §2.1)
 *   _meta.evidence.enrichment_contract_ok   (A3 lane 1, enrichment guard)
 * Nothing else may change.
 *
 * Volatile fields masked (all environment/clock/RNG-dependent, never
 * wire-shape): request ids + request_id_chain values, per-request latency
 * fields, PLoT build stamps, critique UUIDs.
 *
 * Regenerate deliberately (never to paper over a diff you can't explain):
 *   UPDATE_GOLDEN=1 npx vitest run tests/isl-v2-golden-response.pin.test.ts
 *
 * REGENERATED once for F3 (ISL #103 / D-23.15). This capture predates the ISL
 * rename and still carries the removed top-level `factor_evpi[]`. Removing the
 * dead counterfactual consumer changed EXACTLY two factor_sensitivity entries
 * (fac_hiring_cost, fac_team_maturity): the counterfactual-only
 * `evpi_status:"below_resolution"` stamp is gone and the now-always-run
 * heuristic instead emits `evpi_percentage_points:0` + `evpi_method:"heuristic"`
 * (their VOI is 0; win-prob spread 0.184 > 0). The derived `response_content_hash`
 * follows. Nothing else moved. Against LIVE ISL (which emits no `factor_evpi`)
 * this is unchanged behaviour — the stale fixture merely stopped exercising the
 * dead branch. The exact diff is pinned by the assertion below.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260707',
);
const GOLDEN_PATH = join(FIXTURE_DIR, 'plot-v2-run.golden.json');

const capturePlain = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-v2-request.json'), 'utf8'),
);

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
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
    return { data: JSON.parse(JSON.stringify(capturePlain)) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../src/createServer.js';

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

const MASK = '__VOLATILE__';

/**
 * Key names that are clock/RNG/environment-dependent WHEREVER they appear
 * (request ids echo the per-request UUID; fact_id hashes include it;
 * timestamps/latencies are wall-clock; build stamps are per-checkout).
 * None of them is wire-shape: the KEYS still pin (a masked key that
 * disappears or moves still fails the byte comparison).
 */
const VOLATILE_KEYS = new Set([
  'request_id', 'requestId', 'isl_request_id', 'fact_id',
  'timestamp', 'computed_at', 'created_at',
  'processing_time_ms', 'latency_ms', 'normalization_ms', 'validation_ms',
  'isl_ms', 'cee_ms', 'duration_ms',
  'build', 'plot_build',
  'ui', 'plot', 'isl', 'isl_echoed', // request_id_chain values
]);

// `id` is masked ONLY when it is a per-request random UUID (critiques use
// randomUUID()); deterministic ids (options, nodes) stay pinned by value.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mask the documented volatile fields IN PLACE (key order preserved — the
 * comparison is on the serialised string). Deterministic load-bearing
 * counterparts (meta.computed_at passthrough, _meta.evidence.isl_build,
 * response_hash stability) are pinned by explicit assertions below instead.
 */
function normalise(node: any): any {
  if (Array.isArray(node)) {
    for (const item of node) normalise(item);
    return node;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (VOLATILE_KEYS.has(k) && (typeof v === 'string' || typeof v === 'number')) {
        node[k] = MASK;
      } else if (k === 'id' && typeof v === 'string' && UUID_RE.test(v)) {
        node[k] = MASK;
      } else {
        normalise(v);
      }
    }
  }
  return node;
}

/** Strip the spec-mandated additive evidence stamps so the golden generated
 * on pre-lane base 524c488 pins everything else:
 *   - lane 29 (spec §2.1): isl_wire_generation_ok
 *   - A3 lane 1 (enrichment producer guard): enrichment_contract_ok — same
 *     additive-evidence-stamp class; its VALUE surface is pinned by
 *     tests/enrichment-egress-guard.route.test.ts, not by this byte pin. */
function stripAdditiveEvidenceStamps(body: any): any {
  if (body?._meta?.evidence) {
    delete body._meta.evidence.isl_wire_generation_ok;
    delete body._meta.evidence.enrichment_contract_ok;
  }
  return body;
}

describe('/v2/run golden byte-identity pin (well-formed V2 envelope, build 9a22a1a)', () => {
  let app: FastifyInstance;
  let rawBody: any;
  let normalisedText: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(),
    });
    expect(res.statusCode).toBe(200);
    rawBody = JSON.parse(res.body);
    normalisedText = JSON.stringify(
      normalise(stripAdditiveEvidenceStamps(JSON.parse(res.body))),
      null,
      2,
    );
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('matches the checked-in golden byte-for-byte after masking volatile fields', () => {
    if (!existsSync(GOLDEN_PATH) && process.env.UPDATE_GOLDEN !== '1') {
      throw new Error(
        `Golden file missing at ${GOLDEN_PATH} — a lost/deleted golden must not silently regenerate. ` +
        'Restore it from git, or intentionally regenerate with UPDATE_GOLDEN=1.'
      );
    }
    if (process.env.UPDATE_GOLDEN === '1') {
      writeFileSync(GOLDEN_PATH, normalisedText + '\n');
    }
    const golden = readFileSync(GOLDEN_PATH, 'utf8').replace(/\n$/, '');
    expect(normalisedText).toBe(golden);
  });

  // Deterministic counterparts of masked keys — pinned by value so the
  // masking cannot hide a regression in the fields that carry meaning.
  it('meta.computed_at is the ISL wire timestamp (getIslComputedAt passthrough), not PLoT clock', () => {
    expect(rawBody.meta.computed_at).toBe(capturePlain.timestamp);
    expect(rawBody.meta.computed_at).toBe('2026-07-07T11:14:19.368321Z');
  });

  it('_meta.evidence.isl_build passes through the wire build verbatim', () => {
    expect(rawBody._meta.evidence.isl_build).toBe('9a22a1a');
  });

  it('response_hash is deterministic (unmasked in the golden, so also pinned byte-for-byte)', () => {
    expect(typeof rawBody._meta.response_hash).toBe('string');
    expect(rawBody._meta.response_hash.length).toBeGreaterThan(0);
  });

  // F3 (ISL #103 / D-23.15): explicit pin of the ONLY response-content change vs
  // the pre-F3 golden, so the deliberate regeneration is not silent. The removed
  // counterfactual consumer used to stamp these two non-lever factors
  // `evpi_status:"below_resolution"` off the stale fixture's `factor_evpi`; the
  // heuristic (the live path) now emits a non-negative, method-tagged value.
  it('F3 surface change: the two non-lever factors carry heuristic EVPI, never the withdrawn counterfactual below_resolution', () => {
    for (const id of ['fac_hiring_cost', 'fac_team_maturity']) {
      const f = (rawBody.factor_sensitivity as any[]).find((x) => x.factor_id === id);
      expect(f, id).toBeDefined();
      expect(f, id).not.toHaveProperty('evpi_status');
      expect(f.evpi_method, id).toBe('heuristic');
      expect(f.evpi_percentage_points, id).toBeGreaterThanOrEqual(0);
    }
    // And no factor anywhere is labelled counterfactual (the path is removed).
    expect(
      (rawBody.factor_sensitivity as any[]).some((f) => f.evpi_method === 'counterfactual'),
    ).toBe(false);
  });
});
