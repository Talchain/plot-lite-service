/**
 * Doctrine 013 — producer-owned fragile-edge `visible` gate.
 *
 * PLoT takes over the UI's `THRESHOLDS.FRAGILE_EDGE_FILTER` cut-point: it
 * DISCLOSES a per-edge `visible` boolean over the same `switch_probability`
 * scalar, ratified from the UI (switch_probability > 0.15). The producer emits
 * the FLAG — it does NOT filter the array (the UI decides render). The pure
 * helper `deriveFragileEdgeVisible` OMITS the field on absent/non-finite input
 * (unit tests below). Threshold is DOCTRINE-PENDING (Neil), one const.
 *
 * CLOSED SEAM — the absent-omitting behaviour is now end-to-end. The upstream
 * adapter (robustness-analysis.ts, `normalizeFragileEdge` + the legacy-string
 * branch) no longer defaults `switch_probability ?? 0`, so on the /v2/run wire
 * an sp-less fragile edge emits NEITHER `switch_probability`, NOR `visible`, NOR
 * `severity` — honest omission, not a fabricated 0/false/'warning'. Pinned by
 * the "SOURCE FIX (closed seam)" route describe below; unreachable on current
 * ISL output (fragile edges always carry sp) ⇒ zero golden delta.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveFragileEdgeVisible,
  FRAGILE_EDGE_VISIBLE_MIN,
} from '../src/trust/edge-severity.js';

// ---------------------------------------------------------------------------
// Unit — pure helper
// ---------------------------------------------------------------------------

describe('deriveFragileEdgeVisible — ratified fragile-edge visibility cut-point', () => {
  it('switch_probability 0.2 → visible:true', () => {
    expect(deriveFragileEdgeVisible(0.2)).toBe(true);
  });
  it('switch_probability 0.1 → visible:false', () => {
    expect(deriveFragileEdgeVisible(0.1)).toBe(false);
  });
  it('absent / non-finite switch_probability → undefined (field omitted)', () => {
    expect(deriveFragileEdgeVisible(undefined)).toBeUndefined();
    expect(deriveFragileEdgeVisible(null)).toBeUndefined();
    expect(deriveFragileEdgeVisible(NaN)).toBeUndefined();
    expect(deriveFragileEdgeVisible(Infinity)).toBeUndefined();
  });

  // Strict `>` at the boundary (matches the UI's THRESHOLDS.FRAGILE_EDGE_FILTER).
  it('boundary: exactly 0.15 → false (strict >, not >=)', () => {
    expect(deriveFragileEdgeVisible(FRAGILE_EDGE_VISIBLE_MIN)).toBe(false);
  });
  it('boundary: just above 0.15 → true', () => {
    expect(deriveFragileEdgeVisible(0.151)).toBe(true);
  });
  it('zero → false', () => {
    expect(deriveFragileEdgeVisible(0)).toBe(false);
  });

  it('the ratified const is the UI cut-point (0.15)', () => {
    expect(FRAGILE_EDGE_VISIBLE_MIN).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------
// Route — the flag lands on the /v2/run wire (live 07-07 capture, mocked ISL)
// ---------------------------------------------------------------------------

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260707',
);
const baseCapture = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-v2-request.json'), 'utf8'),
);

// Mutable capture holder so a describe can swap in a modified capture before the
// server is spun up. `vi.hoisted` makes it available to the hoisted vi.mock
// factory without a TDZ trap. (Mirrors doctrine-014-evidence-hint.test.ts.)
const holder = vi.hoisted(() => ({ capture: null as any }));

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
    return { data: JSON.parse(JSON.stringify(holder.capture)) as T, error: null };
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

/** POST the fixture at /v2/run against the current `holder.capture` and return the wire fragile_edges. */
async function runFragileEdges(): Promise<any[]> {
  process.env.RATE_LIMIT_ENABLED = '0';
  process.env.CEE_ORCHESTRATOR_ENABLED = '0';
  process.env.DECISION_REVIEW_ENABLE = '0';
  process.env.ENABLE_REVIEW_PASS = '0';
  const app: FastifyInstance = await createServer();
  await app.ready();
  const res = await app.inject({
    method: 'POST', url: '/v2/run',
    headers: { 'Content-Type': 'application/json' },
    payload: buildPlotBody(),
  });
  expect(res.statusCode).toBe(200);
  const edges = JSON.parse(res.body).robustness?.fragile_edges ?? [];
  await app.close();
  return edges;
}

