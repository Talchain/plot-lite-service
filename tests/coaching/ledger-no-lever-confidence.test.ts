/**
 * No "low confidence (N%)" ledger line on a LEVER the options set (AIQ #72 5883875188).
 *
 * On the served C0 run (PLoT 8a66071), the ledger said "Factor Pro plan price has low confidence (30%)". Price is set by
 * every price option, and its level today is the user's own £49. The figure is ISL's attribution stability, but a user
 * reads it as "Olumi isn't sure of your price". Evidence gaps already exclude option-set levers; the ledger's
 * low-confidence loop did not. A measured, non-lever figure keeps its line.
 *
 * Rows replay the SERVED C0 egress (tests/fixtures/r3b-blind-oat-20260929/served-C0-8a66071.json).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { normaliseCoachingInputs } from '../../src/coaching/normalise-inputs.js';
import { buildAssumptionsLedger } from '../../src/coaching/assumptions-ledger.js';

const here = dirname(fileURLToPath(import.meta.url));
const served = JSON.parse(
  readFileSync(join(here, '../fixtures/r3b-blind-oat-20260929/served-C0-8a66071.json'), 'utf8'),
) as {
  request: { graph: unknown; options: Array<{ interventions?: Record<string, unknown> }> };
  response: {
    factor_sensitivity: unknown[];
    m1_coaching: { assumptions_ledger: { assumptions: Array<{ field: string; entity_id: string; reason: string }> } };
  };
};

const PRICE = 'pro_plan_price';
const OTHER = 'other_mrr_growth';

const confidenceEntries = () => {
  const inputs = normaliseCoachingInputs(
    served.request.graph as never, served.request.options as never, {}, served.response.factor_sensitivity as never,
  );
  return buildAssumptionsLedger(inputs).assumptions.filter((a) => a.field === 'confidence');
};

describe('the ledger names no confidence figure for an option-set lever', () => {
  it('precondition: price is a lever, and the served ledger carried its "low confidence (30%)" line', () => {
    expect(served.request.options.some((o) => Object.keys(o.interventions ?? {}).includes(PRICE))).toBe(true);
    const line = served.response.m1_coaching.assumptions_ledger.assumptions.find(
      (a) => a.field === 'confidence' && a.entity_id === PRICE,
    );
    expect(line?.reason).toBe('Factor Pro plan price has low confidence (30%)');
  });

  it('no confidence entry for the lever', () => {
    expect(confidenceEntries().map((a) => a.entity_id)).not.toContain(PRICE);
  });

  it('control: a measured, non-lever low confidence keeps its line', () => {
    const other = confidenceEntries().find((a) => a.entity_id === OTHER);
    expect(other?.reason).toBe('Factor Other MRR growth: its effect on the result is not steady (44%)');
  });

  it('the line says what was measured (how steady the effect is), never "low confidence" in the value (AIQ #72 5884364585)', () => {
    const lines = confidenceEntries().map((a) => a.reason);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).not.toMatch(/confidence/i);
  });
});
