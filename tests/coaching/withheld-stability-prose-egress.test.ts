/**
 * A WITHHELD QUANTITY MAY NOT BE PUBLISHED AS PROSE EITHER.
 *
 * `robustness.recommendation_stability` is DELIBERATELY NOT EMITTED as a wire
 * field (src/routes/v2/run.ts:3411-3422; the DROPPED entry in
 * src/contracts/isl-to-ui.contract.ts:60-78). The rationale is about the
 * QUANTITY, not the field's contract shape — verbatim: ISL derives it as
 * `option_wins[winner]/n_samples`, i.e. "the leader's win_probability
 * relabelled, zero independent information", and "The UI printed it as
 * 'N% stability' — a fabricated second statistic."
 *
 * Prose is a publication. A number the product has ruled itself not entitled
 * to publish as data is equally unpublishable inside a coaching sentence,
 * where the user has NO field to verify it against — strictly worse than the
 * field, because the withhold removed the only checkable surface.
 *
 * WHY A DERIVED SWEEP, NOT A LIST OF THE THREE KNOWN SITES: a hand-maintained
 * list of emission sites drifts silently and reads green (the estate's dominant
 * defect class). This walks EVERY string in the built m1_coaching payload, so a
 * NEW emission site added later fails here without anyone updating a list.
 *
 * Payload shapes are producer-grounded, never invented (P7): both live captures
 * carry 0.59025, and the withhold comment itself cites the second live value
 * 0.8541875 (run.ts:3415-3416). LOW uses 0.42 — the quantity is
 * option_wins/n_samples, so any fraction >= 1/n_options is ordinary for a
 * 3-option run.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const LIVE_DIR = join(FIXTURES_ROOT, 'isl-v2-live-20260707');

const liveCapture = JSON.parse(
  readFileSync(join(LIVE_DIR, 'isl-staging-capture.json'), 'utf8'),
);
const liveRequest = JSON.parse(
  readFileSync(join(LIVE_DIR, 'isl-v2-request.json'), 'utf8'),
);

/** The ISL payload the mock returns for the NEXT /v2/run call. Always cloned. */
let currentIslPayload: any = null;

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
    return { data: JSON.parse(JSON.stringify(currentIslPayload)) as T, error: null };
  },
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../../src/createServer.js');

