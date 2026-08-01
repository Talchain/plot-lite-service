/**
 * ROADMAP 2.260 step 3 — the cost estimator's view of the request must match the
 * request PLoT actually sends.
 *
 * `/v2/run` builds a `DepthPlanInput` (`routes/v2/run.ts`) whose phase flags are
 * HARD-CODED `true`, mirroring unconditional literals inside
 * `toISLRobustnessRequest`. That mirror is invisible: nothing connects the two
 * files, and TypeScript cannot see the relationship at all.
 *
 * It is also load-bearing in BOTH directions, and the two failure modes are
 * opposite and both bad:
 *
 *  - the planner assumes a phase is ON that the translator stopped sending →
 *    PLoT OVER-prices, reduces depth it did not need to, and silently degrades
 *    every analysis (this lane's own defect class);
 *  - the translator starts sending a phase the planner does not price → PLoT
 *    UNDER-prices, confidently plans a depth ISL refuses, and the user gets a
 *    raw 422 instead of a structured blocker.
 *
 * The second is exactly how v5 arrived: `include_factor_flips: true` was added
 * to the translator (ROADMAP 2.228-F3) while the estimator priced no flips term
 * at all. So this is not a hypothetical mirror — it has already drifted once.
 *
 * These tests DERIVE the flags from a real translated request and assert them
 * against what the planner assumes, so the next divergence REDs here.
 */

import { describe, it, expect } from 'vitest';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

function graph(): EngineGraphV3 {
  return {
    nodes: [
      { id: 'a', label: 'A', kind: 'factor', observed_state: { value: 1, baseline: 1 } },
      { id: 'goal', label: 'Goal', kind: 'outcome', observed_state: { value: 0 } },
    ],
    edges: [
      {
        id: 'e1',
        source: 'a',
        target: 'goal',
        edge_type: 'causal',
        exists_probability: 1,
        strength: { mean: 0.5, std: 0.1 },
      },
    ],
  } as unknown as EngineGraphV3;
}

const options: OptionV3[] = [
  { id: 'o1', label: 'One', interventions: { a: { value: 1 } } },
  { id: 'o2', label: 'Two', interventions: { a: { value: 2 } } },
] as unknown as OptionV3[];

function translated(includePathDecomposition?: boolean) {
  return toISLRobustnessRequest(
    graph(),
    options,
    'goal',
    'req-2260',
    undefined,
    undefined,
    undefined,
    undefined,
    includePathDecomposition,
  );
}

describe('the ISL request shape the cost estimator is priced against', () => {
  it('include_voi is sent UNCONDITIONALLY — planSampleDepth prices EVPI + full-population EVPPI on that basis', () => {
    expect(translated().include_voi).toBe(true);
  });

  it("analysis_types always contains 'sensitivity' — the planner prices the edge sweep and the influence walk pool", () => {
    expect(translated().analysis_types).toContain('sensitivity');
  });

  it('include_e_values is sent UNCONDITIONALLY — the planner prices e-values AND the bands that ride on them', () => {
    expect(translated().include_e_values).toBe(true);
  });

  it('include_factor_flips is sent UNCONDITIONALLY — the term v2 never priced, and the reason v5 exists', () => {
    // ROADMAP 2.228-F3 made this unconditional. Between then and this PR, PLoT
    // sent it on every call and priced it at zero.
    expect(translated().include_factor_flips).toBe(true);
  });

  it('include_path_decomposition is REQUEST-GATED — the key is omitted unless asked for', () => {
    expect(translated()).not.toHaveProperty('include_path_decomposition');
    expect(translated(true).include_path_decomposition).toBe(true);
  });

  it('THE ZERO THAT MUST STAY ZERO: PLoT sends NO control_candidates, so the EVPC term is not in play', () => {
    // `/v2/run` passes `controlGridPoints: 0` to the planner. That is only sound
    // while the translator sends no control grid. If this ever REDs, wire the
    // real grid size into `depthPlanInput` in routes/v2/run.ts BEFORE shipping —
    // an unpriced EVPC grid is `evpc_coef · S · W · gridPoints` of cost PLoT
    // cannot see, and ISL's own comment calls it "the dominant free-ride the v2
    // formula admitted".
    const req = translated() as unknown as Record<string, unknown>;
    expect(req).not.toHaveProperty('control_candidates');
  });

  it('POSITIVE CONTROL: the translated request is real, not an empty object', () => {
    // Without this, every assertion above could pass by inspecting nothing.
    const req = translated();
    expect(req.request_id).toBe('req-2260');
    expect(req.graph.nodes.length).toBeGreaterThan(0);
    expect(req.options.length).toBe(2);
    expect(req.analysis_types.length).toBeGreaterThan(0);
  });
});
