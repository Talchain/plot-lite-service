/**
 * ISL V2 envelope accessors — wire-location truth for the NEW fields pinned
 * against the RAW live staging captures:
 *
 *  - tests/fixtures/isl-v2-live-20260707 (ISL build 9a22a1a, captured
 *    2026-07-07 via authenticated POST — see PROVENANCE.md): FIRST build
 *    emitting nested robustness.edge_sensitivity, top-level
 *    sensitivity_reference_option_id, and request-gated path_decomposition
 *    (ISL lane 11 / ISL PR #65).
 *  - tests/fixtures/isl-v2-live-20260706 (ISL build f3f5d92): the OLDER wire
 *    that omits all three — pins the warning path for older deployments.
 *
 * These tests are the machine-checked record of WHERE the new fields live
 * and that getIslEdgeSensitivity distinguishes the two deployed generations.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getIslEdgeSensitivity } from '../src/integrations/isl/v2-envelope.js';

const FIXTURES = dirname(fileURLToPath(import.meta.url));

const newCapture = JSON.parse(
  readFileSync(join(FIXTURES, 'fixtures', 'isl-v2-live-20260707', 'isl-staging-capture.json'), 'utf8'),
);
const newCapturePathDecomp = JSON.parse(
  readFileSync(join(FIXTURES, 'fixtures', 'isl-v2-live-20260707', 'isl-staging-capture-pathdecomp.json'), 'utf8'),
);
const newRequest = JSON.parse(
  readFileSync(join(FIXTURES, 'fixtures', 'isl-v2-live-20260707', 'isl-v2-request.json'), 'utf8'),
);
const newRequestPathDecomp = JSON.parse(
  readFileSync(join(FIXTURES, 'fixtures', 'isl-v2-live-20260707', 'isl-v2-request-pathdecomp.json'), 'utf8'),
);
const oldCapture = JSON.parse(
  readFileSync(join(FIXTURES, 'fixtures', 'isl-v2-live-20260706', 'isl-staging-capture.json'), 'utf8'),
);
const oldRequest = JSON.parse(
  readFileSync(join(FIXTURES, 'fixtures', 'isl-v2-live-20260706', 'isl-v2-request.json'), 'utf8'),
);

describe('20260707 wire shape (fixture integrity — raw capture, do not "fix")', () => {
  it('same request as the 20260706 capture A — the only variable is the deployed build', () => {
    // Byte-identical request bodies (PROVENANCE.md): any wire difference is
    // attributable to the ISL build, not to the request.
    expect(newRequest).toEqual(oldRequest);
    expect(newCapture.build).toBe('9a22a1a');
    expect(oldCapture.build).toBe('f3f5d92');
    // Deterministic seeded run: same seed echoed on both builds.
    expect(newCapture.seed_used).toBe(oldCapture.seed_used);
  });

  it('pathdecomp request differs from request A ONLY by include_path_decomposition', () => {
    const { include_path_decomposition, ...rest } = newRequestPathDecomp;
    expect(include_path_decomposition).toBe(true);
    expect(rest).toEqual(newRequest);
  });

  it('edge sensitivity is NESTED at robustness.edge_sensitivity (26 EdgeSensitivityV2 entries); top-level sensitivity stays absent', () => {
    expect('sensitivity' in newCapture).toBe(false); // V1-era location still dead
    const es = newCapture.robustness.edge_sensitivity;
    expect(Array.isArray(es)).toBe(true);
    expect(es.length).toBe(26);
    for (const e of es) {
      expect(typeof e.edge_id).toBe('string');
      expect(e.edge_id).toBe(`${e.from_id}->${e.to_id}`); // ISL arrow format
      expect(['existence', 'magnitude']).toContain(e.sensitivity_type);
      expect(typeof e.sensitivity_score).toBe('number');
      expect(e.sensitivity_score).toBeGreaterThanOrEqual(0);
      expect(e.sensitivity_score).toBeLessThanOrEqual(1);
      expect(['positive', 'negative']).toContain(e.direction);
      expect(Number.isFinite(e.elasticity)).toBe(true);
      expect(Number.isInteger(e.importance_rank)).toBe(true);
      expect(e.importance_rank).toBeGreaterThanOrEqual(1);
      expect(typeof e.interpretation).toBe('string');
    }
  });

  it('sensitivity_reference_option_id is top-level and names the FIRST request option (T1-5 disclosure)', () => {
    expect(newCapture.sensitivity_reference_option_id).toBe(newRequest.options[0].id);
    expect(newCapture.sensitivity_reference_option_id).toBe('opt_one_dev');
  });

  it('path_decomposition is request-gated: ABSENT without the flag, top-level WITH it', () => {
    expect('path_decomposition' in newCapture).toBe(false);
    const pd = newCapturePathDecomp.path_decomposition;
    expect(pd).toBeDefined();
    expect(typeof pd.recommended_option_id).toBe('string');
    expect(Array.isArray(pd.entry_nodes)).toBe(true);
    expect(typeof pd.truncated).toBe('boolean');
    expect(Number.isInteger(pd.path_count)).toBe(true);
    expect(Array.isArray(pd.paths)).toBe(true);
    expect(pd.paths.length).toBeLessThanOrEqual(3); // top-3 ranking
  });

  it('older wire (f3f5d92) omits ALL THREE new fields — the warning path stays real for older deployments', () => {
    expect(oldCapture.robustness.edge_sensitivity).toBeUndefined();
    expect('sensitivity_reference_option_id' in oldCapture).toBe(false);
    expect('path_decomposition' in oldCapture).toBe(false);
  });
});

describe('getIslEdgeSensitivity (canonical nested read)', () => {
  it('returns the 26 nested entries on the 9a22a1a capture', () => {
    const es = getIslEdgeSensitivity(newCapture);
    expect(es).toBeDefined();
    expect(es!.length).toBe(26);
    expect(es).toBe(newCapture.robustness.edge_sensitivity); // same array, no copy
  });

  it('returns undefined on the older f3f5d92 capture (warning path reachable)', () => {
    expect(getIslEdgeSensitivity(oldCapture)).toBeUndefined();
  });

  it('returns undefined for null/undefined/empty/malformed inputs', () => {
    expect(getIslEdgeSensitivity(null)).toBeUndefined();
    expect(getIslEdgeSensitivity(undefined)).toBeUndefined();
    expect(getIslEdgeSensitivity({})).toBeUndefined();
    expect(getIslEdgeSensitivity({ robustness: {} } as any)).toBeUndefined();
    expect(getIslEdgeSensitivity({ robustness: { edge_sensitivity: [] } } as any)).toBeUndefined();
    expect(getIslEdgeSensitivity({ robustness: { edge_sensitivity: 'nope' } } as any)).toBeUndefined();
  });

  it('does NOT fall back to the V1-era top-level sensitivity field (different shape, dead on the live wire)', () => {
    const legacyOnly = {
      sensitivity: [
        {
          edge_from: 'a', edge_to: 'b', sensitivity_type: 'existence',
          elasticity: 0.5, importance_rank: 1, interpretation: 'legacy',
        },
      ],
    } as any;
    expect(getIslEdgeSensitivity(legacyOnly)).toBeUndefined();
  });
});
