/**
 * ROADMAP 2.520 slice S1 — carry human-confirmation provenance to the engine.
 *
 * THE DEFECT THIS PINS. When a user confirms an estimate ("yes, I'm fairly sure
 * that's 52%"), CEE forwards `observed_state.source` and `observed_state
 * .extractionType` to PLoT. PLoT's `normaliseNode` then rebuilt `observed_state`
 * from an explicit 8-member object literal (`graph-normaliser.ts`, the
 * `value/baseline/unit/std/raw_value/cap/factor_type/uncertainty_drivers` copy)
 * which named neither key, so both were dropped at ingress — before anything
 * else ran. The compute engine therefore treated a human-confirmed number as
 * indistinguishable from an AI guess.
 *
 * ⚠ AND THE DROP WAS GRATUITOUS — every other hop already supported the field:
 *  - PLoT's OWN egress projector declares both (`ISL_DECLARED_OBSERVED_STATE_
 *    FIELDS`, translator-v3.ts) and `toISLObservedState` forwards them by
 *    presence, so they only ever needed to SURVIVE ingress to reach the wire;
 *  - ISL declares both on `ObservedState` and echoes them onto
 *    `FactorSensitivityV2` as `value_source` / `value_extraction_type` — see the
 *    sha256-pinned, machine-generated `tests/fixtures/isl-pinned/isl-openapi
 *    .json`, which is Pydantic's own description of the mounted models.
 *
 * So the entire blockage was two keys missing from one hand-maintained ingress
 * list, sitting one hop upstream of a list that already had them. That is
 * programme trap 12 (the hand-maintained mirror) in its purest form: FIVE lists
 * describe `observed_state` on this path, the two nearest ISL are pinned to each
 * other and to ISL mechanically (ROADMAP 2.274), and the three upstream of them
 * were free-floating.
 *
 * WHAT THIS SUITE GUARDS, and why each test exists:
 *  - T1 is the POSITIVE CONTROL (trap 13). Every other test here asserts a
 *    PRESENCE; T1 is the only one that proves the harness can see an ABSENCE.
 *    Without it "the keys came through" is indistinguishable from "the harness
 *    reports these keys no matter what" — and this estate has shipped exactly
 *    that shape of vacuous test before.
 *  - T2 pins the fixture's own PRECONDITION. If a later tidy-up strips the
 *    provenance from the input, T3/T4 would go on passing while testing nothing.
 *  - T3/T4 bind by IDENTITY (`n.id === ...`), never by a value predicate another
 *    node could satisfy (trap 19), and carry DISTINCT provenance per node so a
 *    swap is observable rather than silently green.
 *  - T5 is the anti-mirror guard and the reason this is not just a two-key
 *    patch: it DERIVES its expectation from `ISL_DECLARED_OBSERVED_STATE_FIELDS`
 *    — the list already pinned to ISL's own OpenAPI — and asserts every member
 *    survives the real ingress→egress chain. A field added to ISL now forces the
 *    re-pin, which grows that list, which REDs here until the normaliser carries
 *    it. That closes the loop the narrow fix would have left open: without T5,
 *    the NEXT field ISL adds repeats this exact bug, silently.
 *    ⚠ Per trap 12d, T5 proves AGREEMENT, not completeness — completeness of the
 *    list itself is what `tests/isl-observed-state-mirror.test.ts` establishes
 *    against ISL's machine-generated spec. The two are not redundant; this suite
 *    needs that one to be meaningful.
 *
 * The chain exercised is the real one, both real producers, no re-implementation:
 *   normaliseGraph/normaliseNode  (ingress — where the strip was)
 *     → toISLNode → toISLObservedState  (egress — what actually hits the wire)
 */

import { describe, it, expect } from 'vitest';
import { normaliseGraph, normaliseNode } from '../src/normalisation/graph-normaliser.js';
import {
  toISLNode,
  toISLRobustnessRequest,
  ISL_DECLARED_OBSERVED_STATE_FIELDS,
} from '../src/integrations/isl/translator-v3.js';

/** The node a human confirmed. Provenance values are unique to it. */
const CONFIRMED_ID = 'fac_confirmed_by_human';
const CONFIRMED_SOURCE = 'user_set';
const CONFIRMED_EXTRACTION = 'user_confirmed';

/** A second node with DIFFERENT provenance, so a mix-up cannot read as green. */
const AI_ID = 'fac_estimated_by_ai';
const AI_SOURCE = 'brief_extraction';
const AI_EXTRACTION = 'llm_inferred';

/**
 * The upstream (CEE-shaped) graph. Both factors carry provenance, with distinct
 * values; the goal node carries none.
 */
