/**
 * SCIENTIFIC REGRESSION GATE — ISL↔PLoT conditional-winner bucket field names
 * ----------------------------------------------------------------------------
 * WHAT WENT WRONG (measured, 17 Aug 2026). PLoT's `ISLConditionalBucket` declared
 * `win_probability: number` over an `as`-cast wire payload
 * (`JSON.parse(text) as T`, src/integrations/isl/client.ts) — no runtime
 * validation. ISL's own models name that member **`winner_probability`**
 * (`src/models/response_v2.py` `BucketResultV2`, and `BucketResult` in
 * `src/models/robustness_v2.py`). So `cw.low_bucket.win_probability` read
 * `undefined` on every real response, the numeric-egress filter required
 * `prob01(...)` on both buckets, and **every row was dropped**:
 * `conditional_winners: []` on 1,270 consecutive live runs since 14 Jun 2026,
 * while ISL was emitting populated rows the whole time.
 *
 * WHY NOTHING CAUGHT IT. Every prior test of this transform fed a fixture written
 * from PLoT's own type claim (`low_bucket: { winner_id, win_probability }`), so the
 * suite and the defect agreed. A fixture the lane writes is not evidence about the
 * wire. This gate therefore reads bytes produced by **ISL's own Pydantic runtime**
 * at a named sha — see `tests/fixtures/isl-conditional-winners-20260817/PROVENANCE.md`.
 *
 * WHAT IT PINS
 *   1. The wire→outbound name mapping, bound by IDENTITY (factor_id), and to the
 *      correct BUCKET (a sibling numeric on the same row is a different value).
 *   2. That the fixture is still the WIRE's shape — if anyone "tidies" it to PLoT's
 *      names, this gate REDs instead of quietly re-creating the mirror.
 *   3. The egress guard's honesty, unchanged: `win_probability` is REQUIRED by the
 *      shared contract (`EnrichmentConditionalBucketSchema` in olumi-schemas —
 *      `win_probability: z.number()`, with an explicit "stays REQUIRED" ruling), so a
 *      row PLoT cannot give a real probability is DROPPED, never emitted bare and
 *      never defaulted to 0.
 *   4. That a payload carrying PLoT's name instead of ISL's is NOT silently accepted
 *      — no lax `a ?? b` alias chain, which would hide the next rename.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformConditionalWinners } from '../../src/routes/v2/run.js';

const FIXTURE_URL = new URL(
  '../fixtures/isl-conditional-winners-20260817/isl-conditional-winners.json',
  import.meta.url,
);
const ISL_ROWS: unknown = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), 'utf8'));

/** The rows keyed by factor_id, so every assertion binds by identity. */
function byFactor(out: Array<{ factor_id: string }>): Record<string, any> {
  return Object.fromEntries(out.map((r) => [r.factor_id, r]));
}

describe('conditional winners · the fixture is the WIRE shape (anti-mirror control)', () => {
  it('every ISL bucket carries `winner_probability` and NO `win_probability`', () => {
    const rows = ISL_ROWS as Array<Record<string, any>>;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      for (const side of ['low_bucket', 'high_bucket'] as const) {
        const bucket = row[side];
        // ISL's declared name is present…
        expect(Object.keys(bucket)).toContain('winner_probability');
        expect(typeof bucket.winner_probability).toBe('number');
        // …and PLoT's outbound name is absent from the INPUT. This is the
        // discrimination: a fixture rewritten to PLoT's names would pass every
        // mapping assertion below while proving nothing about the wire.
        expect(Object.keys(bucket)).not.toContain('win_probability');
        expect(Object.keys(bucket)).not.toContain('mean_outcome');
      }
    }
  });
});

