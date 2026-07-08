/**
 * buildISLResponseSummary — the consolidated ISL boundary diagnostic
 * (`event: 'isl_response_summary'`) must not lie about the live wire
 * (lane 29, docs/enrichment-v1/PLOT-V2-READ-FIX-SPEC.md §2.3).
 *
 * Defect pinned RED first: `sensitivity_count` counted the V1-era TOP-LEVEL
 * `islResult.sensitivity` — structurally 0 on every live V2 response — so
 * the consolidated log permanently reported `sensitivity_count: 0` even when
 * `robustness.edge_sensitivity` carried 26 entries. That is exactly the
 * signal an operator checks when diagnosing "empty science", so it must
 * reflect the same wire location the response readers use
 * (getIslEdgeSensitivity).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildISLResponseSummary } from '../src/routes/v2/run.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const capture20260707 = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260707', 'isl-staging-capture.json'), 'utf8'),
);
const capture20260706 = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260706', 'isl-staging-capture.json'), 'utf8'),
);

function summarise(islResult: unknown) {
  return buildISLResponseSummary('req-test', 'seed-test', islResult, 12.3, true, 200, false);
}

describe('buildISLResponseSummary sensitivity_count (spec §2.3)', () => {
  it('counts the NESTED robustness.edge_sensitivity the live V2 wire carries (build 9a22a1a: 26)', () => {
    const summary = summarise(capture20260707);
    expect(capture20260707.robustness.edge_sensitivity).toHaveLength(26);
    expect(summary.sensitivity_count).toBe(26);
  });

  it('reports 0 when the wire genuinely lacks edge sensitivity (build f3f5d92 capture)', () => {
    expect(capture20260706.robustness?.edge_sensitivity).toBeUndefined();
    const summary = summarise(capture20260706);
    expect(summary.sensitivity_count).toBe(0);
  });

  it('tolerates a null/absent ISL result', () => {
    expect(summarise(null).sensitivity_count).toBe(0);
    expect(summarise(undefined).sensitivity_count).toBe(0);
    expect(summarise({}).sensitivity_count).toBe(0);
  });
});

describe('buildISLResponseSummary other counts stay truthful on the live capture', () => {
  it('options/fragile/robust/factor counts match the wire arrays', () => {
    const summary = summarise(capture20260707);
    expect(summary.options_count).toBe(capture20260707.options.length);
    expect(summary.fragile_edges_count).toBe(capture20260707.robustness.fragile_edges.length);
    expect(summary.robust_edges_count).toBe(capture20260707.robustness.robust_edges.length);
    expect(summary.factor_sensitivity_count).toBe(capture20260707.factor_sensitivity.length);
    expect(summary.analysis_status).toBe('computed');
  });
});
