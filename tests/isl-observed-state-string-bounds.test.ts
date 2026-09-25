/**
 * ISL's DECLARED string-length bounds on `ObservedState` — OMIT, never clip.
 *
 * THE DEFECT (Render logs, 25 Sep 2026, 00:40–05:42Z): ISL's request model
 * declares `unit: Optional[str] = Field(None, max_length=50, …)` and
 * `source: Optional[str] = Field(None, max_length=100, …)`
 * (ISL `src/models/robustness_v2.py:180-187 @ 3c4ab84d`, staging). A factor
 * whose display unit ran past 50 characters made
 * `POST /api/v1/robustness/analyze/v2` answer 422
 * (`graph -> nodes -> 4 -> observed_state -> unit: String should have at most
 * 50 characters`), PLoT failed the WHOLE Run, and the user got no analysis —
 * 8 staging Runs blocked overnight.
 *
 * ISL only ECHOES these fields (e.g. `split_unit` on a conditional-winner row);
 * it never computes with them. So an over-bound value is OMITTED from the ISL
 * request rather than clipped: a clipped unit would be echoed back to the user
 * as though it were the real one. PLoT keeps the FULL value on its own graph,
 * where its normaliser, preflight and flip displays read it.
 *
 * THE BOUNDARY IS DERIVED, NOT REMEMBERED. Every length below comes from
 * `maxLength` in ISL's pinned, sha256-verified OpenAPI document
 * (tests/fixtures/isl-pinned/, Pydantic's own machine-generated description of
 * the models). Its `ObservedState` bounds are identical to staging `3c4ab84d`'s
 * model bytes (unit 50, source 100; no other member bounded).
 *
 * LENGTH IS COUNTED IN CODE POINTS, as Pydantic counts (Python `len()`), not in
 * UTF-16 code units (JS `.length`). Measured against ISL's own `ObservedState`
 * class bytes @ 3c4ab84d under the pinned pydantic 2.6.1 / pydantic-core 2.16.2,
 * via `model_validate_json`, both with raw UTF-8 and with surrogate-pair escapes:
 *   unit 'u'×50            → ACCEPT     unit 'u'×51            → string_too_long
 *   unit 'u'×49 + 😀 (50 cp, 51 UTF-16 units)                  → ACCEPT
 *   unit 'u'×50 + 😀 (51 cp)                                   → string_too_long
 *   unit 😀×26 (26 cp, 52 UTF-16 units)                        → ACCEPT
 *   source 's'×100         → ACCEPT     source 's'×101         → string_too_long
 *   source 's'×99 + 😀 (100 cp, 101 UTF-16 units)              → ACCEPT
 * The emoji rows are the ones a `.length` implementation gets WRONG: it would
 * strip a unit ISL accepts.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  toISLObservedState,
  toISLRobustnessRequest,
  ISL_DECLARED_OBSERVED_STATE_FIELDS,
  ISL_OBSERVED_STATE_UNIT_MAX_LENGTH,
  ISL_OBSERVED_STATE_STRING_MAX_LENGTHS,
} from '../src/integrations/isl/translator-v3.js';
import { normaliseGraph } from '../src/normalisation/graph-normaliser.js';
import { createISLService } from '../src/integrations/isl/index.js';
import { loadOpenApi, loadPin, sha256File } from './helpers/isl-pinned-artifacts.js';

// -----------------------------------------------------------------------------
// The oracle: ISL's own declared bounds, read from the pinned OpenAPI.
// -----------------------------------------------------------------------------

/** `{ member: maxLength }` for every string-typed ObservedState member ISL bounds. */
function islDeclaredStringMaxLengths(): Record<string, number> {
  const schema = loadOpenApi().components.schemas.ObservedState;
  const props = (schema?.properties ?? {}) as Record<string, any>;
  const out: Record<string, number> = {};
  for (const [name, prop] of Object.entries(props)) {
    const branches: any[] = Array.isArray(prop?.anyOf) ? prop.anyOf : [prop];
    for (const b of branches) {
      if (b?.type === 'string' && typeof b.maxLength === 'number') out[name] = b.maxLength;
    }
  }
  return out;
}

