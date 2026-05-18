/**
 * Tests for user-supplied factor uncertainty propagation into ISL
 * `parameter_uncertainties`.
 *
 * Fixes the silent-widening bug: prior to this change, `observed_state.std`
 * values below 0.1 were floored to 0.1 by `Math.max(0.1, std)` applied after
 * Priority 1. User-supplied small stds (e.g. 0.001, 0.003) were therefore
 * never reaching ISL.
 *
 * Covers:
 *   - V3 translator: `buildParameterUncertaintiesV3`
 *   - V2 preflight: `buildParameterUncertainties`
 *   - Numerical safety bounds (MIN_USER_STD, MAX_USER_STD)
 *   - Synthesised defaults preserved
 *   - Boundary contract (graph in → ISL request out)
 */

import { describe, it, expect } from 'vitest';
import {
  buildParameterUncertaintiesV3,
  toISLRobustnessRequest,
} from '../src/integrations/isl/translator-v3.js';
import { buildParameterUncertainties } from '../src/integrations/isl/preflight.js';
import {
  MIN_USER_STD,
  MAX_USER_STD,
  DEFAULT_STD_FLOOR,
  BINARY_DEFAULT_STD,
  FALLBACK_STD,
} from '../src/integrations/isl/parameter-uncertainty-bounds.js';
import type { EngineGraphV3, EngineNodeV3, OptionV3 } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// V3 translator: buildParameterUncertaintiesV3
// ---------------------------------------------------------------------------

describe('buildParameterUncertaintiesV3 — user-supplied std propagation', () => {
  function factor(id: string, value: number, std?: number): EngineNodeV3 {
    return {
      id,
      kind: 'factor',
      label: id,
      observed_state: std === undefined ? { value } : { value, std },
    };
  }

  describe('user-supplied std is honoured (no silent widening)', () => {
    it('observed_state.std = 0.001 → outbound std = 0.001', () => {
      const result = buildParameterUncertaintiesV3([factor('fac_task_coverage', 0.6, 0.001)])!;
      expect(result).toHaveLength(1);
      expect(result[0].std).toBe(0.001);
    });

    it('observed_state.std = 0.003 → outbound std = 0.003', () => {
      const result = buildParameterUncertaintiesV3([factor('fac_team_structure', 0.4, 0.003)])!;
      expect(result).toHaveLength(1);
      expect(result[0].std).toBe(0.003);
    });

    it('observed_state.std = 0.05 → outbound std = 0.05 (sub-floor value preserved)', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0.5, 0.05)])!;
      expect(result[0].std).toBe(0.05);
    });

    it('observed_state.std = 0.1 → outbound std = 0.1', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0.5, 0.1)])!;
      expect(result[0].std).toBe(0.1);
    });

    it('observed_state.std = 0.5 → outbound std = 0.5', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0.5, 0.5)])!;
      expect(result[0].std).toBe(0.5);
    });

    it('observed_state.std = 1.5 → outbound std = 1.5 (existing behaviour preserved)', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 50, 1.5)])!;
      expect(result[0].std).toBe(1.5);
    });
  });

  describe('numerical safety bounds clamp extreme user values', () => {
    it('very small user std (1e-8) is clamped up to MIN_USER_STD (1e-4)', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0.5, 1e-8)])!;
      expect(result[0].std).toBe(MIN_USER_STD);
      expect(result[0].std).toBe(1e-4);
    });

    it('user std above MAX_USER_STD (3.0) is capped at 2.0', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 50, 3.0)])!;
      expect(result[0].std).toBe(MAX_USER_STD);
      expect(result[0].std).toBe(2.0);
    });

    it('user std = MAX_USER_STD passes through unchanged', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 50, 2.0)])!;
      expect(result[0].std).toBe(2.0);
    });

    // Exact MIN_USER_STD boundary trio — pins the clamp inflection point.
    it('user std = MIN_USER_STD (1e-4) passes through unchanged', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0.5, 1e-4)])!;
      expect(result[0].std).toBe(1e-4);
    });

    it('user std = 0.99e-4 (just below MIN) is clamped up to 1e-4', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0.5, 0.99e-4)])!;
      expect(result[0].std).toBe(MIN_USER_STD);
      expect(result[0].std).toBe(1e-4);
    });

    it('user std = 1.01e-4 (just above MIN) passes through unchanged', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0.5, 1.01e-4)])!;
      expect(result[0].std).toBe(1.01e-4);
    });
  });

  describe('invalid / missing user std falls through to default synthesis', () => {
    it('missing std with non-zero value uses value-based default (floored)', () => {
      // value = 0.5 → 0.5 × 0.15 = 0.075 → floored to 0.1
      const result = buildParameterUncertaintiesV3([factor('f', 0.5)])!;
      expect(result[0].std).toBe(DEFAULT_STD_FLOOR);
    });

    it('missing std with non-zero value above floor uses unfloored value-based default', () => {
      // value = 10 → 10 × 0.15 = 1.5 (above floor)
      const result = buildParameterUncertaintiesV3([factor('f', 10)])!;
      expect(result[0].std).toBeCloseTo(1.5, 10);
    });

    it('missing std with value = 0 uses FALLBACK_STD = 0.5', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0)])!;
      expect(result[0].std).toBe(FALLBACK_STD);
    });

    it('std = 0 is treated as missing (falls through to defaults)', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 0.5, 0)])!;
      // value = 0.5 → 0.5 × 0.15 = 0.075 → floored to 0.1
      expect(result[0].std).toBe(DEFAULT_STD_FLOOR);
    });

    it('negative std is treated as missing (falls through to defaults)', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 10, -0.1)])!;
      expect(result[0].std).toBeCloseTo(1.5, 10);
    });

    it('NaN std is treated as missing (falls through to defaults)', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 10, NaN)])!;
      expect(result[0].std).toBeCloseTo(1.5, 10);
    });

    it('Infinity std is treated as missing (falls through to defaults)', () => {
      const result = buildParameterUncertaintiesV3([factor('f', 10, Infinity)])!;
      expect(result[0].std).toBeCloseTo(1.5, 10);
    });
  });

  describe('binary factor defaults preserved', () => {
    it('binary factor (range [0,1]) without user std → BINARY_DEFAULT_STD = 0.3', () => {
      const node: EngineNodeV3 = {
        id: 'bin',
        kind: 'factor',
        label: 'Binary',
        observed_state: { value: 1 },
        state_space: { range: { min: 0, max: 1 } },
      };
      const result = buildParameterUncertaintiesV3([node])!;
      expect(result[0].std).toBe(BINARY_DEFAULT_STD);
    });

    it('binary factor WITH user std = 0.05 → user value honoured (overrides binary default)', () => {
      const node: EngineNodeV3 = {
        id: 'bin',
        kind: 'factor',
        label: 'Binary',
        observed_state: { value: 1, std: 0.05 },
        state_space: { range: { min: 0, max: 1 } },
      };
      const result = buildParameterUncertaintiesV3([node])!;
      expect(result[0].std).toBe(0.05);
    });
  });
});

