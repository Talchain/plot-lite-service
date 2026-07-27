/**
 * PLoT → ISL egress: the request bytes carry no key ISL does not declare.
 * (Contract step-2, slice 6 — producer cleanup toward ISL.)
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * ISL's request models set `extra: "ignore"`, so every undeclared key PLoT
 * sends is silently dropped at ISL's model boundary — invisible in both
 * directions. Three such keys were shipping:
 *
 *   1. `parameter_uncertainties[].mean` — ISL's `ParameterUncertainty`
 *      (isl/src/models/robustness_v2.py:254-267 @ 7d144c7f) declares
 *      {node_id, distribution, std, range_min, range_max}. No `mean`.
 *      Present in ALL FIVE captured live request fixtures.
 *   2. `graph.edges[].weight` — ISL's `EdgeV2` (robustness_v2.py:348-426)
 *      declares {from, to, exists_probability, strength, label, edge_type}.
 *      No `weight`. Live on the `/v1/run` → analyseRobustness path.
 *   3. `graph.nodes[].observed_state.metadata` — ISL's `ObservedState`
 *      (robustness_v2.py:160-200) declares ten fields; `metadata` is not one.
 *      PLoT's normaliser deliberately preserves `metadata` for its OWN
 *      constraint compiler (graph-normaliser.ts:274-276), and `toISLNode`
 *      then forwarded the whole object VERBATIM, so a PLoT-internal key
 *      transited to ISL.
 *
 * ⚠ MIGRATED ONTO THE PUBLISHED HARNESS — AND THE MIGRATION WAS NOT COSMETIC
 * --------------------------------------------------------------------------
 * This file previously carried PRIVATE copies of the capture shim and the
 * fixture graph. The private graph was the PRE-slice-2 fixture, and it is
 * BLIND to one of the three `mean` producers this file names.
 *
 * Its constraint targeted `fac_cost` — a `kind: 'factor'` node with an
 * `observed_state.value`. `buildParameterUncertaintiesV3` (translator-v3.ts)
 * already emits a PU for exactly that shape, so `classifyConstraintPu`
 * (constraint-pu-injection.ts:67) returned `existing` and the injector
 * `continue`d at :154 — its wire-entry push at :182 was UNREACHABLE. The old
 * comment labelling `fac_cost` "Producer 3: a constrained node with no PU of
 * its own → constraint injection" was therefore false, and the old positive
 * control ("all three `mean` producers fired") was satisfied by the TRANSLATOR
 * alone: two observed_state PUs plus one prior PU, and nothing from the
 * injector.
 *
 * `tests/helpers/isl-egress-producers.ts` fixed this by adding a
 * `kind: 'constraint'` node (`con_cost_cap`) and pointing the constraint at
 * it — a node the translator does not emit a PU for, so the injector actually
 * runs. That graph was found to be necessary BY MUTATION, not by reading:
 * re-introducing the slice-6 `mean` key into the injector left the old fixture
 * completely green.
 *
 * The positive control below now asserts the injected entry is PRESENT and
 * carries `CONSTRAINT_PINNED_STD` — something ONLY the injector branch can
 * produce (TESTING-DISCIPLINE rule 1: name the branch the fixture must reach,
 * and assert something only that branch can produce).
 *
 * RULE 3 (TESTING-DISCIPLINE.md): these assertions are made on the SERIALIZED
 * bytes handed to `fetch` — `ISLClient.request()` builds `requestBodyText =
 * JSON.stringify(body)` (client.ts:140) and passes that exact string as the
 * fetch body. A test that asserted on a translator's return value would sit
 * upstream of the egress boundary and could not see a key re-added downstream
 * (e.g. by the constraint injector or the flip-probe cloner).
 *
 * RED before the slice-6 change: every `expect(...undeclared...).toEqual([])`
 * below fails, naming the exact JSON path of each leaked key.
 *
 * POSITIVE CONTROLS (rule 2 / trap 13): each absence assertion is paired with
 * a presence assertion over the SAME captured bytes, so an instrument that
 * silently captured nothing cannot report success.
 *
 * OUT OF SCOPE, deliberately: `goal_constraints[].constraint_id` and
 * `goal_constraints[].weight` are also undeclared on ISL's `GoalConstraint`.
 * `constraint_id` is being ADOPTED into ISL reader-first (Codex OQ-5), not
 * deleted, so it is asserted PRESENT here to pin that decision. `weight` is
 * caller-supplied and latent; it is recorded in the PR body, not changed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CONSTRAINT_PINNED_STD } from '../src/integrations/isl/constraint-pu-injection.js';
import {
  PRODUCERS,
  installEgressCapture,
  uninstallEgressCapture,
  type EgressCapture,
  type ProducerSpec,
} from './helpers/isl-egress-producers.js';

// -----------------------------------------------------------------------------
// Producer lookup — FAILS LOUD on drift (trap 12: derive, don't mirror).
// A renamed or removed producer must break this file, never silently skip it.
// -----------------------------------------------------------------------------

function producer(name: string): ProducerSpec {
  const spec = PRODUCERS.find((p) => p.name === name);
  if (spec === undefined) {
    throw new Error(
      `No producer named "${name}" in PRODUCERS. This gate names its producers ` +
        `explicitly so a rename cannot silently drop coverage. Known: ` +
        `${PRODUCERS.map((p) => p.name).join(', ')}`,
    );
  }
  return spec;
}

/** Drive one producer and return the single body it put on the wire. */
async function runOne(name: string): Promise<EgressCapture> {
  const captures = await producer(name).run();
  expect(captures).toHaveLength(1);
  return captures[0]!;
}

