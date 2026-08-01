/**
 * ROADMAP 2.258 rider — the attested-no-flip vocabulary has ONE definition.
 *
 * THE DEFECT CLASS. Two byte-identical `Set`s of the same two reason tokens
 * lived in two files and were kept in step BY A COMMENT asking the next editor
 * to remember:
 *
 *   · `NO_EFFECT_REASONS`         — src/lib/flip-threshold-status.ts
 *   · `ATTESTED_NO_FLIP_REASONS`  — src/integrations/isl/adapters/factor-flip-values.ts
 *
 * That is the hand-maintained mirror, the dominant defect class in this estate.
 * Its drift here would have been silent, type-safe, and ASYMMETRIC — each
 * direction produces a different lie:
 *
 *   · token in the CLASSIFIER only → the row is published as `all_no_effect`
 *     (an attestation) while `no_flip_in_range` is never stamped, so the
 *     structural signal CEE reads disagrees with PLoT's own status string.
 *   · token in the ADAPTER only    → `no_flip_in_range: true` ships on a row
 *     this classifier calls `unresolved` — PLoT asserting a proven no-flip it
 *     does not itself believe.
 *
 * 2.258 replaced the copy with an import. This file is the alarm for anyone who
 * "simplifies" it back into a literal.
 *
 * ⚠ WHY THIS TEST READS THE SOURCE TEXT. Asserting the two Sets are equal at
 * runtime would be VACUOUS the moment they are the same object — `A === A` is
 * true no matter how the estate is wired, so the test would pass just as
 * happily over a restored copy-paste that happened to agree TODAY. The
 * behavioural half below is kept because it is what users actually depend on;
 * the SOURCE half is what makes the guarantee durable, because the failure mode
 * being guarded is "someone reintroduces a second definition", and only the
 * text can see that.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { NO_EFFECT_REASONS } from '../src/lib/flip-threshold-status.js';
import { classifyFlipThresholdsStatus } from '../src/lib/flip-threshold-status.js';
import { mapIslFactorFlipValues } from '../src/integrations/isl/adapters/factor-flip-values.js';
import type { EngineGraphV3, EngineNodeV3 } from '../src/types/engine-v3.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const STATUS_SRC = resolve(HERE, '../src/lib/flip-threshold-status.ts');
const ADAPTER_SRC = resolve(HERE, '../src/integrations/isl/adapters/factor-flip-values.ts');

const statusText = readFileSync(STATUS_SRC, 'utf8');
const adapterText = readFileSync(ADAPTER_SRC, 'utf8');

/**
 * Strip `/* *\/` blocks and `//` line comments.
 *
 * REQUIRED, not cosmetic. Both files DOCUMENT the reason tokens heavily — the
 * adapter quotes `flip_reason === 'no_effect_within_bounds'` when explaining
 * what CEE exact-matches. A raw-text scan therefore flags prose and the pin
 * below fires on a correctly-wired file: a false alarm, which is the failure
 * mode this whole PR is about. The claim being pinned is about CODE ("the
 * adapter declares no reason-token literals of its own"), so the scan must see
 * code. `stripsComments_positiveControl` proves the stripper actually works
 * before any absence claim rests on it.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const statusCode = stripComments(statusText);
const adapterCode = stripComments(adapterText);
const TOKEN_LITERAL = /'(?:no_effect_within_bounds|structurally_invariant)'/g;

describe('2.258 rider · NO_EFFECT_REASONS is a single source of truth', () => {
  it('the CLASSIFIER owns the definition and EXPORTS it', () => {
    // Named so a reader of this failure knows exactly which file to open.
    expect(statusText).toMatch(/export const NO_EFFECT_REASONS/);
    // The definition is a real literal set, here and only here.
    expect(statusText).toMatch(/'no_effect_within_bounds'/);
    expect(statusText).toMatch(/'structurally_invariant'/);
  });

  it('the ADAPTER imports it rather than restating it', () => {
    expect(adapterText).toMatch(
      /import\s*\{\s*NO_EFFECT_REASONS\s*\}\s*from\s*'[^']*flip-threshold-status\.js'/,
    );
    expect(adapterText).toMatch(/ATTESTED_NO_FLIP_REASONS\s*=\s*NO_EFFECT_REASONS/);
  });

  it('THE PIN: the adapter declares NO reason-token literals of its own IN CODE', () => {
    // This is the assertion that actually bites a reintroduced copy-paste. If
    // someone restores `new Set(['no_effect_within_bounds', ...])` in the
    // adapter, the import may well survive alongside it and every behavioural
    // test still passes — the mirror is back and invisible again.
    //
    // Scoped to the attested-no-flip tokens on purpose: the adapter legitimately
    // names OTHER reason strings (its own producer-contradiction guards), so a
    // blanket "no string literals" rule would be a false alarm.
    expect(adapterCode.match(TOKEN_LITERAL)).toBeNull();
  });

  it('POSITIVE CONTROL: this file can SEE a token literal in code when one is present', () => {
    // Without this, the assertion above could pass because the regex is wrong
    // rather than because the adapter is clean (trap 13 — an absence assertion
    // must first prove it can see a presence). The classifier is the file that
    // legitimately carries the literals in code, so it is the natural control.
    const inClassifier = statusCode.match(TOKEN_LITERAL);
    expect(inClassifier).not.toBeNull();
    expect(inClassifier!.length).toBeGreaterThanOrEqual(2);
  });

  it('POSITIVE CONTROL: stripComments does not simply empty the file', () => {
    // A stripper that returned '' would make the pin above vacuously green —
    // the exact "absence assertion that cannot see a presence" trap, one level
    // down. Prove it removes prose while keeping code.
    expect(adapterCode).toMatch(/ATTESTED_NO_FLIP_REASONS/);          // code survives
    expect(adapterText).toMatch(/CEE currently recognises an attested no-flip/); // prose was there
    expect(adapterCode).not.toMatch(/CEE currently recognises an attested no-flip/); // and is gone
  });

  // ---------------------------------------------------------------------------
  // The behavioural half — what the shared set actually buys.
  // ---------------------------------------------------------------------------

  const graph: EngineGraphV3 = {
    nodes: [
      { id: 'f1', kind: 'factor', label: 'F1', observed_state: { value: 0.5 } } as EngineNodeV3,
    ],
    edges: [],
  } as EngineGraphV3;

  it.each([...NO_EFFECT_REASONS])(
    "'%s' is stamped no_flip_in_range AND classified as a no-effect — one vocabulary, both sites",
    (reason) => {
      // Adapter side: the row earns the structural attestation.
      const mapped = mapIslFactorFlipValues(
        [{ factor_id: 'f1', current_value: 0.5, flip_reason: reason, baseline_winner_id: 'o1' }],
        { graph },
      )!;
      expect(mapped.rows).toHaveLength(1);
      expect(mapped.rows[0].flip_value).toBeNull();
      expect(mapped.rows[0].no_flip_in_range).toBe(true);

      // Classifier side: the same token yields an attested no-effect, not
      // 'unresolved'. Driving both from the SAME set is the point — add a token
      // to the export and this case appears on both sides automatically.
      expect(
        classifyFlipThresholdsStatus([
          {
            factor_id: 'f1',
            factor_label: 'F1',
            current_value: 0.5,
            flip_value: null,
            alternative_winner_id: null,
            alternative_winner_label: null,
            flip_reason: reason,
          },
        ]).status,
      ).toBe('all_no_effect');
    },
  );

  it('NEGATIVE CONTROL: a non-member token is unresolved on BOTH sides', () => {
    // Proves the two assertions above are discriminating rather than
    // universally true. `candidate_cap_exceeded` is ISL's "a genuine candidate
    // we did not evaluate" — emphatically not an attestation.
    const reason = 'candidate_cap_exceeded';
    expect(NO_EFFECT_REASONS.has(reason)).toBe(false);

    const mapped = mapIslFactorFlipValues(
      [{ factor_id: 'f1', current_value: 0.5, flip_reason: reason, baseline_winner_id: 'o1' }],
      { graph },
    )!;
    expect(mapped.rows[0].no_flip_in_range).toBeUndefined();

    expect(
      classifyFlipThresholdsStatus([
        {
          factor_id: 'f1',
          factor_label: 'F1',
          current_value: 0.5,
          flip_value: null,
          alternative_winner_id: null,
          alternative_winner_label: null,
          flip_reason: reason,
        },
      ]).status,
    ).toBe('unresolved');
  });
});
