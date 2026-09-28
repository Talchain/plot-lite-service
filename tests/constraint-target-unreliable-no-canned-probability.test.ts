/**
 * R5-1 (R1 design note, MG #72 5871257542; handed to R&C whole, MG 5871363476):
 * `CONSTRAINT_TARGET_UNRELIABLE` makes NO probability claim unless one was
 * computed.
 *
 * WHAT THE USER WAS TOLD, verbatim, on Paul's served runs (e.g. CEE fixture
 * `served-paul-9bd3747-caveat.json`, "Monthly churn"):
 *
 *     "Comparing the two would report a near-zero chance for every option no
 *      matter how good the options are, so goal-fit probabilities were
 *      withheld for this run rather than shown."
 *
 * Nothing computed that "near-zero chance". The builder is given a node label
 * and a list of REASONS — no probability, no sample, no distribution — so any
 * statement about what the probabilities "would" be is invented by the copy,
 * not read from the engine. It is also false in general: an unanchored sample
 * frame can put a modelled CHANGE on either side of an absolute threshold, so
 * "near-zero for every option" is only one possible outcome.
 *
 * THE RULE THIS SPEC PINS: every arm of the builder states the TRUE reason (the
 * two numbers are not on the same scale / not the same quantity) and that the
 * probabilities were withheld, and NO arm carries a likelihood or magnitude
 * claim. The positive rows prove the probe still sees the reason, so a builder
 * that had gone quiet cannot pass.
 */

import { describe, it, expect } from 'vitest';
import {
  buildConstraintTargetUnreliableMessage,
  type ConstraintUnreliabilityReason,
} from '../src/lib/constraint-reliability.js';

// Likelihood / magnitude wording. "probabilities were withheld" is NOT a
// probability claim (it names what was not shown), so the bare noun is allowed;
// what is refused is any statement of how large or likely something is.
const CANNED_PROBABILITY =
  /near[- ]zero|\bchance\b|\blikel(?:y|ihood)\b|\bunlikely\b|no matter how good|\d+(?:\.\d+)?\s*%/i;

const LABEL = 'Monthly churn';

const ARMS: Array<{
  name: string;
  reasons: ConstraintUnreliabilityReason[];
  targetIsRoot?: boolean;
}> = [
  { name: 'sample_frame_unanchored · non-root (Paul\'s served shape)', reasons: ['sample_frame_unanchored'], targetIsRoot: false },
  { name: 'sample_frame_unanchored · root', reasons: ['sample_frame_unanchored'], targetIsRoot: true },
  { name: 'sample_frame_unanchored · root-ness unproved', reasons: ['sample_frame_unanchored'] },
  { name: 'sample_frame_unanchored + target_base_defaulted', reasons: ['target_base_defaulted', 'sample_frame_unanchored'], targetIsRoot: false },
  { name: 'unit mismatch + unanchored', reasons: ['constraint_unit_mismatch', 'sample_frame_unanchored'] },
  { name: 'unit mismatch only', reasons: ['constraint_unit_mismatch'] },
  { name: 'target_base_defaulted only', reasons: ['target_base_defaulted'] },
  { name: 'threshold_normalisation_defaulted only', reasons: ['threshold_normalisation_defaulted'] },
];

describe('R5-1 — CONSTRAINT_TARGET_UNRELIABLE makes no uncomputed probability claim', () => {
  for (const arm of ARMS) {
    it(`${arm.name}: no likelihood or magnitude wording`, () => {
      const msg = buildConstraintTargetUnreliableMessage(LABEL, arm.reasons, undefined, arm.targetIsRoot);
      expect(msg.match(CANNED_PROBABILITY)?.[0] ?? null).toBeNull();
    });

    it(`${arm.name}: still names the node and says the probabilities were withheld (positive control)`, () => {
      const msg = buildConstraintTargetUnreliableMessage(LABEL, arm.reasons, undefined, arm.targetIsRoot);
      expect(msg).toContain(`"${LABEL}"`);
      expect(msg).toMatch(/withheld/);
    });
  }

  it('the unanchored arms state the TRUE reason: the two are not on the same scale', () => {
    for (const targetIsRoot of [true, false, undefined]) {
      const msg = buildConstraintTargetUnreliableMessage(LABEL, ['sample_frame_unanchored'], undefined, targetIsRoot);
      expect(msg).toContain('same scale');
    }
  });

  it('the probe is live: it catches the sentence that was served', () => {
    const served =
      'Comparing the two would report a near-zero chance for every option no matter how ' +
      'good the options are, so goal-fit probabilities were withheld for this run rather than shown.';
    expect(served).toMatch(CANNED_PROBABILITY);
    // …and does not fire on the withheld-noun phrasing the fix keeps.
    expect('Goal-fit probabilities were withheld for this run.').not.toMatch(CANNED_PROBABILITY);
  });
});
