/**
 * EVIDENCE-PRIORITY RANKING — omit, never substitute.
 *
 * DEFECT (measured at the route, not argued). `src/routes/v2/run.ts` built the
 * evidence-priority card's inputs with:
 *
 *     elasticity: fs.elasticity ?? fs.sensitivity_score ?? 0
 *
 * Two substitutions on one line, feeding a card the user reads as "what matters
 * most here" — `buildEvidencePriorityCard` ranks by `abs(elasticity)`.
 *
 *   (a) CROSS-QUANTITY. `sensitivity_score` is a DIFFERENT quantity standing in
 *       under the elasticity name. `src/facts/mapper.ts` removed exactly this
 *       alias on the fact_objects path (FAMILY-4 SLICE 0, 2026-07-27), on the
 *       evidence that the 2026-07-07 capture published `fac_hiring_cost` at
 *       elasticity +0.497 against sensitivity_score -0.175 — opposite sign,
 *       2.84x apart, in one response. The alias survived here.
 *   (b) FABRICATED ZERO. Absent means "not measured", never "zero elasticity",
 *       and `?? ` does not catch a non-finite value either.
 *
 * MEASURED AT THIS TIP, driving the real /v2/run: an ISL-only factor carrying
 * `sensitivity_score: 0.9` and NO elasticity was published on
 * `factor_sensitivity[]` with the elasticity key correctly ABSENT — while the
 * evidence-priority card in the SAME response body ranked it **#1** at
 * `elasticity: 0.9`. One response, two surfaces, contradicting: the producer
 * says "not measured", the card says "this is the most important thing to
 * gather evidence on".
 *
 * ── Reachability, bounded (CLAUDE.md trap 16-inverse) ───────────────────────
 * `factor_sensitivity[].elasticity` is OPTIONAL (`FactorSensitivityResultV3`)
 * and the producer omits it: `transformFactorSensitivity` assigns
 * `elasticity: finiteNum(f.elasticity)` (run.ts, numeric-egress guard). The
 * rows that can carry the absence are ISL-ONLY APPEND rows —
 * `mergeIslConfidenceIntoGraphFactors` spreads `...islFCleaned` for an ISL
 * factor with no graph counterpart. That is what the mutation below injects,
 * and it is a shape a live ISL can emit; the graph-derived rows always carry an
 * elasticity, so this is NOT the common path. Stated narrowly on purpose.
 *
 * ── Why a MUTATED copy of a pinned capture ─────────────────────────────────
 * The base input is the HISTORICAL 2026-07-07 staging capture, pinned by
 * SHA-256 below so this control cannot decay into a tautology when the deployed
 * producer moves (CLAUDE.md trap 12b). The mutation is the smallest one that
 * reaches the branch — one appended factor — is applied in-test rather than
 * checked in, and is ASSERTED to have landed (positive controls below), so a
 * mutation that silently stopped applying cannot read as a pass.
 *
 * ── Gate note ──────────────────────────────────────────────────────────────
 * `ENABLE_REVIEW_PASS` defaults ON for test/staging (src/config/flags.ts). It
 * is set EXPLICITLY here rather than inherited, so the test cannot silently
 * stop exercising the surface.
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

/** Anti-tautology pin — the bytes this control was written against. */
const PINNED_CAPTURE_SHA256 =
  '07ae686e6ab984eb0068ff5cd74d770e8279bdf20ec41de7383babb3b1b1efc3';
const PINNED_REQUEST_SHA256 =
  '83d34e71a86382168b21d00a9c8277b82e945db42e7465aec145b85e05b090fb';

const capturePlain = JSON.parse(readFileSync(CAPTURE_PATH, 'utf8'));
const requestA = JSON.parse(readFileSync(REQUEST_PATH, 'utf8'));

/** The one number both ghost rows carry on `sensitivity_score`. */
const GHOST_SENSITIVITY = 0.9;

/**
 * Appended ISL-only factors. Both sit ABOVE every graph-derived elasticity in
 * the capture (max 0.497), so a substituted 0.9 cannot fail to rank #1 — the
 * assertion is discriminating by construction, not by luck.
 */
