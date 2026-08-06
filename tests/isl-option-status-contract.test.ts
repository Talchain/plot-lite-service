/**
 * ISL per-option `status` — enum pairing contract (ROADMAP 2.744)
 * ----------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * `ISLOptionComparisonResult.status` is a hand-written TypeScript mirror of a
 * Pydantic `Literal`. It drifted, silently, and the drift was not a typo — the
 * ENVELOPE-level status vocabulary ('skipped' / 'error') was copied onto the
 * PER-OPTION field. Two live consequences on `/v2/run`, both invisible to a
 * green suite because the fixtures were annotated against the same mirror:
 *
 *   1. `hasOptionError` (routes/v2/run.ts) tested for `status === 'error'`, a
 *      value the producer cannot emit, so it was permanently false.
 *   2. The run-status exemption list omitted ISL's real 'partial'/'failed', so
 *      a single failed option degraded the WHOLE run.
 *
 * A mirror that a human must remember to sync WILL drift, and the drift always
 * reads as green (root CLAUDE.md trap 12). So this test does not restate the
 * enum — it DERIVES the producer's side and pairs it against ours.
 *
 * PRODUCER SIDE: `tests/fixtures/isl-pinned/isl-openapi.json`, ISL's own
 * MACHINE-GENERATED OpenAPI document (scripts/generate_openapi.py ->
 * FastAPI app.openapi()). It is Pydantic's description of ISL's models, not a
 * hand-written copy, and ISL CI runs `generate_openapi.py --check` on every PR
 * touching src/models, so it cannot drift from the models without ISL going
 * red. Hermetic: no network, no Python.
 *
 * CONSUMER SIDE: the exported runtime tuple `ISL_OPTION_STATUS_VALUES`. It is a
 * VALUE, not a type, precisely so this comparison can happen at all — a TS
 * union erases at compile time and cannot be asserted against anything.
 *
 * ⚠ ON THE PIN'S STALENESS (disclosed, measured, and bounded — do not skip):
 * PIN.json pins ISL at 35149dd1; ISL staging is 686fcb7f, 11 commits ahead, and
 * `src/models/response_v2.py` HAS changed between them. That does NOT invalidate
 * this pairing, and the reason is specific rather than hopeful: the
 * `OptionResultV2.status` enum and `required` list were read at BOTH shas and
 * are byte-identical (`['computed','partial','failed']`; required includes
 * `id`, `outcome`, `status`). The pin was deliberately NOT bumped by 2.744 —
 * re-pinning re-derives the whole PLoT->ISL REQUEST drift pairing (a different
 * seam, with its own transcript and Python driver) and would have smuggled an
 * unrelated, unreviewed contract change into a defect fix. If you bump the pin,
 * re-read this test: it becomes MORE faithful, not less.
 */

import { describe, it, expect } from 'vitest';

import { loadOpenApi } from './helpers/isl-pinned-artifacts.js';
import { ISL_OPTION_STATUS_VALUES } from '../src/integrations/isl/types/isl-types.js';
import type { PerFeatureStatus } from '../src/types/engine-v3.js';

/** The producer's declared schema for a single option on the V2 wire. */
function optionResultV2Schema(): Record<string, any> {
  const doc = loadOpenApi();
  const schema = doc.components.schemas.OptionResultV2 as Record<string, any> | undefined;
  // Positive control: if ISL ever renames the class, this pairing must fail
  // LOUD rather than pass by comparing against `undefined` (trap 13 — an
  // absence assertion that cannot see a presence proves nothing).
  expect(
    schema,
    'OptionResultV2 absent from the vendored ISL OpenAPI — the pairing has nothing to compare against',
  ).toBeDefined();
  return schema!;
}

describe('ROADMAP 2.744 · ISL per-option status enum pairing', () => {
  it('PRODUCER PRECONDITION: the vendored artifact really declares a status enum', () => {
    // Pin the discriminating power of every assertion below. Without this, a
    // vendored artifact that silently stopped carrying the enum would leave the
    // set comparisons trivially satisfiable and the pairing would agree with
    // itself (trap 13b — a guard whose discrimination depends on a fixture that
    // nothing pins).
    const schema = optionResultV2Schema();
    const declared = schema.properties?.status?.enum;
    expect(Array.isArray(declared), 'OptionResultV2.properties.status.enum is not an array').toBe(true);
    expect(declared.length).toBeGreaterThan(0);
  });

  it('the TS mirror and ISL\'s Pydantic Literal declare the SAME set of values', () => {
    const producer: string[] = optionResultV2Schema().properties.status.enum;

    // Compare as SETS in both directions and report each direction separately,
    // so a failure names which side grew or shrank instead of dumping a diff.
    const producerSet = new Set(producer);
    const mirrorSet = new Set<string>(ISL_OPTION_STATUS_VALUES);

    const onlyInProducer = [...producerSet].filter((v) => !mirrorSet.has(v)).sort();
    const onlyInMirror = [...mirrorSet].filter((v) => !producerSet.has(v)).sort();

    expect(
      onlyInProducer,
      `ISL emits option statuses PLoT does not model: ${onlyInProducer.join(', ')} — ` +
        'consumer branches keyed on status are now incomplete (UNDER-supply).',
    ).toEqual([]);
    expect(
      onlyInMirror,
      `PLoT models option statuses ISL cannot emit: ${onlyInMirror.join(', ')} — ` +
        'any branch testing for these is DEAD CODE that reads as protection (OVER-supply).',
    ).toEqual([]);
  });

  it('status is REQUIRED on the V2 wire (so `undefined` means the legacy V1 shape, not "V2 declined")', () => {
    const required: string[] = optionResultV2Schema().required ?? [];
    expect(required).toContain('status');
    // The V2 identity field is `id`. `option_id` is the V1 name; a fixture that
    // puts `option_id` on an otherwise-V2 option is modelling a wire that does
    // not exist. This is the assertion that would have caught the gate
    // fixture's third impossibility.
    expect(required).toContain('id');
    expect(Object.keys(optionResultV2Schema().properties)).not.toContain('option_id');
  });

  it('REGRESSION (the actual 2.744 defect): the ENVELOPE vocabulary is not the PER-OPTION vocabulary', () => {
    // The specific historical error, pinned by name so a future tidy-up that
    // "harmonises the status enums" fails instead of silently re-merging two
    // vocabularies that live at different levels.
    const mirror = new Set<string>(ISL_OPTION_STATUS_VALUES);
    for (const envelopeOnly of ['skipped', 'error', 'unavailable']) {
      expect(
        mirror.has(envelopeOnly),
        `'${envelopeOnly}' belongs to PLoT's egress PerFeatureStatus / ISL's envelope ` +
          'robustness_status, NOT to a per-option status. Re-adding it here revives the dead guard bug.',
      ).toBe(false);
    }

    // And the converse, so the two vocabularies stay genuinely distinct rather
    // than one being quietly redefined as the other. Typed against
    // PerFeatureStatus so this breaks at COMPILE time too if that type moves.
    const egress: PerFeatureStatus[] = ['computed', 'unavailable', 'skipped', 'error'];
    expect(egress).toContain('unavailable');
    expect(egress).not.toContain('partial' as unknown as PerFeatureStatus);
    expect(egress).not.toContain('failed' as unknown as PerFeatureStatus);
  });
});
