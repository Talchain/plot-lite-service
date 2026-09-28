/**
 * R3-5, PLoT half (AIQ #72 5872273026 · 5872728325; DL ruling 5872746926 (A)): when ISL EVALUATED an
 * accounting identity, every row's `influence_score` is ISL's structural influence over EVERY factor node
 * (`structural_influence`), not PLoT's graph walk — or, when that list cannot cover every row, the walk
 * stays and every row discloses `influence_basis: 'graph_walk'`. Bases are never mixed.
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
import type { FactorSensitivityResultV3, IdentityEvaluationV3 } from '../src/types/engine-v3.js';
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

const MRR_EVALUATED: IdentityEvaluationV3 = {
  node_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'],
  addends: ['other_mrr_growth'], stated_in_brief: true, evaluated: true, level_source: 'stated_level',
};
const MRR_WITHHELD: IdentityEvaluationV3 = {
  node_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'],
  stated_in_brief: false, evaluated: false, withheld_reason: 'identity_frame_missing',
};

const byId = (rows: FactorSensitivityResultV3[]) => Object.fromEntries(rows.map((r) => [r.factor_id, r]));
const strip = ({ influence_score: _s, influence_rank: _r, influence_basis: _b, ...rest }: FactorSensitivityResultV3) => rest;

describe('R3-5 (A) — a complete every-factor list under an evaluated identity is published as ISL\'s', () => {
  it('every row carries ISL\'s EXACT score, bound by factor_id, and says so', () => {
    const out = byId(adoptIslStructuralInfluence(walk(), list(), [MRR_EVALUATED]));
    for (const [id, score] of Object.entries(ISL_EVERY)) {
      expect(out[id].influence_score).toBe(score);
      expect(out[id].influence_basis).toBe('isl_structural');
    }
  });

  it('R3-5 row: price\'s bar is not the walk\'s 1 under MRR = price × subscribers; subscribers lead', () => {
    const out = byId(adoptIslStructuralInfluence(walk(), list(), [MRR_EVALUATED]));
    expect(out.pro_plan_price.influence_score).not.toBe(1);
    expect(out.pro_paying_subscribers.influence_rank).toBe(1);
  });

  it('the unobserved factor carries ISL\'s score (normalised over six), not the walk\'s 0.9895', () => {
    const row = byId(adoptIslStructuralInfluence(walk(), list(), [MRR_EVALUATED])).fac_existing_customers_grandfathered;
    expect(row.influence_score).toBe(0.14907816711590297);
  });

  it('influence_rank follows the published scores (1 = highest)', () => {
    const out = byId(adoptIslStructuralInfluence(walk(), list(), [MRR_EVALUATED]));
    expect([
      'pro_paying_subscribers', 'pro_plan_price', 'fac_existing_customers_grandfathered',
      'monthly_churn', 'other_mrr_growth', 'monthly_new_pro_subscribers',
    ].map((id) => out[id].influence_rank)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('nothing else moves: array order, importance_rank, elasticity, sensitivity_score, zero_reason, source', () => {
    expect(adoptIslStructuralInfluence(walk(), list(), [MRR_EVALUATED]).map(strip)).toEqual(walk().map(strip));
  });

  it('the input rows are not mutated', () => {
    const before = walk();
    adoptIslStructuralInfluence(before, list(), [MRR_EVALUATED]);
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
    kept(adoptIslStructuralInfluence(walk(), list(FIVE_ROW_COHORT), [MRR_EVALUATED]));
  });

  it('no list at all (an ISL build before it) → walk + graph_walk', () => {
    kept(adoptIslStructuralInfluence(walk(), undefined, [MRR_EVALUATED]));
  });

  it('a withheld (truncated) list — every score null → walk + graph_walk', () => {
    const withheld = Object.fromEntries(Object.keys(ISL_EVERY).map((id) => [id, null]));
    kept(adoptIslStructuralInfluence(walk(), list(withheld), [MRR_EVALUATED]));
  });

  it('an out-of-domain score (> 1) counts as missing → walk + graph_walk', () => {
    kept(adoptIslStructuralInfluence(walk(), list({ ...ISL_EVERY, pro_plan_price: 1.5 }), [MRR_EVALUATED]));
  });
});

describe('R3-5 CONTRASTS — without an evaluated identity nothing changes (the same array comes back)', () => {
  it('C0 (ISL reports no identity), even with a list present: same reference, deep-equal, no basis key', () => {
    const rows = walk();
    const out = adoptIslStructuralInfluence(rows, list(), undefined);
    expect(out).toBe(rows);
    expect(out).toEqual(walk());
    expect(out.some((r) => 'influence_basis' in r)).toBe(false);
  });

  it('an identity ISL WITHHELD (evaluated: false): same reference', () => {
    const rows = walk();
    expect(adoptIslStructuralInfluence(rows, list(), [MRR_WITHHELD])).toBe(rows);
  });

  it('an empty identity_evaluations array: same reference', () => {
    const rows = walk();
    expect(adoptIslStructuralInfluence(rows, list(), [])).toBe(rows);
  });
});
