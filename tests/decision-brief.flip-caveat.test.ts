/**
 * ROADMAP 2.1247 — robustness_caveat flip-evidence composition.
 *
 * The caveat used to be composed from robustness MARGINALS alone
 * (is_robust / level); per-factor flip evidence in the SAME response could
 * attest that no tested factor flips the leader while the caveat claimed
 * "small changes to assumptions could change which option leads" — the same
 * self-contradiction the display verdict fixed for its reason string
 * (ROADMAP 2.278, witness-2267-onscreen-flip.md).
 *
 * SPEC (what the consumer of the brief is entitled to): the caveat is TWO
 * NAMED CLAIMS that cannot contradict each other —
 *   claim 1 (`text`)          — aggregate stability under the perturbations
 *                               tested (marginals scope);
 *   claim 2 (`flip_evidence`) — what this run's per-factor flip probes
 *                               attest (probed-set scope). Present ONLY when
 *                               the probes support a claim (computed /
 *                               all_no_effect / partial_no_effect); absent
 *                               when probes were unavailable or unresolved,
 *                               because an unfinished probe attests nothing.
 *
 * Invariants here are written against that spec over the WHOLE input domain
 * (trap 13d: never against the single witnessed failure mode), and the flip
 * classification is asserted EQUAL to `classifyFlipThresholdsStatus` — the
 * single source of truth — so the caveat can never re-derive its own
 * vocabulary and drift (trap 12).
 */

import { describe, it, expect } from 'vitest';
import { assembleBrief, type BriefAssemblyInput } from '../src/assembly/decision-brief.js';
import { classifyFlipThresholdsStatus } from '../src/lib/flip-threshold-status.js';
import type { DenormalisedFlipThreshold } from '../src/lib/flip-threshold-denormaliser.js';

// =============================================================================
// Fixture builders
// =============================================================================

const OPTIONS = [
  { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.62 },
  { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.38 },
] as any[];

function attestedNoFlipRow(id: string, reason: 'structurally_invariant' | 'no_effect_within_bounds' = 'structurally_invariant'): DenormalisedFlipThreshold {
  return {
    factor_id: id,
    factor_label: `Factor ${id}`,
    current_value: 100,
    flip_value: null,
    no_flip_in_range: true,
    alternative_winner_id: null,
    alternative_winner_label: null,
    flip_reason: reason,
  };
}

function computedFlipRow(id: string): DenormalisedFlipThreshold {
  return {
    factor_id: id,
    factor_label: `Factor ${id}`,
    current_value: 100,
    flip_value: 140,
    direction: 'increase',
    alternative_winner_id: 'opt_b',
    alternative_winner_label: 'Option B',
    flip_reason: 'found',
  };
}

function unresolvedRow(id: string, reason = 'timeout'): DenormalisedFlipThreshold {
  return {
    factor_id: id,
    factor_label: `Factor ${id}`,
    current_value: 100,
    flip_value: null,
    alternative_winner_id: null,
    alternative_winner_label: null,
    flip_reason: reason,
  };
}

function buildInput(
  robustness: Record<string, unknown>,
  flipThresholds?: DenormalisedFlipThreshold[],
): BriefAssemblyInput {
  return {
    analysis_status: 'computed',
    critiques: [],
    option_comparison: OPTIONS,
    robustness: { fragile_edges: [], robust_edges: [], ...robustness } as any,
    ...(flipThresholds !== undefined ? { flip_thresholds: flipThresholds } : {}),
    meta: { seed_used: '42' },
  } as BriefAssemblyInput;
}

/** The flip-language predicate claim 1 must never use against an attested no-flip. */
const FLIP_CLAIM = /change which option leads|flip/i;

// =============================================================================
// The witnessed contradiction class (named cases)
// =============================================================================

