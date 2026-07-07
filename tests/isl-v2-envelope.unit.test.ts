/**
 * ISL V2 envelope accessors — wire-location truth pinned against the RAW live
 * staging capture (tests/fixtures/isl-v2-live-20260706, ISL build f3f5d92,
 * captured 2026-07-06 from PLoT boundary logs).
 *
 * These tests are the machine-checked record of WHY the V1-shaped reads in
 * run.ts were dead:
 *  - top-level `edge_e_values` / `sensitivity` / `validation_status` /
 *    `computed_at` NEVER appear on the live V2 wire;
 *  - edge E-values are NESTED at robustness.edge_e_values;
 *  - the timestamp is top-level `timestamp`;
 *  - per-factor EVPI arrives at top-level `factor_evpi` (including a raw
 *    NEGATIVE entry — MC sampling noise — that must never leak outward).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getIslEdgeEValues,
  getIslComputedAt,
  mapIslFactorEvpi,
} from '../src/integrations/isl/v2-envelope.js';
import {
  classifyEvpiPercentagePointsForEmission,
  EVPI_EMISSION_RESOLUTION_PP,
} from '../src/lib/evpi-emission.js';

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'isl-v2-live-20260706',
);

const captureA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture.json'), 'utf8'),
);
const captureB = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-staging-capture-b.json'), 'utf8'),
);
const requestA = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'isl-v2-request.json'), 'utf8'),
);

describe('live V2 wire shape (fixture integrity — raw capture, do not "fix")', () => {
  it('request pinned response_version=2 semantics: e-values and VOI were requested', () => {
    expect(requestA.include_e_values).toBe(true);
    expect(requestA.include_voi).toBe(true);
    expect(requestA.analysis_types).toEqual(['comparison', 'sensitivity', 'robustness']);
  });

  it.each([['A', captureA], ['B', captureB]])(
    'capture %s: V1-shaped top-level fields are ABSENT on the live V2 wire',
    (_name, capture) => {
      expect('edge_e_values' in capture).toBe(false);
      expect('sensitivity' in capture).toBe(false);
      expect('validation_status' in capture).toBe(false);
      expect('computed_at' in capture).toBe(false);
    },
  );

  it.each([['A', captureA], ['B', captureB]])(
    'capture %s: V2 locations are PRESENT (nested e-values, factor_evpi, timestamp)',
    (_name, capture) => {
      expect(Array.isArray(capture.robustness.edge_e_values)).toBe(true);
      expect(capture.robustness.edge_e_values.length).toBeGreaterThan(0);
      expect(Array.isArray(capture.factor_evpi)).toBe(true);
      expect(capture.factor_evpi.length).toBeGreaterThan(0);
      expect(typeof capture.timestamp).toBe('string');
      expect(capture.version).toBe('2.0');
      expect(capture.endpoint_version).toBe('analyze/v2');
    },
  );

  it('capture A: nested edge_e_values entries carry the documented V2 shape', () => {
    let flippable = 0;
    let unflippable = 0;
    for (const e of captureA.robustness.edge_e_values) {
      expect(typeof e.edge_id).toBe('string');
      expect(typeof e.from_id).toBe('string');
      expect(typeof e.to_id).toBe('string');
      expect(Number.isFinite(e.current_mean)).toBe(true);
      expect(Number.isFinite(e.flip_mean)).toBe(true);
      expect(typeof e.flip_direction).toBe('string');
      expect(typeof e.is_unflippable).toBe('boolean');
      // WIRE FACT: e_value is OMITTED on is_unflippable entries (no finite
      // flip exists, so no e-value). PLoT's numeric-egress guard therefore
      // drops unflippable entries from the outward edge_e_values array —
      // representing them outward needs contract work (recorded followup).
      if (e.is_unflippable) {
        expect('e_value' in e).toBe(false);
        unflippable += 1;
      } else {
        expect(Number.isFinite(e.e_value)).toBe(true);
        flippable += 1;
      }
    }
    expect(flippable).toBe(9);
    expect(unflippable).toBe(4);
  });

  it('capture A: factor_evpi carries a raw NEGATIVE entry (MC noise) — the hygiene target', () => {
    const negative = captureA.factor_evpi.filter((f: any) => f.evpi < 0);
    expect(negative.length).toBeGreaterThan(0);
    expect(negative[0].factor_id).toBe('fac_hiring_cost');
    expect(negative[0].evpi).toBe(-0.0015);
    expect(negative[0].evpi_percentage_points).toBe(-0.15);
  });
});

describe('getIslEdgeEValues', () => {
  it('reads the NESTED robustness.edge_e_values location on the live capture', () => {
    const result = getIslEdgeEValues(captureA);
    expect(result).toBe(captureA.robustness.edge_e_values);
    expect(result!.length).toBe(13);
  });

  it('prefers nested over legacy top-level when both exist', () => {
    const nested = [{ edge_id: 'a->b', e_value: 2, current_mean: 0.1, flip_mean: 0.2, flip_direction: 'increase' }];
    const legacy = [{ edge_id: 'x->y', e_value: 9, current_mean: 0.9, flip_mean: 0.8, flip_direction: 'removal' }];
    const result = getIslEdgeEValues({ robustness: { edge_e_values: nested } as any, edge_e_values: legacy as any });
    expect(result).toBe(nested);
  });

  it('falls back to the legacy top-level location for old fixtures', () => {
    const legacy = [{ edge_id: 'x->y', e_value: 9, current_mean: 0.9, flip_mean: 0.8, flip_direction: 'removal' }];
    expect(getIslEdgeEValues({ edge_e_values: legacy as any })).toBe(legacy);
  });

  it('returns undefined when neither location carries an array', () => {
    expect(getIslEdgeEValues({})).toBeUndefined();
    expect(getIslEdgeEValues(undefined)).toBeUndefined();
    expect(getIslEdgeEValues(null)).toBeUndefined();
    expect(getIslEdgeEValues({ robustness: {} as any })).toBeUndefined();
  });
});

describe('getIslComputedAt', () => {
  it('reads top-level timestamp on the live capture', () => {
    expect(getIslComputedAt(captureA)).toBe(captureA.timestamp);
    expect(getIslComputedAt(captureA)).toBe('2026-07-06T23:32:39.636888Z');
  });

  it('falls back to legacy computed_at for old fixtures', () => {
    expect(getIslComputedAt({ computed_at: '2026-01-01T00:00:00Z' })).toBe('2026-01-01T00:00:00Z');
  });

  it('returns undefined when neither is a non-empty string (caller falls back to own clock)', () => {
    expect(getIslComputedAt({})).toBeUndefined();
    expect(getIslComputedAt({ timestamp: '' as any })).toBeUndefined();
    expect(getIslComputedAt({ timestamp: 123 as any })).toBeUndefined();
    expect(getIslComputedAt(undefined)).toBeUndefined();
  });
});

describe('mapIslFactorEvpi (sanitising mapping — P-5 promoted behind ISL_FACTOR_EVPI_INTERNAL, provisional_doctrine_v0)', () => {
  it('proves the live wire delivers factor_evpi: 4 sanitised entries from capture A', () => {
    const { entries, dropped_invalid } = mapIslFactorEvpi(captureA);
    expect(entries).toHaveLength(4);
    expect(dropped_invalid).toBe(0);
    expect(entries.map((e) => e.factor_id).sort()).toEqual([
      'fac_dev_headcount',
      'fac_hiring_cost',
      'fac_team_maturity',
      'fac_tech_lead',
    ]);
  });

  it('negative raw EVPI (fac_hiring_cost -0.15pp) → below_resolution, NEVER an emittable negative', () => {
    const { entries } = mapIslFactorEvpi(captureA);
    const hiring = entries.find((e) => e.factor_id === 'fac_hiring_cost')!;
    expect(hiring.below_resolution).toBe(true);
    expect(hiring.emit_pp).toBeUndefined();
    // Raw values retained for diagnostics only
    expect(hiring.raw_evpi).toBe(-0.0015);
    expect(hiring.raw_evpi_percentage_points).toBe(-0.15);
  });

  it('no entry ever exposes a negative emittable value', () => {
    const { entries } = mapIslFactorEvpi(captureA);
    for (const e of entries) {
      if (e.emit_pp !== undefined) {
        expect(e.emit_pp).toBeGreaterThanOrEqual(EVPI_EMISSION_RESOLUTION_PP);
      }
    }
  });

  it('above-resolution entries emit rounded percentage points', () => {
    const { entries } = mapIslFactorEvpi(captureA);
    const dev = entries.find((e) => e.factor_id === 'fac_dev_headcount')!;
    expect(dev.below_resolution).toBe(false);
    expect(dev.emit_pp).toBe(1.9); // raw 1.85pp rounded to 0.1pp
    expect(dev.metric_type).toBe('p_win_recommended');
    expect(dev.n_evpi_samples).toBe(500);
  });

  it('tolerates absent/empty/garbage input without crashing', () => {
    expect(mapIslFactorEvpi({})).toEqual({ entries: [], dropped_invalid: 0 });
    expect(mapIslFactorEvpi(undefined)).toEqual({ entries: [], dropped_invalid: 0 });
    expect(mapIslFactorEvpi({ factor_evpi: [] })).toEqual({ entries: [], dropped_invalid: 0 });
    const garbage = mapIslFactorEvpi({
      factor_evpi: [
        null,
        { factor_id: 'ok', evpi: 0.01, evpi_percentage_points: 1.0, current_metric: 0.5, perfect_metric: 0.51, metric_type: 'x', n_evpi_samples: 10 },
        { factor_id: 'bad', evpi: Number.NaN, evpi_percentage_points: 1.0 },
        { evpi: 0.01, evpi_percentage_points: 1.0 },
      ] as any,
    });
    expect(garbage.entries).toHaveLength(1);
    expect(garbage.dropped_invalid).toBe(3);
  });

  it("honours ISL's evpi_status='below_resolution' even when the raw value clears PLoT's threshold", () => {
    const { entries } = mapIslFactorEvpi({
      factor_evpi: [
        {
          factor_id: 'fac_x', evpi: 0.02, evpi_percentage_points: 2.0,
          current_metric: 0.5, perfect_metric: 0.52, metric_type: 'p_win_recommended',
          n_evpi_samples: 500, evpi_status: 'below_resolution',
        },
      ] as any,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].below_resolution).toBe(true);
    expect(entries[0].emit_pp).toBeUndefined(); // producer's own label wins
  });

  it("does NOT let evpi_status='ok' override PLoT's threshold for sub-resolution raws", () => {
    const { entries } = mapIslFactorEvpi({
      factor_evpi: [
        {
          factor_id: 'fac_y', evpi: -0.0001, evpi_percentage_points: -0.01,
          current_metric: 0.5, perfect_metric: 0.4999, metric_type: 'p_win_recommended',
          n_evpi_samples: 500, evpi_status: 'ok',
        },
      ] as any,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].below_resolution).toBe(true); // local threshold still applies
    expect(entries[0].emit_pp).toBeUndefined();
  });
});

describe('classifyEvpiPercentagePointsForEmission', () => {
  it('labels negatives below-resolution instead of clamping to zero', () => {
    const c = classifyEvpiPercentagePointsForEmission(-0.15);
    expect(c.emit).toBeUndefined();
    expect(c.below_resolution).toBe(true);
    expect(c.raw).toBe(-0.15);
  });

  it('labels tiny positives below-resolution (indistinguishable from zero at 0.1pp)', () => {
    const c = classifyEvpiPercentagePointsForEmission(0.03);
    expect(c.emit).toBeUndefined();
    expect(c.below_resolution).toBe(true);
  });

  it('emits rounded values at/above resolution', () => {
    expect(classifyEvpiPercentagePointsForEmission(1.85).emit).toBe(1.9);
    expect(classifyEvpiPercentagePointsForEmission(0.85).emit).toBe(0.9);
    expect(classifyEvpiPercentagePointsForEmission(EVPI_EMISSION_RESOLUTION_PP).below_resolution).toBe(false);
  });

  it('non-finite input is absence, not a below-resolution measurement', () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const c = classifyEvpiPercentagePointsForEmission(v);
      expect(c.emit).toBeUndefined();
      expect(c.below_resolution).toBe(false);
    }
  });
});