describe('conditional winners · ISL wire bytes survive the transform', () => {
  it('maps ISL `winner_probability` onto the outbound `win_probability`, per bucket', () => {
    const out = transformConditionalWinners(ISL_ROWS);

    // The defect this gate exists for: at the pristine mapping this is [].
    expect(out).toHaveLength(3);

    const rows = byFactor(out);
    expect(Object.keys(rows).sort()).toEqual(['factor-churn', 'factor-demand', 'factor-price']);

    // Bound to the row by factor_id and to the SIDE by name. The sibling
    // numeric on the same row (0.63) is a different value, so a low/high swap
    // cannot satisfy this.
    expect(rows['factor-demand'].low_bucket.win_probability).toBe(0.71);
    expect(rows['factor-demand'].high_bucket.win_probability).toBe(0.63);
    expect(rows['factor-churn'].low_bucket.win_probability).toBe(0.55);
    expect(rows['factor-churn'].high_bucket.win_probability).toBe(0.48);
  });

  it('carries winner identity, labels and the flip attestation', () => {
    const rows = byFactor(transformConditionalWinners(ISL_ROWS));

    expect(rows['factor-demand'].low_bucket.winner_id).toBe('opt-a');
    expect(rows['factor-demand'].high_bucket.winner_id).toBe('opt-b');
    expect(rows['factor-demand'].winner_flips).toBe(true);
    expect(rows['factor-demand'].factor_label).toBe('Customer demand');
    expect(rows['factor-demand'].split_unit).toBe('units/quarter');

    // Labels come from PLoT's option map when it has one, else the id verbatim.
    const labelled = byFactor(
      transformConditionalWinners(ISL_ROWS, undefined, new Map([['opt-a', 'Ship now']])),
    );
    expect(labelled['factor-demand'].low_bucket.winner_label).toBe('Ship now');
    expect(labelled['factor-demand'].high_bucket.winner_label).toBe('opt-b');
  });

  it('runner-up members ride along when ISL sent them, and stay ABSENT when it did not', () => {
    const rows = byFactor(
      transformConditionalWinners(ISL_ROWS, undefined, new Map([['opt-b', 'Wait a quarter']])),
    );
    expect(rows['factor-demand'].low_bucket.runner_up_id).toBe('opt-b');
    expect(rows['factor-demand'].low_bucket.runner_up_label).toBe('Wait a quarter');
    // Row B's buckets carry no runner-up (ISL serialises with exclude_none, so
    // the key is absent, not null) — absence must stay absence.
    expect(rows['factor-churn'].low_bucket).not.toHaveProperty('runner_up_id');
    expect(rows['factor-churn'].low_bucket).not.toHaveProperty('runner_up_label');
  });

  it('a NEGATIVE split_value survives (the census found a real one at -0.017)', () => {
    const rows = byFactor(transformConditionalWinners(ISL_ROWS));
    expect(rows['factor-churn'].split_value).toBe(-0.017);
    expect(rows['factor-churn'].split_unit).toBeUndefined();
  });

  it('probabilities at the [0,1] boundaries survive — 0 is a measurement, not an absence', () => {
    const rows = byFactor(transformConditionalWinners(ISL_ROWS));
    expect(rows['factor-price'].low_bucket.win_probability).toBe(1);
    expect(rows['factor-price'].high_bucket.win_probability).toBe(0);
    // …and a falsy-zero bug would show up as the key vanishing, so pin presence too.
    expect(Object.keys(rows['factor-price'].high_bucket)).toContain('win_probability');
  });

  it('POSTCONDITION, written against the shared contract and not against this defect: '
    + 'every emitted bucket carries a finite win_probability in [0,1]', () => {
    // `EnrichmentConditionalBucketSchema` (olumi-schemas) declares
    // `win_probability: z.number()` — REQUIRED, with an explicit ruling that it
    // stays required even on a claim-withheld turn. So an emitted bucket without
    // one is unparseable at the consumer, whatever the reason for the absence.
    const emitted = transformConditionalWinners(ISL_ROWS);
    // PIN THE PRECONDITION: a for-loop over [] satisfies every assertion below,
    // which is exactly how this gate would pass while the chain stayed dark.
    expect(emitted).toHaveLength(3);
    for (const row of emitted) {
      for (const bucket of [row.low_bucket, row.high_bucket]) {
        expect(typeof bucket.win_probability).toBe('number');
        expect(Number.isFinite(bucket.win_probability)).toBe(true);
        expect(bucket.win_probability).toBeGreaterThanOrEqual(0);
        expect(bucket.win_probability).toBeLessThanOrEqual(1);
      }
      expect(Number.isFinite(row.split_value)).toBe(true);
    }
  });
});

