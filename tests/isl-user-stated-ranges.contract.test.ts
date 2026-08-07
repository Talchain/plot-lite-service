/**
 * ROADMAP 2.720 / capability P4 — PLoT wires the ISL range→distribution
 * converter that nothing could reach.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * ISL has shipped a complete, Neil-ratified interquartile range→distribution
 * converter since the 2.720 slice (`src/services/range_fit.py`, request field
 * `RobustnessRequestV2.user_stated_ranges`, response field
 * `RobustnessResponseV2.range_fit_disclosures`, seven TYPED refusal codes). It
 * has been DEPLOYED and completely DARK: no producer anywhere sent it anything.
 * PLoT's own pin note said so in as many words — *"user_stated_ranges (2.720,
 * PLoT does not send it)"* (tests/fixtures/isl-pinned/PIN.json). This is the
 * PLoT half of plugging it in: `/v2/run` accepts the field, the translator
 * forwards it request-gated, and the typed disclosure (or refusal) survives back
 * out instead of being dropped by buildResponse's field-by-field rebuild.
 *
 * ⚠ WHAT A GREEN TYPECHECK DOES NOT PROVE — the reason the assertions below are
 * on BYTES and on the PINNED MODEL, never on a translator return value.
 * Every ISL request model is `extra="ignore"` and `extra="forbid"` appears
 * ZERO times in the whole service, so an undeclared or MISSPELLED key dies at
 * Pydantic parse with a clean 200 and no error anywhere in the system. The
 * estate has already shipped that exact failure: `goal_threshold_frame` was
 * emitted by PLoT while UNDECLARED by ISL for ~5 days (1–6 Aug 2026) and
 * survived only because the pin was later moved. A silent success is the
 * DEFAULT failure mode on this boundary.
 *
 * Three independent instruments, deliberately:
 *   1. WIRE BYTES — assertions are made on the serialized string handed to
 *      `fetch` (the egress capture harness), never on a translator return value,
 *      so a key re-added or stripped downstream is still seen.
 *   2. PINNED MODEL — every path the new producer puts on the wire is checked
 *      against ISL's own machine-generated OpenAPI at the pinned SHA, by the
 *      same walker the drift-pairing gate uses. That is what says the members
 *      are DECLARED rather than merely well-typed in TypeScript.
 *   3. LIVE ENDPOINT — `tests/fixtures/isl-range-fit-live-20260807/` holds real
 *      request/response pairs captured against DEPLOYED ISL, including a
 *      MISSPELLED-KEY control. See that block's own comment: it is the only
 *      instrument here that can distinguish "ISL consumed it" from "ISL ignored
 *      it", because the other two cannot see a deployment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  toISLRobustnessRequest,
  ISL_DECLARED_USER_STATED_RANGE_FIELDS,
  type ISLUserStatedRange,
} from '../src/integrations/isl/translator-v3.js';
import { getIslRangeFitDisclosures } from '../src/integrations/isl/v2-envelope.js';
import { V2_RUN_ALLOWED_KEYS } from '../src/routes/v2/run-contract-keys.js';
import {
  PRODUCERS,
  installEgressCapture,
  uninstallEgressCapture,
  buildGraph,
  type EgressCapture,
} from './helpers/isl-egress-producers.js';
import { REPO_ROOT, loadOpenApi, schemaPathStatus, undeclaredPaths } from './helpers/isl-pinned-artifacts.js';

const OPENAPI = loadOpenApi();

/** Drive the named producer and return the single body it put on the wire. */
async function wireBodyOf(name: string): Promise<EgressCapture> {
  const producer = PRODUCERS.find((p) => p.name === name);
  expect(producer, `producer ${name} has been renamed or deleted`).toBeDefined();
  const captures = await producer!.run();
  expect(captures).toHaveLength(1);
  return captures[0]!;
}

// =============================================================================
// 1. THE WIRE BYTES — the field reaches egress, request-gated, projected
// =============================================================================