const GHOST_UNMEASURED = 'fac_ghost_unmeasured'; // elasticity absent entirely
const GHOST_NONFINITE = 'fac_ghost_nonfinite';   // elasticity present but null
const GHOST_MEASURED_ZERO = 'fac_ghost_zero';    // elasticity genuinely 0

/** Which mutation the mock applies on the next call. */
let MUTATE: (capture: any) => void = () => {};

const mockISLService = {
  isEnabled: () => true,
  isAvailable: async () => true,
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
    const capture = JSON.parse(JSON.stringify(capturePlain));
    MUTATE(capture);
    return { data: capture as T, error: null };
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

type Row = Record<string, any>;

interface Driven {
  body: any;
  /** `factor_sensitivity[]` rows keyed by factor_id. */
  published: Map<string, Row>;
  /** evidence_priority card items keyed by factor_id. */
  items: Map<string, Row>;
  /** the evidence_priority card itself, or undefined. */
  card: Row | undefined;
}

let app: FastifyInstance;

async function drive(mutate: (capture: any) => void): Promise<Driven> {
  MUTATE = mutate;
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload: buildPlotBody(),
  });
  expect(res.statusCode).toBe(200);
  const body = JSON.parse(res.body);
  const card = (body.review_cards ?? []).find((c: Row) => c.card_type === 'evidence_priority');
  return {
    body,
    published: new Map((body.factor_sensitivity as Row[]).map((f) => [f.factor_id as string, f])),
    items: new Map(((card?.items ?? []) as Row[]).map((i) => [i.factor_id as string, i])),
    card,
  };
}

/** Append one ISL-only factor to the capture's factor_sensitivity list. */
function appendGhost(nodeId: string, extra: Record<string, unknown>) {
  return (capture: any) => {
    capture.factor_sensitivity.push({
      node_id: nodeId,
      label: nodeId,
      sensitivity_score: GHOST_SENSITIVITY,
      confidence: 0.2,
      direction: 'positive',
      attribution_stability: 'low',
      ...extra,
    });
  };
}

beforeAll(async () => {
  process.env.RATE_LIMIT_ENABLED = '0';
  process.env.CEE_ORCHESTRATOR_ENABLED = '0';
  process.env.DECISION_REVIEW_ENABLE = '0';
  // Explicit, per the gate note — never inherited from NODE_ENV.
  process.env.ENABLE_REVIEW_PASS = '1';
  app = await createServer();
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
});