const DECLARED = islDeclaredStringMaxLengths();
const UNIT_MAX = DECLARED.unit;
const SOURCE_MAX = DECLARED.source;

/** A non-BMP character: ONE code point, TWO UTF-16 code units. */
const EMOJI = '\u{1F600}';

const codePoints = (s: string): number => [...s].length;

function project(os: Record<string, unknown>): Record<string, unknown> {
  return (toISLObservedState(os) ?? {}) as Record<string, unknown>;
}

describe('the oracle is real — ISL’s declared bounds are read, not assumed', () => {
  it('POSITIVE CONTROL: the pinned artifact is intact and declares both bounds', () => {
    // If the vendored spec were missing or renamed, UNIT_MAX would be undefined
    // and every `repeat(UNIT_MAX + 1)` below would silently build ''.
    const pin = loadPin();
    expect(sha256File('tests/fixtures/isl-pinned/isl-openapi.json')).toBe(
      pin.artifacts.isl_openapi_json.sha256,
    );
    expect(UNIT_MAX).toBe(50);
    expect(SOURCE_MAX).toBe(100);
  });

  it('the fixture premise holds: the emoji is one code point but two UTF-16 units', () => {
    expect(EMOJI.length).toBe(2);
    expect(codePoints(EMOJI)).toBe(1);
  });

  it('PLoT’s bound map equals ISL’s declared maxLengths EXACTLY — no bound added or missed', () => {
    // Derived both ways: a bound ISL adds on re-pin that PLoT does not honour
    // would be a 422 waiting for the first long value; a bound PLoT invents
    // would strip a value ISL accepts.
    expect({ ...ISL_OBSERVED_STATE_STRING_MAX_LENGTHS }).toEqual(DECLARED);
    expect(ISL_OBSERVED_STATE_UNIT_MAX_LENGTH).toBe(DECLARED.unit);
    for (const field of Object.keys(DECLARED)) {
      expect(ISL_DECLARED_OBSERVED_STATE_FIELDS as readonly string[]).toContain(field);
    }
  });
});

describe('toISLObservedState — `unit` past ISL’s bound is OMITTED, never clipped', () => {
  it('a unit one code point over the bound is omitted; the rest of the state is untouched', () => {
    const long = 'u'.repeat(UNIT_MAX + 1);
    const p = project({ value: 12, baseline: 10, unit: long, std: 2 });
    expect(p).not.toHaveProperty('unit');
    // Not clipped under any key, and nothing else lost with it.
    expect(Object.values(p)).not.toContain(long.slice(0, UNIT_MAX));
    expect(p).toEqual({ value: 12, baseline: 10, std: 2 });
  });

  it('a unit exactly AT the bound is kept verbatim', () => {
    const atBound = 'u'.repeat(UNIT_MAX);
    const p = project({ value: 1, unit: atBound });
    expect(p.unit).toBe(atBound);
  });

  it.each(['£', '%', '£k', 'users', 'k'])('an ordinary unit %j is kept verbatim', (unit) => {
    expect(project({ value: 1, unit }).unit).toBe(unit);
  });

  it('EMOJI AT THE BOUNDARY: 49 + 😀 = 50 code points (51 UTF-16 units) is KEPT — ISL accepts it', () => {
    const s = 'u'.repeat(UNIT_MAX - 1) + EMOJI;
    expect(codePoints(s)).toBe(UNIT_MAX);
    expect(s.length).toBe(UNIT_MAX + 1);
    expect(project({ value: 1, unit: s }).unit).toBe(s);
  });

  it('EMOJI AT THE BOUNDARY: 50 + 😀 = 51 code points is OMITTED', () => {
    const s = 'u'.repeat(UNIT_MAX) + EMOJI;
    expect(codePoints(s)).toBe(UNIT_MAX + 1);
    expect(project({ value: 1, unit: s })).not.toHaveProperty('unit');
  });

  it('26 emoji = 26 code points (52 UTF-16 units) is KEPT', () => {
    const s = EMOJI.repeat(26);
    expect(s.length).toBeGreaterThan(UNIT_MAX);
    expect(project({ value: 1, unit: s }).unit).toBe(s);
  });
});

