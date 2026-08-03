/**
 * SCIENTIFIC REGRESSION GATE — S5 · the VOI family reaches the wire in a shape a
 * consumer can actually READ (lane L45).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS ALREADY COVERED, AND WHAT THE HOLE WAS
 * ─────────────────────────────────────────────────────────────────────────────
 * Three existing pins between them cover a lot and NONE of them covers this:
 *
 *   · `tests/contract/voi-enrichment-typed.test.ts` — STRUCTURAL: every key in
 *     `ISL_TOPLEVEL_ENRICHMENT_KEYS` is a TYPED property of
 *     `AnalysisEnrichmentSchema`. It asks whether the contract types the keys.
 *     It never asks whether the BODY PLoT emits satisfies that typing.
 *   · `tests/contract/openapi-runtime-drift.test.ts` — the keys are DOCUMENTED
 *     as `runResponseV3` properties. Presence, explicitly not shape.
 *   · `tests/factor-correlation-forwarding.test.ts` — BEHAVIOURAL: present-in ⇒
 *     present-out, absent-in ⇒ absent-out, on the real route. Until this lane it
 *     did that against three HAND-INVENTED shapes, one of which the contract
 *     rejects outright, so it proved transport of a body that this repo's own
 *     egress guard — computing its verdict INSIDE the same response — marked
 *     `enrichment_contract_ok: false`. Measured at `3177fd3`; the test was green.
 *
 * So the chain had a pin for "the contract types it", a pin for "the doc
 * mentions it", and a pin for "the key survives the rebuild" — and no pin at all
 * for **is what we put on the wire a thing the next consumer can read**. This
 * gate is that pin. It matters now because the consumer is live: DGAI's
 * `src/components/results/voi/voiRanking.ts` renders the "Resolve next" view off
 * `enrichment.factor_evppi`, and it DROPS any row without a usable `status` —
 * so an unreadable row does not error, it silently collapses the ranking to its
 * honest gate, which looks exactly like "the science found nothing".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLAIM TYPES (each pin proves one thing, and no more)
 * ─────────────────────────────────────────────────────────────────────────────
 *  N1 CONFORMANCE   — the emitted body parses against the SHARED envelope, per
 *                     PLoT's own egress verdict. Paired with N1c, its positive
 *                     control (trap 13: an "it validates" assertion is vacuous
 *                     until it is shown to be capable of saying no).
 *  N2 MEASURED-ZERO — `decision_evpi: 0` from ISL arrives as exactly `0`, key
 *                     PRESENT. The contract's own `.describe()` names this seam:
 *                     absence means NOT COMPUTED, a measured 0 is a real result,
 *                     and the wire carries no discriminator beyond key presence.
 *  N3 ORDER         — `factor_evppi` rows arrive in PRODUCER order, asserted by
 *                     the `factor_id` SEQUENCE (identity), never by a magnitude
 *                     another row could satisfy.
 *  N4 READABILITY   — every emitted row satisfies the licensed consumer's row
 *                     contract, DERIVED from `EnrichmentFactorEvppiEntrySchema`
 *                     rather than re-listed here.
 *  N5 SUPPRESSION   — under active correlation `p_win_sensitivity` is absent AND
 *                     `correlation_model.suppressed_attributions` names it, so
 *                     absence is readable as a verdict rather than as silence.
 *  N6 COMPLETENESS  — every VOI key CEE keeps for the UI is a key PLoT forwards.
 *                     A UNION assertion between two importable lists, which is
 *                     the only kind of completeness check that is itself derived
 *                     (trap 12d: deriving a guard from a list moves the risk onto
 *                     the list; this one derives from the OTHER repo's list).
 *
 * NOT claimed here: that ISL's numbers are correct, that any row is above its
 * noise floor, or that anything renders. Rendering lives in DGAI.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AnalysisEnrichmentSchema,
  EnrichmentFactorEvppiEntrySchema,
  CEE_UI_ENRICHMENT_KEEP_LIST,
} from '@talchain/schemas/boundary';
import { ISL_TOPLEVEL_ENRICHMENT_KEYS } from '../../src/routes/v2/run-contract-keys.js';
import {
  VOI_TRANSPORT_ALL_FOUR,
  VOI_INDEPENDENT_RUN,
  VOI_CORRELATED_RUN,
  VOI_FACTOR_EVPPI,
  ISL_SUPPRESSED_ATTR_P_WIN_SENSITIVITY,
} from '../fixtures/voi-family-wire.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'isl-v2-live-20260707',
);
const captureA = JSON.parse(readFileSync(join(FIXTURE_DIR, 'isl-staging-capture.json'), 'utf8'));
const requestA = JSON.parse(readFileSync(join(FIXTURE_DIR, 'isl-v2-request.json'), 'utf8'));

/**
 * The VOI block the mocked ISL merges into its envelope for the next request.
 * `null` = emit no VOI keys at all.
 */
