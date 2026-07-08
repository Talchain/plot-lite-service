/**
 * ISL → PLoT wire-shape contract (V2 envelope field locations).
 *
 * FAILS WHEN: a consumer (PLoT) read-path points at a field the producer
 * (ISL) does not emit — the exact defect class that made edge_e_values /
 * edge sensitivity / VOI "structurally empty" on the live wire for weeks
 * (V1-era top-level reads against a V2 wire that nests them under
 * `robustness.*`).
 *
 * Evidence: REAL wire captures from isl-staging — the SAME byte-identical
 * request replayed against each deployed build (capture method: each
 * directory's PROVENANCE.md), so the only variable is the ISL build:
 *   - tests/fixtures/isl-v2-live-20260707 — build 9a22a1a (2026-07-07)
 *   - tests/fixtures/isl-v2-live-20260708 — build 3773f76 (2026-07-08,
 *     lane 29 §3.2 re-verification of the then-deployed build)
 * The PLoT-side accessor manifest is src/integrations/isl/v2-envelope.ts.
 *
 * WHEN THIS FAILS after an ISL redeploy: either ISL moved/renamed a field
 * (fix ISL or update PLoT's v2-envelope.ts accessors AND this manifest in
 * the same change), or ISL started emitting a field this manifest pins as
 * absent (upgrade the read-path deliberately — never silently).
 *
 * INSTALLED per docs/enrichment-v1/PLOT-V2-READ-FIX-SPEC.md §3.1 (lane 29)
 * from olumi-schemas contract-tests/isl-to-plot.contract.test.ts.
 * Adaptations from the reference copy (assertions unchanged):
 *  - FIXTURE points at this repo's raw captures (the olumi-schemas mirror
 *    wraps the same bytes under a `{ _provenance, response }` envelope;
 *    here the file IS the raw response, so no `.response` unwrap).
 *  - Parameterised over every verified capture (the reference copy pinned
 *    only the 20260707 one).
 *  - The `@talchain/schemas/boundary` import swap is DEFERRED until PLoT
 *    pins schemas >= 0.14.0 (currently 0.13.1, which does not export
 *    AnalysisEnrichmentSchema) — the reference spec imports no schema
 *    either, so nothing is lost.
 * Refresh the fixture whenever the deployed ISL build changes materially.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const CAPTURES = ['isl-v2-live-20260707', 'isl-v2-live-20260708'] as const;

describe.each(CAPTURES)('ISL→PLoT wire contract (%s)', (fixtureDir) => {
  const isl: Record<string, unknown> = JSON.parse(
    readFileSync(join(here, '..', 'fixtures', fixtureDir, 'isl-staging-capture.json'), 'utf-8'),
  );
  const robustness = isl.robustness as Record<string, unknown>;

  describe('fields PLoT reads MUST exist where PLoT reads them', () => {
    it('edge E-values live NESTED at robustness.edge_e_values (getIslEdgeEValues)', () => {
      expect(Array.isArray(robustness.edge_e_values)).toBe(true);
      const entry = (robustness.edge_e_values as Array<Record<string, unknown>>)[0];
      // Load-bearing keys for PLoT transformEdgeEValues:
      for (const key of ['edge_id', 'from_id', 'to_id', 'e_value', 'flip_direction', 'current_mean', 'flip_mean']) {
        expect(entry, `edge_e_values[0].${key}`).toHaveProperty(key);
      }
    });

    it('edge sensitivity lives NESTED at robustness.edge_sensitivity (getIslEdgeSensitivity; ISL build 9a22a1a+)', () => {
      expect(Array.isArray(robustness.edge_sensitivity)).toBe(true);
      const entry = (robustness.edge_sensitivity as Array<Record<string, unknown>>)[0];
      for (const key of ['edge_id', 'from_id', 'to_id', 'sensitivity_type', 'elasticity', 'importance_rank']) {
        expect(entry, `edge_sensitivity[0].${key}`).toHaveProperty(key);
      }
    });

    it('computation timestamp lives at top-level `timestamp` (getIslComputedAt)', () => {
      expect(typeof isl.timestamp).toBe('string');
      expect((isl.timestamp as string).length).toBeGreaterThan(0);
    });

    it('per-factor EVPI lives at top-level `factor_evpi` (mapIslFactorEvpi, P-5)', () => {
      expect(Array.isArray(isl.factor_evpi)).toBe(true);
      const entry = (isl.factor_evpi as Array<Record<string, unknown>>)[0];
      for (const key of ['factor_id', 'evpi', 'evpi_percentage_points', 'metric_type']) {
        expect(entry, `factor_evpi[0].${key}`).toHaveProperty(key);
      }
      // evpi_status is conditionally present ('below_resolution') — when present
      // PLoT must honour it instead of emitting a clamped 0.
    });

    it('factor sensitivity entries carry the keys mapIslFactorEntry reads', () => {
      expect(Array.isArray(isl.factor_sensitivity)).toBe(true);
      const entry = (isl.factor_sensitivity as Array<Record<string, unknown>>)[0];
      for (const key of ['node_id', 'label', 'sensitivity_score', 'elasticity', 'direction', 'importance_rank', 'confidence', 'attribution_stability', 'elasticity_std', 'rank_flip_rate', 'stability_method']) {
        expect(entry, `factor_sensitivity[0].${key}`).toHaveProperty(key);
      }
    });

    it('per-option results live at top-level `options` with id/label/outcome/win_probability', () => {
      expect(Array.isArray(isl.options)).toBe(true);
      const entry = (isl.options as Array<Record<string, unknown>>)[0];
      for (const key of ['id', 'label', 'outcome', 'status', 'win_probability']) {
        expect(entry, `options[0].${key}`).toHaveProperty(key);
      }
    });

    it('reference-option disclosure lives at top-level sensitivity_reference_option_id (build 9a22a1a+)', () => {
      expect(typeof isl.sensitivity_reference_option_id).toBe('string');
    });

    it('inference_warnings is ALWAYS an array (sentinel contract; [] when none)', () => {
      expect(Array.isArray(isl.inference_warnings)).toBe(true);
    });

    it('wire-generation version markers are declared (build / engine_version / version=2.x — lane 29 §2.1)', () => {
      expect(typeof isl.build).toBe('string');
      expect(typeof isl.engine_version).toBe('string');
      expect(isl.version).toMatch(/^2(\.|$)/);
    });
  });

  describe('V1-era read locations the V2 wire does NOT emit (dead-read pins)', () => {
    // Each of these was a PLoT read-path that silently produced "empty science"
    // because the V2 wire never carried the field at that location. PLoT's
    // v2-envelope.ts accessors now read the correct locations; these pins
    // ensure nobody re-introduces the dead reads on the strength of stale docs,
    // and fire deliberately if ISL ever starts emitting them.

    it('top-level edge_e_values is NOT emitted (nested under robustness instead)', () => {
      expect(isl).not.toHaveProperty('edge_e_values');
    });

    it('top-level sensitivity is NOT emitted (edge sensitivity nests under robustness)', () => {
      expect(isl).not.toHaveProperty('sensitivity');
    });

    it('top-level validation_status is NOT emitted on the V2 wire', () => {
      expect(isl).not.toHaveProperty('validation_status');
    });

    it('top-level computed_at is NOT emitted (use `timestamp`)', () => {
      expect(isl).not.toHaveProperty('computed_at');
    });

    it('factor_sensitivity[].value_of_information is NOT emitted (use factor_evpi[])', () => {
      for (const entry of isl.factor_sensitivity as Array<Record<string, unknown>>) {
        expect(entry).not.toHaveProperty('value_of_information');
      }
    });

    it('robustness.recommendation_stability IS still emitted by ISL but is DEPRECATED downstream', () => {
      // ISL derives it as the leader's win_probability relabelled (zero
      // independent information); PLoT no longer re-emits it (lane H item B).
      // Pinned here so a change in ISL's emission is noticed, not inferred.
      expect(robustness).toHaveProperty('recommendation_stability');
    });
  });
});