describe('T1 user_stated_ranges reaches the ISL egress bytes', () => {
  beforeEach(() => installEgressCapture());
  afterEach(() => uninstallEgressCapture());

  it('T1a: the producer emits user_stated_ranges, bound to its node by IDENTITY', async () => {
    const c = await wireBodyOf('v2-run-user-stated-ranges');
    const body = c.body as Record<string, unknown>;

    // POSITIVE CONTROL first: real bytes at the right endpoint (trap 13).
    expect(c.bodyText.length).toBeGreaterThan(200);
    expect(c.url).toContain('/api/v1/robustness/analyze/v2');

    const ranges = body.user_stated_ranges as ISLUserStatedRange[] | undefined;
    expect(ranges, 'the producer put no user_stated_ranges on the wire').toBeDefined();

    // BIND BY IDENTITY, never by a value predicate another entry could satisfy
    // (trap 19). The row is found by node_id, and the node_id is one this
    // fixture graph actually contains.
    const graphNodeIds = new Set(buildGraph().nodes.map((n) => n.id));
    const row = ranges!.find((r) => r.node_id === 'fac_headcount');
    expect(row, 'no user_stated_ranges row for fac_headcount').toBeDefined();
    expect(graphNodeIds.has(row!.node_id)).toBe(true);
    expect(row!.lower).toBe(0.35);
    expect(row!.upper).toBe(0.55);
    expect(row!.domain).toBe('unit_interval');
    expect(row!.source).toBe('user');
    expect(row!.method_version).toBe('user-stated-range-v1');

    // And it is on the SERIALIZED bytes, not only on the parsed object.
    expect(c.bodyText).toContain('"user_stated_ranges"');
  });

  it('T1b: REQUEST-GATED — the base producer omits the key entirely', async () => {
    const c = await wireBodyOf('v2-run-base');
    expect('user_stated_ranges' in (c.body as object)).toBe(false);
    expect(c.bodyText).not.toContain('user_stated_ranges');
  });

  it('T1c: an empty array is omitted, never sent as []', () => {
    const req = toISLRobustnessRequest(
      buildGraph(),
      [{ id: 'opt_a', label: 'Hire', interventions: { fac_headcount: { value: 0.8 } } }] as never,
      'goal_margin',
      'req_gate',
      2000,
      undefined,
      undefined,
      'seed-gate',
      undefined,
      undefined,
      undefined,
      undefined,
      [],
    );
    expect('user_stated_ranges' in req).toBe(false);
  });

  it('T1d: PROJECTION — a client-supplied key ISL does not declare never reaches the wire', () => {
    const req = toISLRobustnessRequest(
      buildGraph(),
      [{ id: 'opt_a', label: 'Hire', interventions: { fac_headcount: { value: 0.8 } } }] as never,
      'goal_margin',
      'req_gate',
      2000,
      undefined,
      undefined,
      'seed-gate',
      undefined,
      undefined,
      undefined,
      undefined,
      [
        {
          node_id: 'fac_headcount',
          lower: 0.2,
          upper: 0.6,
          domain: 'unit_interval',
          // Not declared by ISL's UserStatedRange. Under extra="ignore" this
          // would die silently at parse; PLoT must not put it on the wire.
          confidence_weight: 0.9,
        } as unknown as ISLUserStatedRange,
      ],
    );
    const row = req.user_stated_ranges![0]!;
    expect(Object.keys(row).sort()).toEqual(['domain', 'lower', 'node_id', 'upper']);
    expect('confidence_weight' in row).toBe(false);
  });

  it('T1e: absent bounds stay ABSENT, not coerced — an open-ended range must reach ISL as one so the typed RANGE_OPEN_ENDED refusal fires', () => {
    // ISL's UserStatedRange declares lower/upper Optional precisely so an
    // open-ended statement ("at least X") is EXPRESSIBLE and can be REFUSED
    // loudly rather than silently reshaped. A producer that defaulted a missing
    // bound to 0 would manufacture a range the user never stated and get a
    // clean, wrong, fitted distribution back.
    const req = toISLRobustnessRequest(
      buildGraph(),
      [{ id: 'opt_a', label: 'Hire', interventions: { fac_headcount: { value: 0.8 } } }] as never,
      'goal_margin',
      'req_gate',
      2000,
      undefined,
      undefined,
      'seed-gate',
      undefined,
      undefined,
      undefined,
      undefined,
      [{ node_id: 'fac_headcount', lower: 0.2, domain: 'unbounded' }],
    );
    const row = req.user_stated_ranges![0]!;
    expect('upper' in row).toBe(false);
    expect(row.lower).toBe(0.2);
  });
});