/** Every JSON path in the captured bytes matching `container[*].key`. */
function undeclaredKeyPaths(
  capture: EgressCapture,
  collect: (body: any) => Array<{ path: string; obj: any }>,
  key: string,
): string[] {
  return collect(capture.body)
    .filter(({ obj }) => obj !== null && typeof obj === 'object' && key in obj)
    .map(({ path }) => `${path}.${key}`);
}

const collectParameterUncertainties = (body: any) =>
  ((body?.parameter_uncertainties ?? []) as any[]).map((obj, i) => ({
    path: `parameter_uncertainties[${i}]`,
    obj,
  }));

const collectEdges = (body: any) =>
  ((body?.graph?.edges ?? []) as any[]).map((obj, i) => ({ path: `graph.edges[${i}]`, obj }));

const collectObservedStates = (body: any) =>
  ((body?.graph?.nodes ?? []) as any[])
    .map((n, i) => ({ path: `graph.nodes[${i}].observed_state`, obj: n?.observed_state }))
    .filter(({ obj }) => obj !== null && obj !== undefined);

// -----------------------------------------------------------------------------

describe('PLoT → ISL egress carries no undeclared request key (slice 6)', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    installEgressCapture({ status: 'ok' });
  });

  afterEach(() => {
    uninstallEgressCapture();
    process.env = { ...savedEnv };
  });

  describe('/api/v1/robustness/analyze/v2 — the /v2/run analysis body', () => {
    const captureV2Body = () => runOne('v2-run-base');

    it('POSITIVE CONTROL: the instrument sees the bytes, and ALL THREE `mean` producers fired', async () => {
      const c = await captureV2Body();
      const body = c.body as any;

      // The capture is real bytes, not an empty object (trap 13).
      expect(c.bodyText.length).toBeGreaterThan(200);
      expect(c.url).toContain('/api/v1/robustness/analyze/v2');

      const pu = body.parameter_uncertainties as any[];

      // Producer 1 (observed_state) and producer 2 (uniform prior), from the
      // translator; plus producer 3 (constraint injection), from the injector.
      expect(pu.map((p) => p.node_id).sort()).toEqual([
        'con_cost_cap',
        'fac_cost',
        'fac_headcount',
        'fac_market',
      ]);

      // ⚠ THE ASSERTION THE OLD PRIVATE FIXTURE COULD NOT MAKE.
      // `con_cost_cap` is `kind: 'constraint'`, so the translator emits no PU
      // for it — the ONLY way this entry can exist is
      // `injectConstraintParameterUncertainties`, and CONSTRAINT_PINNED_STD is
      // a value only that branch writes. Without this, the `mean` absence
      // assertions below would be made over a body the injector never touched.
      const injected = pu.find((p) => p.node_id === 'con_cost_cap');
      expect(injected).toBeDefined();
      expect(injected.std).toBe(CONSTRAINT_PINNED_STD);

      for (const p of pu) {
        expect(typeof p.node_id).toBe('string');
        expect(p.distribution).toBe('normal');
        expect(typeof p.std).toBe('number');
      }

      // Edge `strength.mean` IS declared by ISL — proof that the assertions
      // below target the specific undeclared keys and not the string "mean".
      for (const e of body.graph.edges as any[]) {
        expect(typeof e.strength.mean).toBe('number');
        expect(typeof e.strength.std).toBe('number');
      }

      // The observed_state allowlist must keep every ISL-DECLARED field.
      const os = (body.graph.nodes as any[]).find((n) => n.id === 'fac_headcount')!.observed_state;
      expect(os).toMatchObject({
        value: 0.4,
        std: 0.08,
        baseline: 0.3,
        unit: 'people',
        raw_value: 40,
        cap: 100,
        factor_type: 'quantitative',
        uncertainty_drivers: ['hiring_pipeline'],
      });

      // constraint_id is undeclared on ISL today but is being ADOPTED, not
      // dropped (Codex OQ-5). Pinned present so a later lane cannot delete it
      // by mistaking it for slice-6 cleanup.
      expect((body.goal_constraints as any[])[0].constraint_id).toBe('c1');
    });

    it('no parameter_uncertainties[].mean — from the observed_state, prior, or constraint-injection producer', async () => {
      const c = await captureV2Body();
      expect(undeclaredKeyPaths(c, collectParameterUncertainties, 'mean')).toEqual([]);
    });

    it('no graph.nodes[].observed_state.metadata — the PLoT-internal key must not transit', async () => {
      const c = await captureV2Body();
      expect(undeclaredKeyPaths(c, collectObservedStates, 'metadata')).toEqual([]);
      // Byte-level backstop: the internal operator value must not appear at all.
      expect(c.bodyText).not.toContain('cee_constraint_node');
    });

    it('no graph.edges[].weight', async () => {
      const c = await captureV2Body();
      expect(undeclaredKeyPaths(c, collectEdges, 'weight')).toEqual([]);
    });
  });

  describe('flip probe — the cloned body sent per probe point', () => {
    // A probe on a factor already in the PU list (clone path) and one on a
    // factor that is not (insert path) — the two branches at
    // flip-thresholds.ts:840-859.
    const captureProbeBodies = async (): Promise<EgressCapture[]> => [
      await runOne('flip-probe-clone'),
      await runOne('flip-probe-insert'),
    ];

    it('POSITIVE CONTROL: both probe branches produced real bytes with PU entries', async () => {
      const [clonePath, insertPath] = await captureProbeBodies();
      const cloneBody = clonePath!.body as any;
      const insertBody = insertPath!.body as any;

      // The base body already carries the injected constraint PU, so the clone
      // path is 4 and the insert path adds a fifth.
      expect(cloneBody.parameter_uncertainties.length).toBe(4);
      expect(insertBody.parameter_uncertainties.length).toBe(5);
      expect(insertBody.parameter_uncertainties.map((p: any) => p.node_id)).toContain('fac_no_obs');

      // The injected constraint PU survives the clone — the probe operates
      // downstream of the injector, which is why this file captures at fetch.
      for (const b of [cloneBody, insertBody]) {
        expect(b.parameter_uncertainties.map((p: any) => p.node_id)).toContain('con_cost_cap');
        for (const p of b.parameter_uncertainties as any[]) {
          expect(typeof p.std).toBe('number');
        }
      }

      // The probe moves observed_state.value — the field ISL actually reads.
      const moved = (cloneBody.graph.nodes as any[]).find((n) => n.id === 'fac_headcount');
      expect(moved.observed_state.value).toBe(0.75);
    });

    it('no parameter_uncertainties[].mean on either probe branch', async () => {
      for (const c of await captureProbeBodies()) {
        expect(undeclaredKeyPaths(c, collectParameterUncertainties, 'mean')).toEqual([]);
      }
    });

    it('no observed_state.metadata survives the probe clone', async () => {
      for (const c of await captureProbeBodies()) {
        expect(undeclaredKeyPaths(c, collectObservedStates, 'metadata')).toEqual([]);
      }
    });
  });

  describe('/v1/run → analyseRobustness — the second live ISL producer', () => {
    const captureV1Body = () => runOne('v1-run-analyse-robustness');

    it('POSITIVE CONTROL: the /v1 body was captured and carries its declared edge fields', async () => {
      const c = await captureV1Body();
      const body = c.body as any;

      expect(body.graph.edges.length).toBe(2);
      for (const e of body.graph.edges as any[]) {
        expect(typeof e.from).toBe('string');
        expect(typeof e.to).toBe('string');
        expect(typeof e.exists_probability).toBe('number');
        // `weight` is dropped, but the quantity it carried must survive in the
        // ISL-declared location — otherwise this cleanup silently removed data.
        expect(typeof e.strength.mean).toBe('number');
        expect(typeof e.strength.std).toBe('number');
      }
      expect((body.graph.edges as any[]).map((e) => e.strength.mean)).toEqual([0.5, -0.4]);
      expect((body.parameter_uncertainties as any[]).length).toBeGreaterThan(0);
    });

    it('no graph.edges[].weight', async () => {
      const c = await captureV1Body();
      expect(undeclaredKeyPaths(c, collectEdges, 'weight')).toEqual([]);
    });

    it('no parameter_uncertainties[].mean', async () => {
      const c = await captureV1Body();
      expect(undeclaredKeyPaths(c, collectParameterUncertainties, 'mean')).toEqual([]);
    });

    it('no graph.nodes[].observed_state.metadata', async () => {
      const c = await captureV1Body();
      expect(undeclaredKeyPaths(c, collectObservedStates, 'metadata')).toEqual([]);
      expect(c.bodyText).not.toContain('cee_constraint_node');
    });
  });

  /**
   * The three groups above name the producers that were leaking at slice 6. A
   * producer added LATER would not be covered by any of them — the same
   * "the gate never reached that path" defect this file was migrated to fix,
   * one level up. This sweep closes that by deriving its subjects from
   * PRODUCERS rather than naming them.
   *
   * NOT VACUOUS (rule 2): the `causal-*` producers send no graph and no
   * parameter_uncertainties at all, so an unguarded sweep would pass over them
   * by inspecting nothing. The control below asserts the sweep actually
   * inspected containers of all three kinds, and reports which producers were
   * inspectable — so an instrument that went blind reports zero, not green.
   */
  describe('EVERY producer in the manifest, derived — no undeclared key anywhere', () => {
    interface Inspected {
      name: string;
      pu: number;
      edges: number;
      observedStates: number;
    }

    async function sweep(): Promise<Inspected[]> {
      const rows: Inspected[] = [];
      for (const spec of PRODUCERS) {
        for (const c of await spec.run()) {
          // The RESPONSE-VERSION PIN, asserted on the wire rather than read off
          // client.ts. ISL's V2 handler serialises with
          // `model_dump(by_alias=True, exclude_none=True)`, which is recursive,
          // so on THIS path a null field is OMITTED, never sent. Any capture of
          // a `null`-bearing ISL body is therefore the LEGACY v1 format — a
          // hand-curl without the pin — and says nothing about what PLoT
          // receives. Pinned here so that scope cannot be mislaid again.
          expect(c.url).toContain('response_version=2');
          expect(undeclaredKeyPaths(c, collectParameterUncertainties, 'mean')).toEqual([]);
          expect(undeclaredKeyPaths(c, collectEdges, 'weight')).toEqual([]);
          expect(undeclaredKeyPaths(c, collectObservedStates, 'metadata')).toEqual([]);
          expect(c.bodyText).not.toContain('cee_constraint_node');
          rows.push({
            name: spec.name,
            pu: collectParameterUncertainties(c.body).length,
            edges: collectEdges(c.body).length,
            observedStates: collectObservedStates(c.body).length,
          });
        }
      }
      return rows;
    }

    it('no undeclared key on any producer, and the sweep inspected real containers', async () => {
      const rows = await sweep();

      // Every producer was driven and put at least one body on the wire.
      expect(rows.length).toBeGreaterThanOrEqual(PRODUCERS.length);
      expect(new Set(rows.map((r) => r.name))).toEqual(new Set(PRODUCERS.map((p) => p.name)));

      // The sweep inspected containers of all three kinds — otherwise every
      // absence assertion above passed by looking at nothing.
      expect(rows.reduce((n, r) => n + r.pu, 0)).toBeGreaterThan(0);
      expect(rows.reduce((n, r) => n + r.edges, 0)).toBeGreaterThan(0);
      expect(rows.reduce((n, r) => n + r.observedStates, 0)).toBeGreaterThan(0);

      // And the constraint-injection branch was reached inside the sweep too.
      expect(rows.filter((r) => r.pu >= 4).length).toBeGreaterThan(0);
    });
  });
});