describe('conditional winners · the validated parse refuses what it cannot read', () => {
  /** ISL's real shape for one bucket, as a builder so each case varies ONE thing. */
  const bucket = (over: Record<string, unknown> = {}) => ({
    n_samples: 100, winner_id: 'opt-a', winner_label: 'Option A',
    winner_probability: 0.6, ...over,
  });
  const row = (factor_id: string, over: Record<string, unknown> = {}) => ({
    factor_id, factor_label: 'F', split_value: 0.5,
    low_bucket: bucket(), high_bucket: bucket({ winner_id: 'opt-b', winner_probability: 0.4 }),
    winner_flips: true, ...over,
  });

  it('accepts the control row (so every rejection below is about the mutation, not the builder)', () => {
    expect(transformConditionalWinners([row('control')]).map((r) => r.factor_id)).toEqual(['control']);
  });

  it('does NOT accept PLoT\'s own field name in ISL\'s position — no lax alias chain', () => {
    // A bucket that carries `win_probability` and not `winner_probability` is not
    // ISL's shape. Accepting it via `a ?? b` would re-hide the next rename, so the
    // honest disposal is the drop the egress guard already performs.
    const out = transformConditionalWinners([
      row('plot-name-only', {
        low_bucket: { n_samples: 100, winner_id: 'opt-a', win_probability: 0.6 },
        high_bucket: { n_samples: 100, winner_id: 'opt-b', win_probability: 0.4 },
      }),
      row('isl-name'),
    ]);
    expect(out.map((r) => r.factor_id)).toEqual(['isl-name']);
  });

  it('drops a row whose probability is a NUMBER OUT OF [0,1] — the guard keeps its honesty', () => {
    const out = transformConditionalWinners([
      row('corrupt-high', { high_bucket: bucket({ winner_id: 'opt-b', winner_probability: 1.7 }) }),
      row('corrupt-low', { low_bucket: bucket({ winner_probability: -0.01 }) }),
      row('ok'),
    ]);
    expect(out.map((r) => r.factor_id)).toEqual(['ok']);
  });

  it('drops a row whose probability is non-finite or the wrong TYPE (never coerces)', () => {
    const out = transformConditionalWinners([
      row('nan', { low_bucket: bucket({ winner_probability: Number.NaN }) }),
      row('inf', { low_bucket: bucket({ winner_probability: Number.POSITIVE_INFINITY }) }),
      row('stringy', { low_bucket: bucket({ winner_probability: '0.6' }) }),
      row('nulled', { low_bucket: bucket({ winner_probability: null }) }),
      row('ok'),
    ]);
    expect(out.map((r) => r.factor_id)).toEqual(['ok']);
  });

  it('drops a structurally broken row instead of throwing, and keeps its neighbours', () => {
    const out = transformConditionalWinners([
      null,
      'not a row',
      { factor_id: 'no-buckets', factor_label: 'F', split_value: 0.5, winner_flips: true },
      row('missing-flip', { winner_flips: 'yes' }),
      row('missing-winner-id', { low_bucket: { n_samples: 1, winner_probability: 0.6 } }),
      row('survivor'),
    ]);
    expect(out.map((r) => r.factor_id)).toEqual(['survivor']);
  });

  it('a non-array payload degrades to [] rather than throwing', () => {
    for (const bad of [undefined, null, {}, 'x', 42]) {
      expect(transformConditionalWinners(bad as unknown)).toEqual([]);
    }
  });
});