describe('toISLObservedState — the same rule for every bounded field (`source`)', () => {
  it('a source one code point over ITS bound is omitted', () => {
    const p = project({ value: 1, source: 's'.repeat(SOURCE_MAX + 1), unit: '£' });
    expect(p).not.toHaveProperty('source');
    expect(p).toEqual({ value: 1, unit: '£' });
  });

  it('a source exactly at its bound is kept verbatim', () => {
    const s = 's'.repeat(SOURCE_MAX);
    expect(project({ value: 1, source: s }).source).toBe(s);
  });

  it('source is measured in code points too: 99 + 😀 (101 UTF-16 units) is kept', () => {
    const s = 's'.repeat(SOURCE_MAX - 1) + EMOJI;
    expect(s.length).toBe(SOURCE_MAX + 1);
    expect(project({ value: 1, source: s }).source).toBe(s);
  });

  it('each field has ITS OWN bound: a source longer than the UNIT bound is kept', () => {
    const s = 's'.repeat(UNIT_MAX + 1);
    expect(project({ value: 1, source: s }).source).toBe(s);
  });

  it('CONTRAST: string members ISL does NOT bound are forwarded at any length', () => {
    const long = 'x'.repeat(SOURCE_MAX * 3);
    const p = project({
      value: 1,
      extractionType: long,
      factor_type: long,
      uncertainty_drivers: [long],
    });
    expect(p.extractionType).toBe(long);
    expect(p.factor_type).toBe(long);
    expect(p.uncertainty_drivers).toEqual([long]);
  });
});

describe('toISLObservedState — by-presence behaviour and bytes are otherwise unchanged', () => {
  it('absent fields stay absent; a present-`undefined` field stays absent', () => {
    expect(Object.keys(project({ value: 1 }))).toEqual(['value']);
    expect(Object.keys(project({ value: 1, unit: undefined, source: undefined }))).toEqual(['value']);
  });

  it('non-object input still projects to undefined', () => {
    expect(toISLObservedState(undefined)).toBeUndefined();
    expect(toISLObservedState(null)).toBeUndefined();
    expect(toISLObservedState('£')).toBeUndefined();
  });

  it('in-bound state: serialized bytes are byte-identical to the by-presence projection', () => {
    const os = {
      metadata: { operator: '>=' },
      uncertainty_drivers: ['market'],
      factor_type: 'price',
      extractionType: 'explicit',
      cap: 100,
      raw_value: 59,
      std: 5,
      source: 's'.repeat(SOURCE_MAX),
      unit: 'u'.repeat(UNIT_MAX - 1) + EMOJI,
      baseline: 49,
      value: 59,
    };
    // Declared-list order, `metadata` stripped — exactly what the pre-fix
    // projection emitted for this input.
    const expected =
      '{"value":59,"baseline":49,' +
      `"unit":${JSON.stringify(os.unit)},` +
      `"source":${JSON.stringify(os.source)},` +
      '"std":5,"raw_value":59,"cap":100,"extractionType":"explicit",' +
      '"factor_type":"price","uncertainty_drivers":["market"]}';
    expect(JSON.stringify(toISLObservedState(os))).toBe(expected);
  });

  it('the caller’s object is not mutated — PLoT keeps the full unit', () => {
    const long = 'u'.repeat(UNIT_MAX + 10);
    const os = { value: 1, unit: long };
    project(os);
    expect(os.unit).toBe(long);
  });
});

// -----------------------------------------------------------------------------
// End to end through BOTH real ISL request builders.
// -----------------------------------------------------------------------------

/** 60 code points — a unit of the shape that failed on staging. */
const LONG_UNIT = 'qualified enterprise leads per account executive per quarter';
const LONG_ID = 'fac_long_unit';
const SHORT_ID = 'fac_short_unit';