describe('013 route: visible gate lands on /v2/run robustness.fragile_edges', () => {
  let edges: any[];

  beforeAll(async () => {
    holder.capture = JSON.parse(JSON.stringify(baseCapture));
    edges = await runFragileEdges();
  }, 120_000);

  it('emits at least one fragile edge with a visible flag', () => {
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.visible !== undefined)).toBe(true);
  });

  it('every edge carrying switch_probability gets the threshold-correct visible flag', () => {
    // REACHABLE behaviour only. On the current wire every fragile edge carries a
    // finite switch_probability (the upstream adapter defaults `?? 0`), so this
    // asserts the emitted flag equals the ratified threshold decision for that
    // sp. It does NOT — and cannot — prove the absent⇒omitted contract
    // end-to-end: both sides derive from the SAME already-defaulted wire sp, so
    // this is a threshold-correctness check, not an absence check. The helper's
    // omit-on-absent is pinned by the unit tests above; what the wire actually
    // does with an sp-less edge is pinned by the KNOWN SEAM describe below.
    for (const e of edges) {
      expect(Number.isFinite(e.switch_probability)).toBe(true);
      expect(e.visible).toBe(e.switch_probability > FRAGILE_EDGE_VISIBLE_MIN);
    }
  });

  it('producer does NOT filter the array — both visible:true and visible:false edges are present', () => {
    // The live 07-07 capture carries switch_probabilities on both sides of 0.15,
    // so the disclosed-but-unfiltered contract is observable on the wire.
    expect(edges.some((e) => e.visible === true)).toBe(true);
    expect(edges.some((e) => e.visible === false)).toBe(true);
  });
});

describe('013 SOURCE FIX (closed seam): an sp-less fragile edge OMITS switch_probability, visible AND severity', () => {
  // CLOSED SEAM: the upstream normalizer no longer defaults switch_probability
  // `?? 0` (robustness-analysis.ts, `normalizeFragileEdge` + the legacy-string
  // branch). An ISL fragile edge that OMITS switch_probability now reaches the
  // /v2/run wire with switch_probability, `visible` AND `severity` ALL omitted —
  // honest absence, not a fabricated 0 / false / 'warning'. This end-to-end pin
  // was previously the "KNOWN SEAM (rowed)" describe that asserted the
  // fabrication (visible:false, sp:0); the source `?? 0` kill closes it.
  //
  // Unreachable on current ISL output (fragile edges always carry sp) ⇒ ZERO
  // golden delta; this feeds the route an sp-less ISL edge to prove the honest
  // absent⇒omitted contract holds end-to-end.
  const SP_LESS_EDGE_ID = 'fac_dev_headcount->goal_productivity';
  let edges: any[];
  let spLess: any;

  beforeAll(async () => {
    const modified = JSON.parse(JSON.stringify(baseCapture));
    // Inject a fragile edge whose ISL payload OMITS switch_probability entirely.
    // Real node ids (present in the request graph) so label lookup is unremarkable;
    // appended (index 7) so the unmodified describe above is unaffected.
    modified.robustness.fragile_edges.push({
      edge_id: SP_LESS_EDGE_ID,
      from_id: 'fac_dev_headcount',
      to_id: 'goal_productivity',
      // NO switch_probability — models an ISL fragile edge that omits the scalar.
    });
    holder.capture = modified;
    edges = await runFragileEdges();
    spLess = edges.find((e) => e.edge_id === SP_LESS_EDGE_ID);
  }, 120_000);

  it('the sp-less edge reaches the wire (producer does not drop it)', () => {
    expect(spLess).toBeDefined();
  });

  it('switch_probability is OMITTED (no `?? 0` fabrication)', () => {
    expect(spLess.switch_probability).toBeUndefined();
  });

  it('visible is OMITTED (honest absence, not a fabricated false)', () => {
    expect(spLess.visible).toBeUndefined();
  });

  it('severity is OMITTED (honest absence, not a fabricated warning)', () => {
    expect(spLess.severity).toBeUndefined();
  });
});
