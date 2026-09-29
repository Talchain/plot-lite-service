/**
 * R3 SCIENCE #72 5889219876 — under an unevaluated goal identity, withhold what the WALK computed; keep what the
 * STRUCTURE computed. Pure rows for `factorRowWithoutWalk` / `driverOrderUnderWithhold` (the route rows are in
 * goal-derived-figures-withhold.route.test.ts, on a real ISL answer whose every row is structural).
 */
import { describe, it, expect } from 'vitest';
import { factorRowWithoutWalk, driverOrderUnderWithhold, isStructuralFactorBasis } from '../src/lib/goal-identity-withhold.js';

const WALK = { value_of_information: 0.2, attribution_stability: 'stable', rank_flip_rate: 0.1, flip_risk_category: 'low', evpi_percentage_points: 3, evpi_method: 'heuristic' };
const INFLUENCE = { influence_score: 0.7, influence_rank: 1, influence_basis: 'isl_structural' };
const RANKED = { sensitivity_score: 0.4, elasticity: 0.8, importance_rank: 1, direction: 'positive' };
const BOOTSTRAP_CONF = { confidence: 0.45, confidence_source: 'plot_unified_from_isl_bootstrap', confidence_provenance: { method: 'x' }, confidence_components: { a: 1 } };
const GRAPH_CONF = { confidence: 0.5, confidence_source: 'plot_unified_from_graph', confidence_provenance: { method: 'y' } };

describe('factorRowWithoutWalk — the walk goes, the structure stays', () => {
  it("ISL's Monte-Carlo ordering (isl_uncertainty): rank / score / elasticity / direction, VOI & co, bootstrap confidence all go; influence stays", () => {
    const row = { factor_id: 'f', factor_label: 'F', importance_basis: 'isl_uncertainty', ...INFLUENCE, ...RANKED, ...WALK, ...BOOTSTRAP_CONF };
    expect(factorRowWithoutWalk(row)).toEqual({ factor_id: 'f', factor_label: 'F', importance_basis: 'isl_uncertainty', ...INFLUENCE });
  });
  it('no basis disclosed: treated as the walk (fail closed)', () => {
    const row = { factor_id: 'f', ...RANKED, ...WALK };
    expect(factorRowWithoutWalk(row)).toEqual({ factor_id: 'f' });
  });
  for (const basis of ['graph_structural', 'isl_structural']) {
    it(`a structural basis (${basis}) keeps rank / score / elasticity / direction; VOI & co still go`, () => {
      const row = { factor_id: 'f', importance_basis: basis, ...INFLUENCE, ...RANKED, ...WALK, ...BOOTSTRAP_CONF };
      expect(factorRowWithoutWalk(row)).toEqual({ factor_id: 'f', importance_basis: basis, ...INFLUENCE, ...RANKED });
    });
  }
  it('a confidence attested structural (plot_unified_from_graph) stays with its source and provenance', () => {
    const row = { factor_id: 'f', importance_basis: 'graph_structural', ...GRAPH_CONF, ...WALK };
    expect(factorRowWithoutWalk(row)).toEqual({ factor_id: 'f', importance_basis: 'graph_structural', ...GRAPH_CONF });
  });
  it('copies, never mutates', () => {
    const row = { factor_id: 'f', ...WALK };
    factorRowWithoutWalk(row);
    expect(row).toEqual({ factor_id: 'f', ...WALK });
  });
  it('isStructuralFactorBasis', () => {
    expect(['graph_structural', 'isl_structural'].map(isStructuralFactorBasis)).toEqual([true, true]);
    expect(['isl_uncertainty', 'none', undefined].map(isStructuralFactorBasis)).toEqual([false, false, false]);
  });
});

describe('driverOrderUnderWithhold — only the walk-ordered ranking goes', () => {
  const order = (basis: string) => ({ basis, ranked_factor_ids: ['a', 'b'] });
  it('isl_uncertainty under the withhold → withheld', () => {
    expect(driverOrderUnderWithhold(order('isl_uncertainty'), true)).toBeUndefined();
  });
  it('a structural order under the withhold → kept, the same object', () => {
    for (const b of ['graph_structural', 'isl_structural', 'none']) {
      const o = order(b);
      expect(driverOrderUnderWithhold(o, true)).toBe(o);
    }
  });
  it('CONTROL: no withhold → every basis kept', () => {
    const o = order('isl_uncertainty');
    expect(driverOrderUnderWithhold(o, false)).toBe(o);
  });
});

describe('coachingWithoutWalk', () => {
  it('coaching keeps only its structural fields', async () => {
    const { coachingWithoutWalk } = await import('../src/lib/goal-identity-withhold.js');
    const c = { coaching_version: 'v', computed_at: 't', thresholds_used: {}, key_drivers: [1], model_critiques: [2], assumptions_ledger: [3],
      headline_type: 'clear_winner', executive_summary: {}, story_headlines: {}, next_actions: [], readiness: 'ready', readiness_reasons: [], readiness_signals: {}, readiness_tone: 'x', evidence_gaps: [] };
    const structural = [{ importance_basis: 'isl_structural' }, { importance_basis: 'graph_structural' }];
    expect(Object.keys(coachingWithoutWalk(c, structural)).sort()).toEqual(['assumptions_ledger', 'coaching_version', 'computed_at', 'key_drivers', 'model_critiques', 'thresholds_used']);
  });
  it("key_drivers go when ANY row's rank is the walk's (isl_uncertainty, or undisclosed): the order would be arbitrary (AIQ 5889873087)", async () => {
    const { coachingWithoutWalk } = await import('../src/lib/goal-identity-withhold.js');
    const c = { coaching_version: 'v', key_drivers: [{ factor_id: 'a', rank: 1 }], model_critiques: [], assumptions_ledger: {} };
    for (const rows of [[{ importance_basis: 'isl_uncertainty' }], [{ importance_basis: 'isl_structural' }, { importance_basis: 'isl_uncertainty' }], [{}]]) {
      expect('key_drivers' in coachingWithoutWalk(c, rows), JSON.stringify(rows)).toBe(false);
    }
    // CONTROL: every row structural → kept, the same array.
    expect(coachingWithoutWalk(c, [{ importance_basis: 'graph_structural' }]).key_drivers).toBe(c.key_drivers);
  });
});
