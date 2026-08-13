/**
 * Track S — Hash sample-awareness (HASH_VERSION v7)
 *
 * Monte Carlo error scales with sample depth, so the same graph + same seed at a
 * different `n_samples` is a genuinely different computation and MUST hash
 * differently. An omitted `n_samples` resolves to the server default before
 * hashing, so an explicit default-valued request and an omitted one share a hash.
 *
 * These are the machine-enforced contract guarantees for H1 — not advisory.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicaliseRequest,
  computeResponseHash,
  hashRequest,
  HASH_VERSION,
  DEFAULT_HASH_N_SAMPLES,
} from '../src/normalisation/canonicalise.js';
import type { RunRequestV3, EngineGraphV3 } from '../src/types/engine-v3.js';

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor-a', kind: 'factor', label: 'Factor A' },
    { id: 'factor-b', kind: 'factor', label: 'Factor B' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'factor-a', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-b', to: 'goal', exists_probability: 0.9, strength: { mean: 0.7, std: 0.1 } },
  ],
};

const OPTIONS = [
  { id: 'opt1', label: 'Option 1', interventions: { 'factor-a': { value: 1.5, source: 'user_specified' } } },
  { id: 'opt2', label: 'Option 2', interventions: { 'factor-b': { value: 2.0, source: 'user_specified' } } },
];

function makeRequest(overrides: Partial<RunRequestV3> = {}): RunRequestV3 {
  return {
    graph: GRAPH,
    options: OPTIONS,
    goal_node_id: 'goal',
    seed: '42',
    ...overrides,
  } as RunRequestV3;
}

// seedUsed (3rd arg) is the seed the route resolved; mirror req.seed so the
// helper exercises seed discrimination correctly.
const hashWith = (req: RunRequestV3, nSamples?: number) =>
  computeResponseHash(canonicaliseRequest(req, GRAPH, String(req.seed ?? '42'), undefined, undefined, nSamples));

describe('Hash sample-awareness (v7)', () => {
  it('HASH_VERSION is 8', () => {
    // 2.1024: 7→8. v7 added n_samples; v8 moved the whole canonical form onto
    // the EFFECTIVE ISL request. The sample-depth guarantees below are unchanged
    // by that move — n_samples rides the ISL request too.
    expect(HASH_VERSION).toBe(8);
  });

  it('same graph + same seed + different n_samples → different response_hash', () => {
    const req = makeRequest();
    const h1000 = hashWith(req, 1000);
    const h2000 = hashWith(req, 2000);
    const h4000 = hashWith(req, 4000);
    expect(h1000).not.toBe(h2000);
    expect(h2000).not.toBe(h4000);
    expect(h1000).not.toBe(h4000);
  });

  it('omitted n_samples hashes identically to explicit default depth', () => {
    // Resolved-default path: passing no depth and no req.n_samples must equal
    // passing the server default explicitly.
    const omitted = hashWith(makeRequest(), undefined);
    const explicitDefault = hashWith(makeRequest(), DEFAULT_HASH_N_SAMPLES);
    const reqWithDefault = hashWith(makeRequest({ n_samples: DEFAULT_HASH_N_SAMPLES }), undefined);
    expect(omitted).toBe(explicitDefault);
    expect(omitted).toBe(reqWithDefault);
  });

  it('explicit param overrides req.n_samples for the hash', () => {
    // The route passes the *resolved* depth explicitly; it must win over the raw body value.
    const req = makeRequest({ n_samples: 1000 });
    expect(hashWith(req, 4000)).toBe(hashWith(makeRequest({ n_samples: 4000 }), 4000));
    expect(hashWith(req, 4000)).not.toBe(hashWith(req, 1000));
  });

  it('n_samples only changes the hash — graph/seed still matter', () => {
    const a = hashWith(makeRequest({ seed: '42' }), 2000);
    const b = hashWith(makeRequest({ seed: '43' }), 2000);
    expect(a).not.toBe(b); // seed still discriminates at fixed depth
  });

  it('hashRequest convenience fn forwards n_samples', () => {
    const req = makeRequest();
    expect(hashRequest(req, GRAPH, '42', undefined, undefined, 1000)).not.toBe(
      hashRequest(req, GRAPH, '42', undefined, undefined, 4000)
    );
  });
});