describe('robustness_caveat — attested no-flip evidence (2.1247)', () => {
  it('CONTRADICTION KILL: fragile marginals + all rows attested no-flip → text no longer claims a flip', () => {
    const brief = assembleBrief(
      buildInput({ is_robust: false, level: 'low' }, [attestedNoFlipRow('f1'), attestedNoFlipRow('f2', 'no_effect_within_bounds')]),
    );
    const caveat = brief?.robustness_caveat;
    expect(caveat).toBeDefined();
    // Claim 1 keeps its marginal-scoped verdict but must not assert the flip
    // this same payload's evidence refutes.
    expect(caveat!.text).not.toMatch(FLIP_CLAIM);
    expect(caveat!.text).toContain('perturbations tested');
    // Claim 2 carries the attestation, scoped to the probed set (2.292 scoping).
    expect(caveat!.flip_evidence).toBeDefined();
    expect(caveat!.flip_evidence!.status).toBe('all_no_effect');
    expect(caveat!.flip_evidence!.text).toContain('factors we could test');
  });

  it('is_robust false with no level + attested no-flip → text no longer claims a flip', () => {
    const brief = assembleBrief(buildInput({ is_robust: false }, [attestedNoFlipRow('f1')]));
    const caveat = brief?.robustness_caveat;
    expect(caveat!.basis).toBe('is_robust');
    expect(caveat!.text).not.toMatch(FLIP_CLAIM);
    expect(caveat!.text).toContain('did not pass');
    expect(caveat!.flip_evidence!.status).toBe('all_no_effect');
  });

  it('a computed flip is acknowledged as a named claim (earned flip language)', () => {
    const brief = assembleBrief(buildInput({ is_robust: false, level: 'low' }, [computedFlipRow('f1'), computedFlipRow('f2')]));
    const caveat = brief?.robustness_caveat;
    expect(caveat!.flip_evidence).toBeDefined();
    expect(caveat!.flip_evidence!.status).toBe('computed');
    expect(caveat!.flip_evidence!.text).toMatch(/change which option leads/);
    // Aggregate claim keeps its original wording — consistent with the evidence.
    expect(caveat!.text).toContain('fragile under the perturbations tested');
  });

  it('partial no-effect (computed + attested rest) carries its own claim', () => {
    const brief = assembleBrief(buildInput({ level: 'medium' }, [computedFlipRow('f1'), attestedNoFlipRow('f2')]));
    const caveat = brief?.robustness_caveat;
    expect(caveat!.flip_evidence!.status).toBe('partial_no_effect');
    expect(caveat!.flip_evidence!.text).toMatch(/change which option leads/);
  });

  it('unresolved probes attest nothing: no flip_evidence claim, wording unchanged', () => {
    const brief = assembleBrief(buildInput({ is_robust: false, level: 'low' }, [attestedNoFlipRow('f1'), unresolvedRow('f2')]));
    const caveat = brief?.robustness_caveat;
    expect(caveat!.flip_evidence).toBeUndefined();
    expect(caveat!.text).toContain('small changes to assumptions could change which option leads');
  });

  it('absent flip evidence: caveat byte-identical to the pre-2.1247 shape (no flip_evidence key)', () => {
    const brief = assembleBrief(buildInput({ is_robust: false, level: 'low' }));
    const caveat = brief?.robustness_caveat;
    expect(caveat).toEqual({
      text: 'This ranking was fragile under the perturbations tested — small changes to assumptions could change which option leads.',
      basis: 'is_robust',
      doctrine: 'provisional_doctrine_v0',
    });
    expect(Object.keys(caveat as object)).not.toContain('flip_evidence');
  });

  it('empty flip array is unavailable, not an attestation: no flip_evidence claim', () => {
    const brief = assembleBrief(buildInput({ level: 'low' }, []));
    expect(brief?.robustness_caveat?.flip_evidence).toBeUndefined();
  });
});

// =============================================================================
// Spec invariants over the whole input domain
// =============================================================================

