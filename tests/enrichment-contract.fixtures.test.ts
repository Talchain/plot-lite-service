/**
 * Enrichment contract — fixture conformance (A3 lane 1, CI contract test).
 *
 * Every checked-in /v2/run response fixture must conform to the typed
 * PLoT→CEE enrichment envelope (`AnalysisEnrichmentSchema`, VENDORED
 * @talchain/schemas — the same bytes CEE's shadow validator runs). This is
 * the producer-side CI tripwire: a PLoT change that lands a non-conformant
 * shape in a fixture goes RED here, in the repo that caused it, instead of
 * surfacing only in CEE's (default-off) shadow telemetry.
 *
 * Derive-don't-mirror: the fixture list is DISCOVERED on disk (every
 * plot-response.json under contracts/examples/ and tests/golden/), never
 * hand-listed, and the discovery itself FAILS LOUD when it finds fewer than
 * the floor known today — an empty glob must never pass vacuously.
 *
 * Positive controls (an absence-of-failure assertion without a control is
 * vacuous): deliberately corrupted variants of a real fixture MUST fail
 * validation, one per corruption class (bad enum, bad scalar type, bad
 * entry shape, bad container type). If the schema stops discriminating —
 * e.g. a future vendored bump accidentally loosens the typed keys — these
 * go RED.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AnalysisEnrichmentSchema } from '@talchain/schemas/boundary';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Known fixture count TODAY (4). Discovery asserts >= this floor so a moved
 * directory or renamed convention fails loud instead of silently shrinking
 * coverage to zero. New fixtures are picked up automatically.
 */
const FIXTURE_COUNT_FLOOR = 4;

function discoverPlotResponseFixtures(): string[] {
  const roots = ['contracts/examples', 'tests/golden'];
  const found: string[] = [];
  for (const root of roots) {
    const abs = join(REPO_ROOT, root);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(abs, entry.name, 'plot-response.json');
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  return found.sort();
}

const fixtures = discoverPlotResponseFixtures();

describe('enrichment contract — checked-in /v2/run fixtures conform to the vendored envelope', () => {
  it(`fixture discovery finds at least ${FIXTURE_COUNT_FLOOR} plot-response.json fixtures (fail-loud, never vacuous)`, () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(FIXTURE_COUNT_FLOOR);
  });

  for (const fixturePath of fixtures) {
    const rel = relative(REPO_ROOT, fixturePath);

    it(`${rel} conforms to AnalysisEnrichmentSchema`, () => {
      const body = JSON.parse(readFileSync(fixturePath, 'utf8'));
      const result = AnalysisEnrichmentSchema.safeParse(body);
      if (!result.success) {
        // Diagnostics: paths + codes only — never values.
        const issues = result.error.issues.map((i) => `${i.path.join('.')} (${i.code})`);
        expect.fail(`schema violations: ${issues.join(', ')}`);
      }
      expect(result.success).toBe(true);
    });

    it(`${rel} survives .parse() with ZERO key loss (passthrough guarantee)`, () => {
      // The envelope is passthrough at every level BY DESIGN — a vendored
      // bump that silently switches to strip() would start dropping
      // producer-ahead fields at any future "use the parsed value" call
      // site. Deep-equality of parse output vs input pins that guarantee.
      const body = JSON.parse(readFileSync(fixturePath, 'utf8'));
      const parsed = AnalysisEnrichmentSchema.parse(body);
      expect(parsed).toEqual(body);
    });
  }

  describe('positive controls — the schema DISCRIMINATES (corrupted variants must FAIL)', () => {
    // Use a real conformant fixture as the base for each corruption so the
    // control exercises the same shape the passing assertions do.
    const basePath = fixtures.find((f) => f.includes(join('tests', 'golden'))) ?? fixtures[0];

    function corrupt(mutate: (body: Record<string, unknown>) => void) {
      const body = JSON.parse(readFileSync(basePath!, 'utf8'));
      mutate(body);
      return AnalysisEnrichmentSchema.safeParse(body);
    }

    it('bad enum: confidence_tier = "banana" → FAILS (invalid_enum_value)', () => {
      const result = corrupt((b) => {
        b.confidence_tier = 'banana';
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some(
            (i) => i.path.join('.') === 'confidence_tier' && i.code === 'invalid_enum_value',
          ),
        ).toBe(true);
      }
    });

    it('bad scalar type: analysis_status = 42 → FAILS (invalid_type)', () => {
      const result = corrupt((b) => {
        b.analysis_status = 42;
      });
      expect(result.success).toBe(false);
    });

    it('bad entry shape: edge_e_values[0].flip_direction = 42 (required string) → FAILS', () => {
      const result = corrupt((b) => {
        b.edge_e_values = [
          ...((b.edge_e_values as unknown[]) ?? []),
        ];
        // Ensure at least one entry exists, then corrupt a REQUIRED string
        // leaf. This is the same corruption vector the route-level egress
        // tests drive end-to-end (verbatim ISL→egress passthrough field).
        const arr = b.edge_e_values as Array<Record<string, unknown>>;
        if (arr.length === 0) {
          arr.push({
            edge_id: 'a::b', from_id: 'a', to_id: 'b',
            e_value: 1, flip_direction: 42, current_mean: 0, flip_mean: 0,
          });
        } else {
          arr[0] = { ...arr[0], flip_direction: 42 };
        }
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((i) => i.path.join('.').endsWith('flip_direction')),
        ).toBe(true);
      }
    });

    it('bad container type: robustness = "yes" → FAILS (invalid_type)', () => {
      const result = corrupt((b) => {
        b.robustness = 'yes';
      });
      expect(result.success).toBe(false);
    });
  });
});
