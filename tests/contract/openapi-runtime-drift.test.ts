/**
 * OpenAPI ↔ runtime DRIFT GATE (F9 / D-23.15).
 *
 * FAILS WHEN the public contract (`contracts/openapi.yaml`) and the runtime
 * `/v2/run` wire contract diverge on TOP-LEVEL keys — the exact defect that
 * left `factor_correlations` (request) and the correlated-factors outputs
 * `correlation_model` / `decision_evpi` / `factor_evppi` / `p_win_sensitivity`
 * (response) undocumented while the runtime carried them.
 *
 * DERIVE-DON'T-MIRROR: both sides are read from their sources of truth —
 * `V2_RUN_ALLOWED_KEYS` + `ISL_TOPLEVEL_ENRICHMENT_KEYS` (which the runtime
 * ALSO uses; see src/routes/v2/run.ts) and the parsed OpenAPI document — and
 * compared fail-loud. Neither can change without the other or this test goes
 * RED.
 *
 * NOTE: PLoT types the four response enrichment fields as `unknown` (verbatim
 * ISL passthrough); their firm shapes ride @talchain/schemas 0.23 / the S5
 * typed surface (D-23.8). This gate pins their PRESENCE as documented response
 * properties, not their shape.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as loadYaml } from 'js-yaml';
import {
  V2_RUN_ALLOWED_KEYS,
  ISL_TOPLEVEL_ENRICHMENT_KEYS,
} from '../../src/routes/v2/run-contract-keys.js';

const OPENAPI_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'contracts',
  'openapi.yaml',
);
const spec = loadYaml(readFileSync(OPENAPI_PATH, 'utf8')) as any;

/** Top-level property NAMES declared by a components schema. */
function propsOf(schemaName: string): string[] {
  const schema = spec?.components?.schemas?.[schemaName];
  expect(schema, `components.schemas.${schemaName} must exist`).toBeDefined();
  expect(schema.properties, `${schemaName}.properties must exist`).toBeDefined();
  return Object.keys(schema.properties);
}

describe('OpenAPI ↔ runtime drift gate — /v2/run request/response wire contract', () => {
  it('positive control: the parse reaches real F9 content and the diff logic discriminates (not vacuous)', () => {
    const reqKeys = propsOf('runRequestV3');
    const respKeys = propsOf('runResponseV3');
    // The parse reached the real, F9-relevant content (would be empty if the
    // YAML load or the schema navigation had silently failed).
    expect(reqKeys).toContain('factor_correlations');
    expect(respKeys).toContain('factor_evppi');
    expect(respKeys).toContain('p_win_sensitivity');
    // The set-diff used by the assertions below actually DETECTS a missing key:
    const probe = new Set(reqKeys.filter((k) => k !== 'factor_correlations'));
    expect([...V2_RUN_ALLOWED_KEYS].filter((k) => !probe.has(k))).toContain(
      'factor_correlations',
    );
  });

  it('runRequestV3.properties EXACTLY equals the runtime request allowlist (V2_RUN_ALLOWED_KEYS)', () => {
    const specKeys = new Set(propsOf('runRequestV3'));
    const missingFromSpec = [...V2_RUN_ALLOWED_KEYS].filter((k) => !specKeys.has(k)).sort();
    const missingFromRuntime = [...specKeys].filter((k) => !V2_RUN_ALLOWED_KEYS.has(k)).sort();
    expect(
      missingFromSpec,
      `request keys accepted at runtime but UNDOCUMENTED in runRequestV3: ${missingFromSpec.join(', ')}`,
    ).toEqual([]);
    expect(
      missingFromRuntime,
      `request keys documented in runRequestV3 but NOT in the runtime allowlist: ${missingFromRuntime.join(', ')}`,
    ).toEqual([]);
  });

  it('every ISL top-level enrichment passthrough key is documented as a runResponseV3 property', () => {
    const specKeys = new Set(propsOf('runResponseV3'));
    const undocumented = ISL_TOPLEVEL_ENRICHMENT_KEYS.filter((k) => !specKeys.has(k));
    expect(
      undocumented,
      `ISL enrichment passthrough keys forwarded by runtime but UNDOCUMENTED in runResponseV3: ${undocumented.join(', ')}`,
    ).toEqual([]);
  });
});