function upstreamGraphWithProvenance(): any {
  return {
    nodes: [
      {
        id: CONFIRMED_ID,
        kind: 'factor',
        label: 'Confirmed by human',
        observed_state: {
          value: 0.52,
          std: 0.08,
          source: CONFIRMED_SOURCE,
          extractionType: CONFIRMED_EXTRACTION,
        },
      },
      {
        id: AI_ID,
        kind: 'factor',
        label: 'Estimated by AI',
        observed_state: {
          value: 0.45,
          std: 0.2,
          source: AI_SOURCE,
          extractionType: AI_EXTRACTION,
        },
      },
      { id: 'goal_margin', kind: 'outcome', label: 'Margin' },
    ],
    edges: [
      { from: CONFIRMED_ID, to: 'goal_margin', exists_probability: 0.9, strength: { mean: 0.5, std: 0.1 } },
      { from: AI_ID, to: 'goal_margin', exists_probability: 0.8, strength: { mean: 0.3, std: 0.12 } },
    ],
  };
}

/** Drive the REAL ingress→egress chain for a single upstream node. */
function throughChain(upstreamNode: any): Record<string, unknown> {
  const islNode = toISLNode(normaliseNode(upstreamNode));
  return (islNode.observed_state ?? {}) as Record<string, unknown>;
}

/** Drive the real chain for a whole graph, returning ISL nodes by id. */
function graphThroughChain(upstream: any): Map<string, Record<string, unknown>> {
  const normalised = normaliseGraph(upstream);
  const out = new Map<string, Record<string, unknown>>();
  for (const n of normalised.graph.nodes) {
    out.set(n.id, (toISLNode(n).observed_state ?? {}) as Record<string, unknown>);
  }
  return out;
}