// =============================================================================
// 2. THE PINNED MODEL — the members are DECLARED, not merely well-typed
// =============================================================================

describe('T2 every member PLoT emits is DECLARED by ISL at the pin', () => {
  beforeEach(() => installEgressCapture());
  afterEach(() => uninstallEgressCapture());

  it('T2a: POSITIVE CONTROL — the pinned artifact declares user_stated_ranges at all', () => {
    const props = Object.keys(
      OPENAPI.components.schemas.RobustnessRequestV2!.properties as object,
    );
    expect(props).toContain('user_stated_ranges');
    expect(OPENAPI.components.schemas.UserStatedRange).toBeDefined();
  });

  it('T2b: the new producer puts ZERO undeclared paths on the wire', async () => {
    const c = await wireBodyOf('v2-run-user-stated-ranges');
    const undeclared = [
      ...new Set(undeclaredPaths(c.body, 'RobustnessRequestV2', OPENAPI).map((h) => h.normalised)),
    ].sort();
    expect(
      undeclared,
      'the user_stated_ranges producer emits key(s) ISL\'s pinned RobustnessRequestV2 does not ' +
        'declare. ISL drops them silently under extra:"ignore" — nothing else will tell you.',
    ).toEqual([]);
  });

  it('T2c: DERIVED, not mirrored — PLoT\'s projection allowlist equals ISL\'s UserStatedRange members', () => {
    const islMembers = Object.keys(
      OPENAPI.components.schemas.UserStatedRange!.properties as object,
    ).sort();
    expect([...ISL_DECLARED_USER_STATED_RANGE_FIELDS].sort()).toEqual(islMembers);
  });

  it('T2d: each declared member resolves under a declaring parent in ISL\'s model tree', () => {
    for (const field of ISL_DECLARED_USER_STATED_RANGE_FIELDS) {
      expect(
        schemaPathStatus(`user_stated_ranges[].${field}`, 'RobustnessRequestV2', OPENAPI),
        `user_stated_ranges[].${field} does not resolve as DECLARED in ISL's pinned model tree`,
      ).toBe('declared');
    }
  });
});

// =============================================================================
// 3. THE /v2/run INGRESS — both gates must know the key
// =============================================================================

