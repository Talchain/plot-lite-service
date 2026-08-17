/**
 * FULL-PIPELINE WITNESS — ISL conditional_winners reach the public /v2/run wire.
 * ----------------------------------------------------------------------------
 * The unit gate (`conditional-winners-isl-bucket-names.test.ts`) pins the
 * transform. This one drives the WHOLE route: a mocked ISL returns a real live
 * staging capture with a populated `conditional_winners` array in ISL's own wire
 * shape, and the assertions are made on the SERIALISED public response body.
 *
 * Why both. The transform being right proves nothing about the route: the field
 * could be dropped again by `buildResponse`'s field-by-field rebuild (the
 * `transformEdgeEValues` hazard this repo already has a comment about), or
 * flattened by the response-shaping layer. A unit test would stay green through
 * either.
 *
 * FIXTURE COMPOSITION, stated exactly (this matters — see trap 14b):
 *  · The ISL envelope is `tests/fixtures/isl-v2-live-20260707/isl-staging-capture.json`
 *    VERBATIM, deep-cloned at read time. Nothing is written back. That capture has
 *    NO `conditional_winners` (its model produced no flip), which is why one has to
 *    be composed in.
 *  · The rows come from `tests/fixtures/isl-conditional-winners-20260817/`, produced
 *    by ISL's OWN Pydantic runtime @ `28fe0c95` (see that directory's PROVENANCE.md).
 *  · Only the option IDS are remapped, onto the capture's real options, so the
 *    label-enrichment hop is exercised against real labels. EVERY KEY NAME — the
 *    thing under test — is the producer's, untouched.
 *
 * RUNG: code-proven end-to-end against captured producer bytes. NOT wire-witnessed:
 * deployed staging still serves the pre-fix build, so a live `/v2/run` witness on a
 * contested model is owed AFTER deploy, not obtainable before merge.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_DIR = join(HERE, '..', 'fixtures', 'isl-v2-live-20260707');
const CW_DIR = join(HERE, '..', 'fixtures', 'isl-conditional-winners-20260817');

const capture = JSON.parse(readFileSync(join(LIVE_DIR, 'isl-staging-capture.json'), 'utf8'));
const request = JSON.parse(readFileSync(join(LIVE_DIR, 'isl-v2-request.json'), 'utf8'));
const islRows = JSON.parse(readFileSync(join(CW_DIR, 'isl-conditional-winners.json'), 'utf8'));

// The capture's real options, in the order the request declared them.
const OPT = request.options.map((o: any) => o.id as string);
const LABEL: Record<string, string> = Object.fromEntries(
  request.options.map((o: any) => [o.id, o.label as string]),
);

/** Remap the producer rows' option ids onto the capture's, key names untouched. */
function rowsForCapture(): unknown[] {
  const idMap: Record<string, string> = { 'opt-a': OPT[0], 'opt-b': OPT[1], 'opt-c': OPT[2] };
  const remapBucket = (b: any) => ({
    ...b,
    winner_id: idMap[b.winner_id] ?? b.winner_id,
    ...(b.runner_up_id !== undefined && { runner_up_id: idMap[b.runner_up_id] ?? b.runner_up_id }),
  });
  return (islRows as any[]).map((r) => ({
    ...r,
    low_bucket: remapBucket(r.low_bucket),
    high_bucket: remapBucket(r.high_bucket),
  }));
}

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
    return {
      factors: [], value_of_information: [], robustness_label: 'robust' as const,
      robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const,
    };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: string | null }> {
    // Deep clone, then compose. The capture on disk is never mutated.
    const payload = JSON.parse(JSON.stringify(capture));
    payload.conditional_winners = rowsForCapture();
    return { data: payload as T, error: null };
  },
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');

function buildPlotBody() {
  return {
    graph: {
      nodes: request.graph.nodes.map((n: any) => ({
        id: n.id, kind: n.kind, label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: request.graph.edges.map((e: any) => ({
        from: e.from, to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: request.options.map((o: any) => ({
      id: o.id, label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId, { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: request.goal_node_id,
    seed: String(request.seed),
  };
}

/** Find every `conditional_winners` array anywhere in the response tree. */
function findConditionalWinners(value: unknown, path = '$', out: Array<[string, any[]]> = []): Array<[string, any[]]> {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findConditionalWinners(v, `${path}[${i}]`, out));
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'conditional_winners' && Array.isArray(v)) out.push([`${path}.${k}`, v]);
      findConditionalWinners(v, `${path}.${k}`, out);
    }
  }
  return out;
}

describe('conditional winners · full /v2/run pipeline against producer bytes', () => {
  let app: FastifyInstance;
  let body: any;
  let rawBody: string;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(),
    });
    expect(res.statusCode).toBe(200);
    rawBody = res.body;
    body = JSON.parse(res.body);
  }, 120_000);

  afterAll(async () => { await app.close(); });

  it('the public response carries the rows — not a silent empty array', () => {
    const found = findConditionalWinners(body);
    // At least one location, and EVERY location that exists must be populated:
    // a second, empty copy elsewhere in the tree is the shape of this defect.
    expect(found.length).toBeGreaterThan(0);
    for (const [path, rows] of found) {
      expect(rows.length, `empty conditional_winners at ${path}`).toBe(3);
    }
  });

  it('probabilities survive to the wire under the CONTRACT name, per bucket', () => {
    const [, rows] = findConditionalWinners(body)[0];
    const byFactor = Object.fromEntries(rows.map((r: any) => [r.factor_id, r]));
    expect(byFactor['factor-demand'].low_bucket.win_probability).toBe(0.71);
    expect(byFactor['factor-demand'].high_bucket.win_probability).toBe(0.63);
    expect(byFactor['factor-churn'].low_bucket.win_probability).toBe(0.55);
    // A boundary 0 must reach the wire as 0, not vanish and not become null.
    expect(byFactor['factor-price'].high_bucket.win_probability).toBe(0);
    expect(rawBody).not.toContain('"win_probability":null');
    // ISL's own key name must NOT appear on the public surface — the outbound
    // contract name is `win_probability` and the UI/CEE read that.
    expect(rawBody).not.toContain('winner_probability');
  });

  it('label enrichment resolved real option labels from the graph', () => {
    const [, rows] = findConditionalWinners(body)[0];
    const demand = rows.find((r: any) => r.factor_id === 'factor-demand');
    expect(demand.low_bucket.winner_id).toBe(OPT[0]);
    expect(demand.low_bucket.winner_label).toBe(LABEL[OPT[0]]);
    expect(demand.high_bucket.winner_label).toBe(LABEL[OPT[1]]);
    expect(demand.low_bucket.runner_up_label).toBe(LABEL[OPT[1]]);
    // The producer's flip attestation rides through verbatim — the UI card keys
    // its scenario rendering off exactly this.
    expect(demand.winner_flips).toBe(true);
  });

  it('every emitted bucket satisfies the shared contract (win_probability required, [0,1])', () => {
    for (const [path, rows] of findConditionalWinners(body)) {
      for (const row of rows) {
        for (const side of ['low_bucket', 'high_bucket'] as const) {
          const p = row[side].win_probability;
          expect(typeof p, `${path} ${row.factor_id}.${side}`).toBe('number');
          expect(p).toBeGreaterThanOrEqual(0);
          expect(p).toBeLessThanOrEqual(1);
          expect(typeof row[side].winner_id).toBe('string');
          expect(typeof row[side].winner_label).toBe('string');
        }
      }
    }
  });
});
