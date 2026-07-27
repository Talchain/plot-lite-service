/**
 * FAMILY-4 SLICE 0 — one payload, one field name, ONE quantity.
 *
 * DEFECT (measured, not argued). `src/routes/v2/run.ts` fed `fs.elasticity ?? 0`
 * into the FactObject field named `sensitivity_score`, while the same /v2/run
 * body published the real `sensitivity_score` on `factor_sensitivity[]`. On the
 * committed golden for this fixture, `fac_hiring_cost` therefore carried:
 *
 *     factor_sensitivity[0].sensitivity_score  =  -0.175
 *     fact_objects[].data.sensitivity_score    =  +0.4971042471042471
 *
 * Opposite sign, 2.84x apart, same field name, same response. A consumer
 * sorting `fact_objects` by `sensitivity_score` got an ordering that
 * contradicted `factor_sensitivity[]`, and a consumer reading the sign got the
 * opposite direction — including from the `direction: 'negative'` sitting in
 * the very same object.
 *
 * This test drives the real route and asserts the two surfaces agree.
 *
 * ── Why the fixture, and why pinned by HASH (CLAUDE.md trap 12b) ────────────
 * The input is the HISTORICAL 2026-07-07 staging capture, pinned by SHA-256
 * below. A control whose reference is "whatever staging returns now" is a
 * control with an expiry date nobody wrote down; this one cannot silently
 * become a tautology when the deployed producer changes. The hash assertions
 * run FIRST and fail loudly on drift rather than assuming good.
 *
 * ── Why the positive controls come first (CLAUDE.md trap 13) ────────────────
 * An equality assertion between two fields passes trivially if the fields are
 * both absent, or if the payload happens to make them equal anyway. The first
 * `describe` block proves the assertion can SEE a presence: facts exist, they
 * cover the factors, and at least one factor has `sensitivity_score` genuinely
 * DIFFERENT from `elasticity` — so the identity assertion is discriminating on
 * this input, not vacuous.
 *
 * ── Gate note ───────────────────────────────────────────────────────────────
 * `ENABLE_FACTS_ASSEMBLY` defaults ON only for test/staging
 * (src/config/flags.ts). It is set EXPLICITLY here rather than inherited from
 * NODE_ENV, so the test cannot silently stop exercising the surface.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260707',
);
const CAPTURE_PATH = join(FIXTURE_DIR, 'isl-staging-capture.json');
const REQUEST_PATH = join(FIXTURE_DIR, 'isl-v2-request.json');

/**
 * Anti-tautology pin. These are the bytes of the 2026-07-07 capture (ISL build
 * 9a22a1a) this control was written against. If a lane re-captures against a
 * newer producer, it must create a NEW fixture directory — never re-point this
 * control at live, and never update these hashes to make a red go away.
 */
const PINNED_CAPTURE_SHA256 =
  '07ae686e6ab984eb0068ff5cd74d770e8279bdf20ec41de7383babb3b1b1efc3';
const PINNED_REQUEST_SHA256 =
  '83d34e71a86382168b21d00a9c8277b82e945db42e7465aec145b85e05b090fb';

const capturePlain = JSON.parse(readFileSync(CAPTURE_PATH, 'utf8'));
const requestA = JSON.parse(readFileSync(REQUEST_PATH, 'utf8'));

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
import { assembleFactObjects } from '../src/facts/index.js';

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

type FactorRow = Record<string, any>;

