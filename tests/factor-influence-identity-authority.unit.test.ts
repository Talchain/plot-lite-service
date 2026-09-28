/**
 * R3-5, PLoT half (AIQ #72 5872273026 · 5872728325; DL ruling 5872746926 (A)) and ONE influence algorithm
 * (AIQ 5872951506; census #72 5875292873): on EVERY graph, every row's `influence_score` is ISL's structural
 * influence over EVERY factor node (`structural_influence`), not PLoT's graph walk — or, when that list
 * cannot cover every row, the walk stays and every row discloses `influence_basis: 'graph_walk'`. Bases
 * are never mixed. The identity no longer gates adoption.
 *
 * WALK = PLoT's served top-level rows on P1 (AIQ capture `P1-20260928T143522Z`, olumi-programme-docs
 * 8a9fb927, PLoT 7ce9704 · ISL f8aecca), verbatim for the fields below.
 *
 * ISL_EVERY = ISL's own `_compute_structural_influence` over all six factor nodes of the SAME served wire
 * (ISL `tests/fixtures/anchored_delta/paul_a295e4a1_served_wire_plot_a6da42b.json`, identity
 * MRR = price × subscribers, ISL staging 12d7215f), `repr` values copied from the run — not illustrative.
 * The unobserved `fac_existing_customers_grandfathered` has a score here; in `factor_sensitivity` (5 rows,
 * the uncertainty cohort) it has none.
 */

import { describe, it, expect } from 'vitest';
import { adoptIslStructuralInfluence } from '../src/lib/factor-influence.js';
import type { FactorSensitivityResultV3 } from '../src/types/engine-v3.js';
import type { ISLStructuralInfluenceEntry } from '../src/integrations/isl/types/isl-types.js';

function walk(): FactorSensitivityResultV3[] {
  return [
    { factor_id: 'fac_existing_customers_grandfathered', influence_score: 0.9895414829202863, influence_rank: 2, importance_rank: 1, elasticity: 0.9895414829202863, sensitivity_score: -0.48875, source: 'graph' },
    { factor_id: 'other_mrr_growth', influence_score: 0.8098549220830987, influence_rank: 3, importance_rank: 2, elasticity: 0.8098549220830987, sensitivity_score: 0.39999999999999997, source: 'graph' },
    { factor_id: 'pro_paying_subscribers', influence_score: 0.303695595781162, influence_rank: 4, importance_rank: 3, elasticity: 0.303695595781162, sensitivity_score: 0.15, source: 'graph' },
    { factor_id: 'pro_plan_price', influence_score: 1, influence_rank: 1, importance_rank: 4, elasticity: 0, sensitivity_score: 0, source: 'graph', zero_reason: 'intervention_override' },
    { factor_id: 'monthly_churn', influence_score: 0.045554339367174304, influence_rank: 5, importance_rank: 5, elasticity: 0, sensitivity_score: 0, source: 'graph', zero_reason: 'intervention_override' },
    { factor_id: 'monthly_new_pro_subscribers', influence_score: 0.0303695595781162, influence_rank: 6, importance_rank: 6, elasticity: 0, sensitivity_score: 0, source: 'graph', zero_reason: 'intervention_override' },
  ] as FactorSensitivityResultV3[];
}

const ISL_EVERY: Record<string, number> = {
  pro_plan_price: 0.6381328979591836,
  pro_paying_subscribers: 1.0,
  monthly_churn: 0.12,
  monthly_new_pro_subscribers: 0.08000000000000002,
  other_mrr_growth: 0.08086253369272237,
  fac_existing_customers_grandfathered: 0.14907816711590297,
};
function list(scores: Record<string, number | null> = ISL_EVERY): ISLStructuralInfluenceEntry[] {
  return Object.entries(scores).map(([node_id, influence_score]) => ({ node_id, influence_score, influence_rank: null }));
}
const FIVE_ROW_COHORT = Object.fromEntries(
  Object.entries(ISL_EVERY).filter(([id]) => id !== 'fac_existing_customers_grandfathered'),
);

const byId = (rows: FactorSensitivityResultV3[]) => Object.fromEntries(rows.map((r) => [r.factor_id, r]));
const strip = ({ influence_score: _s, influence_rank: _r, influence_basis: _b, ...rest }: FactorSensitivityResultV3) => rest;