// ---------------------------------------------------------------------------
// V2 preflight: buildParameterUncertainties (must mirror translator)
// ---------------------------------------------------------------------------

describe('buildParameterUncertainties (preflight) — mirrors V3 translator', () => {
  function buildGraph(value: number, std?: number) {
    return {
      nodes: [
        {
          id: 'f1',
          kind: 'factor' as const,
          label: 'F1',
          observed_state: std === undefined ? { value } : { value, std },
        },
        { id: 'goal', kind: 'goal' as const, label: 'Goal' },
      ],
      edges: [{ from: 'f1', to: 'goal' }],
    };
  }

  it('observed_state.std = 0.001 → outbound std = 0.001', () => {
    const result = buildParameterUncertainties(buildGraph(0.6, 0.001));
    expect(result[0].std).toBe(0.001);
  });

  it('observed_state.std = 0.003 → outbound std = 0.003', () => {
    const result = buildParameterUncertainties(buildGraph(0.4, 0.003));
    expect(result[0].std).toBe(0.003);
  });

  it('observed_state.std = 0.5 → outbound std = 0.5', () => {
    const result = buildParameterUncertainties(buildGraph(0.5, 0.5));
    expect(result[0].std).toBe(0.5);
  });

  it('very small std (1e-8) → clamped to MIN_USER_STD = 1e-4', () => {
    const result = buildParameterUncertainties(buildGraph(0.5, 1e-8));
    expect(result[0].std).toBe(MIN_USER_STD);
  });

  it('std above MAX_USER_STD (3.0) → capped at 2.0', () => {
    const result = buildParameterUncertainties(buildGraph(50, 3.0));
    expect(result[0].std).toBe(MAX_USER_STD);
  });

  // Exact MIN_USER_STD boundary trio (mirrors translator block above).
  it('std = MIN_USER_STD (1e-4) → unchanged', () => {
    const result = buildParameterUncertainties(buildGraph(0.5, 1e-4));
    expect(result[0].std).toBe(1e-4);
  });

  it('std = 0.99e-4 → clamped up to MIN_USER_STD', () => {
    const result = buildParameterUncertainties(buildGraph(0.5, 0.99e-4));
    expect(result[0].std).toBe(MIN_USER_STD);
  });

  it('std = 1.01e-4 → unchanged', () => {
    const result = buildParameterUncertainties(buildGraph(0.5, 1.01e-4));
    expect(result[0].std).toBe(1.01e-4);
  });

  it('std = 0 treated as missing → value-based default, floored', () => {
    const result = buildParameterUncertainties(buildGraph(0.5, 0));
    expect(result[0].std).toBe(DEFAULT_STD_FLOOR);
  });

  it('negative std treated as missing → value-based default', () => {
    const result = buildParameterUncertainties(buildGraph(10, -0.5));
    expect(result[0].std).toBeCloseTo(1.5, 10);
  });

  it('value = 0 with no user std → FALLBACK_STD = 0.5', () => {
    const result = buildParameterUncertainties(buildGraph(0));
    expect(result[0].std).toBe(FALLBACK_STD);
  });
});