describe('2.520 S1 — human-confirmation provenance survives PLoT ingress', () => {
  it('T1 POSITIVE CONTROL: the harness can see these keys ABSENT', () => {
    // The crux of this suite. Every other test asserts a PRESENCE; if the
    // harness reported `source`/`extractionType` unconditionally — because it
    // echoed its own input, or because the projection injected the keys — those
    // tests would pass while the pipeline dropped everything. This is the only
    // test that can distinguish "carried through" from "the fixture never had
    // them". An absence assertion that cannot see a presence tests nothing; the
    // converse is just as vacuous, and that is what this pins.
    const os = throughChain({
      id: 'fac_no_provenance',
      kind: 'factor',
      label: 'No provenance',
      observed_state: { value: 0.5, std: 0.1 },
    });

    // The chain demonstrably produced a real observed_state...
    expect(os).toHaveProperty('value', 0.5);
    expect(os).toHaveProperty('std', 0.1);
    // ...and yet reports both provenance keys ABSENT. Absent, not null:
    // a fabricated null would be a value nobody stated.
    expect(os).not.toHaveProperty('source');
    expect(os).not.toHaveProperty('extractionType');
  });

  it('T2 PRECONDITION: the fixture actually carries provenance on the named node', () => {
    // Pin the guard's own precondition. If someone later tidies the fixture and
    // drops these keys from the INPUT, T3/T4 would keep passing while asserting
    // nothing — the test would rot silently. This makes that a RED.
    const input = upstreamGraphWithProvenance();
    const confirmed = input.nodes.find((n: any) => n.id === CONFIRMED_ID);
    expect(confirmed, `fixture must contain node ${CONFIRMED_ID}`).toBeDefined();
    expect(confirmed.observed_state.source).toBe(CONFIRMED_SOURCE);
    expect(confirmed.observed_state.extractionType).toBe(CONFIRMED_EXTRACTION);
    // ...and the rival node carries DIFFERENT provenance, so T3's identity
    // binding is falsifiable rather than trivially satisfied.
    const ai = input.nodes.find((n: any) => n.id === AI_ID);
    expect(ai.observed_state.source).toBe(AI_SOURCE);
    expect(ai.observed_state.extractionType).toBe(AI_EXTRACTION);
    expect(AI_SOURCE).not.toBe(CONFIRMED_SOURCE);
  });

  it('T3 the confirmed factor reaches the ISL request body carrying its provenance, bound by id', () => {
    // ⭐ The assertion the slice exists for, and the one the discriminating
    // mutant pair is evaluated against.
    // Bound by IDENTITY (`id === CONFIRMED_ID`), never by a value predicate:
    // `find(n => n.observed_state.source === 'user_set')` would also match any
    // other node that happened to be user_set, so it could not tell "this
    // factor's provenance survived" from "some factor's did".
    // Deliberately asserts about CONFIRMED_ID ONLY — degrading a DIFFERENT node
    // must not RED this test, which is what proves the binding.
    const byId = graphThroughChain(upstreamGraphWithProvenance());
    const os = byId.get(CONFIRMED_ID);

    expect(os, `no ISL node emitted for ${CONFIRMED_ID}`).toBeDefined();
    expect(os).toHaveProperty('source', CONFIRMED_SOURCE);
    expect(os).toHaveProperty('extractionType', CONFIRMED_EXTRACTION);
    // The value itself must be untouched — this slice changes no maths.
    expect(os).toHaveProperty('value', 0.52);
    expect(os).toHaveProperty('std', 0.08);
  });

  it('T4 provenance lands on the right node — the AI-estimated factor keeps its own, not the human’s', () => {
    // Identity binding from the other side: a chain that stamped one node's
    // provenance onto every node, or crossed the two, would pass T3 and RED here.
    const byId = graphThroughChain(upstreamGraphWithProvenance());

    const confirmed = byId.get(CONFIRMED_ID);
    const ai = byId.get(AI_ID);
    expect(confirmed).toHaveProperty('source', CONFIRMED_SOURCE);
    expect(ai).toHaveProperty('source', AI_SOURCE);
    expect(ai).toHaveProperty('extractionType', AI_EXTRACTION);

    // The outcome node was given no observed_state at all and must not acquire one.
    expect(byId.get('goal_margin') ?? {}).not.toHaveProperty('source');
  });

  it('T5 DERIVED: every field ISL declares survives the ingress→egress chain', () => {
    // The anti-mirror guard (trap 12). This does NOT hand-list the fields — it
    // iterates `ISL_DECLARED_OBSERVED_STATE_FIELDS`, which
    // `tests/isl-observed-state-mirror.test.ts` pins to ISL's own
    // machine-generated OpenAPI at a sha256-verified pin. So the chain is:
    //   ISL's Pydantic models → that list → this assertion → the normaliser.
    // Adding a field to ISL forces a re-pin, which grows the list, which REDs
    // here until PLoT's ingress carries it. Without this, the two keys are a
    // patch and the NEXT field ISL adds is dropped exactly as silently.
    const sample: Record<string, unknown> = {
      value: 0.52,
      baseline: 0.3,
      unit: 'people',
      source: CONFIRMED_SOURCE,
      std: 0.08,
      raw_value: 40,
      cap: 100,
      extractionType: CONFIRMED_EXTRACTION,
      factor_type: 'quantitative',
      uncertainty_drivers: ['hiring_pipeline'],
    };

    // Positive control for the derivation itself: an empty or truncated list
    // would make the loop below pass by iterating nothing.
    expect(ISL_DECLARED_OBSERVED_STATE_FIELDS.length).toBeGreaterThan(0);
    for (const field of ISL_DECLARED_OBSERVED_STATE_FIELDS) {
      expect(sample, `fixture lacks a value for declared field '${field}'`).toHaveProperty(field);
    }

    const os = throughChain({
      id: 'fac_all_declared',
      kind: 'factor',
      label: 'All declared fields',
      observed_state: sample,
    });

    for (const field of ISL_DECLARED_OBSERVED_STATE_FIELDS) {
      expect(os, `declared field '${field}' was dropped at PLoT ingress`).toHaveProperty(
        field,
        sample[field],
      );
    }
  });

  it('T6 the provenance reaches the SERIALISED ISL request body, not just an in-memory object', () => {
    // The closest this repo can get to the wire without standing up ISL. T3
    // stops at `toISLNode`; the live `/v2/run` path continues through
    // `toISLRobustnessRequest` (`graph.nodes.map(toISLNode)`) and then through
    // `JSON.stringify` at the fetch boundary. Both of those could still lose the
    // field — the builder by re-projecting, the serializer by dropping an
    // `undefined`. Asserting on the parsed BYTES closes that gap.
    const normalised = normaliseGraph(upstreamGraphWithProvenance());
    const request = toISLRobustnessRequest(
      normalised.graph,
      [
        { id: 'opt_a', label: 'Option A', interventions: {} },
        { id: 'opt_b', label: 'Option B', interventions: {} },
      ] as any,
      'goal_margin',
      'req_2520_s1_provenance',
    );

    // Round-trip through the serializer the fetch boundary uses.
    const wire = JSON.parse(JSON.stringify(request));
    const onWire = wire.graph.nodes.find((n: any) => n.id === CONFIRMED_ID);

    expect(onWire, `${CONFIRMED_ID} missing from the serialised ISL request`).toBeDefined();
    expect(onWire.observed_state).toHaveProperty('source', CONFIRMED_SOURCE);
    expect(onWire.observed_state).toHaveProperty('extractionType', CONFIRMED_EXTRACTION);

    // Same positive control as T1, at the wire: a node that carried no
    // provenance must not acquire any, and must not gain an explicit `null`.
    // `JSON.stringify` drops undefined keys, so absence here is real absence.
    const goal = wire.graph.nodes.find((n: any) => n.id === 'goal_margin');
    expect(goal?.observed_state ?? {}).not.toHaveProperty('source');
    expect(goal?.observed_state ?? {}).not.toHaveProperty('extractionType');
  });
});
