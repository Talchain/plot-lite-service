/**
 * F14 (Codex deep review, A3 r2) — finite-range overflow guards.
 *
 * An accepted explicit range `{min:-1e308, max:1e308}` has `max > min` but
 * `max - min === Infinity`. Denormalising a valid `0.5` through it returns
 * `Infinity`, which `JSON.stringify` emits as a fabricated `null` on the wire
 * (flip_value), or makes PLoT silently DROP the whole edge E-value
 * (current_mean/flip_mean). These tests SERIALIZE the final bytes (per the
 * Codex requirement) rather than only inspecting JS objects.
 *
 * RED-first: each byte assertion FAILS on the current code — the insane range
 * survives `deriveRange` (only `max > min` is checked) and overflows.
 */

import { describe, it, expect } from 'vitest';
import {
  buildNormalisationContext,
  deriveRange,
  denormaliseValue,
  isFiniteRange,
  type NormalisationContext,
} from '../src/lib/intervention-normaliser.js';
import { denormaliseFlipThresholds } from '../src/lib/flip-threshold-denormaliser.js';
import { transformEdgeEValues } from '../src/routes/v2/run.js';
import type { EngineNodeV3 } from '../src/types/engine-v3.js';

const INSANE = { min: -1e308, max: 1e308 };

// Goal + factor nodes carrying the overflow-width explicit range. Normalisation
// context is built through deriveRange (Priority 1: explicit state_space.range),
// exactly as the live route does — so the range-source finite guard is exercised.
const NODES: EngineNodeV3[] = [
  { id: 'goal', kind: 'goal', label: 'Revenue', state_space: { range: { ...INSANE } } },
  { id: 'f', kind: 'factor', label: 'Spend', state_space: { range: { ...INSANE } }, observed_state: { value: 0.6 } },
];

function ctx(): NormalisationContext {
  return buildNormalisationContext(NODES, 'goal');
}

describe('F14 — deriveRange rejects overflow-width ranges (range-source fix)', () => {
  it('DEFECT: an explicit {min:-1e308,max:1e308} range is NOT accepted verbatim', () => {
    const r = deriveRange(NODES[1]);
    // Pre-fix: source 'explicit' with the insane endpoints (width Infinity).
    // Post-fix: rejected → falls through the chain to a finite range.
    expect(Number.isFinite(r.max - r.min)).toBe(true);
    expect(r.max - r.min).toBeGreaterThan(0);
  });

  it('positive control: a NORMAL explicit range is preserved verbatim (no regression)', () => {
    const node: EngineNodeV3 = { id: 'n', kind: 'factor', label: 'n', state_space: { range: { min: 10, max: 60 } } };
    const r = deriveRange(node);
    expect(r).toEqual({ min: 10, max: 60, source: 'explicit' });
  });

  it('isFiniteRange: positive control', () => {
    expect(isFiniteRange(0, 1)).toBe(true);
    expect(isFiniteRange(10, 60)).toBe(true);
    expect(isFiniteRange(-1e308, 1e308)).toBe(false); // width overflows
    expect(isFiniteRange(5, 5)).toBe(false); // zero width
    expect(isFiniteRange(5, 4)).toBe(false); // negative width
    expect(isFiniteRange(Infinity, 0)).toBe(false);
    expect(isFiniteRange(NaN, 1)).toBe(false);
  });
});

describe('F14 — flip thresholds: no fabricated null on the SERIALIZED wire', () => {
  it('DEFECT: a valid normalised flip_value denormalises to a FINITE number, not null', () => {
    const out = denormaliseFlipThresholds(
      [{ factor_id: 'f', factor_label: 'Spend', current_value: 0.5, flip_value: 0.5, direction: 'increase', flip_reason: 'found' }],
      ctx(),
      [],
    );
    const json = JSON.stringify(out);
    // Pre-fix: 0.5 → Infinity → serialised "flip_value":null (fabricated).
    // Post-fix: the goal/factor range is a safe default → finite flip_value.
    expect(json).not.toContain('"flip_value":null');
    expect(Number.isFinite(out[0].flip_value)).toBe(true);
    expect(Number.isFinite(out[0].current_value)).toBe(true);
  });

  it('defense + disclosure: a directly non-finite range nulls flip_value AND discloses via flip_reason', () => {
    // Bypass deriveRange — hand a context whose range already overflows, to
    // prove the post-denormalisation finite guard (defense-in-depth) discloses
    // rather than emitting a silent fabricated null.
    const context: NormalisationContext = {
      factors: new Map([['f', { factor_id: 'f', range: { min: -1e308, max: 1e308, source: 'explicit' }, baseline: 0 }]]),
      goal_node_id: 'goal',
    };
    const out = denormaliseFlipThresholds(
      [{ factor_id: 'f', factor_label: 'Spend', current_value: 0.5, flip_value: 0.5, direction: 'increase', flip_reason: 'found' }],
      context,
      [],
    );
    const json = JSON.stringify(out);
    expect(json).not.toContain('Infinity'); // never a non-finite token
    expect(out[0].flip_reason).toBe('non_finite_denormalisation');
    expect(Number.isFinite(out[0].current_value)).toBe(true);
  });
});

describe('F14 — edge E-values: overflow no longer silently drops the entry', () => {
  it('DEFECT: an edge E-value survives (not dropped) and serialises with finite means', () => {
    const isl = [{
      edge_id: 'f->goal', e_value: 1.4, flip_direction: 'increase',
      current_mean: 0.5, flip_mean: 0.7,
    }];
    const out = transformEdgeEValues(isl as never, new Map([['f', 'Spend'], ['goal', 'Revenue']]), ctx());
    const json = JSON.stringify(out);
    // Pre-fix: current_mean/flip_mean → Infinity → filtered out → out is [].
    // Post-fix: safe goal range → finite means → entry retained.
    expect(out).toHaveLength(1);
    expect(json).not.toContain('"current_mean":null');
    expect(json).not.toContain('"flip_mean":null');
    expect(Number.isFinite(out[0].current_mean)).toBe(true);
    expect(Number.isFinite(out[0].flip_mean)).toBe(true);
  });

  it('positive control: denormaliseValue on a safe range is exact', () => {
    expect(denormaliseValue(0.5, { min: 10, max: 60, source: 'explicit' })).toBe(35);
  });
});