describe('T3 /v2/run accepts user_stated_ranges at BOTH request gates', () => {
  it('T3a: the preValidation unknown-key allowlist admits it', () => {
    expect(V2_RUN_ALLOWED_KEYS.has('user_stated_ranges')).toBe(true);
  });

  it('T3b: the Ajv body schema (additionalProperties:false) declares it', () => {
    // Read at the source rather than through the route: the two gates are
    // independent and omitting the key from EITHER drops the field before the
    // handler sees it — a silent, 200-shaped loss.
    const runTs = readFileSync(resolve(REPO_ROOT, 'src/routes/v2/run.ts'), 'utf8');
    expect(runTs).toMatch(/user_stated_ranges:\s*\{\s*\n?\s*type:\s*'array'/);
  });
});

// =============================================================================
// 4. THE RESPONSE — the typed fit result survives back out
// =============================================================================

describe('T4 range_fit_disclosures survives back through PLoT', () => {
  it('T4a: the envelope accessor reads the TOP-LEVEL field', () => {
    const disclosures = [
      {
        node_id: 'fac_headcount',
        lower: 0.2,
        upper: 0.6,
        domain: 'unit_interval' as const,
        fitted: {
          family: 'beta' as const,
          alpha: 1.1864333334848651,
          beta: 1.7124956456865377,
          mean: 0.4092660917219096,
          std: 0.2490153792254106,
          q25: 0.2,
          q75: 0.6000000000000004,
          coverage: 0.5,
          method_version: 'range-iq-fit-v1',
        },
      },
    ];
    expect(getIslRangeFitDisclosures({ range_fit_disclosures: disclosures })).toEqual(disclosures);
  });

  it('T4b: a TYPED REFUSAL survives intact — it is not a fallback and must not be flattened away', () => {
    const refused = [
      {
        node_id: 'fac_headcount',
        lower: 0.9,
        upper: 0.1,
        domain: 'unit_interval' as const,
        refusal: {
          code: 'RANGE_INVALID_ORDER' as const,
          message: 'The lower bound is greater than the upper bound.',
          lower: 0.9,
          upper: 0.1,
          domain: 'unit_interval' as const,
        },
      },
    ];
    const out = getIslRangeFitDisclosures({ range_fit_disclosures: refused });
    expect(out).toEqual(refused);
    expect(out![0]!.refusal!.code).toBe('RANGE_INVALID_ORDER');
    expect(out![0]!.fitted).toBeUndefined();
  });

  it('T4c: ABSENT stays absent — no default payload growth, no invented empty array', () => {
    expect(getIslRangeFitDisclosures({})).toBeUndefined();
    expect(getIslRangeFitDisclosures(null)).toBeUndefined();
    expect(getIslRangeFitDisclosures(undefined)).toBeUndefined();
    // A non-array (a malformed ISL build) must degrade to absent, never be
    // forwarded as a shape consumers cannot read.
    expect(getIslRangeFitDisclosures({ range_fit_disclosures: 'nonsense' } as never)).toBeUndefined();
  });

  it('T4d: an EMPTY array is a computed-empty result and is preserved, not collapsed to absent', () => {
    // ISL emits the key only when ranges were stated, so `[]` means "you stated
    // ranges and none produced a row" — a different fact from "you stated none".
    expect(getIslRangeFitDisclosures({ range_fit_disclosures: [] })).toEqual([]);
  });
});

// =============================================================================
// 5. THE LIVE ENDPOINT — the only instrument that can see a deployment
// =============================================================================

/**
 * ⚠ THIS BLOCK IS THE ONE THAT ANSWERS "DID ISL CONSUME IT?"
 *
 * Sections 1–4 prove PLoT emits the field and that ISL's PINNED model declares
 * it. Neither can prove the DEPLOYED service acts on it — a pin is a SHA, not a
 * deployment, and under `extra="ignore"` a misspelled key returns exactly the
 * same 200 as a correct one. So these four request/response pairs were captured
 * against DEPLOYED ISL (`isl-staging.onrender.com`, build `686fcb7`) on
 * 2026-08-07 and frozen here.
 *
 * The four arms are a DISCRIMINATING SET, not a demonstration:
 *   A control-absent    → 200, and NO range_fit_disclosures key.
 *   B valid-range       → 200 WITH a beta fit whose q25/q75 are the stated
 *                         bounds and whose method_version is ISL's own
 *                         `range-iq-fit-v1`. Nothing but the converter running
 *                         can produce that object.
 *   C invalid-order     → 200 with the TYPED refusal RANGE_INVALID_ORDER and a
 *                         matching `inference_warnings` entry at severity
 *                         'warning' — proof the refusal path is live too, not
 *                         just the happy path.
 *   D misspelled-key    → `user_stated_rangez`, one letter wrong. 200, and
 *                         NOTHING. This is the arm that makes A/B/C mean
 *                         something: it shows what "ISL ignored it" looks like,
 *                         and it looks EXACTLY like A. Without D, B and C would
 *                         be a 200 being read as a computation.
 *
 * Trap 12b: these are HISTORICAL artefacts pinned by content, not a control
 * pointed at "whatever is deployed now", so they cannot decay into a tautology
 * the next time ISL moves. They are evidence about 686fcb7 and say so.
 */
describe('T5 LIVE WITNESS: deployed ISL CONSUMED the field (not merely returned 200)', () => {
  const DIR = 'tests/fixtures/isl-range-fit-live-20260807';
  const load = (f: string): Record<string, unknown> =>
    JSON.parse(readFileSync(resolve(REPO_ROOT, DIR, f), 'utf8'));

  it('T5a: POSITIVE CONTROL — all four arms are real captures of the same deployed build', () => {
    const arms = [
      'A-control-absent',
      'B-valid-range',
      'C-invalid-order',
      'D-misspelled-key',
    ];
    for (const arm of arms) {
      const resp = load(`${arm}.response.json`);
      expect(resp.build, `${arm} was captured against a different build`).toBe('686fcb7');
      expect(resp.analysis_status).toBe('computed');
    }
    // …and the request bodies genuinely differ in the way the arms claim.
    expect('user_stated_ranges' in load('A-control-absent.request.json')).toBe(false);
    expect('user_stated_ranges' in load('B-valid-range.request.json')).toBe(true);
    expect('user_stated_ranges' in load('C-invalid-order.request.json')).toBe(true);
    // D's key is MISSPELLED — pin that in-test, or the whole discrimination
    // below is a guard whose precondition nothing pins (trap 13b, third face).
    expect('user_stated_ranges' in load('D-misspelled-key.request.json')).toBe(false);
    expect('user_stated_rangez' in load('D-misspelled-key.request.json')).toBe(true);
  });

  it('T5b: B — the deployed converter RAN: a beta fit whose quartiles are the stated bounds', () => {
    const d = (load('B-valid-range.response.json').range_fit_disclosures as any[])!;
    expect(d).toHaveLength(1);
    const row = d[0]!;
    expect(row.node_id).toBe('fac_dev_headcount'); // bound by IDENTITY
    expect(row.fitted.family).toBe('beta');
    expect(row.fitted.method_version).toBe('range-iq-fit-v1');
    expect(row.fitted.coverage).toBe(0.5);
    // The interquartile contract: the stated bounds ARE the fitted quartiles.
    expect(row.fitted.q25).toBeCloseTo(0.2, 9);
    expect(row.fitted.q75).toBeCloseTo(0.6, 9);
    expect(row.fitted.alpha).toBeGreaterThan(0);
    expect(row.fitted.beta).toBeGreaterThan(0);
    expect(row.refusal).toBeUndefined();
  });

  it('T5c: C — the deployed REFUSAL path ran, typed, and disclosed on inference_warnings', () => {
    const resp = load('C-invalid-order.response.json');
    const row = (resp.range_fit_disclosures as any[])![0]!;
    expect(row.node_id).toBe('fac_dev_headcount');
    expect(row.refusal.code).toBe('RANGE_INVALID_ORDER');
    expect(row.fitted).toBeUndefined(); // a refusal is never a fallback fit
    const warned = (resp.inference_warnings as any[]).filter(
      (w) => w.code === 'RANGE_INVALID_ORDER',
    );
    expect(warned).toHaveLength(1);
    expect(warned[0].field).toBe('user_stated_ranges[fac_dev_headcount]');
    expect(warned[0].severity).toBe('warning');
  });

  it('T5d: THE DISCRIMINATOR — a one-letter misspelling returns 200 and NOTHING, exactly like the control', () => {
    // If this ever fails by finding disclosures on D, the instrument has gone
    // blind and T5b/T5c prove nothing. If it fails by finding them on A, the
    // field is not request-gated on ISL's side and the "no default payload
    // growth" claim is false.
    expect('range_fit_disclosures' in load('D-misspelled-key.response.json')).toBe(false);
    expect('range_fit_disclosures' in load('A-control-absent.response.json')).toBe(false);
    // And the arm that WAS spelled correctly did produce one. Stated as a pair
    // so a reviewer sees the discrimination, not two separate readings.
    expect('range_fit_disclosures' in load('B-valid-range.response.json')).toBe(true);
  });
});