describe('family-4 slice 0: fact_objects vs factor_sensitivity — one name, one quantity', () => {
  let app: FastifyInstance;
  let body: any;
  /** `factor_sensitivity[]` rows keyed by factor_id. */
  let published: Map<string, FactorRow>;
  /** `fact_objects[].data` rows of type factor_sensitivity, keyed by node_id. */
  let facts: Map<string, FactorRow>;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    // Explicit, per the gate note above — never inherited from NODE_ENV.
    process.env.ENABLE_FACTS_ASSEMBLY = '1';

    app = await createServer();
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(),
    });
    expect(res.statusCode).toBe(200);
    body = JSON.parse(res.body);

    published = new Map(
      (body.factor_sensitivity as FactorRow[]).map((f) => [f.factor_id as string, f]),
    );
    facts = new Map(
      (body.fact_objects as any[])
        .filter((o) => o?.data?.type === 'factor_sensitivity')
        .map((o) => [o.data.node_id as string, o.data as FactorRow]),
    );
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // POSITIVE CONTROLS — run first. If any of these fails, every assertion in
  // the next block is vacuous and its green means nothing.
  // ───────────────────────────────────────────────────────────────────────────
  describe('positive controls (trap 13 / trap 12b)', () => {
    it('the input fixture is the pinned HISTORICAL capture, byte-for-byte', () => {
      const sha = (p: string) =>
        createHash('sha256').update(readFileSync(p)).digest('hex');
      expect(sha(CAPTURE_PATH), 'isl-staging-capture.json').toBe(PINNED_CAPTURE_SHA256);
      expect(sha(REQUEST_PATH), 'isl-v2-request.json').toBe(PINNED_REQUEST_SHA256);
    });

    it('the surface under test is POPULATED — facts exist and cover the published factors', () => {
      expect(published.size).toBeGreaterThan(0);
      expect(facts.size).toBeGreaterThan(0);
      // Every fact must correspond to a published row (facts are a top-5 slice
      // of the published array, so the containment is one-way).
      for (const nodeId of facts.keys()) {
        expect(published.has(nodeId), `no factor_sensitivity row for ${nodeId}`).toBe(true);
      }
      // And the factor this defect was measured on is present.
      expect(facts.has('fac_hiring_cost')).toBe(true);
    });

    it('the identity assertion DISCRIMINATES: at least one factor has sensitivity_score !== elasticity', () => {
      // If the two quantities coincided on every row, the next block would pass
      // whichever one the mapper fed — i.e. it would test nothing. On this
      // fixture fac_hiring_cost separates them (-0.175 vs +0.4971...).
      const separating = [...published.values()].filter(
        (f) =>
          typeof f.sensitivity_score === 'number' &&
          typeof f.elasticity === 'number' &&
          f.sensitivity_score !== f.elasticity,
      );
      expect(separating.length).toBeGreaterThan(0);
      const hiring = published.get('fac_hiring_cost')!;
      expect(hiring.sensitivity_score).toBe(-0.175);
      expect(hiring.elasticity).toBe(0.4971042471042471);
      // Opposite signs — the sharpest available separator.
      expect(Math.sign(hiring.sensitivity_score)).not.toBe(Math.sign(hiring.elasticity));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE FIX
  // ───────────────────────────────────────────────────────────────────────────
  describe('sensitivity_score means the same thing everywhere in the payload', () => {
    it('fact_objects[].data.sensitivity_score EQUALS factor_sensitivity[].sensitivity_score for the same factor', () => {
      for (const [nodeId, data] of facts) {
        const row = published.get(nodeId)!;
        expect(
          data.sensitivity_score,
          `fact_objects[${nodeId}].data.sensitivity_score (${data.sensitivity_score}) ` +
            `diverges from factor_sensitivity[${nodeId}].sensitivity_score (${row.sensitivity_score}) ` +
            '— two values, one name, one payload',
        ).toBe(row.sensitivity_score);
      }
    });

    it('the measured divergence is closed by VALUE and by SIGN (fac_hiring_cost: -0.175 vs +0.4971042471042471)', () => {
      const factData = facts.get('fac_hiring_cost')!;
      expect(factData.sensitivity_score).toBe(-0.175);
      expect(factData.sensitivity_score).not.toBe(0.4971042471042471);
      expect(Math.sign(factData.sensitivity_score)).toBe(
        Math.sign(published.get('fac_hiring_cost')!.sensitivity_score),
      );
    });

    it('within a single fact, the sign of sensitivity_score agrees with its own co-located direction', () => {
      for (const [nodeId, data] of facts) {
        if (typeof data.sensitivity_score !== 'number' || data.sensitivity_score === 0) continue;
        expect(
          data.sensitivity_score < 0 ? 'negative' : 'positive',
          `fact_objects[${nodeId}].data: sensitivity_score ${data.sensitivity_score} ` +
            `contradicts its own direction '${data.direction}'`,
        ).toBe(data.direction);
      }
    });

    it('no `importance_score` is emitted anywhere in the /v2/run body', () => {
      // It was synthesised as a third name for the same number. It has never
      // been on `factor_sensitivity[]` and must not reappear one level down.
      expect(JSON.stringify(body)).not.toContain('"importance_score"');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BYTE-IDENTITY / NON-OVER-REACH CONTROLS — the fix must change exactly one
  // thing. Quantities that LEGITIMATELY differ must still differ.
  // ───────────────────────────────────────────────────────────────────────────
  describe('controls: the fix does not collapse distinct quantities, and moves nothing else', () => {
    it('elasticity is still forwarded verbatim and still DIFFERS from sensitivity_score where the producer says it does', () => {
      for (const [nodeId, data] of facts) {
        expect(data.elasticity, `elasticity for ${nodeId}`).toBe(
          published.get(nodeId)!.elasticity,
        );
      }
      const hiring = facts.get('fac_hiring_cost')!;
      expect(hiring.elasticity).toBe(0.4971042471042471);
      // Different magnitude AND different sign — and that is CORRECT: they are
      // different quantities (raw total causal effect vs normalised influence).
      expect(hiring.elasticity).not.toBe(hiring.sensitivity_score);
    });

    it('factor_sensitivity[] itself is untouched — the source array keeps its pinned values', () => {
      expect(
        (body.factor_sensitivity as FactorRow[]).map((f) => [
          f.factor_id,
          f.sensitivity_score,
          f.elasticity,
          f.importance_rank,
          f.direction,
        ]),
      ).toEqual([
        ['fac_hiring_cost', -0.175, 0.4971042471042471, 1, 'negative'],
        ['fac_team_maturity', 0.13745631067961164, 0.39045780474351904, 2, 'positive'],
        ['fac_tech_lead', 0, 0, 3, 'positive'],
        ['fac_dev_headcount', 0, 0, 4, 'positive'],
      ]);
    });

    it('the non-quantity members of each fact are unchanged (label, rank, direction, confidence, stability)', () => {
      expect(
        [...facts.entries()]
          .map(([nodeId, d]) => [nodeId, d.label, d.importance_rank, d.direction, d.confidence, d.attribution_stability])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ).toEqual([
        ['fac_dev_headcount', 'Developer Headcount Added', 4, 'positive', 0.3, 'negligible'],
        ['fac_hiring_cost', 'Hiring and Salary Cost', 1, 'negative', 0.44075, 'low'],
        ['fac_team_maturity', 'Team Technical Maturity', 2, 'positive', 0.44455, 'low'],
        ['fac_tech_lead', 'Tech Lead in Place', 3, 'positive', 0.3, 'negligible'],
      ]);
    });
  });
});

/**
 * Unit-level pin for the ABSENCE branches. The 2026-07-07 capture happens to
 * carry both quantities on every factor, so a route-level test alone cannot
 * see the `?? 0` coalescers or the cross-quantity fallback that used to sit in
 * `mapFactorSensitivity`. Reverting either of those hunks must turn something
 * red (CLAUDE.md trap 11), so they are pinned directly on the mapper.
 */
describe('family-4 slice 0: mapFactorSensitivity absence branches', () => {
  const LINEAGE = {
    graph_hash: '0123456789abcdef',
    seed: 42,
    config_version: '1',
    isl_request_id: 'req-test',
  };

  function factorData(input: Record<string, unknown>) {
    const env = assembleFactObjects(
      { analysis_status: 'computed', factor_sensitivity: [input as any] },
      LINEAGE,
    );
    const fact = env.facts.find((f) => f.fact_type === 'factor_sensitivity');
    expect(fact, 'no factor_sensitivity fact assembled').toBeDefined();
    return fact!.data as Record<string, unknown>;
  }

  it('an absent sensitivity_score is OMITTED, never coalesced to 0', () => {
    const data = factorData({ node_id: 'f1', importance_rank: 1, elasticity: 0.9 });
    expect(data).not.toHaveProperty('sensitivity_score');
    expect(data.elasticity).toBe(0.9);
  });

  it('an absent elasticity is OMITTED, and never falls back to sensitivity_score', () => {
    const data = factorData({ node_id: 'f1', importance_rank: 1, sensitivity_score: -0.42 });
    expect(data).not.toHaveProperty('elasticity');
    // The pre-slice code emitted `elasticity: f.elasticity ?? f.sensitivity_score ?? 0`,
    // i.e. -0.42 under the elasticity name — a different quantity, silently.
    expect(data.sensitivity_score).toBe(-0.42);
  });

  it('both absent ⇒ both omitted; no fabricated zeros anywhere in the fact', () => {
    const data = factorData({ node_id: 'f1', importance_rank: 1 });
    expect(data).not.toHaveProperty('sensitivity_score');
    expect(data).not.toHaveProperty('elasticity');
    expect(data).not.toHaveProperty('importance_score');
  });

  it('present values are forwarded verbatim and independently — no aliasing', () => {
    const data = factorData({
      node_id: 'f1',
      importance_rank: 1,
      sensitivity_score: -0.175,
      elasticity: 0.4971042471042471,
    });
    expect(data.sensitivity_score).toBe(-0.175);
    expect(data.elasticity).toBe(0.4971042471042471);
    expect(data).not.toHaveProperty('importance_score');
  });
});
