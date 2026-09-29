/**
 * A TYPED audience on every assumptions-ledger row (AIQ #72 5884364585; DL 5884241382 / 5884225297).
 *
 * The ledger mixes assumptions of THIS decision model a user could check or change (a fragile link, a measured factor
 * confidence) with process diagnostics ("Non-canonical fields stripped before ISL: unit", "normalised range=[0,200]
 * source=explicit_cap"). A reader must filter on a typed field, never on a dedup-key or text pattern. A new or unknown
 * source class is `internal` (fail closed). Counts a user sees count `user` rows only.
 *
 * The classifier rows replay the SERVED ledger (PLoT 2e9de99, tests/fixtures/r3b-blind-oat-20260929/served-C0-ledger-2e9de99.json).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildAssumptionsLedger, ledgerAudience, type AssumptionRecord } from '../../src/coaching/assumptions-ledger.js';
import type { CoachingInputs } from '../../src/coaching/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const served = JSON.parse(
  readFileSync(join(here, '../fixtures/r3b-blind-oat-20260929/served-C0-ledger-2e9de99.json'), 'utf8'),
).assumptions_ledger as { assumptions: AssumptionRecord[]; total_count: number };

describe('the served ledger rows classify by their typed source class', () => {
  it('precondition: 7 served rows, 5 of them normaliser diagnostics', () => {
    expect(served.total_count).toBe(7);
    expect(served.assumptions.filter((a) => a.source_service === 'plot_normaliser')).toHaveLength(5);
  });

  it('normaliser rows are internal; the fragile edge and the measured 44% factor are user', () => {
    const user = served.assumptions.filter((a) => ledgerAudience(a) === 'user').map((a) => a.reason);
    expect(user).toEqual([
      'Edge Pro plan price → MRR has 48% chance of flipping decision',
      'Factor Other MRR growth has low confidence (44%)',
    ]);
    for (const a of served.assumptions.filter((x) => x.source_service === 'plot_normaliser')) {
      expect(ledgerAudience(a), a.reason).toBe('internal');
    }
  });

  it('an unknown or unlisted source class is internal (fail closed)', () => {
    expect(ledgerAudience({ source_service: 'cee_review', entity_type: 'node', field: 'x' })).toBe('internal');
    expect(ledgerAudience({ source_service: 'something_new' as never, entity_type: 'edge', field: 'switch_probability' })).toBe('internal');
    expect(ledgerAudience({ source_service: 'isl_engine', entity_type: 'node', field: 'something_else' })).toBe('internal');
  });
});

describe('the producer stamps every row, and user counts count user rows only', () => {
  const inputs = {
    graph: { nodes: [{ id: 'goal', kind: 'goal', label: 'Goal' }, { id: 'f1', kind: 'factor', label: 'Demand' }], edges: [] },
    options: [], robustness: {}, interventionTargetIds: new Set<string>(),
    factorSensitivity: [{ node_id: 'f1', label: 'Demand', importance_rank: 1, elasticity: 0.4, influence_score: 0.4, confidence: 0.3 }],
    fragileEdges: [{
      edgeId: 'f1->goal', fromId: 'f1', toId: 'goal', fromLabel: 'Demand', toLabel: 'Goal', displayLabel: 'Demand → Goal',
      switchProb: 0.4, altWinnerLabel: 'B', altWinnerId: 'b',
    }],
  } as unknown as CoachingInputs;
  const repair = { field: 'intervention.value.f1', action: 'normalised', from_value: 49, to_value: 0.245, reason: 'normalised range=[0,200] source=explicit_cap' };
  const ledger = buildAssumptionsLedger(inputs, [repair]);

  it('every row carries a typed audience', () => {
    expect(ledger.assumptions.length).toBeGreaterThanOrEqual(3);
    for (const a of ledger.assumptions) expect(['user', 'internal']).toContain(a.audience);
    expect(ledger.assumptions.find((a) => a.source_service === 'plot_normaliser')?.audience).toBe('internal');
  });

  it('user_count and user_high_impact_count count user rows only; the totals are unchanged', () => {
    const user = ledger.assumptions.filter((a) => a.audience === 'user');
    expect(ledger.user_count).toBe(user.length);
    expect(ledger.user_count).toBe(2);
    expect(ledger.user_high_impact_count).toBe(user.filter((a) => a.impact === 'high').length);
    expect(ledger.total_count).toBe(ledger.assumptions.length);
  });
});
