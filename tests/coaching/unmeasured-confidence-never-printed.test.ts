/**
 * A confidence figure is printed only when ISL MEASURED the factor's stability (DL #72 5883188906, AIQ 5883088747).
 *
 * PLoT's unified confidence comes from two sources (`confidence_source`):
 *   - `plot_unified_from_isl_bootstrap`: ISL measured the factor's attribution stability;
 *   - `plot_unified_from_graph`: no measured stability. The figure is the graph formula over edge existence, and for
 *     a root factor a synthetic 0.5 edge.
 * Coaching printed both as "NN%": the evidence-gap display and note, the next-action rationale, the ledger reason and
 * the readiness signal. After ISL withholds a blind probe's stability (ISL #215), every P1 factor is graph-only, and the
 * served route still printed "low confidence (40%)" and "50%". An ORDERING default stays allowed; a printed figure
 * without measured stability is not. Measured confidence is preserved.
 *
 * The rows replay REAL wire (tests/fixtures/r3b-blind-oat-20260929/captures.json: PLoT /v2/run egress over ISL at
 * #214 and #215), not hand-built rows.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateM1Coaching } from '../../src/coaching/m1-coaching.js';
import { computeReadinessSignals } from '../../src/coaching/readiness-signals.js';
import { generateCritiques } from '../../src/coaching/critiques.js';
import { getThresholds } from '../../src/coaching/thresholds.js';
import type { CoachingInputs } from '../../src/coaching/types.js';

type Capture = {
  graph: unknown;
  options: unknown[];
  isl: unknown;
  factor_sensitivity: Array<{ factor_id: string; confidence?: number; confidence_source?: string }>;
};

const here = dirname(fileURLToPath(import.meta.url));
const captures = JSON.parse(
  readFileSync(join(here, '../fixtures/r3b-blind-oat-20260929/captures.json'), 'utf8'),
) as Record<'P1_pre215' | 'ZERO' | 'P1_post215', Capture>;

function coach(c: Capture) {
  const m1 = generateM1Coaching(
    c.graph as never, c.options as never, c.isl, undefined, undefined, undefined, undefined,
    c.factor_sensitivity as never,
  );
  expect(m1).not.toBeNull();
  return m1!;
}

const unmeasured = (c: Capture) =>
  new Set(c.factor_sensitivity.filter((f) => f.confidence_source === 'plot_unified_from_graph').map((f) => f.factor_id));

/** Every user-facing string coaching emits about a factor's confidence. */
function confidenceText(m1: ReturnType<typeof coach>): string[] {
  return [
    ...m1.evidence_gaps.flatMap((g) => [g.confidence_display ?? '', g.suggestion, ...g.notes]),
    ...m1.next_actions.map((a) => a.rationale),
    ...(m1.assumptions_ledger?.assumptions ?? []).map((a) => a.reason),
    ...(m1.readiness_signals?.signals ?? []).map((s) => s.signal),
  ];
}

const PRINTED_CONFIDENCE = /confidence[^|]{0,40}?\d+\s*%|\d+\s*%[^|]{0,20}confidence|defaulted to \d+%/i;

describe('P1 after ISL #215: every factor is graph-only, so no confidence figure is printed', () => {
  const c = captures.P1_post215;
  const m1 = coach(c);

  it('precondition: every row is graph-only', () => {
    expect(unmeasured(c).size).toBe(c.factor_sensitivity.length);
  });

  it('no evidence gap prints a confidence, and each says it is defaulted', () => {
    expect(m1.evidence_gaps.length).toBeGreaterThan(0);
    for (const g of m1.evidence_gaps) {
      expect(g.confidence_display, g.factor_id).toBeUndefined();
      expect(g.confidence_defaulted, g.factor_id).toBe(true);
      expect(g.notes.join(' '), g.factor_id).not.toMatch(/\d+%/);
    }
  });

  it('the ledger carries no confidence entry for a graph-only factor', () => {
    const entries = (m1.assumptions_ledger?.assumptions ?? []).filter((a) => a.field === 'confidence');
    expect(entries.map((a) => a.entity_id)).toEqual([]);
  });

  it('no coaching string prints a confidence figure', () => {
    for (const text of confidenceText(m1)) expect(text).not.toMatch(PRINTED_CONFIDENCE);
  });
});

describe('an old unanalysed factor (grandfathered: ISL never measures it) prints no figure either', () => {
  const c = captures.P1_pre215;
  const m1 = coach(c);
  const GRANDFATHERED = 'fac_existing_customers_grandfathered';

  it('precondition: grandfathered is graph-only and is an evidence gap', () => {
    expect(unmeasured(c).has(GRANDFATHERED)).toBe(true);
    expect(m1.evidence_gaps.map((g) => g.factor_id)).toContain(GRANDFATHERED);
  });

  it('its gap prints no confidence', () => {
    const gap = m1.evidence_gaps.find((g) => g.factor_id === GRANDFATHERED)!;
    expect(gap.confidence_display).toBeUndefined();
    expect(gap.confidence_defaulted).toBe(true);
    expect([gap.suggestion, ...gap.notes].join(' ')).not.toMatch(PRINTED_CONFIDENCE);
  });
});

