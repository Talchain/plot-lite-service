/**
 * Track S PR-E — Standard MC sample depth default 1000→4000, with env rollback.
 *
 * Machine-enforced acceptance proof:
 *  - default unset → standard depth resolves to 4000;
 *  - STANDARD_N_SAMPLES=1000 → resolves to 1000 (emergency rollback);
 *  - response hash differs between 1000 and 4000;
 *  - flip probes stay at their independent depth (do NOT inherit base 4000).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  resolveStandardNSamples,
  STANDARD_N_SAMPLES_DEFAULT,
} from '../src/config/sampling.js';
import { resolveFlipProbeNSamples } from '../src/analysis/flip-thresholds.js';
import { hashRequest } from '../src/normalisation/canonicalise.js';
import type { RunRequestV3, EngineGraphV3 } from '../src/types/engine-v3.js';

const ENV_KEY = 'STANDARD_N_SAMPLES';
// The malformed-env cases below intentionally trip the once-per-process warning;
// stub console.warn so the expected operator warning doesn't clutter test output.
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { delete process.env[ENV_KEY]; vi.restoreAllMocks(); });

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [{ from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } }],
};
const REQ = {
  graph: GRAPH,
  options: [{ id: 'opt1', label: 'O1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } }],
  goal_node_id: 'goal',
  seed: '42',
} as unknown as RunRequestV3;

describe('PR-E standard sample depth', () => {
  it('default (env unset) resolves to 4000', () => {
    delete process.env[ENV_KEY];
    expect(STANDARD_N_SAMPLES_DEFAULT).toBe(4000);
    expect(resolveStandardNSamples()).toBe(4000);
  });

  it('STANDARD_N_SAMPLES=1000 rolls back to 1000', () => {
    process.env[ENV_KEY] = '1000';
    expect(resolveStandardNSamples()).toBe(1000);
  });

  it('honours other in-bounds overrides', () => {
    process.env[ENV_KEY] = '2000';
    expect(resolveStandardNSamples()).toBe(2000);
    process.env[ENV_KEY] = '100';
    expect(resolveStandardNSamples()).toBe(100);
    process.env[ENV_KEY] = '10000';
    expect(resolveStandardNSamples()).toBe(10000);
  });

  it('falls back safely on malformed, empty, or out-of-bounds env (no parseInt misparse, no bound bypass)', () => {
    // parseInt would yield 1 / 4 / 1000 for the first three — all unsafe.
    for (const bad of ['oops', '', '   ', '1,000', '4_000', '1000abc', '1.5', '-500', '1e3', '99', '0', '10001', '50000']) {
      process.env[ENV_KEY] = bad;
      expect(resolveStandardNSamples()).toBe(STANDARD_N_SAMPLES_DEFAULT); // 4000
    }
  });

  it('response hash differs between 1000 and 4000 (same graph + seed)', () => {
    const h1000 = hashRequest(REQ, GRAPH, '42', undefined, undefined, 1000);
    const h4000 = hashRequest(REQ, GRAPH, '42', undefined, undefined, 4000);
    expect(h1000).not.toBe(h4000);
  });

  it('flip probes do NOT inherit the new 4000 base depth (stay decoupled)', () => {
    // Base default is now 4000; flip probes must remain at their independent depth.
    expect(resolveFlipProbeNSamples(STANDARD_N_SAMPLES_DEFAULT)).toBe(1000);
    expect(resolveFlipProbeNSamples(resolveStandardNSamples())).toBe(1000);
  });
});
