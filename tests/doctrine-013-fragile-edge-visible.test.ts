/**
 * Doctrine 013 — producer-owned fragile-edge `visible` gate.
 *
 * PLoT takes over the UI's `THRESHOLDS.FRAGILE_EDGE_FILTER` cut-point: it
 * DISCLOSES a per-edge `visible` boolean over the same `switch_probability`
 * scalar, ratified from the UI (switch_probability > 0.15). The producer emits
 * the FLAG — it does NOT filter the array (the UI decides render). Absent/
 * non-finite switch_probability ⇒ NO `visible` field (honesty). Threshold is
 * DOCTRINE-PENDING (Neil), one const.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

describe('013 route: visible gate lands on /v2/run robustness.fragile_edges', () => {
  let app: FastifyInstance;
  let edges: any[];

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
    edges = JSON.parse(res.body).robustness?.fragile_edges ?? [];
  }, 120_000);

  afterAll(async () => { await app?.close(); });

  it('emits at least one fragile edge with a visible flag', () => {
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.some((e) => e.visible !== undefined)).toBe(true);
  });

  it('every visible flag matches deriveFragileEdgeVisible(switch_probability)', () => {
    for (const e of edges) {
      const expected = deriveFragileEdgeVisible(e.switch_probability);
      if (expected === undefined) {
        expect(e.visible).toBeUndefined();
      } else {
        expect(e.visible).toBe(expected);
      }
    }
  });

  it('producer does NOT filter the array — both visible:true and visible:false edges are present', () => {
    // The live 07-07 capture carries switch_probabilities on both sides of 0.15,
    // so the disclosed-but-unfiltered contract is observable on the wire.
    expect(edges.some((e) => e.visible === true)).toBe(true);
    expect(edges.some((e) => e.visible === false)).toBe(true);
  });
});
