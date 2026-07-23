/**
 * Doctrine 014 — producer-owned `evidence_hint` ("gather evidence" gate).
 *
 * PLoT takes over the UI's VOI hint cut-point, gating on the REAL per-factor
 * counterfactual EVPI where present and falling back to the heuristic VOI:
 *   real evpi_percentage_points (evpi_method 'counterfactual') present
 *       → evidence_hint = evpi_percentage_points >= EVPI_HINT_MIN_PP (0.5pp)
 *   else value_of_information present
 *       → evidence_hint = value_of_information > VOI_HINT_MIN (0.05)
 *   else → NO field (no basis; honesty).
 * Both thresholds DOCTRINE-PENDING (Neil), one const each. Levers are skipped
 * (option-controlled, not evidence-gap candidates).
 *
 * EVPI_HINT_MIN_PP = 0.5pp is a PROVISIONAL, WEAKLY-grounded placeholder (see
 * acceptance-evidence/.../doctrine-emits/NOTES.md §014 and the const's docstring
 * in src/lib/evpi-emission.ts) — the available staging captures are near-
 * duplicate re-captures and the observed EVPI sits at/below ISL's own ~6pp
 * counterfactual noise floor, so this gate is near-inert on current builds. Do
 * NOT cite a firm bimodal 0.85-7.8pp band as grounding; the REAL threshold is
 * DOCTRINE-PENDING (Neil). These route tests exercise the WIRING (the gate is
 * consulted and lands on the wire), not the calibration of the const.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  deriveEvidenceHint,
  EVPI_HINT_MIN_PP,
  VOI_HINT_MIN,
} from '../src/lib/evpi-emission.js';

// ---------------------------------------------------------------------------
// Unit — pure helper (the ratified gate)
// ---------------------------------------------------------------------------

describe('deriveEvidenceHint — real-EVPI gate with VOI fallback', () => {
  it('real EVPI 2.0pp (>= threshold) → hint:true', () => {
    expect(deriveEvidenceHint({ realEvpiPp: 2.0 })).toBe(true);
  });
  it('real EVPI 0.1pp (< threshold) → hint:false', () => {
    expect(deriveEvidenceHint({ realEvpiPp: 0.1 })).toBe(false);
  });
  it('no real EVPI + VOI 0.08 (> 0.05) → hint:true (fallback fires)', () => {
    expect(deriveEvidenceHint({ voi: 0.08 })).toBe(true);
  });
  it('no real EVPI + VOI 0.02 (<= 0.05) → hint:false', () => {
    expect(deriveEvidenceHint({ voi: 0.02 })).toBe(false);
  });

  it('real EVPI takes precedence over VOI (real present ⇒ VOI ignored)', () => {
    // real EVPI below threshold wins even when VOI would say true.
    expect(deriveEvidenceHint({ realEvpiPp: 0.1, voi: 0.9 })).toBe(false);
    // real EVPI above threshold wins even when VOI would say false.
    expect(deriveEvidenceHint({ realEvpiPp: 2.0, voi: 0.0 })).toBe(true);
  });

  it('no basis (both absent/non-finite) → undefined (field omitted)', () => {
    expect(deriveEvidenceHint({})).toBeUndefined();
    expect(deriveEvidenceHint({ realEvpiPp: NaN, voi: NaN })).toBeUndefined();
    expect(deriveEvidenceHint({ realEvpiPp: Infinity })).toBeUndefined();
    expect(deriveEvidenceHint({ realEvpiPp: null, voi: null })).toBeUndefined();
  });

  it('boundary: real EVPI exactly 0.5pp → true (>=)', () => {
    expect(deriveEvidenceHint({ realEvpiPp: EVPI_HINT_MIN_PP })).toBe(true);
  });
  it('boundary: VOI exactly 0.05 → false (strict >)', () => {
    expect(deriveEvidenceHint({ voi: VOI_HINT_MIN })).toBe(false);
  });

  it('the ratified consts: EVPI_HINT_MIN_PP=0.5pp, VOI_HINT_MIN=0.05', () => {
    expect(EVPI_HINT_MIN_PP).toBe(0.5);
    expect(VOI_HINT_MIN).toBe(0.05);
  });
});

// ---------------------------------------------------------------------------
// Route — the gate lands on the /v2/run wire (live 07-07 capture, mocked ISL)
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
// factory without a TDZ trap.
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

async function runOnce(): Promise<any[]> {
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
  const factors = JSON.parse(res.body).factor_sensitivity ?? [];
  await app.close();
  return factors;
}

/** Recompute the ratified gate from a factor's FINAL emitted fields. */
function gateFor(f: any): boolean | undefined {
  const realEvpiPp = f.evpi_method === 'counterfactual' ? f.evpi_percentage_points : undefined;
  return deriveEvidenceHint({ realEvpiPp, voi: f.value_of_information });
}

