/**
 * ROADMAP 2.278 — the fragility verdict must not use FLIP language on turns
 * whose own flip evidence attests there is no flip.
 *
 * WITNESSED (`PHASE0-EVIDENCE-2026-07-28/witness-2267-onscreen-flip.md`):
 * across four analysed guest scenarios, 19 of 19 `flip_thresholds` rows came
 * back `structurally_invariant` — ISL's MATHEMATICAL ATTESTATION that no value
 * of that factor can move the argmax — and the product rendered no flip card,
 * because there was nothing to render. On those same turns the payload shipped
 * `display_verdict: "fragile"` with
 * `display_verdict_reason: "small changes could flip this result"`.
 * One response both asserted a flip and denied one.
 *
 * WHAT IS PINNED HERE:
 *  - the VERDICT is unchanged in every case (2.278 corrects the copy, not the
 *    assessment — a run can be genuinely non-robust with no flippable factor);
 *  - only `all_no_effect` — every row an ATTESTED no-effect, none unresolved —
 *    earns the reworded reason;
 *  - `computed` (a real flip), `unresolved`/`partial_no_effect` (an unfinished
 *    probe) and `unavailable` (legacy/empty) all keep the original wording.
 *
 * The route-level block proves the change survives to the CEE-visible wire —
 * a guard that only changes an internal value is theatre.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveRobustnessDisplayVerdict,
  ROBUSTNESS_DISPLAY_VERDICT_REASONS,
  ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP,
} from '../src/routes/v2/robustness-display-verdict.js';
import type { DenormalisedFlipThreshold } from '../src/lib/flip-threshold-denormaliser.js';

// ---------------------------------------------------------------------------
// Row builders — the witnessed shapes.
// ---------------------------------------------------------------------------

function noFlipRow(
  factor_id: string,
  flip_reason: 'structurally_invariant' | 'no_effect_within_bounds' = 'structurally_invariant',
): DenormalisedFlipThreshold {
  return {
    factor_id,
    factor_label: factor_id,
    current_value: 0,
    flip_value: null,
    alternative_winner_id: null,
    alternative_winner_label: null,
    flip_reason,
    no_flip_in_range: true,
  } as DenormalisedFlipThreshold;
}

function realFlipRow(factor_id: string): DenormalisedFlipThreshold {
  return {
    factor_id,
    factor_label: factor_id,
    current_value: 0,
    flip_value: 0.65,
    direction: 'increase',
    alternative_winner_id: 'opt_build',
    alternative_winner_label: 'Build In-House',
    flip_reason: 'found',
  } as DenormalisedFlipThreshold;
}

function unresolvedRow(
  factor_id: string,
  flip_reason: string = 'timeout',
): DenormalisedFlipThreshold {
  return {
    factor_id,
    factor_label: factor_id,
    current_value: 0,
    flip_value: null,
    alternative_winner_id: null,
    alternative_winner_label: null,
    flip_reason,
  } as DenormalisedFlipThreshold;
}

const FRAGILE_FACTS = { is_robust: false, level: 'low' };
const MODERATE_FACTS = { is_robust: true, level: 'medium' };
const ROBUST_FACTS = { is_robust: true, level: 'high' };

const FLIP_PHRASE = 'small changes could flip this result';

describe('ROADMAP 2.278 — flip evidence informs the verdict REASON', () => {
  // -------------------------------------------------------------------------
  // THE WITNESSED CASE. 19/19 structurally_invariant + fragile.
  // -------------------------------------------------------------------------
  it('W1: attested no-flip + fragile — the reason no longer claims flippability', () => {
    const rows = Array.from({ length: 4 }, (_, i) => noFlipRow(`fac_${i}`));
    const out = deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, rows);

    // The verdict is deliberately UNCHANGED — this row corrects copy, not
    // assessment.
    expect(out.display_verdict).toBe('fragile');

    expect(out.display_verdict_reason).not.toBe(FLIP_PHRASE);
    expect(out.display_verdict_reason).not.toMatch(/flip/i);
    expect(out.display_verdict_reason).toBe(
      ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP.fragile,
    );
  });

  it('W1b: the reworded reason says what WAS measured', () => {
    const out = deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, [noFlipRow('f')]);
    // It must describe the flip measurement that actually ran — SCOPED to the
    // probed set (ROADMAP 2.292 replaced the universal "no single factor"
    // phrasing this pin used to assert: ISL probes only eligible root factors
    // with observed values/uncertainty, so the universal claim overclaimed).
    expect(out.display_verdict_reason).toMatch(/factors we could test/i);
    expect(out.display_verdict_reason).toMatch(/which option leads/i);
    // ...and still disclose that the run scored badly on the OTHER checks,
    // so the corrected copy cannot read as an all-clear.
    expect(out.display_verdict_reason).toMatch(/robustness checks/i);
  });

  it('W2: `no_effect_within_bounds` is equally an attestation', () => {
    const rows = [noFlipRow('a', 'no_effect_within_bounds'), noFlipRow('b')];
    const out = deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, rows);
    expect(out.display_verdict_reason).not.toMatch(/flip/i);
  });

  it('W3: attested no-flip + moderate — reason reworded, verdict unchanged', () => {
    const out = deriveRobustnessDisplayVerdict(MODERATE_FACTS, true, [noFlipRow('f')]);
    expect(out.display_verdict).toBe('moderate');
    expect(out.display_verdict_reason).toBe(
      ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP.moderate,
    );
    expect(out.display_verdict_reason).not.toMatch(/flip/i);
  });

  // -------------------------------------------------------------------------
  // POSITIVE CONTROL — a REAL flip. Flip language is earned; nothing changes.
  // Shape taken from witness-2265-raw/runC (flip_reason 'found',
  // flip_value 0.65).
  // -------------------------------------------------------------------------
  it('C1: a real flip keeps the original flip wording', () => {
    const rows = [realFlipRow('fac_buy_indicator'), noFlipRow('fac_build_indicator')];
    const out = deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, rows);
    expect(out.display_verdict).toBe('fragile');
    expect(out.display_verdict_reason).toBe(FLIP_PHRASE);
  });

  // -------------------------------------------------------------------------
  // FAIL-CLOSED CONTROLS — an unfinished probe attests nothing, and an absent
  // array is not evidence of absence.
  // -------------------------------------------------------------------------
  it('C2: one unresolved row blocks the no-flip wording (a timeout attests nothing)', () => {
    const rows = [noFlipRow('a'), noFlipRow('b'), unresolvedRow('c', 'timeout')];
    const out = deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, rows);
    expect(out.display_verdict_reason).toBe(FLIP_PHRASE);
  });

  it('C2b: an UNKNOWN flip_reason is treated as unresolved, never as an attestation', () => {
    const rows = [noFlipRow('a'), unresolvedRow('b', 'some_future_isl_token')];
    const out = deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, rows);
    expect(out.display_verdict_reason).toBe(FLIP_PHRASE);
  });

  it('C3: an EMPTY array is "nobody measured", not "nothing can flip"', () => {
    expect(deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, []).display_verdict_reason)
      .toBe(FLIP_PHRASE);
  });

  it('C4: legacy payloads are not blinded — omitted/undefined/null keep current copy', () => {
    expect(deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true).display_verdict_reason)
      .toBe(FLIP_PHRASE);
    expect(deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, undefined).display_verdict_reason)
      .toBe(FLIP_PHRASE);
    expect(deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, null).display_verdict_reason)
      .toBe(FLIP_PHRASE);
  });

  // -------------------------------------------------------------------------
  // The verdicts that never carried flip language keep their single reason.
  // -------------------------------------------------------------------------
  it('C5: robust / not_assessed are unaffected by flip evidence', () => {
    expect(
      deriveRobustnessDisplayVerdict(ROBUST_FACTS, true, [noFlipRow('f')]).display_verdict_reason,
    ).toBe(ROBUSTNESS_DISPLAY_VERDICT_REASONS.robust);

    expect(
      deriveRobustnessDisplayVerdict(undefined, false, [noFlipRow('f')]).display_verdict_reason,
    ).toBe(ROBUSTNESS_DISPLAY_VERDICT_REASONS.not_assessed);
  });

  it('C6: no reworded reason is ever emitted for a verdict that has none', () => {
    expect(ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP.robust).toBeUndefined();
    expect(ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP.not_assessed).toBeUndefined();
  });

  it('C7: every reworded reason is claim-safe (non-empty, no digits)', () => {
    for (const [verdict, reason] of Object.entries(
      ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP,
    )) {
      expect(reason, verdict).toBeTruthy();
      expect(reason!.length, verdict).toBeGreaterThan(0);
      expect(reason!, verdict).not.toMatch(/\d/);
    }
  });
});

// ===========================================================================
// ROADMAP 2.292 — the no-flip reason must claim only the TESTED scope.
//
// ISL emits flip-threshold rows ONLY for ELIGIBLE ROOT factors carrying
// observed values/uncertainty (robustness_analyzer_v2.py factor-eligibility
// selection, ISL tip f35975dc). "No single factor on its own changed which
// option leads" is therefore an OVERCLAIM: a non-root or unobserved factor was
// never probed and may still flip the leading option. The sentence must scope
// itself to what was actually tested — an attestation over the probed set,
// never a universal over the whole graph.
//
// ⚠ 2.278's constraint carries forward unchanged: only the REASON COPY moves.
// The verdict-stability pins above (W1/W3) and the wire-survival pins below
// (R1–R4) must stay green against the reworded strings.
// ===========================================================================

describe('ROADMAP 2.292 — the no-flip reason claims only what was tested', () => {
  it('S1: the fragile reason scopes its claim to the TESTED factors, not to every factor', () => {
    const out = deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, [noFlipRow('f')]);
    // The corrected copy names the tested scope...
    expect(out.display_verdict_reason).toMatch(/factors we could test/i);
    // ...and no longer asserts the universal "no single factor" over factors
    // ISL never probed (non-root / unobserved factors are not in the rows).
    expect(out.display_verdict_reason).not.toMatch(/no single factor/i);
  });

  it('S2: the moderate reason is scoped the same way', () => {
    const out = deriveRobustnessDisplayVerdict(MODERATE_FACTS, true, [noFlipRow('f')]);
    expect(out.display_verdict_reason).toMatch(/factors we could test/i);
    expect(out.display_verdict_reason).not.toMatch(/no single factor/i);
  });

  it('S3: the scoped copy still says what was measured and does not read as an all-clear', () => {
    const out = deriveRobustnessDisplayVerdict(FRAGILE_FACTS, true, [noFlipRow('f')]);
    // What was measured: the probed factors did not change the leading option.
    expect(out.display_verdict_reason).toMatch(/which option leads/i);
    // Not an all-clear: the fragile variant still discloses the low score on
    // the other robustness checks.
    expect(out.display_verdict_reason).toMatch(/robustness checks/i);
    // And it still never claims a flip.
    expect(out.display_verdict_reason).not.toMatch(/flip/i);
  });

  it('S4: no universal-scope wording anywhere in the attested-no-flip reason set', () => {
    for (const [verdict, reason] of Object.entries(
      ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP,
    )) {
      expect(reason!, verdict).not.toMatch(/no single factor/i);
      expect(reason!, verdict).not.toMatch(/\bany factor\b/i);
      expect(reason!, verdict).not.toMatch(/\ball factors\b/i);
    }
  });

  it('S5: VERDICT STABILITY under the reworded copy — the verdict never moves (2.278 invariant re-pinned)', () => {
    // Same producer facts, with and without the attestation: the verdict is
    // identical in every case; only the reason string may differ.
    for (const facts of [FRAGILE_FACTS, MODERATE_FACTS, ROBUST_FACTS]) {
      const withAttestation = deriveRobustnessDisplayVerdict(facts, true, [noFlipRow('f')]);
      const without = deriveRobustnessDisplayVerdict(facts, true, undefined);
      expect(withAttestation.display_verdict).toBe(without.display_verdict);
    }
  });
});

// ===========================================================================
// ROUTE LEVEL — does the corrected copy actually reach the wire CEE reads?
// ===========================================================================

const FIXTURES_ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

const capture = JSON.parse(
  readFileSync(join(FIXTURES_ROOT, 'isl-v2-live-20260707', 'isl-staging-capture.json'), 'utf8'),
);
const request = JSON.parse(
  readFileSync(join(FIXTURES_ROOT, 'isl-v2-live-20260707', 'isl-v2-request.json'), 'utf8'),
);

let currentIslPayload: any = null;

const mockISLService = {
  isEnabled(): boolean { return true; },
  async isAvailable(): Promise<boolean> { return true; },
  async validateCausal() {
    return {
      status: 'identifiable', confidence: 'high',
      adjustment_sets: [], minimal_set: [], backdoor_paths: [], issues: [],
      explanation: { summary: 'Mock', reasoning: 'Test' }, source: 'isl',
    };
  },
  async analyseSensitivity() {
    return { overall_robustness: 'robust', sensitive_parameters: [], recommendations: [], source: 'isl' };
  },
  async analyseFactorSensitivity() {
    return { factors: [], value_of_information: [], robustness_label: 'robust' as const, robustness_score: 0.8, latency_ms: 0, source: 'unavailable' as const };
  },
  async computeCounterfactual(): Promise<never> { throw new Error('not called'); },
  async callAnalysisEndpoint<T>(): Promise<{ data: T | null; error: string | null }> {
    return { data: JSON.parse(JSON.stringify(currentIslPayload)) as T, error: null };
  },
};

vi.mock('../src/integrations/isl/index.ts', async () => {
  const actual = await vi.importActual<any>('../src/integrations/isl/index.ts');
  return { ...actual, getISLService: () => mockISLService, islService: mockISLService };
});

const { createServer } = await import('../src/createServer.js');

function buildPlotBody(islRequest: any) {
  return {
    graph: {
      nodes: islRequest.graph.nodes.map((n: any) => ({
        id: n.id,
        kind: n.kind,
        label: n.label,
        ...(n.observed_state?.value !== undefined && n.observed_state?.value !== null
          ? { observed_state: { value: n.observed_state.value } }
          : {}),
      })),
      edges: islRequest.graph.edges.map((e: any) => ({
        from: e.from,
        to: e.to,
        exists_probability: e.exists_probability,
        strength: { mean: e.strength.mean, std: e.strength.std },
      })),
    },
    options: islRequest.options.map((o: any) => ({
      id: o.id,
      label: o.label,
      interventions: Object.fromEntries(
        Object.entries(o.interventions).map(([nodeId, value]) => [
          nodeId,
          { value, source: 'user_specified' },
        ]),
      ),
    })),
    goal_node_id: islRequest.goal_node_id,
    seed: String(islRequest.seed),
  };
}

/** Factor ids from the captured request, so mapping finds real nodes. */
function factorIds(limit: number): string[] {
  return (request.graph.nodes as any[])
    .filter((n) => n.kind === 'factor' && Number.isFinite(n.observed_state?.value))
    .slice(0, limit)
    .map((n) => n.id);
}