describe('robustness_caveat — domain-wide consistency invariants (2.1247)', () => {
  const IS_ROBUST_VALUES = [true, false, undefined] as const;
  const LEVEL_VALUES = ['high', 'medium', 'moderate', 'low', 'very_low', undefined, 'unrecognised_future_level'] as const;
  const FLIP_CLASSES: Array<{ name: string; rows?: DenormalisedFlipThreshold[] }> = [
    { name: 'absent', rows: undefined },
    { name: 'empty', rows: [] },
    { name: 'all_attested', rows: [attestedNoFlipRow('f1'), attestedNoFlipRow('f2')] },
    { name: 'all_computed', rows: [computedFlipRow('f1')] },
    { name: 'computed_plus_attested', rows: [computedFlipRow('f1'), attestedNoFlipRow('f2')] },
    { name: 'attested_plus_unresolved', rows: [attestedNoFlipRow('f1'), unresolvedRow('f2')] },
    { name: 'all_unresolved', rows: [unresolvedRow('f1', 'candidate_cap_exceeded')] },
  ];

  it('claims never contradict: every marginal state × every flip-evidence class', () => {
    for (const is_robust of IS_ROBUST_VALUES) {
      for (const level of LEVEL_VALUES) {
        for (const flips of FLIP_CLASSES) {
          const robustness: Record<string, unknown> = {};
          if (is_robust !== undefined) robustness.is_robust = is_robust;
          if (level !== undefined) robustness.level = level;

          const brief = assembleBrief(buildInput(robustness, flips.rows));
          const caveat = brief?.robustness_caveat;
          expect(caveat, `caveat missing for ${JSON.stringify({ is_robust, level, flips: flips.name })}`).toBeDefined();

          // The spec's classification, derived from the single source of truth.
          const { status } = classifyFlipThresholdsStatus(flips.rows);
          const label = JSON.stringify({ is_robust, level, flips: flips.name, status });

          if (status === 'all_no_effect') {
            // An attested no-flip payload must never carry a caveat claiming a flip.
            expect(caveat!.text, `claim-1 flip language despite attestation: ${label}`).not.toMatch(FLIP_CLAIM);
          }

          if (caveat!.flip_evidence !== undefined) {
            // Claim 2 exists only when the evidence supports a claim, and its
            // status must EQUAL the shared classifier's (derived, not mirrored).
            expect(['computed', 'all_no_effect', 'partial_no_effect'], label).toContain(caveat!.flip_evidence.status);
            expect(caveat!.flip_evidence.status, label).toBe(status);
            expect(caveat!.flip_evidence.text.length, label).toBeGreaterThan(0);
            // Claim-safety: no numbers in the flip claim.
            expect(caveat!.flip_evidence.text, label).not.toMatch(/\d/);
            // No self-contradiction inside claim 2 either.
            if (caveat!.flip_evidence.status === 'all_no_effect') {
              expect(caveat!.flip_evidence.text, label).not.toMatch(/could change which option leads(?! on its own)/);
            }
          } else {
            // Absence of claim 2 is only honest when nothing was attested.
            expect(['unavailable', 'unresolved'], label).toContain(status);
          }

          // basis (claim 1's scope marker) is untouched by flip evidence.
          const expectedBasis = is_robust !== undefined ? 'is_robust' : level !== undefined ? 'level' : 'absent';
          expect(caveat!.basis, label).toBe(expectedBasis);
        }
      }
    }
  });

  it('run.ts threads the SAME flip array the response publishes (same-run doctrine)', async () => {
    // Structural pin: the assembleBrief call site in run.ts must pass
    // flip_thresholds. A name-grep is not a wire witness, but this seam has no
    // public route harness here; the integration is additionally covered by the
    // input-threading tests above running through the public assembleBrief API.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const runTs = readFileSync(join(here, '..', 'src', 'routes', 'v2', 'run.ts'), 'utf8');
    const callSite = runTs.slice(runTs.indexOf('const assembledBrief = assembleBrief({'));
    const callBlock = callSite.slice(0, callSite.indexOf('});') + 3);
    expect(callBlock).toContain('flip_thresholds: flipThresholds');
  });
});
