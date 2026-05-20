/**
 * /v2/run route-level contract for the additive margin-sensitivity surface.
 *
 * The helper-, classifier-, denormaliser-, and hash-stability tests cover the
 * pieces. This file exercises the full assembly path: a real POST through
 * `/v2/run`, asserting that the new top-level fields (`flip_thresholds_margin_status`,
 * `flip_thresholds_margin_coverage`) and the per-entry `margin_sensitivity`
 * object are emitted with the documented shape. Catches future route-wiring
 * regressions that the granular tests cannot.
 *
 * @see PR #171 (margin-sensitivity diagnostic) and the follow-up review.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { spawnServer, requestJSON, type ServerHandle } from './utils.js';

describe('V2 Run · margin-sensitivity contract', () => {
  let server: ServerHandle | null = null;

  const ENV = {
    TEST_ROUTES: '1',
    AUTH_ENABLED: '0',
    RATE_LIMIT_ENABLED: '0',
  };

  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it('emits the new margin diagnostic fields with documented shape on a flip-threshold-bearing graph', async () => {
    vi.resetModules();
    server = await spawnServer({ env: ENV });

    // A multi-factor graph with two options that intervene on the same factor.
    // The other factors become flip-threshold candidates (after intervention
    // exclusion from PR #166), each of which exercises the Step-0 probe path
    // and therefore the margin-sensitivity hook.
    const res = await requestJSON(`${server.baseUrl}/v2/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: {
          nodes: [
            {
              id: 'marketing-spend',
              kind: 'factor',
              label: 'Marketing Spend',
              observed_state: { value: 60, baseline: 60, unit: 'GBP-k' },
              state_space: { range: { min: 0, max: 120 } },
            },
            {
              id: 'conversion-rate',
              kind: 'factor',
              label: 'Conversion Rate',
              observed_state: { value: 0.04, baseline: 0.04, unit: '%' },
              state_space: { range: { min: 0.01, max: 0.1 } },
            },
            {
              id: 'brand-awareness',
              kind: 'factor',
              label: 'Brand Awareness',
              observed_state: { value: 0.5, baseline: 0.5 },
              state_space: { range: { min: 0, max: 1 } },
            },
            { id: 'revenue', kind: 'goal', label: 'Revenue' },
          ],
          edges: [
            { from: 'marketing-spend', to: 'brand-awareness', exists_probability: 0.9, strength: { mean: 0.55, std: 0.1 } },
            { from: 'conversion-rate', to: 'revenue', exists_probability: 0.95, strength: { mean: 0.8, std: 0.08 } },
            { from: 'brand-awareness', to: 'revenue', exists_probability: 0.85, strength: { mean: 0.6, std: 0.12 } },
          ],
        },
        options: [
          {
            id: 'opt-aggressive',
            label: 'Aggressive Spend',
            interventions: { 'marketing-spend': { value: 110, source: 'user_specified' } },
          },
          {
            id: 'opt-conservative',
            label: 'Conservative Spend',
            interventions: { 'marketing-spend': { value: 30, source: 'user_specified' } },
          },
        ],
        goal_node_id: 'revenue',
      }),
    });

    expect(res.status).toBe(200);
    const body = res.data as Record<string, unknown>;

    // Existing strict-flip status surface (PR #167) must still be present.
    expect(body).toHaveProperty('flip_thresholds_status');
    expect(['computed', 'all_no_effect', 'partial_no_effect', 'unresolved', 'unavailable'])
      .toContain(body.flip_thresholds_status);

    // ===== New top-level margin diagnostic =====
    expect(body).toHaveProperty('flip_thresholds_margin_status');
    expect(['computed', 'partial_movement', 'all_none', 'unavailable'])
      .toContain(body.flip_thresholds_margin_status);

    expect(body).toHaveProperty('flip_thresholds_margin_coverage');
    const cov = body.flip_thresholds_margin_coverage as { total: number; with_margin: number; without_margin: number };
    expect(cov).toMatchObject({
      total: expect.any(Number),
      with_margin: expect.any(Number),
      without_margin: expect.any(Number),
    });
    // Coverage internal consistency:
    expect(cov.total).toBeGreaterThanOrEqual(0);
    expect(cov.with_margin).toBeGreaterThanOrEqual(0);
    expect(cov.without_margin).toBeGreaterThanOrEqual(0);
    expect(cov.with_margin + cov.without_margin).toBe(cov.total);

    // ===== Per-entry margin_sensitivity (when flip_thresholds[] is populated) =====
    const ft = body.flip_thresholds as Array<Record<string, unknown>> | undefined;
    if (ft && ft.length > 0) {
      // Coverage must match the actual array length.
      expect(cov.total).toBe(ft.length);

      // Every entry that completed Step-0 probes should carry margin_sensitivity.
      // (Entries that did NOT carry it are counted in cov.without_margin.)
      const withMargin = ft.filter((e) => e.margin_sensitivity !== undefined);
      expect(withMargin.length).toBe(cov.with_margin);

      // Every margin_sensitivity object must have the full documented shape.
      for (const e of withMargin) {
        const ms = e.margin_sensitivity as Record<string, unknown>;
        // Movement + classification fields.
        expect(['none', 'weakened', 'strengthened', 'flipped']).toContain(ms.movement);
        expect(typeof ms.threshold).toBe('number');
        expect(['towards_min', 'towards_max', 'both', 'none']).toContain(ms.strongest_direction);
        expect(['normalised', 'display']).toContain(ms.value_scale);

        // Numeric fields are finite-or-null.
        const numericKeys = [
          'baseline_margin',
          'min_probe_margin',
          'max_probe_margin',
          'min_probe_delta',
          'max_probe_delta',
          'strongest_probe_value',
          'strongest_delta',
          'strongest_delta_abs',
          'strongest_delta_percentage_points',
        ] as const;
        for (const k of numericKeys) {
          const v = ms[k];
          if (v !== null && v !== undefined) {
            expect(Number.isFinite(v)).toBe(true);
          }
        }

        // Display-ready field invariants.
        expect(typeof ms.display_value_available).toBe('boolean');

        if (ms.movement === 'none') {
          // No movement → strongest_delta family must all be null.
          expect(ms.strongest_delta).toBeNull();
          expect(ms.strongest_delta_abs).toBeNull();
          expect(ms.strongest_delta_percentage_points).toBeNull();
        } else if (ms.strongest_delta !== null && ms.strongest_delta !== undefined) {
          // When populated, abs and pp must be coherent with strongest_delta.
          const sd = ms.strongest_delta as number;
          const sda = ms.strongest_delta_abs as number;
          const sdpp = ms.strongest_delta_percentage_points as number;
          expect(sda).toBeCloseTo(Math.abs(sd), 10);
          expect(sdpp).toBeCloseTo(sda * 100, 6);
        }

        // display_value_available implies value_scale === 'display' AND strongest_probe_value is finite.
        if (ms.display_value_available === true) {
          expect(ms.value_scale).toBe('display');
          expect(Number.isFinite(ms.strongest_probe_value)).toBe(true);
        }

        // Existing strict-flip fields preserved on the surrounding entry.
        expect(e).toHaveProperty('flip_value');
        expect(e).toHaveProperty('flip_reason');
        expect(e).toHaveProperty('iterations_used');
      }
    } else {
      // No flip_thresholds[] → status must be 'unavailable' for both classifiers.
      expect(body.flip_thresholds_margin_status).toBe('unavailable');
      expect(cov.total).toBe(0);
    }

    // The diagnostic fields are excluded from response_hash. Hash must still
    // be present and well-formed (existing hash invariant).
    if ('response_hash' in body) {
      const h = body.response_hash;
      expect(typeof h).toBe('string');
      expect(h as string).toMatch(/^[a-f0-9]{16}$/);
    }
  }, 30_000);
});