function buildPlotBody(islRequest: any, seedOverride?: string) {
  return {
    graph: {
      nodes: islRequest.graph.nodes.map((n: any) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: islRequest.graph.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: islRequest.options.map((o: any) => ({
      id: o.id,
      label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId,
          { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: islRequest.goal_node_id,
    seed: seedOverride ?? String(islRequest.seed),
  };
}

/**
 * Clone the live ISL capture and set (or delete) recommendation_stability.
 *
 * `confidence` is set to the SAME value because post-ISL-#114 that slot carries
 * this exact quantity unmodified (documented at run.ts:3430-3453 and in the
 * contract's DROPPED entry) — so it is producer-faithful, and it gives the test
 * a PUBLISHED field that echoes the injected value. That echo is the test's own
 * precondition pin: without it, a stale or cross-test response would be swept
 * for prose leaks and read as a pass (trap 13b — a guard whose discrimination
 * depends on a fixture nothing pins).
 */
function captureWithStability(stability: number | undefined, confidenceEcho: number): any {
  const clone = JSON.parse(JSON.stringify(liveCapture));
  if (stability === undefined) {
    delete clone.robustness.recommendation_stability;
  } else {
    clone.robustness.recommendation_stability = stability;
  }
  clone.robustness.confidence = confidenceEcho;
  return clone;
}

/** Every string reachable in the payload, with its JSON path (derived, not listed). */
function collectProse(value: unknown, path = 'm1_coaching'): Array<{ path: string; text: string }> {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => collectProse(v, `${path}[${i}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => collectProse(v, `${path}.${k}`));
  }
  return [];
}

/**
 * The defect, stated as the property: a percentage token in the same clause as
 * the withheld quantity's own label. Binds by the quantity's IDENTITY (its
 * label), not by a bare number another quantity could satisfy — coaching prose
 * legitimately carries other percentages (win-probability deltas, evidence).
 */
const STABILITY_FIGURE =
  /(\d+(?:\.\d+)?)\s*%[^.!?]{0,60}?recommendation stability|recommendation stability[^.!?]{0,60}?\(?\s*(\d+(?:\.\d+)?)\s*%/i;

function figureLeaks(prose: Array<{ path: string; text: string }>) {
  return prose.filter((p) => STABILITY_FIGURE.test(p.text));
}

async function runV2(app: FastifyInstance, payload: any) {
  const res = await app.inject({
    method: 'POST',
    url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload,
  });
  return { statusCode: res.statusCode, body: JSON.parse(res.body) };
}

describe('withheld recommendation_stability — never published as prose (/v2/run, live-capture derived)', () => {
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
    await app?.close();
  });

  // ─── The core property, across the reachable payload shapes ───
  // Each shape carries a DISTINCT seed so that no body-keyed cache, replay or
  // dedupe anywhere on the route can serve one shape's response for another —
  // measured necessity, not caution: with a shared seed the HIGH shape was
  // served the LOW shape's prose ("42%" under an 0.8541875 injection), and the
  // only tell was two different inputs producing one answer (trap 20).
  const SHAPES: Array<{ name: string; stability: number | undefined; confidence: number; seed: string }> = [
    { name: 'LOW (0.42 — option_wins/n_samples, ordinary for 3 options)', stability: 0.42, confidence: 0.42, seed: '910001' },
    { name: 'LIVE/CLOSE-CALL (0.59025 — both live captures)', stability: 0.59025, confidence: 0.59025, seed: '910002' },
    { name: 'HIGH (0.8541875 — the second live value cited in the withhold)', stability: 0.8541875, confidence: 0.8541875, seed: '910003' },
    { name: 'ABSENT (ISL omits the field)', stability: undefined, confidence: 0.3141593, seed: '910004' },
  ];

  for (const shape of SHAPES) {
    it(`publishes NO stability figure in m1_coaching prose — ${shape.name}`, async () => {
      currentIslPayload = captureWithStability(shape.stability, shape.confidence);
      const { statusCode, body } = await runV2(app, buildPlotBody(liveRequest, shape.seed));
      expect(statusCode).toBe(200);
      expect(body.m1_coaching).toBeDefined();

      // PRECONDITION PIN: prove this response was built from THIS shape's
      // payload before sweeping it for leaks. An absence swept over the wrong
      // response is a vacuous pass.
      expect(
        body.robustness?.confidence,
        'response must be derived from THIS shape\'s injected ISL payload',
      ).toBeCloseTo(shape.confidence, 6);

      const prose = collectProse(body.m1_coaching);
      // Positive control: the sweep can SEE prose at all (an empty sweep would
      // make every absence assertion below vacuous — trap 13).
      expect(prose.length).toBeGreaterThan(5);

      const leaks = figureLeaks(prose);
      expect(
        leaks.map((l) => `${l.path}: ${l.text}`),
        'a withheld quantity may not be published as prose',
      ).toEqual([]);
    }, 60_000);
  }

  // ─── OPPOSITE-DIRECTION TWIN ───
  // Removing the figure must not silence the robustness warning. The
  // QUALITATIVE claim must still fire when stability is genuinely low, and
  // must stay quiet when it is fine.
  it('TWIN: genuinely low stability STILL raises the qualitative robustness warning', async () => {
    currentIslPayload = captureWithStability(0.42, 0.42);
    const { body } = await runV2(app, buildPlotBody(liveRequest, '920001'));
    expect(body.robustness?.confidence).toBeCloseTo(0.42, 6);

    const signals = body.m1_coaching?.readiness_signals?.signals ?? [];
    const lowSignal = signals.find(
      (s: any) => s.dimension === 'robustness' && /low recommendation stability/i.test(s.signal),
    );
    expect(lowSignal, 'the low-stability warning must survive the figure removal').toBeDefined();
    expect(lowSignal.impact).toBe('negative');
    // ...and it must carry no figure.
    expect(STABILITY_FIGURE.test(lowSignal.signal)).toBe(false);
  }, 60_000);

  it('TWIN: healthy stability stays QUIET (no low warning) and still reads positively', async () => {
    currentIslPayload = captureWithStability(0.8541875, 0.8541875);
    const { body } = await runV2(app, buildPlotBody(liveRequest, '920002'));
    expect(body.robustness?.confidence).toBeCloseTo(0.8541875, 6);

    const signals = body.m1_coaching?.readiness_signals?.signals ?? [];
    const lowSignal = signals.find(
      (s: any) => s.dimension === 'robustness' && /low recommendation stability/i.test(s.signal),
    );
    expect(lowSignal, 'a healthy run must not raise a low-stability warning').toBeUndefined();

    const highSignal = signals.find(
      (s: any) => s.dimension === 'robustness' && /high recommendation stability/i.test(s.signal),
    );
    expect(highSignal, 'the positive robustness signal must survive').toBeDefined();
    expect(highSignal.impact).toBe('positive');
    expect(STABILITY_FIGURE.test(highSignal.signal)).toBe(false);
  }, 60_000);

  // The qualitative claim must remain NON-VACUOUS: the close-call sentence has
  // to still tell the user the ranking could move.
  it('TWIN: the close-call qualifier still tells the user the ranking could shift', async () => {
    currentIslPayload = captureWithStability(0.59025, 0.59025);
    const { body } = await runV2(app, buildPlotBody(liveRequest, '920003'));
    expect(body.robustness?.confidence).toBeCloseTo(0.59025, 6);

    const summaryProse = collectProse(body.m1_coaching?.executive_summary ?? {})
      .map((p) => p.text)
      .join(' ');
    expect(summaryProse.length).toBeGreaterThan(0);
    expect(summaryProse).toMatch(/could shift|within model uncertainty|provisional|caveats/i);
  }, 60_000);
});
