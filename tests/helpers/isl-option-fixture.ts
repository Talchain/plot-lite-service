/**
 * A per-option ISL V2 fixture builder that CANNOT invent a field (ROADMAP 2.744).
 * ----------------------------------------------------------------------------
 * The gate fixture this replaces carried three impossibilities in one literal:
 *
 *     { option_id: 'opt1', outcome: finiteOutcome, rank: 1, status: 'error' }
 *
 *   - `status: 'error'`  — not a member of ISL's per-option Literal
 *   - `rank`             — not a property of OptionResultV2 at all
 *   - `option_id`        — the V1 name; V2's identity field is `id`
 *
 * None of it failed anything, because the consumer sites are all `any`-typed
 * and the TS mirror it was written against carried the same errors. A fixture
 * is a hand-maintained mirror of a producer (root CLAUDE.md trap 12); the only
 * durable fix is to stop hand-maintaining it.
 *
 * So this builder DERIVES the legal shape from the vendored, Pydantic-generated
 * `tests/fixtures/isl-pinned/isl-openapi.json` and hard-fails on:
 *   - any key that is not a declared property of `OptionResultV2`
 *   - any missing `required` property
 *   - any `status` outside the declared enum
 *
 * It is hermetic (no network, no Python) and it fails LOUD rather than
 * assume-good, which is the property the plain object literal lacked.
 *
 * ⚠ SCOPE — what this does NOT prove. It checks the option object against the
 * producer's DECLARED SCHEMA. It does not prove the producer would actually
 * emit these VALUES together on a real run (trap 16's inverse: a shape can be
 * schema-legal and still unreachable). Where a test depends on a combination
 * being reachable, derive that from ISL's emitting code and say so in the test
 * — `determine_option_status` in ISL's src/utils/response_builder.py is the
 * function that decides which status an option gets.
 */

import { loadOpenApi } from './isl-pinned-artifacts.js';

export interface OptionResultV2Fixture {
  id: string;
  outcome: Record<string, unknown>;
  status: string;
  [k: string]: unknown;
}

interface OptionSchema {
  properties: Record<string, unknown>;
  required: string[];
  statusEnum: string[];
}

let cached: OptionSchema | undefined;

/** The producer's declared OptionResultV2 schema, read once from the vendored artifact. */
export function optionResultV2Schema(): OptionSchema {
  if (cached) return cached;
  const doc = loadOpenApi();
  const schema = doc.components.schemas.OptionResultV2 as Record<string, any> | undefined;
  if (!schema || typeof schema.properties !== 'object') {
    throw new Error(
      'isl-option-fixture: OptionResultV2 is absent from the vendored ISL OpenAPI. ' +
        'The fixture builder has no producer to derive from — fix the pin, do not bypass this.',
    );
  }
  const statusEnum = schema.properties?.status?.enum;
  if (!Array.isArray(statusEnum) || statusEnum.length === 0) {
    throw new Error(
      'isl-option-fixture: OptionResultV2.properties.status.enum is missing or empty. ' +
        'Without it the status check below would silently accept anything.',
    );
  }
  cached = {
    properties: schema.properties,
    required: Array.isArray(schema.required) ? schema.required : [],
    statusEnum,
  };
  return cached;
}

/** ISL's per-option status values, straight from the producer's schema. */
export function islOptionStatusValues(): string[] {
  return [...optionResultV2Schema().statusEnum];
}

/**
 * A finite, fully-usable V2 outcome block.
 *
 * Field list derived from `OutcomeDistributionV2`'s required set; the values
 * satisfy PLoT's `hasAllRequiredOutcomeStats` (mean/p10/p50/p90 all finite).
 */
export function finiteOutcome(mean = 0.7): Record<string, number | string> {
  return {
    mean,
    std: 0.1,
    p10: mean - 0.2,
    p50: mean,
    p90: mean + 0.2,
    n_samples: 1000,
    n_valid_samples: 1000,
    validity_ratio: 1.0,
  };
}

/**
 * Build a per-option V2 result, validated against the producer's schema.
 *
 * @throws if a key is undeclared, a required key is missing, or status is not
 *         a member of the producer's enum.
 */
export function makeOptionResultV2(fields: Record<string, unknown>): OptionResultV2Fixture {
  const { properties, required, statusEnum } = optionResultV2Schema();

  const undeclared = Object.keys(fields).filter((k) => !(k in properties));
  if (undeclared.length > 0) {
    throw new Error(
      `isl-option-fixture: ${undeclared.join(', ')} is not a property of ISL's OptionResultV2. ` +
        `Declared properties: ${Object.keys(properties).sort().join(', ')}. ` +
        'A fixture carrying a field the producer cannot emit tests a wire that does not exist.',
    );
  }

  const missing = required.filter((k) => !(k in fields));
  if (missing.length > 0) {
    throw new Error(
      `isl-option-fixture: missing required OptionResultV2 field(s): ${missing.join(', ')}. ` +
        'Omitting a field the producer ALWAYS emits leaves consumer branches unexercised.',
    );
  }

  const status = fields.status;
  if (typeof status !== 'string' || !statusEnum.includes(status)) {
    throw new Error(
      `isl-option-fixture: status ${JSON.stringify(status)} is not one of ` +
        `${statusEnum.join(' | ')} (ISL OptionResultV2.status). ` +
        "'skipped' and 'error' are ENVELOPE-level values and are not emitted per option.",
    );
  }

  return fields as unknown as OptionResultV2Fixture;
}
