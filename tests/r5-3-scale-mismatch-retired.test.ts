/**
 * R5-3 (R5 handed to R&C whole, MG #72 5871363476): SCALE_MISMATCH_WARNING IS RETIRED — no engine fact can make it true.
 *
 * Preflight compared raw intervention values ACROSS factors ("max is ~180,000× min") and told the user "Large
 * magnitudes may dominate outcomes". The engine never sees those raw magnitudes side by side: whenever any value is
 * outside [0,1] the normaliser rescales EVERY intervention on its OWN factor's range (`normaliseOptions`: the factor's
 * context range, else a per-factor fallback, else [0,1]), and a value outside its own range is CLAMPED and recorded
 * (the `intervention_clamped` withhold path is the real disclosure). So £180,000 on a cost factor and a 0/1 switch on
 * another are each read on their own scale, and nothing "dominates" by magnitude. The warning asserted a fact the
 * engine never has, which is the class R5 removes, so it is retired rather than re-gated.
 */
import { describe, it, expect } from 'vitest';
import { runPreflightValidation } from '../src/validation/preflight-v2.js';
import { buildNormalisationContext, normaliseOptions } from '../src/lib/intervention-normaliser.js';
import type { EngineGraphV3, OptionV3 } from '../src/types/engine-v3.js';

const STATS = { optionNodesFiltered: 0, optionEdgesFiltered: 0, nodesNormalised: 3, edgesNormalised: 2 };
const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'factor-switch', kind: 'factor', label: 'Adopt the tool' },
    { id: 'factor-cost', kind: 'factor', label: 'Annual cost' },
    { id: 'goal', kind: 'goal', label: 'Goal' },
  ],
  edges: [
    { from: 'factor-switch', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
    { from: 'factor-cost', to: 'goal', exists_probability: 0.9, strength: { mean: -0.7, std: 0.1 } },
  ],
} as unknown as EngineGraphV3;

// The served shape: a 0/1 switch on one factor, a money figure on another.
const MIXED: OptionV3[] = [
  { id: 'opt_tool', label: 'Adopt the tool', interventions: { 'factor-switch': { value: 1, source: 'user_specified' }, 'factor-cost': { value: 180000, source: 'user_specified' } } },
  { id: 'opt_status_quo', label: 'Carry on', interventions: { 'factor-switch': { value: 0, source: 'user_specified' }, 'factor-cost': { value: 90000, source: 'user_specified' } } },
] as unknown as OptionV3[];

describe('R5-3 — SCALE_MISMATCH_WARNING is retired', () => {
  it('RED: values spanning 180,000× across DIFFERENT factors raise no scale-mismatch warning', () => {
    const result = runPreflightValidation(GRAPH, MIXED, 'goal', STATS);
    expect(result.passed).toBe(true);
    expect(result.warnings.map((w) => w.code)).not.toContain('SCALE_MISMATCH_WARNING');
  });

  it('ENGINE FACT: the normaliser reads each intervention on its OWN factor\'s range — every value lands in [0,1]', () => {
    const context = buildNormalisationContext(GRAPH.nodes as never, 'goal', undefined, MIXED);
    const { options, diagnostics } = normaliseOptions(MIXED, context);
    for (const d of diagnostics) {
      expect(d.normalised_value, `${d.option_id}/${d.factor_id}`).toBeGreaterThanOrEqual(0);
      expect(d.normalised_value, `${d.option_id}/${d.factor_id}`).toBeLessThanOrEqual(1);
    }
    // Each factor has its own range: the cost factor's is not the switch factor's.
    const rangeOf = (f: string) => diagnostics.find((d) => d.factor_id === f)!.range;
    expect(rangeOf('factor-cost').max).not.toBe(rangeOf('factor-switch').max);
    expect(options).toHaveLength(2);
  });
});