function upstreamGraph(): any {
  return {
    nodes: [
      { id: LONG_ID, kind: 'factor', label: 'Leads', observed_state: { value: 12, std: 2, unit: LONG_UNIT } },
      { id: SHORT_ID, kind: 'factor', label: 'Price', observed_state: { value: 49, std: 5, unit: '£' } },
      { id: 'goal', kind: 'goal', label: 'Revenue' },
    ],
    edges: [
      { from: LONG_ID, to: 'goal', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
      { from: SHORT_ID, to: 'goal', exists_probability: 0.8, strength: { mean: 0.3, std: 0.1 } },
    ],
  };
}

describe('end to end: /v2 builder (toISLRobustnessRequest) — the wire drops the long unit, PLoT keeps it', () => {
  it('the 60-code-point unit has no `unit` key on the wire; the in-bound unit survives by id', () => {
    expect(codePoints(LONG_UNIT)).toBe(60);
    const normalised = normaliseGraph(upstreamGraph());
    const request = toISLRobustnessRequest(
      normalised.graph,
      [
        { id: 'opt_a', label: 'A', interventions: {} },
        { id: 'opt_b', label: 'B', interventions: {} },
      ] as any,
      'goal',
      'req_isl_unit_bound_v2',
    );
    const wire = JSON.parse(JSON.stringify(request));
    const onWire = (id: string) => wire.graph.nodes.find((n: any) => n.id === id);

    // Non-vacuous: the node and its observed_state ARE on the wire.
    expect(onWire(LONG_ID)?.observed_state?.value).toBe(12);
    expect(onWire(LONG_ID).observed_state).not.toHaveProperty('unit');
    expect(onWire(SHORT_ID)?.observed_state?.unit).toBe('£');

    // PLoT's own normalised graph still carries the FULL unit.
    const plotNode = normalised.graph.nodes.find((n) => n.id === LONG_ID);
    expect(plotNode?.observed_state?.unit).toBe(LONG_UNIT);
  });
});

describe('end to end: /v1 builder (islService.analyseRobustness) — the bytes handed to fetch', () => {
  const ISL_HOST = 'isl.unit-bound.test';
  const ENV_KEYS = ['ISL_ENABLE', 'ISL_BASE_URL', 'ISL_API_KEY'] as const;
  const savedEnv: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('the 60-code-point unit has no `unit` key in the request body; PLoT’s graph keeps it', async () => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = `https://${ISL_HOST}`;
    process.env.ISL_API_KEY = 'test-key-not-a-secret';

    const bodies: string[] = [];
    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes(ISL_HOST)) throw new Error(`NO-NETWORK TRIPWIRE: unmocked fetch to ${url}`);
      if (url.includes('/api/v1/robustness/analyze/v2')) bodies.push(String(init?.body));
      const { makeComputedIslResponse } = await import('./helpers/run-fixtures.js');
      const text = JSON.stringify(makeComputedIslResponse());
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => text,
        json: async () => JSON.parse(text),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    // The /v1 leg's own graph shape (trust/types Graph).
    const graph: any = {
      nodes: [
        { id: LONG_ID, kind: 'factor', label: 'Leads', observed_state: { value: 12, std: 2, unit: LONG_UNIT } },
        { id: SHORT_ID, kind: 'factor', label: 'Price', observed_state: { value: 49, std: 5, unit: '£' } },
        { id: 'goal', kind: 'goal', label: 'Revenue' },
      ],
      edges: [
        { from: LONG_ID, to: 'goal', weight: 0.5, belief_exists: 0.9, strength_std: 0.1 },
        { from: SHORT_ID, to: 'goal', weight: 0.3, belief_exists: 0.8, strength_std: 0.1 },
      ],
    };

    const service = createISLService();
    expect(service.isEnabled()).toBe(true);
    await service.analyseRobustness(
      graph,
      'goal',
      [
        { id: 'opt_a', label: 'A', interventions: { [SHORT_ID]: 45 } },
        { id: 'opt_b', label: 'B', interventions: { [SHORT_ID]: 55 } },
      ],
      'req_isl_unit_bound_v1',
    );

    // Non-vacuous: exactly one analyse request reached the fetch boundary.
    expect(bodies).toHaveLength(1);
    const sent = JSON.parse(bodies[0]);
    const onWire = (id: string) => sent.graph.nodes.find((n: any) => n.id === id);
    expect(onWire(LONG_ID)?.observed_state?.value).toBe(12);
    expect(onWire(LONG_ID).observed_state).not.toHaveProperty('unit');
    expect(onWire(SHORT_ID)?.observed_state?.unit).toBe('£');

    // PLoT's own graph still carries the full unit.
    expect(graph.nodes[0].observed_state.unit).toBe(LONG_UNIT);
  });
});
