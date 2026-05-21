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
});
