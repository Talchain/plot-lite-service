/**
 * Unit tests for src/lib/constraint-reliability.ts (lane PLoT-H item A).
 *
 * Route-level behaviour (suppression + CONSTRAINT_TARGET_UNRELIABLE emission)
 * is pinned in tests/constraint-target-unreliable.fixture.test.ts; these tests
 * pin the detection semantics in isolation.
 */

import { describe, it, expect } from 'vitest';
import {
  detectUnreliableConstraintTargets,
  buildConstraintTargetUnreliableMessage,
} from '../src/lib/constraint-reliability.js';
import type { NormalisationRange } from '../src/lib/intervention-normaliser.js';

const gc = (id: string, nodeId: string) => ({
  constraint_id: id,
  node_id: nodeId,
  operator: '>=' as const,
  value: 20,
});

const range = (source: NormalisationRange['source']): NormalisationRange => ({
  min: 0,
  max: 1,
  source,
});

describe('detectUnreliableConstraintTargets', () => {
  it('returns [] for no constraints / undefined inputs', () => {
    expect(detectUnreliableConstraintTargets(undefined, undefined, undefined)).toEqual([]);
    expect(detectUnreliableConstraintTargets([], new Map(), {})).toEqual([]);
  });

  it("flags a constraint whose normalisation range source is 'default'", () => {
    const ranges = new Map([['c1', range('default')]]);
    const out = detectUnreliableConstraintTargets([gc('c1', 'out_x')], ranges, {});
    expect(out).toEqual([
      { constraint_id: 'c1', node_id: 'out_x', reasons: ['threshold_normalisation_defaulted'] },
    ]);
  });

  it('does NOT flag derivable range sources (explicit/inferred tiers)', () => {
    for (const src of ['explicit_cap', 'explicit', 'extracted', 'inferred_spread', 'inferred_baseline', 'inferred_value'] as const) {
      const ranges = new Map([['c1', range(src)]]);
      expect(detectUnreliableConstraintTargets([gc('c1', 'out_x')], ranges, {})).toEqual([]);
    }
  });

  it('flags a target named by the ISL CONSTRAINT_NODE_DEFAULT_BASE inference warning (nested detail shape)', () => {
    const islResult = {
      inference_warnings: [{
        code: 'CONSTRAINT_NODE_DEFAULT_BASE',
        field: 'nodes[out_x].base',
        detail: { node_id: 'out_x', defaulted_to: 0.0, reason: 'no_parameter_uncertainty', message: 'm' },
      }],
    };
    const out = detectUnreliableConstraintTargets([gc('c1', 'out_x')], undefined, islResult);
    expect(out).toEqual([
      { constraint_id: 'c1', node_id: 'out_x', reasons: ['target_base_defaulted'] },
    ]);
  });

  it('flags a target named via the ISL critiques channel (affected_node_ids)', () => {
    const islResult = {
      critiques: [{ code: 'CONSTRAINT_NODE_DEFAULT_BASE', affected_node_ids: ['out_x'] }],
    };
    const out = detectUnreliableConstraintTargets([gc('c1', 'out_x')], undefined, islResult);
    expect(out).toEqual([
      { constraint_id: 'c1', node_id: 'out_x', reasons: ['target_base_defaulted'] },
    ]);
  });

  it('combines both reasons on the full live chain', () => {
    const ranges = new Map([['c1', range('default')]]);
    const islResult = {
      inference_warnings: [{
        code: 'CONSTRAINT_NODE_DEFAULT_BASE',
        detail: { node_id: 'out_x' },
      }],
    };
    const out = detectUnreliableConstraintTargets([gc('c1', 'out_x')], ranges, islResult);
    expect(out).toEqual([
      {
        constraint_id: 'c1',
        node_id: 'out_x',
        reasons: ['threshold_normalisation_defaulted', 'target_base_defaulted'],
      },
    ]);
  });

  it('only flags the affected constraint, not reliable siblings', () => {
    const ranges = new Map([
      ['c1', range('default')],
      ['c2', range('inferred_value')],
    ]);
    const out = detectUnreliableConstraintTargets(
      [gc('c1', 'out_x'), gc('c2', 'out_y')],
      ranges,
      {},
    );
    expect(out.map((t) => t.constraint_id)).toEqual(['c1']);
  });

  it('ignores unrelated warning codes and unrelated node ids', () => {
    const islResult = {
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', detail: { node_id: 'out_x' } },
        { code: 'CONSTRAINT_NODE_DEFAULT_BASE', detail: { node_id: 'other_node' } },
      ],
    };
    expect(detectUnreliableConstraintTargets([gc('c1', 'out_x')], undefined, islResult)).toEqual([]);
  });
});

describe('buildConstraintTargetUnreliableMessage (provisional_doctrine_v0 wording)', () => {
  it('names the node, states withholding, and gives the user action', () => {
    const msg = buildConstraintTargetUnreliableMessage('Campaign effectiveness', ['target_base_defaulted']);
    expect(msg).toContain('Campaign effectiveness');
    expect(msg).toContain('withheld');
    expect(msg).toContain('Set a value or range for "Campaign effectiveness"');
  });

  it('normalisation-only reason gets the scaling explanation', () => {
    const msg = buildConstraintTargetUnreliableMessage('X', ['threshold_normalisation_defaulted']);
    expect(msg).toContain('could not be scaled');
  });

  it('never contains the raw suppressed numbers or the strings EVPI / expected value', () => {
    const msg = buildConstraintTargetUnreliableMessage('X', [
      'threshold_normalisation_defaulted',
      'target_base_defaulted',
    ]);
    expect(msg).not.toMatch(/\bEVPI\b/i);
    expect(msg).not.toMatch(/expected value/i);
    expect(msg).not.toMatch(/0(\.0+)?%/);
  });
});