describe('014 route: evidence_hint on unmodified live capture (below-resolution + levers)', () => {
  let factors: any[];
  beforeAll(async () => {
    holder.capture = JSON.parse(JSON.stringify(baseCapture));
    factors = await runOnce();
  }, 120_000);

  it('emits at least one factor with an evidence_hint', () => {
    expect(factors.length).toBeGreaterThan(0);
    expect(factors.some((f) => f.evidence_hint !== undefined)).toBe(true);
  });

  it('every emitted evidence_hint matches the recomputed gate', () => {
    for (const f of factors) {
      if (f.evidence_hint !== undefined) {
        expect(f.evidence_hint).toBe(gateFor(f));
      }
    }
  });

  it('levers (intervention_override) get NO evidence_hint (skipped)', () => {
    const levers = factors.filter((f) => f.zero_reason === 'intervention_override');
    expect(levers.length).toBeGreaterThan(0); // fixture has option-controlled levers
    for (const f of levers) {
      expect(f.evidence_hint).toBeUndefined();
    }
  });

  it('non-lever factors with a basis (finite VOI or counterfactual EVPI) get a hint', () => {
    for (const f of factors) {
      if (f.zero_reason === 'intervention_override') continue;
      const hasBasis = gateFor(f) !== undefined;
      if (hasBasis) expect(f.evidence_hint).toBeDefined();
    }
  });
});

describe('014 route: the removed `factor_evpi` no longer drives a counterfactual evidence_hint (F3 / ISL #103 / D-23.15)', () => {
  let hiringCost: any;
  beforeAll(async () => {
    // Inject a MATERIAL `factor_evpi` (the removed win-probability EVPI name) on
    // a non-lever factor. Pre-F3 this drove evpi_method:'counterfactual' and an
    // evidence_hint off the real per-factor EVPI. Post-F3 the name is IGNORED —
    // this proves the old-name path is dead and the gate falls back to VOI only.
    const modified = JSON.parse(JSON.stringify(baseCapture));
    const fe = (modified.factor_evpi ?? []).find((e: any) => e.factor_id === 'fac_hiring_cost');
    fe.evpi = 0.02;
    fe.evpi_percentage_points = 2.0; // pre-F3 this cleared EVPI_HINT_MIN_PP as counterfactual
    delete fe.evpi_status;
    holder.capture = modified;
    const factors = await runOnce();
    hiringCost = factors.find((f: any) => f.factor_id === 'fac_hiring_cost');
  }, 120_000);

  it('the injected factor_evpi is IGNORED — fac_hiring_cost is not counterfactual and carries no evpi_status', () => {
    expect(hiringCost).toBeDefined();
    expect(hiringCost.evpi_method).not.toBe('counterfactual');
    expect(hiringCost).not.toHaveProperty('evpi_status');
  });

  it('evidence_hint now derives from the heuristic VOI only (the ignored injected EVPI never drives it)', () => {
    // With the counterfactual basis withheld, gateFor collapses to the VOI gate;
    // whatever evidence_hint the wire carries must equal that VOI recomputation,
    // NOT anything derived from the ignored injected factor_evpi (2.0pp).
    if (hiringCost.evidence_hint !== undefined) {
      expect(hiringCost.evidence_hint).toBe(gateFor(hiringCost));
      expect(hiringCost.evidence_hint).toBe(
        deriveEvidenceHint({ voi: hiringCost.value_of_information }),
      );
    }
  });
});
