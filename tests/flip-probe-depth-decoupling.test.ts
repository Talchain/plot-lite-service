/**
 * Track S — Flip-probe sample-depth decoupling (H3)
 *
 * Flip probes must NOT inherit the base analysis `n_samples`. Raising the base
 * depth (for display-stable probabilities) must not silently push flip probes
 * into timeout. These tests pin the contract: probe depth is its own control.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createISLInferenceFn,
  resolveFlipProbeNSamples,
  DEFAULT_FLIP_PROBE_N_SAMPLES,
} from '../src/analysis/flip-thresholds.js';

const ORIGINAL = {
  graph: {
    nodes: [
      { id: 'factor-a', kind: 'factor', observed_state: { value: 1.0, std: 0.3 } },
      { id: 'goal', kind: 'goal' },
    ],
    edges: [{ from: 'factor-a', to: 'goal' }],
  },
  options: [{ id: 'opt1' }, { id: 'opt2' }],
  goal_node_id: 'goal',
  n_samples: 4000, // base analysis depth (raised)
  parameter_uncertainties: [{ node_id: 'factor-a', distribution: 'normal', mean: 1.0, std: 0.3 }],
  seed: '42',
};

/** callAnalysis stub that records the probe body's n_samples. */
function recordingInference(flipProbeNSamples?: number) {
  const seen: Array<number | undefined> = [];
  const callAnalysis = async (_endpoint: string, body: any) => {
    seen.push(body?.n_samples);
    return { data: { results: [{ option_id: 'opt1', win_probability: 0.5 }, { option_id: 'opt2', win_probability: 0.5 }] } };
  };
  const fn = createISLInferenceFn(callAnalysis, ORIGINAL, 'req-1', flipProbeNSamples);
  return { fn, seen };
}

const ENV_KEY = 'FLIP_PROBE_N_SAMPLES';
// Invalid-env cases below intentionally trip the once-per-process warning;
// stub console.warn so the expected operator warning doesn't clutter test output.
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { delete process.env[ENV_KEY]; vi.restoreAllMocks(); });

describe('resolveFlipProbeNSamples', () => {
  it('does NOT scale up when the base depth is raised (decoupled)', () => {
    expect(resolveFlipProbeNSamples(1000)).toBe(1000);
    expect(resolveFlipProbeNSamples(4000)).toBe(DEFAULT_FLIP_PROBE_N_SAMPLES); // stays at 1000
    expect(resolveFlipProbeNSamples(8000)).toBe(DEFAULT_FLIP_PROBE_N_SAMPLES);
  });

  it('never runs probes deeper than the base depth', () => {
    expect(resolveFlipProbeNSamples(500)).toBe(500);
  });

  it('honours an explicit FLIP_PROBE_N_SAMPLES env override (may exceed default)', () => {
    process.env[ENV_KEY] = '2000';
    expect(resolveFlipProbeNSamples(4000)).toBe(2000);
    expect(resolveFlipProbeNSamples(1000)).toBe(2000);
  });

  it('ignores a malformed env value', () => {
    process.env[ENV_KEY] = 'not-a-number';
    expect(resolveFlipProbeNSamples(4000)).toBe(DEFAULT_FLIP_PROBE_N_SAMPLES);
  });

  it('ignores parseInt foot-guns and out-of-bounds env values (falls back, never misparses)', () => {
    for (const bad of ['1,000', '4_000', '1000abc', '1.5', '-5', '50000', '99', '0']) {
      process.env[ENV_KEY] = bad;
      // Falls back to min(1000, base) — never to a misparsed value like 1 or 4.
      expect(resolveFlipProbeNSamples(4000)).toBe(DEFAULT_FLIP_PROBE_N_SAMPLES);
    }
  });
});

describe('createISLInferenceFn probe depth', () => {
  it('sends the probe depth, not the base depth, to ISL', async () => {
    const probeDepth = resolveFlipProbeNSamples(ORIGINAL.n_samples); // 1000, base is 4000
    const { fn, seen } = recordingInference(probeDepth);
    await fn('factor-a', 0.5);
    expect(seen).toEqual([1000]);
    expect(seen[0]).not.toBe(ORIGINAL.n_samples); // base raise did not reach the probe
  });

  it('falls back to base depth when no probe depth is supplied (legacy)', async () => {
    const { fn, seen } = recordingInference(undefined);
    await fn('factor-a', 0.5);
    expect(seen).toEqual([ORIGINAL.n_samples]); // 4000
  });
});
