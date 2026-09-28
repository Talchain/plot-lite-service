/**
 * ⛔ A tiny causal edge failed the whole Run (journey C, CEE `9cd467e`, 28 Sep 2026 09:20:19Z).
 *
 * ISL's `StrengthDistribution.std` is `Field(gt=0.001)` (src/models/robustness_v2.py): STRICTLY greater than 0.001.
 * PLoT's proportional floor `min(0.05, max(MIN_STD, |mean| / 2))` floored the draft's 0.001 / 0.0005 edge
 * (advertising share -> paying subscribers) to EXACTLY 0.001. ISL answered 422
 * `graph -> edges -> 3 -> strength -> std: Input should be greater than 0.001`, and the user was told
 * "The analysis engine could not produce a comparison".
 *
 * The rule under test is ISL's contract, not a value: every std PLoT emits must be > 0.001.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normaliseEdge, normaliseGraph, type NormalisationWarning } from '../src/normalisation/graph-normaliser.js';

/** ISL `StrengthDistribution.std = Field(..., gt=0.001)`: the exclusive lower bound. */
const ISL_STD_EXCLUSIVE_MIN = 0.001;

const causal = new Map([['A', 'factor'], ['B', 'factor']]);
const run = (strength: { mean: number; std: number }) => {
  const warnings: NormalisationWarning[] = [];
  return normaliseEdge({ from: 'A', to: 'B', strength } as never, 0, causal, warnings).strength.std;
};

describe('every edge std PLoT sends is one ISL accepts (> 0.001, exclusive)', () => {
  it('RED: the served edge — mean 0.001, std 0.0005 — is sent above 0.001', () => {
    expect(run({ mean: 0.001, std: 0.0005 })).toBeGreaterThan(ISL_STD_EXCLUSIVE_MIN);
  });

  it('RED: a negative tiny effect — mean −0.002, std 0 — is sent above 0.001', () => {
    expect(run({ mean: -0.002, std: 0 })).toBeGreaterThan(ISL_STD_EXCLUSIVE_MIN);
  });

  it('RED: a zero mean with zero spread is sent above 0.001', () => {
    expect(run({ mean: 0, std: 0 })).toBeGreaterThan(ISL_STD_EXCLUSIVE_MIN);
  });

  it('a non-finite spread is floored above 0.001', () => {
    expect(run({ mean: 0.3, std: Number.NaN })).toBeGreaterThan(ISL_STD_EXCLUSIVE_MIN);
  });

  it('RED: the SERVED journey-C graph normalises with every edge std above 0.001', () => {
    const served = JSON.parse(
      readFileSync(new URL('./fixtures/served/journey-c-20260928-tiny-edge.graph.json', import.meta.url), 'utf8'),
    );
    const { graph } = normaliseGraph({ nodes: served.nodes, edges: served.edges } as never);
    expect(graph.edges.length).toBe(served.edges.length);
    const tiny = graph.edges.find((e) => e.from === 'advertising_share_of_budget' && e.to === 'paying_pro_subscribers');
    expect(tiny?.strength.mean).toBe(0.001);
    const refused = graph.edges.filter((e) => !(e.strength.std > ISL_STD_EXCLUSIVE_MIN)).map((e) => `${e.from}->${e.to}=${e.strength.std}`);
    expect(refused).toEqual([]);
  });

  it('CONTROL: a small effect above the floor keeps its own proportional spread (T3 −0.01 / 0.005)', () => {
    expect(run({ mean: -0.01, std: 0.005 })).toBe(0.005);
  });

  it('CONTROL: |mean| ≥ 0.1 floors to 0.05 exactly as before', () => {
    expect(run({ mean: 0.5, std: 0.01 })).toBe(0.05);
  });
});
