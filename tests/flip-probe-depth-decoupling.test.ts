/**
 * Track S (revised) — Flip-probe sample-depth control
 *
 * HISTORY: Track S originally pinned probes to min(1000, base) so raising the
 * base depth could not push probes into the (then 5s/10s) flip timeouts.
 * Paul-ruled lenient defaults 2026-07-17 inverted the trade: probes now run at
 * BASE precision up to a 10k cap (flip values carry the precision of the
 * displayed probabilities), and the flip time budgets were raised 6x in step.
 * What SURVIVES of decoupling — and is pinned here — is the control itself:
 * the 10k cap, the never-deeper-than-base rule, and the FLIP_PROBE_N_SAMPLES
 * env override with strict parsing.
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
  n_samples: 4000, // base analysis depth
  parameter_uncertainties: [{ node_id: 'factor-a', distribution: 'normal', std: 0.3 }],
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
  it('runs probes at BASE precision up to the 10k cap (Paul ruling 2026-07-17)', () => {
    expect(resolveFlipProbeNSamples(1000)).toBe(1000);
    expect(resolveFlipProbeNSamples(4000)).toBe(4000); // was pinned to 1000 pre-ruling
    expect(resolveFlipProbeNSamples(8000)).toBe(8000);
    expect(resolveFlipProbeNSamples(12_000)).toBe(DEFAULT_FLIP_PROBE_N_SAMPLES); // capped at 10k
  });

  it('never runs probes deeper than the base depth', () => {
    expect(resolveFlipProbeNSamples(500)).toBe(500);
  });

  it('honours an explicit FLIP_PROBE_N_SAMPLES env override (decoupled from base)', () => {
    process.env[ENV_KEY] = '2000';
    expect(resolveFlipProbeNSamples(4000)).toBe(2000);
    expect(resolveFlipProbeNSamples(1000)).toBe(2000);
  });

  it('ignores a malformed env value', () => {
    process.env[ENV_KEY] = 'not-a-number';
    expect(resolveFlipProbeNSamples(4000)).toBe(4000); // falls back to min(cap, base)
  });

  it('ignores parseInt foot-guns and out-of-bounds env values (falls back, never misparses)', () => {
    for (const bad of ['1,000', '4_000', '1000abc', '1.5', '-5', '50000', '99', '0']) {
      process.env[ENV_KEY] = bad;
      // Falls back to min(10000, base) — never to a misparsed value like 1 or 4.
      expect(resolveFlipProbeNSamples(4000)).toBe(4000);
    }
  });
});

describe('createISLInferenceFn probe depth', () => {
  it('sends the RESOLVED probe depth to ISL (env override proves the control is live)', async () => {
    process.env[ENV_KEY] = '2000';
    const probeDepth = resolveFlipProbeNSamples(ORIGINAL.n_samples); // 2000: env wins over base 4000
    const { fn, seen } = recordingInference(probeDepth);
    await fn('factor-a', 0.5);
    expect(seen).toEqual([2000]);
    expect(seen[0]).not.toBe(ORIGINAL.n_samples); // the probe-depth control reached the wire
  });

  it('falls back to base depth when no probe depth is supplied (legacy)', async () => {
    const { fn, seen } = recordingInference(undefined);
    await fn('factor-a', 0.5);
    expect(seen).toEqual([ORIGINAL.n_samples]); // 4000
  });
});
