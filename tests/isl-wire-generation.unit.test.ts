/**
 * assessIslWireGeneration / logIslWireGenerationUnverified unit tests
 * (lane 29, spec §2.1, docs/enrichment-v1/PLOT-V2-READ-FIX-SPEC.md).
 *
 * The assertion is MARKER-BASED, not ordinal: ISL build identifiers are git
 * SHAs (9a22a1a, f3f5d92) with no order relation, so "at least generation X"
 * is verified by (a) the envelope DECLARING its version markers
 * (build / engine_version / version=2.x / timestamp) and (b) wire-location
 * probes for the nested fields PLoT's readers assume
 * (robustness.edge_e_values, robustness.edge_sensitivity — the locations
 * introduced by f3f5d92 and 9a22a1a respectively).
 *
 * Spec §3.3: an envelope with `build` absent and one with nested fields
 * missing must both fail verification; the structured warning fires exactly
 * ONCE and never on a verified envelope.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ISL_MIN_WIRE_GENERATION,
  assessIslWireGeneration,
  logIslWireGenerationUnverified,
} from '../src/integrations/isl/wire-generation.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const capture20260707 = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260707', 'isl-staging-capture.json'), 'utf8'),
);
const capture20260706 = JSON.parse(
  readFileSync(join(FIXTURES, 'isl-v2-live-20260706', 'isl-staging-capture.json'), 'utf8'),
);

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

describe('assessIslWireGeneration (spec §2.1)', () => {
  it('verifies the live 9a22a1a capture (all markers + both nested locations)', () => {
    const a = assessIslWireGeneration(capture20260707);
    expect(a.ok).toBe(true);
    expect(a.missing_markers).toEqual([]);
    expect(a.isl_build).toBe('9a22a1a');
    expect(a.isl_engine_version).toBe('1.0.0');
    expect(a.isl_version).toBe('2.0');
  });

  it('build absent → unverified with marker "build" (spec §3.3 case 1)', () => {
    const c = clone(capture20260707);
    delete c.build;
    const a = assessIslWireGeneration(c);
    expect(a.ok).toBe(false);
    expect(a.missing_markers).toContain('build');
    expect(a.isl_build).toBeNull();
  });

  it('engine_version / version / timestamp absent → each named as a missing marker', () => {
    const c = clone(capture20260707);
    delete c.engine_version;
    delete c.version;
    delete c.timestamp;
    const a = assessIslWireGeneration(c);
    expect(a.ok).toBe(false);
    expect(a.missing_markers).toContain('engine_version');
    expect(a.missing_markers).toContain('version');
    expect(a.missing_markers).toContain('timestamp');
  });

  it('declared version is not generation 2 → unverified with marker "version_not_v2"', () => {
    const c = clone(capture20260707);
    c.version = '1.0';
    const a = assessIslWireGeneration(c);
    expect(a.ok).toBe(false);
    expect(a.missing_markers).toContain('version_not_v2');
    expect(a.isl_version).toBe('1.0'); // declared value still reported for diagnosis
  });

  it('nested wire locations missing while robustness present → probe markers (spec §3.3 case 2)', () => {
    const c = clone(capture20260707);
    delete c.robustness.edge_e_values;
    delete c.robustness.edge_sensitivity;
    const a = assessIslWireGeneration(c);
    expect(a.ok).toBe(false);
    expect(a.missing_markers).toContain('robustness.edge_e_values');
    expect(a.missing_markers).toContain('robustness.edge_sensitivity');
  });

  it('EMPTY nested arrays still verify (location exists — computed-empty is not a wire gap)', () => {
    const c = clone(capture20260707);
    c.robustness.edge_e_values = [];
    c.robustness.edge_sensitivity = [];
    const a = assessIslWireGeneration(c);
    expect(a.ok).toBe(true);
    expect(a.missing_markers).toEqual([]);
  });

  it('robustness absent entirely → probes not applicable (no probe markers), version markers still checked', () => {
    const c = clone(capture20260707);
    delete c.robustness;
    const a = assessIslWireGeneration(c);
    // Robustness analysis did not come back at all — the per-feature status
    // machinery covers that; the probes cannot distinguish generations.
    expect(a.missing_markers).not.toContain('robustness.edge_e_values');
    expect(a.missing_markers).not.toContain('robustness.edge_sensitivity');
    expect(a.ok).toBe(true);
  });

  it('real older-generation capture (f3f5d92) → unverified via the edge_sensitivity probe', () => {
    const a = assessIslWireGeneration(capture20260706);
    expect(a.ok).toBe(false);
    expect(a.missing_markers).toEqual(['robustness.edge_sensitivity']);
    expect(a.isl_build).toBe('f3f5d92');
  });

  it('null / undefined / non-object → unverified with marker "isl_response"', () => {
    for (const v of [null, undefined, 'nope', 42]) {
      const a = assessIslWireGeneration(v);
      expect(a.ok).toBe(false);
      expect(a.missing_markers).toEqual(['isl_response']);
      expect(a.isl_build).toBeNull();
    }
  });

  it('ISL_MIN_WIRE_GENERATION documents the assumed build', () => {
    expect(ISL_MIN_WIRE_GENERATION).toBe('9a22a1a');
  });
});

describe('logIslWireGenerationUnverified (spec §2.1 — ONE structured warning)', () => {
  it('emits exactly one warn with event isl_wire_generation_unverified carrying build + missing markers', () => {
    const warn = vi.fn();
    const c = clone(capture20260707);
    delete c.build;
    delete c.robustness.edge_e_values;
    const a = assessIslWireGeneration(c);
    logIslWireGenerationUnverified({ warn }, a, 'req-123');
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0][0];
    expect(payload.event).toBe('isl_wire_generation_unverified');
    expect(payload.request_id).toBe('req-123');
    expect(payload.isl_build).toBeNull();
    expect(payload.missing_markers).toContain('build');
    expect(payload.missing_markers).toContain('robustness.edge_e_values');
    expect(payload.min_wire_generation).toBe(ISL_MIN_WIRE_GENERATION);
  });

  it('never fires on a verified envelope', () => {
    const warn = vi.fn();
    logIslWireGenerationUnverified({ warn }, assessIslWireGeneration(capture20260707), 'req-123');
    expect(warn).not.toHaveBeenCalled();
  });
});
