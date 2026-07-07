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
  partitionConstraintTargets,
  buildConstraintTargetUnreliableMessage,
  buildConstraintGoalFitModelledMessage,
  GOAL_FIT_SCORED_FROM_MODELLED_OUTCOME,
  type UnreliableConstraintTarget,
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

describe('partitionConstraintTargets (P0-C2 doctrine B classification)', () => {
  const target = (
    nodeId: string,
    reasons: UnreliableConstraintTarget['reasons'],
  ): UnreliableConstraintTarget => ({
    constraint_id: `c_${nodeId}`,
    node_id: nodeId,
    reasons,
  });

  const graph = {
    edges: [
      { from: 'fac_a', to: 'out_x' },
      { from: 'out_x', to: 'goal_g' },
    ],
  };

  it('classifies base-defaulted-only targets with forward-propagated inputs as modelledBasis', () => {
    const out = partitionConstraintTargets([target('goal_g', ['target_base_defaulted'])], graph);
    expect(out.modelledBasis.map((t) => t.node_id)).toEqual(['goal_g']);
    expect(out.suppressed).toEqual([]);
  });

  it('keeps suppressing a base-defaulted target with NO incoming edges (root: constant placeholder, not a distribution)', () => {
    const out = partitionConstraintTargets([target('fac_a', ['target_base_defaulted'])], graph);
    expect(out.suppressed.map((t) => t.node_id)).toEqual(['fac_a']);
    expect(out.modelledBasis).toEqual([]);
  });

  it('keeps suppressing when the reason set includes threshold_normalisation_defaulted', () => {
    for (const reasons of [
      ['threshold_normalisation_defaulted'],
      ['threshold_normalisation_defaulted', 'target_base_defaulted'],
    ] as const) {
      const out = partitionConstraintTargets([target('goal_g', [...reasons])], graph);
      expect(out.suppressed, reasons.join('+')).toHaveLength(1);
      expect(out.modelledBasis, reasons.join('+')).toEqual([]);
    }
  });

  it('ignores bidirected edges when deciding forward propagation (ISL strips them from the forward model)', () => {
    const bidirectedOnly = { edges: [{ from: 'fac_a', to: 'goal_g', edge_type: 'bidirected' }] };
    const out = partitionConstraintTargets([target('goal_g', ['target_base_defaulted'])], bidirectedOnly);
    expect(out.suppressed).toHaveLength(1);
    expect(out.modelledBasis).toEqual([]);
  });

  it('is conservative on absent graph/edges: everything keeps suppressing', () => {
    for (const g of [undefined, {}, { edges: [] }] as const) {
      const out = partitionConstraintTargets([target('goal_g', ['target_base_defaulted'])], g);
      expect(out.suppressed).toHaveLength(1);
      expect(out.modelledBasis).toEqual([]);
    }
  });

  it('partitions a mixed set target-by-target', () => {
    const out = partitionConstraintTargets(
      [
        target('goal_g', ['target_base_defaulted']),
        target('out_x', ['threshold_normalisation_defaulted']),
      ],
      graph,
    );
    expect(out.modelledBasis.map((t) => t.node_id)).toEqual(['goal_g']);
    expect(out.suppressed.map((t) => t.node_id)).toEqual(['out_x']);
  });
});

describe('buildConstraintGoalFitModelledMessage (provisional_doctrine_v0 wording)', () => {
  it('names the node, states the modelled basis, and gives the anchoring action', () => {
    const msg = buildConstraintGoalFitModelledMessage('Improve productivity');
    expect(msg).toContain('Improve productivity');
    expect(msg.toLowerCase()).toContain('modelled');
    expect(msg).toContain('no observed baseline value');
    expect(msg).toContain('Set a value for "Improve productivity"');
  });

  it('never quotes probabilities or percentage figures', () => {
    const msg = buildConstraintGoalFitModelledMessage('X');
    expect(msg).not.toMatch(/\d+(\.\d+)?%/);
    expect(msg).not.toMatch(/0\.\d+/);
  });

  it('exports the wire value used by the goal_fit_basis annotation', () => {
    expect(GOAL_FIT_SCORED_FROM_MODELLED_OUTCOME).toBe('modelled_outcome_distribution');
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