// ───────────────────────────────────────────────────────────────────────────
// POSITIVE CONTROLS — run first. If any fails, every assertion below is
// vacuous and its green means nothing (CLAUDE.md trap 13).
// ───────────────────────────────────────────────────────────────────────────
describe('positive controls', () => {
  it('the input fixture is the pinned HISTORICAL capture, byte-for-byte', () => {
    const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
    expect(sha(CAPTURE_PATH), 'isl-staging-capture.json').toBe(PINNED_CAPTURE_SHA256);
    expect(sha(REQUEST_PATH), 'isl-v2-request.json').toBe(PINNED_REQUEST_SHA256);
  });

  it('the surface under test is POPULATED — an unmutated run builds a ranked card', async () => {
    const { card, items } = await drive(() => {});
    expect(card, 'no evidence_priority card on the baseline run').toBeDefined();
    expect(items.size).toBeGreaterThan(0);
    // And the ranking is real: every item carries a finite elasticity.
    for (const [id, item] of items) {
      expect(Number.isFinite(item.elasticity), `${id} has non-finite elasticity`).toBe(true);
    }
  }, 120_000);

  it('the MUTATION LANDS — the producer publishes the ghost row with elasticity ABSENT', async () => {
    const { published } = await drive(appendGhost(GHOST_UNMEASURED, {}));
    const row = published.get(GHOST_UNMEASURED);
    expect(row, 'ghost row missing from factor_sensitivity[] — mutation did not apply').toBeDefined();
    // The producer is already honest HERE: it omits what it did not measure.
    expect(Object.hasOwn(row!, 'elasticity'), 'producer published an elasticity it never measured').toBe(false);
    // And it publishes the OTHER quantity, which is what the defect copied.
    expect(row!.sensitivity_score).toBe(GHOST_SENSITIVITY);
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// THE DEFECT. RED at pristine on all three assertions.
// ───────────────────────────────────────────────────────────────────────────
describe('an UNMEASURED elasticity is dropped from the ranking, never substituted', () => {
  it('does not rank a factor whose elasticity the producer omitted', async () => {
    const { items } = await drive(appendGhost(GHOST_UNMEASURED, {}));
    // RED at pristine: present at sensitivity_rank 1.
    expect(
      items.has(GHOST_UNMEASURED),
      'a factor with no measured elasticity was ranked in the evidence-priority card',
    ).toBe(false);
  }, 120_000);

  it('never publishes sensitivity_score under the elasticity name', async () => {
    const { items, published } = await drive(appendGhost(GHOST_UNMEASURED, {}));
    // Bind by IDENTITY as well as by value: the ghost must be absent, AND no
    // surviving item may carry the ghost's sensitivity_score as its elasticity.
    expect(items.get(GHOST_UNMEASURED)?.elasticity).toBeUndefined();
    for (const [id, item] of items) {
      expect(
        item.elasticity,
        `${id} carries the ghost's sensitivity_score (${GHOST_SENSITIVITY}) as its elasticity`,
      ).not.toBe(GHOST_SENSITIVITY);
      // Every ranked item's elasticity must equal the published elasticity for
      // the SAME factor — one name, one quantity.
      expect(item.elasticity, `${id} elasticity disagrees with factor_sensitivity[]`)
        .toBe(published.get(id)?.elasticity);
    }
  }, 120_000);

  it('drops a NON-FINITE elasticity too (`??` never caught it)', async () => {
    const { items } = await drive(appendGhost(GHOST_NONFINITE, { elasticity: null }));
    expect(
      items.has(GHOST_NONFINITE),
      'a factor with a non-finite elasticity was ranked',
    ).toBe(false);
  }, 120_000);

  it('the real top driver keeps rank 1 once the unrankable row is gone', async () => {
    const baseline = await drive(() => {});
    const withGhost = await drive(appendGhost(GHOST_UNMEASURED, {}));
    const topOf = (d: Driven) =>
      [...d.items.values()].sort((a, b) => a.sensitivity_rank - b.sensitivity_rank)[0]?.factor_id;
    expect(topOf(withGhost)).toBe(topOf(baseline));
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
// THE OPPOSITE-DIRECTION TWIN. GREEN at pristine AND after the fix — turning a
// real measurement into an omission is the mirror defect and would be just as
// wrong (numeric-egress-guards.ts:81-83).
// ───────────────────────────────────────────────────────────────────────────
describe('a MEASURED zero elasticity still ships and is still ranked', () => {
  it('ranks a factor whose elasticity is genuinely 0, at 0', async () => {
    const { items, published } = await drive(appendGhost(GHOST_MEASURED_ZERO, { elasticity: 0 }));

    // Precondition pinned in-test: the producer really published a measured 0
    // alongside a NON-zero sensitivity_score, so this case can tell
    // "omit-when-absent" apart from "omit-when-falsy" (CLAUDE.md trap 13b).
    const row = published.get(GHOST_MEASURED_ZERO);
    expect(row, 'ghost row missing — mutation did not apply').toBeDefined();
    expect(row!.elasticity).toBe(0);
    expect(row!.sensitivity_score).toBe(GHOST_SENSITIVITY);

    const item = items.get(GHOST_MEASURED_ZERO);
    expect(item, 'a MEASURED zero elasticity was dropped from the ranking').toBeDefined();
    expect(item!.elasticity, 'a measured 0 was replaced').toBe(0);
    expect(item!.sensitivity_value, 'abs(0) is 0, not the sensitivity_score').toBe(0);
  }, 120_000);
});