describe('R3-5 (A) — a complete every-factor list under an evaluated identity is published as ISL\'s', () => {
  it('every row carries ISL\'s EXACT score, bound by factor_id, and says so', () => {
    const out = byId(adoptIslStructuralInfluence(walk(), list()));
    for (const [id, score] of Object.entries(ISL_EVERY)) {
      expect(out[id].influence_score).toBe(score);
      expect(out[id].influence_basis).toBe('isl_structural');
    }
  });

  it('R3-5 row: price\'s bar is not the walk\'s 1 under MRR = price × subscribers; subscribers lead', () => {
    const out = byId(adoptIslStructuralInfluence(walk(), list()));
    expect(out.pro_plan_price.influence_score).not.toBe(1);
    expect(out.pro_paying_subscribers.influence_rank).toBe(1);
  });

  it('the unobserved factor carries ISL\'s score (normalised over six), not the walk\'s 0.9895', () => {
    const row = byId(adoptIslStructuralInfluence(walk(), list())).fac_existing_customers_grandfathered;
    expect(row.influence_score).toBe(0.14907816711590297);
  });

  it('influence_rank follows the published scores (1 = highest)', () => {
    const out = byId(adoptIslStructuralInfluence(walk(), list()));
    expect([
      'pro_paying_subscribers', 'pro_plan_price', 'fac_existing_customers_grandfathered',
      'monthly_churn', 'other_mrr_growth', 'monthly_new_pro_subscribers',
    ].map((id) => out[id].influence_rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rows are RE-ORDERED by ISL\'s score (driver-order rule 1); importance_rank = influence_rank = position', () => {
    const out = adoptIslStructuralInfluence(walk(), list());
    expect(out.map((r) => r.factor_id)).toEqual([
      'pro_paying_subscribers', 'pro_plan_price', 'fac_existing_customers_grandfathered',
      'monthly_churn', 'other_mrr_growth', 'monthly_new_pro_subscribers',
    ]);
    expect(out.map((r) => r.importance_rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.map((r) => r.influence_rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('nothing else moves per factor: elasticity, sensitivity_score, zero_reason, source', () => {
    const keep = ({ importance_rank: _i, ...rest }: FactorSensitivityResultV3) => strip(rest as FactorSensitivityResultV3);
    const keyed = (rows: FactorSensitivityResultV3[]) => Object.fromEntries(rows.map((r) => [r.factor_id, keep(r)]));
    expect(keyed(adoptIslStructuralInfluence(walk(), list()))).toEqual(keyed(walk()));
  });

  it('the input rows are not mutated', () => {
    const before = walk();
    adoptIslStructuralInfluence(before, list());
    expect(before).toEqual(walk());
  });
});

describe('R3-5 (A) — an incomplete list never mixes bases: the walk stays and every row discloses it', () => {
  const kept = (rows: FactorSensitivityResultV3[]) => {
    expect(rows.map(strip)).toEqual(walk().map(strip));
    expect(rows.map((r) => r.influence_score)).toEqual(walk().map((r) => r.influence_score));
    expect(rows.map((r) => r.influence_rank)).toEqual(walk().map((r) => r.influence_rank));
    expect(rows.every((r) => r.influence_basis === 'graph_walk')).toBe(true);
  };

  it('the five-row uncertainty cohort (the unobserved factor unscored) → walk + graph_walk', () => {
    kept(adoptIslStructuralInfluence(walk(), list(FIVE_ROW_COHORT)));
  });


  it('a withheld (truncated) list — every score null → walk + graph_walk', () => {
    const withheld = Object.fromEntries(Object.keys(ISL_EVERY).map((id) => [id, null]));
    kept(adoptIslStructuralInfluence(walk(), list(withheld)));
  });

  it('an out-of-domain score (> 1) counts as missing → walk + graph_walk', () => {
    kept(adoptIslStructuralInfluence(walk(), list({ ...ISL_EVERY, pro_plan_price: 1.5 })));
  });
});

// ISL's own walk over the six factor nodes of the SAME served wire WITHOUT the identity (C0), from ISL
// `_compute_structural_influence` at ISL #206 b1113de — the EXPECTED NET effect (AIQ #72 5875853496:
// |Σ paths ∏(mean × exists_probability)|) — `repr` values copied from the run.
const ISL_C0: Record<string, number> = {
  pro_plan_price: 1.0,
  pro_paying_subscribers: 0.3023481567243842,
  monthly_churn: 0.0362817788069261,
  monthly_new_pro_subscribers: 0.02418785253795074,
  other_mrr_growth: 0.8062617512650246,
  fac_existing_customers_grandfathered: 0.9933144775585104,
};

describe('ONE influence algorithm (AIQ 5872951506) — without an identity a complete list is adopted too', () => {
  it('the identity no longer gates adoption: the function takes no identity argument', () => {
    expect(adoptIslStructuralInfluence.length).toBe(2);
  });

  it('C0 (no identity) with ISL\'s C0 list: every row shows ISL\'s C0 score, basis isl_structural', () => {
    const out = byId(adoptIslStructuralInfluence(walk(), list(ISL_C0)));
    for (const [id, score] of Object.entries(ISL_C0)) {
      expect(out[id].influence_score).toBe(score);
      expect(out[id].influence_basis).toBe('isl_structural');
    }
    // the discriminating bar: the walk gives grandfathered 0.98954; ISL's net C0 walk gives 0.99331
    expect(out.fac_existing_customers_grandfathered.influence_score).not.toBe(byId(walk()).fac_existing_customers_grandfathered.influence_score);
  });

  it('C0: the rows re-order by ISL\'s net C0 score — price 1st, grandfathered 2nd; ranks = position', () => {
    const out = adoptIslStructuralInfluence(walk(), list(ISL_C0));
    expect(out.map((r) => r.factor_id)).toEqual([
      'pro_plan_price', 'fac_existing_customers_grandfathered', 'other_mrr_growth',
      'pro_paying_subscribers', 'monthly_churn', 'monthly_new_pro_subscribers',
    ]);
    expect(out.map((r) => r.influence_rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.map((r) => r.importance_rank)).toEqual([1, 2, 3, 4, 5, 6]);
    // the input came in the walk's importance order (grandfathered first; the lever price 4th)
    expect(walk()[0].factor_id).toBe('fac_existing_customers_grandfathered');
  });

  it('no list at all (ISL did not run the phase, or an older ISL): the SAME array back, untouched, no basis key', () => {
    const rows = walk();
    const out = adoptIslStructuralInfluence(rows, undefined);
    expect(out).toBe(rows);
    expect(out).toEqual(walk());
    expect(out.some((r) => 'influence_basis' in r)).toBe(false);
  });

  it('an EMPTY list is a list that covers nothing → walk + graph_walk (not the untouched path)', () => {
    const out = adoptIslStructuralInfluence(walk(), []);
    expect(out.map((r) => r.influence_score)).toEqual(walk().map((r) => r.influence_score));
    expect(out.every((r) => r.influence_basis === 'graph_walk')).toBe(true);
  });
});