describe('ROADMAP 2.278 — the corrected reason reaches the CEE-visible wire', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    app = await createServer();
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
  });

  async function runWithFlips(flipValues: any[] | undefined) {
    currentIslPayload = JSON.parse(JSON.stringify(capture));
    if (flipValues !== undefined) {
      currentIslPayload.factor_flip_values = flipValues;
    }
    const res = await app.inject({
      method: 'POST',
      url: '/v2/run',
      headers: { 'Content-Type': 'application/json' },
      payload: buildPlotBody(request),
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('R1: baseline — this capture ships the FRAGILE verdict (control for R2)', async () => {
    const body = await runWithFlips(undefined);
    expect(body.robustness.display_verdict).toBe('fragile');
    // No flip block from ISL → 'unavailable' → original wording preserved.
    expect(body.robustness.display_verdict_reason).toBe(FLIP_PHRASE);
  });

  it('R2: all rows structurally_invariant — the WIRE no longer claims a flip', async () => {
    const ids = factorIds(3);
    expect(ids.length).toBeGreaterThan(0);

    const body = await runWithFlips(
      ids.map((id) => ({
        factor_id: id,
        current_value: 0,
        flip_value: null,
        flip_reason: 'structurally_invariant',
      })),
    );

    // The evidence really did land as an attestation...
    expect(body.flip_thresholds.length).toBe(ids.length);
    expect(body.flip_thresholds.every((r: any) => r.no_flip_in_range === true)).toBe(true);
    expect(body.flip_thresholds_status).toBe('all_no_effect');

    // ...and the verdict copy on the same payload agrees with it.
    expect(body.robustness.display_verdict).toBe('fragile');
    expect(body.robustness.display_verdict_reason).not.toMatch(/flip/i);
    expect(body.robustness.display_verdict_reason).toBe(
      ROBUSTNESS_DISPLAY_VERDICT_REASONS_ATTESTED_NO_FLIP.fragile,
    );

    // The contradiction the witness caught must be gone from the whole payload
    // surface CEE transports.
    expect(JSON.stringify(body.robustness)).not.toContain(FLIP_PHRASE);
  });

  it('R3: a real flip on the wire keeps the flip wording', async () => {
    const ids = factorIds(2);
    const body = await runWithFlips([
      {
        factor_id: ids[0],
        current_value: 0,
        flip_value: 0.65,
        direction: 'increase',
        flip_reason: 'found',
        alternative_winner_id: 'opt_x',
      },
      { factor_id: ids[1], current_value: 0, flip_value: null, flip_reason: 'structurally_invariant' },
    ]);

    expect(body.flip_thresholds_status).not.toBe('all_no_effect');
    expect(body.robustness.display_verdict_reason).toBe(FLIP_PHRASE);
  });

  it('R4: an unresolved row on the wire keeps the flip wording (fail-closed)', async () => {
    const ids = factorIds(2);
    const body = await runWithFlips([
      { factor_id: ids[0], current_value: 0, flip_value: null, flip_reason: 'structurally_invariant' },
      { factor_id: ids[1], current_value: 0, flip_value: null, flip_reason: 'timeout' },
    ]);

    expect(body.flip_thresholds_status).not.toBe('all_no_effect');
    expect(body.robustness.display_verdict_reason).toBe(FLIP_PHRASE);
  });
});