// ---------------------------------------------------------------------------
// Translator <-> preflight parity (sanity check that both paths emit the same
// std for the same input). The pipelines diverge in many places, but the
// std-derivation logic must remain in lockstep.
// ---------------------------------------------------------------------------

describe('translator vs preflight parity for std derivation', () => {
  const cases: Array<{ name: string; value: number; std?: number }> = [
    { name: 'small user std', value: 0.6, std: 0.001 },
    { name: 'medium user std', value: 0.5, std: 0.05 },
    { name: 'large user std', value: 50, std: 1.5 },
    { name: 'sub-min user std', value: 0.5, std: 1e-8 },
    { name: 'at-min user std (1e-4)', value: 0.5, std: 1e-4 },
    { name: 'just-below-min user std (0.99e-4)', value: 0.5, std: 0.99e-4 },
    { name: 'just-above-min user std (1.01e-4)', value: 0.5, std: 1.01e-4 },
    { name: 'over-max user std', value: 50, std: 3.0 },
    { name: 'zero user std', value: 0.5, std: 0 },
    { name: 'negative user std', value: 10, std: -0.1 },
    { name: 'NaN user std', value: 10, std: NaN },
    { name: 'no std, value 10', value: 10 },
    { name: 'no std, value 0', value: 0 },
    { name: 'no std, value 0.5', value: 0.5 },
  ];

  for (const { name, value, std } of cases) {
    it(`parity: ${name}`, () => {
      const v3 = buildParameterUncertaintiesV3([
        {
          id: 'f',
          kind: 'factor',
          label: 'F',
          observed_state: std === undefined ? { value } : { value, std },
        },
      ])!;
      const preflight = buildParameterUncertainties({
        nodes: [
          {
            id: 'f',
            kind: 'factor',
            label: 'F',
            observed_state: std === undefined ? { value } : { value, std },
          },
          { id: 'goal', kind: 'goal', label: 'Goal' },
        ],
        edges: [{ from: 'f', to: 'goal' }],
      });
      expect(v3[0].std).toBe(preflight[0].std);
    });
  }
});

// ---------------------------------------------------------------------------
// Boundary contract: graph → ISL request preserves user-supplied std
// (regression test for the original symptom — small user values reaching ISL)
// ---------------------------------------------------------------------------

describe('PLoT → ISL boundary: user-supplied std reaches ISL request', () => {
  it('outbound parameter_uncertainties preserves small user-supplied stds', () => {
    const graph: EngineGraphV3 = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Revenue', observed_state: { value: 100 } },
        {
          id: 'fac_task_coverage',
          kind: 'factor',
          label: 'Task Coverage',
          observed_state: { value: 0.6, std: 0.001 },
        },
        {
          id: 'fac_team_structure',
          kind: 'factor',
          label: 'Team Structure',
          observed_state: { value: 0.4, std: 0.003 },
        },
      ],
      edges: [
        { from: 'fac_task_coverage', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
        { from: 'fac_team_structure', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    };
    const options: OptionV3[] = [
      { id: 'opt1', label: 'Option 1', interventions: {} },
    ];

    const req = toISLRobustnessRequest(graph, options, 'goal', 'req-test', 1000);

    const pus = req.parameter_uncertainties ?? [];
    const tc = pus.find((p) => p.node_id === 'fac_task_coverage');
    const ts = pus.find((p) => p.node_id === 'fac_team_structure');

    expect(tc).toBeDefined();
    expect(ts).toBeDefined();
    // The fix: small user-supplied stds must propagate to the ISL payload as-is.
    expect(tc!.std).toBe(0.001);
    expect(ts!.std).toBe(0.003);
  });

  it('low- vs high-uncertainty fixture: outbound stds differ as supplied', () => {
    const makeGraph = (std: number): EngineGraphV3 => ({
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Goal', observed_state: { value: 100 } },
        { id: 'f', kind: 'factor', label: 'F', observed_state: { value: 0.6, std } },
      ],
      edges: [
        { from: 'f', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
      ],
    });

    const low = toISLRobustnessRequest(makeGraph(0.001), [], 'goal', 'req-low', 1000);
    const high = toISLRobustnessRequest(makeGraph(0.5), [], 'goal', 'req-high', 1000);

    const lowStd = low.parameter_uncertainties!.find((p) => p.node_id === 'f')!.std;
    const highStd = high.parameter_uncertainties!.find((p) => p.node_id === 'f')!.std;

    expect(lowStd).toBe(0.001);
    expect(highStd).toBe(0.5);
    expect(lowStd).toBeLessThan(highStd);
  });
});