describe('MEASURED confidence is preserved', () => {
  it('a measured gap keeps its figure (P1 before #215: subscribers from ISL bootstrap)', () => {
    const c = captures.P1_pre215;
    const subs = c.factor_sensitivity.find((f) => f.factor_id === 'pro_paying_subscribers')!;
    expect(subs.confidence_source).toBe('plot_unified_from_isl_bootstrap');
    const gap = coach(c).evidence_gaps.find((g) => g.factor_id === 'pro_paying_subscribers')!;
    expect(gap.confidence_defaulted).toBe(false);
    expect(gap.confidence_display).toBe(`${Math.round(subs.confidence! * 100)}%`);
  });

  it('a measured, non-lever low-confidence factor keeps its ledger entry (P1 before #215: subscribers)', () => {
    // Not price: price is an option-set lever, and a lever carries no confidence line (AIQ 5883875188).
    const c = captures.P1_pre215;
    const subs = c.factor_sensitivity.find((f) => f.factor_id === 'pro_paying_subscribers')!;
    expect(subs.confidence_source).toBe('plot_unified_from_isl_bootstrap');
    const entry = (coach(c).assumptions_ledger?.assumptions ?? []).find(
      (a) => a.field === 'confidence' && a.entity_id === 'pro_paying_subscribers',
    );
    expect(entry?.reason).toContain(`(${Math.round(subs.confidence! * 100)}%)`);
  });

  it('ZERO: the ledger carries no confidence entry for a graph-only factor', () => {
    const c = captures.ZERO;
    const graphOnly = (coach(c).assumptions_ledger?.assumptions ?? []).filter(
      (a) => a.field === 'confidence' && unmeasured(c).has(a.entity_id),
    );
    expect(graphOnly).toEqual([]);
  });
});

describe('the readiness signal prints an average only when every factor was measured', () => {
  const base = (confidences: Array<number | undefined>): CoachingInputs =>
    ({
      factorSensitivity: confidences.map((confidence, i) => ({
        node_id: `f${i}`, label: `F${i}`, elasticity: 0.1, importance_rank: i + 1, confidence,
      })),
      options: [], fragileEdges: [], robustness: {}, interventionTargetIds: new Set<string>(),
    }) as unknown as CoachingInputs;
  const signalText = (inputs: CoachingInputs) =>
    computeReadinessSignals(inputs, 'ready' as never, [], [], getThresholds()).signals.map((s) => s.signal);

  it('all measured: the figure is printed', () => {
    expect(signalText(base([0.9, 0.9, 0.9]))).toContain('High average confidence (90%)');
  });

  it('one defaulted: the signal stands, with no figure', () => {
    const texts = signalText(base([0.9, 0.9, 0.9, undefined]));
    expect(texts.some((t) => t.startsWith('High average confidence'))).toBe(true);
    for (const t of texts) expect(t).not.toMatch(PRINTED_CONFIDENCE);
  });

  // PR Review #409 5883367656: the LOW path printed "Low average confidence (23%)" from two measured 0.1 values and
  // an unmeasured neutral 0.5.
  it('LOW, all measured: the figure is printed', () => {
    expect(signalText(base([0.1, 0.1]))).toContain('Low average confidence (10%)');
  });

  it('LOW, one defaulted: the signal stands, with no figure', () => {
    const texts = signalText(base([0.1, 0.1, undefined]));
    expect(texts.some((t) => t.startsWith('Low average confidence'))).toBe(true);
    for (const t of texts) expect(t).not.toMatch(PRINTED_CONFIDENCE);
  });
});

describe('the overconfidence critique prints an average only when every factor was measured', () => {
  const inputs = (confidences: Array<number | undefined>): CoachingInputs =>
    ({
      factorSensitivity: confidences.map((confidence, i) => ({
        node_id: `f${i}`, label: `F${i}`, elasticity: 0.1, importance_rank: i + 1, confidence,
      })),
      graph: { nodes: [], edges: [] }, options: [], fragileEdges: [], robustness: {},
      interventionTargetIds: new Set<string>(),
    }) as unknown as CoachingInputs;
  const over = (c: Array<number | undefined>) =>
    generateCritiques(inputs(c)).filter((x) => x.type === 'OVERCONFIDENCE');

  it('all measured: the figure is printed', () => {
    const [critique] = over([0.95, 0.95]);
    expect(critique?.challenge_question).toBe('Average confidence is 95%. Is this justified?');
  });

  it('one defaulted: the critique stands, with no figure', () => {
    const [critique] = over([0.95, 0.95, undefined]);
    expect(critique).toBeDefined();
    expect(critique!.challenge_question).not.toMatch(/\d+\s*%/);
  });
});
