/**
 * @talchain/schemas 0.13.1 re-vendor adoption tests
 *
 * PLoT was re-vendored from the GitHub Packages registry pin 0.2.1 to a
 * vendored tarball of 0.13.1 (vendor/talchain-schemas-0.13.1.tgz). Every
 * dist module backing a symbol PLoT imports is byte-identical between the
 * two versions, except graph.* whose only delta is the purely additive
 * TopologyPlanSchema export (not consumed by PLoT src).
 *
 * These fixtures prove, at runtime, that each consumed schema/constant
 * behaves identically on 0.13.1. One representative fixture per consumed
 * symbol; the import inventory is:
 *
 *   src/constants/limits.ts        LIMITS, DEFAULT_EXISTS_PROBABILITY
 *   src/types/engine-v3.ts         LIMITS, NODE_ID_PATTERN,
 *                                  type SeedSourceType, type NodeV3,
 *                                  type EdgeV3, type GraphV3,
 *                                  type RepairEntry
 *   src/trust/types.ts             DetailLevel
 *   src/routes/v1/cee-draft-graph.ts  CeeTypedErrorSchema,
 *                                  PlotCeeUpstreamEnvelopeSchema,
 *                                  PlotProxyTimeoutErrorSchema,
 *                                  type PlotCeeUpstreamEnvelope,
 *                                  type PlotProxyTimeoutError
 *   src/routes/v2/run.ts           type SeedSourceType
 *
 * The pre-existing tests/schema-adoption.test.ts (written against 0.2.1)
 * is deliberately unchanged — it passing on 0.13.1 is itself part of the
 * proof.
 *
 * 2026-07-08 (lane 33): the vendored pin moved 0.13.1 → 0.14.0
 * (enrichment v1; additive over 0.13.1 — no transport field or strictness
 * change on any symbol PLoT consumes). The installed-version proof below
 * now pins 0.14.0; every consumed-surface fixture in this file is
 * deliberately unchanged — it passing on 0.14.0 is itself part of the
 * proof. 0.14.0-specific adoption lives in
 * tests/contract/isl-to-plot.contract.test.ts and the
 * AnalysisEnrichmentSchema assertion in
 * tests/enrichment-emission-contract.test.ts.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  LIMITS,
  DEFAULT_EXISTS_PROBABILITY,
  NODE_ID_PATTERN,
  NodeV3Schema,
  EdgeV3Schema,
  GraphV3Schema,
  RepairEntrySchema,
  SeedSource,
  DetailLevel,
  CeeTypedErrorSchema,
  PlotCeeUpstreamEnvelopeSchema,
  PlotProxyTimeoutErrorSchema,
  // New in 0.13.x — the ONLY delta in a dist module PLoT consumes from.
  // Not imported by PLoT src; asserted here to document the additive change.
  TopologyPlanSchema,
} from '@talchain/schemas';
import type {
  SeedSourceType,
  NodeV3,
  EdgeV3,
  GraphV3,
  RepairEntry,
  PlotCeeUpstreamEnvelope,
  PlotProxyTimeoutError,
} from '@talchain/schemas';

// =============================================================================
// 0. Installed-version proof: the vendored 0.14.0 tarball is what resolves
// =============================================================================

describe('@talchain/schemas 0.14.0 installation', () => {
  it('resolves to version 0.14.0', () => {
    // The package's exports map has no "require" condition, so
    // createRequire().resolve() cannot be used; read the installed
    // manifest directly (checkout-stable relative to this test file).
    const manifestPath = fileURLToPath(
      new URL('../node_modules/@talchain/schemas/package.json', import.meta.url),
    );
    const pkg = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      version: string;
    };
    expect(pkg.name).toBe('@talchain/schemas');
    expect(pkg.version).toBe('0.14.0');
  });
});

// =============================================================================
// 1. Constants consumed by src/constants/limits.ts + src/types/engine-v3.ts
// =============================================================================

describe('LIMITS + DEFAULT_EXISTS_PROBABILITY (src/constants/limits.ts)', () => {
  it('LIMITS carries the exact canonical values PLoT enforces', () => {
    expect(LIMITS.MAX_NODES).toBe(50);
    expect(LIMITS.MAX_EDGES).toBe(100);
    expect(LIMITS.MAX_OPTIONS).toBe(10);
    expect(LIMITS.MAX_CONSTRAINTS).toBe(20);
    expect(LIMITS.STD_FLOOR).toBe(0.001);
    expect(LIMITS.STD_CEILING_RATIO).toBe(0.5);
    expect(LIMITS.STD_CEILING_ABS).toBe(10000);
    expect(LIMITS.DEFAULT_STD).toBe(0.1);
    expect(LIMITS.DEFAULT_EXISTS_PROBABILITY).toBe(0.8);
    expect(LIMITS.STRENGTH_BOUNDS).toEqual({ min: -1.0, max: 1.0 });
    expect(LIMITS.DEFAULT_SEED).toBe('42');
  });

  it('DEFAULT_EXISTS_PROBABILITY standalone export matches LIMITS', () => {
    expect(DEFAULT_EXISTS_PROBABILITY).toBe(0.8);
    expect(DEFAULT_EXISTS_PROBABILITY).toBe(LIMITS.DEFAULT_EXISTS_PROBABILITY);
  });
});

describe('NODE_ID_PATTERN (src/types/engine-v3.ts)', () => {
  it('is the canonical lowercase id pattern', () => {
    expect(NODE_ID_PATTERN.source).toBe('^[a-z0-9_:-]+$');
    expect(NODE_ID_PATTERN.test('factor_price:v1-a')).toBe(true);
    expect(NODE_ID_PATTERN.test('Factor A')).toBe(false); // uppercase + space
    expect(NODE_ID_PATTERN.test('')).toBe(false);
  });
});

// =============================================================================
// 2. Graph schemas backing engine-v3's type-only imports
//    (NodeV3 / EdgeV3 / GraphV3 / RepairEntry)
// =============================================================================

describe('graph schemas (types consumed by src/types/engine-v3.ts)', () => {
  const node = {
    id: 'factor-price',
    kind: 'factor',
    label: 'Unit price',
    observed_state: { value: 50 },
  } satisfies Record<string, unknown>;

  const edge = {
    from: 'factor-price',
    to: 'goal',
    exists_probability: 0.8,
    strength: { mean: 0.5, std: 0.1 },
  } satisfies Record<string, unknown>;

  it('NodeV3Schema parses a canonical PLoT node', () => {
    const result = NodeV3Schema.safeParse(node);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    // Type-level usage proof for the type-only import in engine-v3.ts
    const typed: NodeV3 = NodeV3Schema.parse(node);
    expect(typed.id).toBe('factor-price');
  });

  it('EdgeV3Schema parses a canonical PLoT edge', () => {
    const result = EdgeV3Schema.safeParse(edge);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    const typed: EdgeV3 = EdgeV3Schema.parse(edge);
    expect(typed.from).toBe('factor-price');
  });

  it('GraphV3Schema parses a canonical PLoT graph', () => {
    const graph = {
      nodes: [node, { id: 'goal', kind: 'goal', label: 'Goal' }],
      edges: [edge],
    };
    const result = GraphV3Schema.safeParse(graph);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    const typed: GraphV3 = GraphV3Schema.parse(graph);
    expect(typed.nodes).toHaveLength(2);
  });

  it('NodeV3Schema rejects an id violating NODE_ID_PATTERN', () => {
    const result = NodeV3Schema.safeParse({ ...node, id: 'Factor A' });
    expect(result.success).toBe(false);
  });

  it('RepairEntrySchema parses the DEFAULT_EXISTS_PROBABILITY repair PLoT emits', () => {
    const repair = {
      code: 'DEFAULT_EXISTS_PROBABILITY',
      layer: 'plot',
      field_path: 'edges[0].exists_probability',
      before: null,
      after: DEFAULT_EXISTS_PROBABILITY,
      reason: 'exists_probability missing; canonical default applied',
      severity: 'info',
    };
    const result = RepairEntrySchema.safeParse(repair);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    const typed: RepairEntry = RepairEntrySchema.parse(repair);
    expect(typed.layer).toBe('plot');
  });

  it('RepairEntrySchema rejects unknown repair codes and severities', () => {
    expect(
      RepairEntrySchema.safeParse({
        code: 'NOT_A_REPAIR_CODE',
        layer: 'plot',
        field_path: 'x',
        before: null,
        after: 1,
        reason: 'r',
        severity: 'info',
      }).success,
    ).toBe(false);
    expect(
      RepairEntrySchema.safeParse({
        code: 'CLAMP_STD_MINIMUM',
        layer: 'plot',
        field_path: 'x',
        before: 0,
        after: 0.001,
        reason: 'r',
        severity: 'fatal', // not in enum
      }).success,
    ).toBe(false);
  });
});

// =============================================================================
// 3. Enums (src/trust/types.ts + src/routes/v2/run.ts + engine-v3.ts)
// =============================================================================

describe('SeedSource / SeedSourceType (src/routes/v2/run.ts, engine-v3.ts)', () => {
  it('accepts exactly the two canonical seed sources', () => {
    expect(SeedSource.options).toEqual(['client_generated', 'server_generated']);
    expect(SeedSource.safeParse('client_generated').success).toBe(true);
    expect(SeedSource.safeParse('server_generated').success).toBe(true);
    expect(SeedSource.safeParse('invalid').success).toBe(false);
  });

  it('SeedSourceType type-only import remains assignable', () => {
    const clientSeed: SeedSourceType = 'client_generated';
    const serverSeed: SeedSourceType = 'server_generated';
    expect([clientSeed, serverSeed]).toEqual(SeedSource.options);
  });
});

describe('DetailLevel (src/trust/types.ts)', () => {
  it('accepts exactly quick | standard | deep', () => {
    expect(DetailLevel.options).toEqual(['quick', 'standard', 'deep']);
    expect(DetailLevel.safeParse('standard').success).toBe(true);
    expect(DetailLevel.safeParse('invalid').success).toBe(false);
  });
});

// =============================================================================
// 4. Error schemas (src/routes/v1/cee-draft-graph.ts)
// =============================================================================

describe('error schemas (src/routes/v1/cee-draft-graph.ts)', () => {
  it('PlotCeeUpstreamEnvelopeSchema parses the envelope PLoT emits', () => {
    const envelope: PlotCeeUpstreamEnvelope = {
      error: 'CEE_UPSTREAM_ERROR',
      message: 'CEE returned non-JSON 502 response',
      retryable: true,
      upstream_content_type: 'text/html',
      upstream_body_preview: '<html>Bad Gateway</html>',
      elapsed_ms: 1234,
      request_id: 'req-1',
    };
    expect(PlotCeeUpstreamEnvelopeSchema.safeParse(envelope).success).toBe(true);
    // Optional trailing fields stay optional
    expect(
      PlotCeeUpstreamEnvelopeSchema.safeParse({
        error: 'CEE_UPSTREAM_ERROR',
        message: 'CEE returned non-JSON response',
        retryable: false,
      }).success,
    ).toBe(true);
  });

  it('PlotProxyTimeoutErrorSchema parses the timeout error PLoT emits', () => {
    const timeout: PlotProxyTimeoutError = {
      error: 'CEE_PROXY_TIMEOUT',
      message: 'CEE did not respond within 105s',
      retryable: true,
      elapsed_ms: 105000,
      request_id: 'req-2',
    };
    expect(PlotProxyTimeoutErrorSchema.safeParse(timeout).success).toBe(true);
    // elapsed_ms + request_id are REQUIRED on the timeout error
    expect(
      PlotProxyTimeoutErrorSchema.safeParse({
        error: 'CEE_PROXY_TIMEOUT',
        message: 'timeout',
        retryable: true,
      }).success,
    ).toBe(false);
  });

  it('error ownership boundary is unchanged: PLoT codes are not CEE typed errors', () => {
    expect(
      CeeTypedErrorSchema.safeParse({
        error: 'CEE_LLM_TIMEOUT',
        message: 'LLM did not respond',
        retryable: true,
        elapsed_ms: 90000,
      }).success,
    ).toBe(true);
    expect(
      CeeTypedErrorSchema.safeParse({
        error: 'CEE_PROXY_TIMEOUT', // PLoT-owned code
        message: 'CEE did not respond within 105s',
        retryable: true,
        elapsed_ms: 105000,
        request_id: 'req-1',
      }).success,
    ).toBe(false);
  });
});

// =============================================================================
// 5. The single additive delta in a consumed dist module (graph.js)
// =============================================================================

describe('0.2.1 → 0.13.1 delta documentation', () => {
  it('TopologyPlanSchema (appended to graph.js; unused by PLoT src) parses string[]', () => {
    expect(TopologyPlanSchema.safeParse(['goal', 'factor-a']).success).toBe(true);
    expect(TopologyPlanSchema.safeParse([1, 2]).success).toBe(false);
  });
});