const mockState: { voi: Record<string, unknown> | null } = { voi: null };

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
  async analyseRobustness(): Promise<never> { throw new Error('not called'); },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: unknown | null; latency_ms: number }> {
    const payload = JSON.parse(JSON.stringify(captureA));
    if (mockState.voi) Object.assign(payload, JSON.parse(JSON.stringify(mockState.voi)));
    return { data: payload as T, error: null, latency_ms: 0 };
  },
};

vi.mock('../../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

import { createServer } from '../../src/createServer.js';

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
        from: e.from, to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: requestA.options.map((o: any) => ({
      id: o.id, label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId, { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: requestA.goal_node_id,
    seed: String(requestA.seed),
  };
}

describe('S5 gate · the VOI family reaches the wire in a READABLE shape', () => {
  let app: FastifyInstance;

  /** POST /v2/run with `voi` merged into the mocked ISL envelope. */
  async function run(voi: Record<string, unknown> | null): Promise<any> {
    mockState.voi = voi;
    const res = await app.inject({
      method: 'POST', url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(),
    });
    expect(res.statusCode, 'the run must succeed before any VOI claim is made').toBe(200);
    return JSON.parse(res.body);
  }

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    process.env.DECISION_REVIEW_ENABLE = '0';
    process.env.ENABLE_REVIEW_PASS = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    mockState.voi = null;
    await app.close();
  });

  // ── N1 · CONFORMANCE, with its positive control ───────────────────────────

  it('N1 the emitted VOI body parses against the SHARED enrichment envelope', async () => {
    const body = await run({ ...VOI_TRANSPORT_ALL_FOUR });
    const parsed = AnalysisEnrichmentSchema.safeParse(body);
    expect(
      parsed.success
        ? []
        : parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })),
      'the /v2/run body must satisfy the envelope CEE and the UI parse it against',
    ).toEqual([]);
  });

  it("N1b PLoT's own egress verdict on that body agrees: enrichment_contract_ok", async () => {
    const body = await run({ ...VOI_TRANSPORT_ALL_FOUR });
    expect(body?._meta?.evidence?.enrichment_contract_ok).toBe(true);
    expect(
      (body.inference_warnings ?? []).map((w: { code: string }) => w.code),
    ).not.toContain('ENRICHMENT_CONTRACT_MISMATCH');
  });

  it('N1c POSITIVE CONTROL — a wrong-typed decision_evpi IS caught (N1/N1b are not vacuous)', async () => {
    // The EXACT shape this gate's lane found in the repo's own passthrough
    // fixture: an object where the contract types a number.
    const body = await run({
      ...VOI_TRANSPORT_ALL_FOUR,
      decision_evpi: { value: 0.042, method: 'joint_samples', units: 'outcome' },
    });
    const parsed = AnalysisEnrichmentSchema.safeParse(body);
    expect(parsed.success, 'a wrong-typed decision_evpi must NOT parse clean').toBe(false);
    expect(body?._meta?.evidence?.enrichment_contract_ok).toBe(false);
    expect(
      (body.inference_warnings ?? []).map((w: { code: string }) => w.code),
    ).toContain('ENRICHMENT_CONTRACT_MISMATCH');
  });

  // ── N2 · MEASURED ZERO ≠ NOT COMPUTED ─────────────────────────────────────

  it('N2 an ISL decision_evpi of exactly 0 arrives as 0 with the key PRESENT', async () => {
    const body = await run({ ...VOI_INDEPENDENT_RUN, decision_evpi: 0 });
    expect(
      Object.prototype.hasOwnProperty.call(body, 'decision_evpi'),
      'a measured 0 must not be dropped — absence would mean NOT COMPUTED',
    ).toBe(true);
    expect(body.decision_evpi).toBe(0);
    expect(body.decision_evpi).not.toBeNull();
  });

  it('N2b an ISL decision_evpi that is ABSENT stays absent — never coerced to 0 or null', async () => {
    const { decision_evpi: _omitted, ...withoutDecisionEvpi } = VOI_INDEPENDENT_RUN;
    const body = await run({ ...withoutDecisionEvpi });
    expect(
      Object.prototype.hasOwnProperty.call(body, 'decision_evpi'),
      'NOT COMPUTED must reach the consumer as key-absent, never as 0',
    ).toBe(false);
  });

  // ── N3 · PRODUCER RANK ORDER IS THE CONTRACT ──────────────────────────────

  it('N3 factor_evppi arrives in PRODUCER order, asserted by factor_id sequence', async () => {
    const body = await run({ ...VOI_INDEPENDENT_RUN });
    const producerOrder = VOI_FACTOR_EVPPI.map((r) => r.factor_id);
    // Identity binding: the SEQUENCE of ids, not a magnitude another row could
    // satisfy. `toEqual` on the array pins position, so a reversal or a
    // re-sort REDs even when every row survives.
    expect(body.factor_evppi.map((r: { factor_id: string }) => r.factor_id)).toEqual(producerOrder);
    expect(producerOrder.length, 'the order claim needs >1 row to be falsifiable').toBeGreaterThan(1);
  });

  // ── N4 · READABLE BY THE LICENSED CONSUMER ────────────────────────────────

  /**
   * The consumer's row contract, DERIVED from the pinned schema exactly as
   * DGAI's `voiRanking.ts` derives it (`EnrichmentFactorEvppiEntrySchema.pick`),
   * plus the same three consumer tightenings that reader applies. Re-listing the
   * field names here would be a second definition of a contract whose whole
   * point is that there is one.
   */
  const ConsumerRowSchema = EnrichmentFactorEvppiEntrySchema.pick({
    factor_id: true, evppi: true, status: true,
  });
  const RENDERABLE_STATUSES = ['resolved', 'below_resolution'];

  it('N4 every emitted factor_evppi row is one the licensed consumer can render', async () => {
    const body = await run({ ...VOI_INDEPENDENT_RUN });
    const unreadable: Array<{ factor_id: unknown; why: string }> = [];
    for (const raw of body.factor_evppi as unknown[]) {
      const parsed = ConsumerRowSchema.safeParse(raw);
      const id = (raw as { factor_id?: unknown })?.factor_id;
      if (!parsed.success) { unreadable.push({ factor_id: id, why: 'schema' }); continue; }
      if (!(parsed.data.factor_id.length > 0)) { unreadable.push({ factor_id: id, why: 'empty id' }); continue; }
      if (!Number.isFinite(parsed.data.evppi)) { unreadable.push({ factor_id: id, why: 'evppi not finite' }); continue; }
      if (parsed.data.status === undefined || !RENDERABLE_STATUSES.includes(parsed.data.status)) {
        unreadable.push({ factor_id: id, why: `status ${String(parsed.data.status)}` });
      }
    }
    expect(
      unreadable,
      'a row the consumer drops does not error — it silently shrinks the ranking',
    ).toEqual([]);
  });

  it('N4b both renderable bands are exercised, so N4 cannot pass on one band alone', async () => {
    const body = await run({ ...VOI_INDEPENDENT_RUN });
    const statuses = new Set((body.factor_evppi as Array<{ status: string }>).map((r) => r.status));
    expect([...statuses].sort()).toEqual(['below_resolution', 'resolved']);
  });

  // ── N5 · SUPPRESSION IS A VERDICT, NOT SILENCE ────────────────────────────

  it('N5 under active correlation p_win_sensitivity is absent AND named as suppressed', async () => {
    const body = await run({ ...VOI_CORRELATED_RUN });
    expect(
      Object.prototype.hasOwnProperty.call(body, 'p_win_sensitivity'),
      'ISL suppresses this array under active correlation',
    ).toBe(false);
    // The discriminator that makes the absence readable. Without it, "suppressed"
    // and "never computed" are the same bytes.
    expect(body.correlation_model?.suppressed_attributions)
      .toContain(ISL_SUPPRESSED_ATTR_P_WIN_SENSITIVITY);
    // factor_evppi stays EMITTED under correlation — it is honest there.
    expect(Array.isArray(body.factor_evppi)).toBe(true);
    expect(body.factor_evppi.length).toBeGreaterThan(0);
  });

  // ── N6 · UNION COMPLETENESS ACROSS THE TWO IMPORTABLE LISTS ───────────────

  it('N6 every VOI key CEE keeps for the UI is a key PLoT forwards', () => {
    const forwarded = new Set<string>(ISL_TOPLEVEL_ENRICHMENT_KEYS);
    const voiKeepListMembers = (CEE_UI_ENRICHMENT_KEEP_LIST as readonly string[]).filter((k) =>
      ['correlation_model', 'decision_evpi', 'factor_evppi', 'p_win_sensitivity'].includes(k),
    );
    // The corpus half of trap 12d: this literal is what notices the LIST is
    // short. The derived half is the subset check below.
    expect(voiKeepListMembers.sort()).toEqual(
      ['correlation_model', 'decision_evpi', 'factor_evppi', 'p_win_sensitivity'],
    );
    const keptButNotForwarded = voiKeepListMembers.filter((k) => !forwarded.has(k));
    expect(
      keptButNotForwarded,
      'CEE would transport a key PLoT no longer sends — the consumer sees silence, not an error',
    ).toEqual([]);
  });
});
