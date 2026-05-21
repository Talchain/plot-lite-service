/**
 * Driver-direction regression fixture.
 *
 * Locks in the current correct behaviour of assembleBrief's top_drivers:
 * negative-elasticity cost / time / risk factors must surface with
 * direction = 'negative' and sensitivity = abs(elasticity). The investigation
 * found no bug here; this test exists to catch regressions if a future change
 * flattens factor sign into absolute impact.
 *
 * Per the post-analysis-wording-honesty workstream, no production change to
 * src/assembly/decision-brief.ts is required unless this test fails.
 */

import { describe, it, expect } from 'vitest';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';

const MINIMAL_OPTIONS = [
  { option_id: 'opt_a', option_label: 'Option A', id: 'opt_a', label: 'Option A', win_probability: 0.6 },
  { option_id: 'opt_b', option_label: 'Option B', id: 'opt_b', label: 'Option B', win_probability: 0.4 },
] as any[];

const baseInput: BriefAssemblyInput = {
  analysis_status: 'computed',
  critiques: [],
  option_comparison: MINIMAL_OPTIONS,
  robustness: { level: 'moderate', fragile_edges: [], robust_edges: [] } as any,
  meta: { seed_used: '1' },
} as any;

describe('assembleBrief — driver direction regression', () => {
  it('cost factor (negative elasticity) surfaces as direction: negative with absolute sensitivity', () => {
    const result = assembleBrief({
      ...baseInput,
      factor_sensitivity: [
        { factor_id: 'cost', factor_label: 'Campaign cost', elasticity: -0.85, direction: 'negative' },
        { factor_id: 'brand', factor_label: 'Brand awareness', elasticity: 0.5, direction: 'positive' },
      ] as any[],
    } as any);

    const costDriver = result?.top_drivers.find((d) => d.factor_label === 'Campaign cost');
    expect(costDriver).toBeDefined();
    expect(costDriver!.direction).toBe('negative');
    expect(costDriver!.sensitivity).toBeCloseTo(0.85, 5);
  });

  it('time-burden factor (negative elasticity) surfaces as direction: negative', () => {
    const result = assembleBrief({
      ...baseInput,
      factor_sensitivity: [
        { factor_id: 'time_to_ship', factor_label: 'Time to ship', elasticity: -0.7, direction: 'negative' },
      ] as any[],
    } as any);

    const timeDriver = result?.top_drivers.find((d) => d.factor_label === 'Time to ship');
    expect(timeDriver).toBeDefined();
    expect(timeDriver!.direction).toBe('negative');
    expect(timeDriver!.sensitivity).toBeCloseTo(0.7, 5);
  });

  it('risk factor (negative elasticity) surfaces as direction: negative', () => {
    const result = assembleBrief({
      ...baseInput,
      factor_sensitivity: [
        { factor_id: 'execution_risk', factor_label: 'Execution risk', elasticity: -0.6, direction: 'negative' },
      ] as any[],
    } as any);

    const riskDriver = result?.top_drivers.find((d) => d.factor_label === 'Execution risk');
    expect(riskDriver).toBeDefined();
    expect(riskDriver!.direction).toBe('negative');
    expect(riskDriver!.sensitivity).toBeCloseTo(0.6, 5);
  });

  it('mixed positive and negative drivers retain their respective directions', () => {
    const result = assembleBrief({
      ...baseInput,
      factor_sensitivity: [
        { factor_id: 'brand', factor_label: 'Brand awareness', elasticity: 0.8, direction: 'positive' },
        { factor_id: 'cost', factor_label: 'Campaign cost', elasticity: -0.85, direction: 'negative' },
        { factor_id: 'time_to_ship', factor_label: 'Time to ship', elasticity: -0.4, direction: 'negative' },
      ] as any[],
    } as any);

    expect(result?.top_drivers.find((d) => d.factor_label === 'Brand awareness')?.direction).toBe('positive');
    expect(result?.top_drivers.find((d) => d.factor_label === 'Campaign cost')?.direction).toBe('negative');
    expect(result?.top_drivers.find((d) => d.factor_label === 'Time to ship')?.direction).toBe('negative');

    for (const d of result!.top_drivers) {
      expect(d.sensitivity).toBeGreaterThanOrEqual(0);
    }
  });

  // -------------------------------------------------------------------------
  // Production-shape regressions
  //
  // Real factor_sensitivity inputs reaching assembleBrief never carry a signed
  // `elasticity`. The graph path sets `elasticity = normalised_influence`
  // (always >= 0); the ISL path sets `elasticity = null`. The signed signal
  // lives on the `direction` field instead. These cases lock in that
  // buildTopDrivers honours that upstream signal.
  // -------------------------------------------------------------------------

  it('production shape: direction=negative with positive (magnitude) elasticity preserves negative', () => {
    // Mirrors the staging-bundle bug: Annual Salary Cost arrives from the
    // graph path with normalised_influence ≈ 0.85 (positive magnitude) and
    // direction = 'negative'. decision_brief.top_drivers must report negative.
    const result = assembleBrief({
      ...baseInput,
      factor_sensitivity: [
        { factor_id: 'annual_salary_cost', factor_label: 'Annual Salary Cost', elasticity: 0.85, direction: 'negative' },
        { factor_id: 'team_maturity', factor_label: 'Team Technical Maturity', elasticity: 0.6, direction: 'positive' },
      ] as any[],
    } as any);

    const cost = result?.top_drivers.find((d) => d.factor_label === 'Annual Salary Cost');
    expect(cost).toBeDefined();
    expect(cost!.direction).toBe('negative');
    expect(cost!.sensitivity).toBeCloseTo(0.85, 5);

    const maturity = result?.top_drivers.find((d) => d.factor_label === 'Team Technical Maturity');
    expect(maturity!.direction).toBe('positive');
    expect(maturity!.sensitivity).toBeCloseTo(0.6, 5);
  });

  it('direction-vs-sign disagreement: upstream direction wins over elasticity sign', () => {
    // Documents the contract: when upstream sets direction explicitly,
    // buildTopDrivers respects it regardless of elasticity sign.
    const result = assembleBrief({
      ...baseInput,
      factor_sensitivity: [
        { factor_id: 'brand', factor_label: 'Brand awareness', elasticity: -0.7, direction: 'positive' },
        { factor_id: 'cost', factor_label: 'Campaign cost', elasticity: 0.5, direction: 'negative' },
      ] as any[],
    } as any);

    expect(result?.top_drivers.find((d) => d.factor_label === 'Brand awareness')?.direction).toBe('positive');
    expect(result?.top_drivers.find((d) => d.factor_label === 'Campaign cost')?.direction).toBe('negative');
  });

  it('mixed direction with positive elasticity falls back to positive (documented limitation)', () => {
    // BriefDriver.direction is the narrow union 'positive' | 'negative'.
    // Upstream 'mixed' / 'unknown' / missing must collapse to one of those.
    // The fallback is sign(elasticity); unsigned magnitudes therefore land on
    // 'positive'. This is the unavoidable narrowing the workstream brief
    // allows — known signed signals (above) take precedence over it.
    const result = assembleBrief({
      ...baseInput,
      factor_sensitivity: [
        { factor_id: 'mixed_factor', factor_label: 'Mixed-direction factor', elasticity: 0.6, direction: 'mixed' },
        { factor_id: 'unknown_factor', factor_label: 'Unknown-direction factor', elasticity: 0.5, direction: 'unknown' },
        { factor_id: 'missing_factor', factor_label: 'No-direction factor', elasticity: 0.4 },
      ] as any[],
    } as any);

    expect(result?.top_drivers.find((d) => d.factor_label === 'Mixed-direction factor')?.direction).toBe('positive');
    expect(result?.top_drivers.find((d) => d.factor_label === 'Unknown-direction factor')?.direction).toBe('positive');
    expect(result?.top_drivers.find((d) => d.factor_label === 'No-direction factor')?.direction).toBe('positive');
  });

  it('mixed/unknown direction with negative elasticity falls back to negative', () => {
    const result = assembleBrief({
      ...baseInput,
      factor_sensitivity: [
        { factor_id: 'mixed_neg', factor_label: 'Mixed negative magnitude', elasticity: -0.5, direction: 'mixed' },
        { factor_id: 'missing_neg', factor_label: 'No direction negative magnitude', elasticity: -0.3 },
      ] as any[],
    } as any);

    expect(result?.top_drivers.find((d) => d.factor_label === 'Mixed negative magnitude')?.direction).toBe('negative');
    expect(result?.top_drivers.find((d) => d.factor_label === 'No direction negative magnitude')?.direction).toBe('negative');
  });
});
