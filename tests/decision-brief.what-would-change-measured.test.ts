/**
 * ⭐ "WHAT COULD CHANGE" LISTS ONLY WHAT WAS MEASURED TO CHANGE THE LEADER (AI Quality ruling
 * olumi-programme-docs #72 5867389636; MG as PLoT owner, DL re-route 5867659507).
 *
 * Served P1 (product identity): £59 wins 100% of draws, decision EVPI = 0, every factor's EVPPI below
 * resolution, the other-growth flip `no_effect_within_bounds` — yet the Analysis tab read "What could
 * change: Existing customers grandfathered (+2 more)". The structural |elasticity| fallback fired on
 * 14/14 banked robust Runs, and in 10 of them nothing measurably changes the leader.
 *
 * SPEC. In this order, and nothing else: (1) fragile edges (as before); (2) factors with a FOUND flip
 * threshold; (3) factors whose EVPPI is above resolution (`status: 'resolved'`, the same test CEE's
 * `select-factor-evppi.ts` uses). Nothing measured → `[]` (the UI and the Agent then say CEE's
 * `NO_SINGLE_ASSUMPTION`). Structural drivers stay in `top_drivers` and are never relabelled.
 */
import { describe, it, expect } from 'vitest';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

const OPTIONS = [
  { option_id: 'opt_59', option_label: '£59 price', id: 'opt_59', label: '£59 price', win_probability: 1 },
  { option_id: 'opt_49', option_label: 'Keep £49', id: 'opt_49', label: 'Keep £49', win_probability: 0 },
] as any[];

/** The structural drivers a robust Run always has — they must never surface as "what could change". */
const DRIVERS = [
  { factor_id: 'grandfathered', factor_label: 'Existing customers grandfathered', elasticity: 0.9, direction: 'positive' },
  { factor_id: 'other_growth', factor_label: 'Other MRR growth', elasticity: 0.6, direction: 'positive' },
  { factor_id: 'churn', factor_label: 'Monthly churn', elasticity: -0.4, direction: 'negative' },
  { factor_id: 'price', factor_label: 'Pro plan price', elasticity: 0.3, direction: 'positive' },
] as any[];

const flip = (factor_id: string, factor_label: string, flip_reason: string, flip_value: number | null) =>
  ({ factor_id, factor_label, current_value: 1, flip_value, flip_reason, alternative_winner_id: flip_value === null ? null : 'opt_49' });
const evppi = (factor_id: string, status: 'resolved' | 'below_resolution', value: number) =>
  ({ factor_id, evppi: value, evppi_raw: value, status });

const run = (over: Partial<BriefAssemblyInput> & Record<string, unknown>) => assembleBrief({
  analysis_status: 'computed',
  critiques: [],
  option_comparison: OPTIONS,
  robustness: { level: 'robust', fragile_edges: [], robust_edges: [] } as any,
  factor_sensitivity: DRIVERS,
  meta: { seed_used: '1' },
  ...over,
} as BriefAssemblyInput);

describe('what_would_change — only what was MEASURED to change the leader (AIQ 5867389636)', () => {
  it('RED P1 (served): no fragile edge, no found flip, every EVPPI below resolution → [] — never the structural drivers', () => {
    const brief = run({
      flip_thresholds: [flip('other_growth', 'Other MRR growth', 'no_effect_within_bounds', null)] as any,
      factor_evppi: [evppi('grandfathered', 'below_resolution', 0), evppi('churn', 'below_resolution', 0)] as any,
    });
    expect(brief?.what_would_change).toEqual([]);
    // The drivers stay where they belong, unrelabelled.
    expect(brief?.top_drivers.map((d) => d.factor_label)).toContain('Existing customers grandfathered');
  });

  it('RED: a robust Run with no flip or EVPPI evidence at all → [] (absent evidence is not a measurement)', () => {
    expect(run({})?.what_would_change).toEqual([]);
  });

  it('CONTROL C0: a fragile edge is listed exactly as before', () => {
    const brief = run({
      robustness: { level: 'fragile', fragile_edges: [{ edge_id: 'e1', from_id: 'other_growth', to_id: 'mrr', from_label: 'Other MRR growth', to_label: 'MRR' }], robust_edges: [] } as any,
    });
    expect(brief?.what_would_change).toEqual(['Other MRR growth → MRR']);
  });

  it('a found flip threshold names its factor; a flip that was not found names nothing', () => {
    const brief = run({
      flip_thresholds: [
        flip('price', 'Pro plan price', 'found', 55),
        flip('other_growth', 'Other MRR growth', 'no_effect_within_bounds', null),
        flip('churn', 'Monthly churn', 'timeout', null),
      ] as any,
    });
    expect(brief?.what_would_change).toEqual(['Pro plan price']);
  });

  it('an EVPPI above resolution names its factor (label from factor_sensitivity); below resolution names nothing', () => {
    const brief = run({ factor_evppi: [evppi('churn', 'resolved', 1200), evppi('grandfathered', 'below_resolution', 0)] as any });
    expect(brief?.what_would_change).toEqual(['Monthly churn']);
  });

  it('ORDER: fragile edges, then found flips, then EVPPI above resolution — each factor once', () => {
    const brief = run({
      robustness: { level: 'fragile', fragile_edges: [{ edge_id: 'e1', from_id: 'other_growth', to_id: 'mrr', from_label: 'Other MRR growth', to_label: 'MRR' }], robust_edges: [] } as any,
      flip_thresholds: [flip('price', 'Pro plan price', 'found', 55)] as any,
      factor_evppi: [evppi('churn', 'resolved', 1200), evppi('price', 'resolved', 900)] as any,
    });
    expect(brief?.what_would_change).toEqual(['Other MRR growth → MRR', 'Pro plan price', 'Monthly churn']);
  });

  it('an option-pinned lever is never named from a flip or an EVPPI row (the A1b/A1c lever rule)', () => {
    const pinned = [{ ...DRIVERS[3], zero_reason: 'intervention_override' }, ...DRIVERS.slice(0, 3)] as any[];
    const brief = run({
      factor_sensitivity: pinned,
      flip_thresholds: [flip('price', 'Pro plan price', 'found', 55)] as any,
      factor_evppi: [evppi('price', 'resolved', 900)] as any,
    });
    expect(brief?.what_would_change).toEqual([]);
  });
});
