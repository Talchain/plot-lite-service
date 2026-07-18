/**
 * F13 (Codex deep review, A3 r2) — canonicalise node_id/factor_id to ONE
 * precedence used everywhere, so a `{node_id:'lever', factor_id:'other'}` twin
 * cannot map/publish as `lever` while escaping lever-suppression via the
 * opposite-precedence D-U predicate.
 *
 * RED-first: the two DEFECT assertions below use ONLY pre-existing exports
 * (`isOptionControlledLever`, `buildFactorStability`) and FAIL on the current
 * (opposite-precedence) code — they see the leak at BOTH the raw-ISL predicate
 * boundary and the post-mapping publication boundary. `factorIdOf` /
 * `hasFactorIdConflict` are pure additive helpers (no behaviour of their own).
 *
 * NOTE: the pinned ISL producer emits only canonical `node_id` today, so no
 * live leak exists — this is schema-evolution hardening, kept additive/safe.
 */

import { describe, it, expect } from 'vitest';
import {
  isOptionControlledLever,
  factorIdOf,
  hasFactorIdConflict,
} from '../src/lib/intervention-override.js';
import { buildFactorStability } from '../src/lib/factor-influence.js';
import { extractFactorSensitivity } from '../src/cee/decision-review-request.js';
import type { EngineGraphV3 } from '../src/types/engine-v3.js';

const GRAPH: EngineGraphV3 = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Revenue' },
    { id: 'lever', kind: 'factor', label: 'Marketing Spend', observed_state: { value: 0.6 } },
    { id: 'other', kind: 'factor', label: 'Brand Awareness', observed_state: { value: 0.5 } },
  ],
  edges: [
    { from: 'lever', to: 'goal', exists_probability: 0.8, strength: { mean: 0.5, std: 0.1 } },
  ],
} as unknown as EngineGraphV3;

// A future/additive ISL entry: identifies node `lever` (canonical) but ALSO
// carries a conflicting `factor_id: 'other'`. The structural lever set is
// {'lever'}. Valid 3C stability fields so the publication path would emit it.
const TWIN = {
  node_id: 'lever',
  factor_id: 'other',
  label: 'Marketing Spend',
  elasticity_std: 0.2,
  attribution_stability: 'high',
  rank_flip_rate: 0.1,
  stability_method: 'bootstrap_1000',
  zero_reason: null,
} as const;

describe('F13 — factor-id canonicalisation (raw-ISL boundary)', () => {
  it('DEFECT: option-controlled-lever predicate suppresses the unequal twin (canonical id = node_id)', () => {
    // Pre-fix this returns FALSE: the predicate checked factor_id ('other') first,
    // which is NOT in the structural lever set {'lever'} → escapes suppression.
    expect(isOptionControlledLever(TWIN, new Set(['lever']))).toBe(true);
  });

  it('positive control: a NON-lever twin (node/factor both outside the set) is NOT falsely suppressed', () => {
    expect(isOptionControlledLever(
      { node_id: 'freefactor', factor_id: 'alsofree' },
      new Set(['lever']),
    )).toBe(false);
  });
});

describe('F13 — factor-id canonicalisation (post-mapping publication boundary)', () => {
  it('DEFECT: factor_stability does not publish the unequal twin\'s non-zero spread', () => {
    const result = buildFactorStability([TWIN], GRAPH, new Set(['lever']));
    // Pre-fix: one entry with elasticity_std 0.2 leaks (identified as `lever`,
    // suppression missed because the D-U predicate resolved `other`).
    // Post-fix: the conflicting twin is DROPPED (ambiguous identity), so it is
    // absent from the published spread.
    const leaked = result.find((e) => e.elasticity_std === 0.2);
    expect(leaked, 'unequal twin must not leak a non-zero spread').toBeUndefined();
    expect(result).toHaveLength(0);
  });

  it('positive control: a CLEAN lever (node_id only, in the set) still publishes with spread suppressed to 0', () => {
    const cleanLever = { ...TWIN, factor_id: undefined };
    const result = buildFactorStability([cleanLever], GRAPH, new Set(['lever']));
    expect(result).toHaveLength(1);
    expect(result[0].factor_id).toBe('lever');
    expect(result[0].elasticity_std).toBe(0);
  });

  it('positive control: a genuine non-lever (node_id only, NOT in the set) keeps its spread verbatim', () => {
    const nonLever = {
      node_id: 'other', label: 'Brand Awareness', elasticity_std: 0.11,
      attribution_stability: 'moderate', rank_flip_rate: 0.15, stability_method: 'bootstrap_1000',
    };
    const result = buildFactorStability([nonLever], GRAPH, new Set(['lever']));
    expect(result).toHaveLength(1);
    expect(result[0].elasticity_std).toBe(0.11);
  });
});

describe('F13 — CEE review-request derivation uses the canonical predicate', () => {
  it('DEFECT: an unequal-twin lever is filtered out of the CEE review factor list', () => {
    const islResult = {
      factor_sensitivity: [
        { ...TWIN, factor_label: 'Marketing Spend', elasticity: 0.3, confidence: 0.7 },
        { node_id: 'other', factor_id: 'other', factor_label: 'Brand', elasticity: 0.1, confidence: 0.6 },
      ],
    };
    // Structural lever set = {'lever'}. Pre-fix the twin resolves 'other' and
    // survives the filter → its elasticity egresses to CEE. Post-fix it is
    // recognised as the lever and dropped.
    const out = extractFactorSensitivity(islResult as never, new Set(['lever']));
    expect(out.some((f) => f.factor_id === 'lever')).toBe(false);
    expect(out.map((f) => f.factor_id)).toEqual(['other']);
  });
});

describe('F13 — factorIdOf / hasFactorIdConflict helpers (positive controls)', () => {
  it('factorIdOf resolves node_id first, falls back to factor_id, ignores empties', () => {
    expect(factorIdOf({ node_id: 'n', factor_id: 'f' })).toBe('n');
    expect(factorIdOf({ factor_id: 'f' })).toBe('f');
    expect(factorIdOf({ node_id: '', factor_id: 'f' })).toBe('f');
    expect(factorIdOf({})).toBeUndefined();
    expect(factorIdOf({ node_id: '', factor_id: '' })).toBeUndefined();
  });

  it('hasFactorIdConflict is true only when both non-empty ids differ', () => {
    expect(hasFactorIdConflict({ node_id: 'a', factor_id: 'b' })).toBe(true);
    expect(hasFactorIdConflict({ node_id: 'a', factor_id: 'a' })).toBe(false);
    expect(hasFactorIdConflict({ node_id: 'a' })).toBe(false);
    expect(hasFactorIdConflict({ factor_id: 'b' })).toBe(false);
    expect(hasFactorIdConflict({ node_id: 'a', factor_id: '' })).toBe(false);
  });
});
