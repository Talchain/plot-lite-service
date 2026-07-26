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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ISLClient } from '../src/integrations/isl/client.js';
import {
  toISLRobustnessRequest,
  type ISLRobustnessRequestV3,
} from '../src/integrations/isl/translator-v3.js';
import { injectConstraintParameterUncertainties } from '../src/integrations/isl/constraint-pu-injection.js';
import { createISLInferenceFn } from '../src/analysis/flip-thresholds.js';
import { createISLService } from '../src/integrations/isl/index.js';
import type { EngineGraphV3, EngineNodeV3, OptionV3, GoalConstraint } from '../src/types/engine-v3.js';

// -----------------------------------------------------------------------------
// Egress capture — the exact string given to fetch as the request body.
// -----------------------------------------------------------------------------

interface Capture {
  url: string;
  bodyText: string;
  body: any;
}

let captured: Capture[] = [];

function installFetchCapture(responseBody: unknown = {}): void {
  captured = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: any, init: any) => {
      const bodyText = String(init?.body ?? '');
      captured.push({ url: String(url), bodyText, body: JSON.parse(bodyText) });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify(responseBody),
        json: async () => responseBody,
      } as any;
    }),
  );
}

/** Every JSON path in the captured bytes matching `container[*].key`. */
function undeclaredKeyPaths(
  capture: Capture,
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
// Fixtures — a PLoT-internal graph that exercises every `mean` producer.
// -----------------------------------------------------------------------------

/**
 * `metadata` is what PLoT's own normaliser attaches to a constraint node's
 * observed_state (graph-normaliser.ts:274-276) so the constraint compiler can
 * read `.operator`. It is PLoT-internal and must not reach ISL. It is not on
 * `EngineNodeV3.observed_state`, hence the cast — which is precisely why the
 * verbatim forward was invisible to the typechecker.
 */
function nodeWithInternalMetadata(): EngineNodeV3 {
  return {
    id: 'fac_headcount',
    kind: 'factor',
    label: 'Headcount',
    observed_state: {
      value: 0.4,
      std: 0.08,
      baseline: 0.3,
      unit: 'people',
      raw_value: 40,
      cap: 100,
      factor_type: 'quantitative',
      uncertainty_drivers: ['hiring_pipeline'],
      // PLoT-internal: read by constraint-compiler.ts, never by ISL.
      metadata: { operator: '<=', source: 'cee_constraint_node' },
    } as EngineNodeV3['observed_state'],
  } as EngineNodeV3;
}

function buildGraph(): EngineGraphV3 {
  const nodes: EngineNodeV3[] = [
    nodeWithInternalMetadata(),
    // Producer 2: external factor with a uniform prior → PU synthesised from range.
    {
      id: 'fac_market',
      kind: 'factor',
      label: 'Market growth',
      category: 'external',
      prior: { distribution: 'uniform', range_min: 0.2, range_max: 0.6 },
    } as EngineNodeV3,
    // Producer 3: a constrained node with no PU of its own → constraint injection.
    {
      id: 'fac_cost',
      kind: 'factor',
      label: 'Cost',
      observed_state: { value: 0.55 },
    } as EngineNodeV3,
    // In the graph but with no observed_state, so the translator emits no PU
    // for it — the realistic "insert" branch of the flip probe.
    { id: 'fac_no_obs', kind: 'factor', label: 'Unmeasured' } as EngineNodeV3,
    { id: 'goal_margin', kind: 'outcome', label: 'Margin' } as EngineNodeV3,
  ];

  return {
    nodes,
    edges: [
      {
        from: 'fac_headcount',
        to: 'goal_margin',
        exists_probability: 0.9,
        strength: { mean: 0.5, std: 0.1 },
      },
      {
        from: 'fac_market',
        to: 'goal_margin',
        exists_probability: 0.8,
        strength: { mean: 0.3, std: 0.12 },
      },
      {
        from: 'fac_cost',
        to: 'goal_margin',
        exists_probability: 0.85,
        strength: { mean: -0.4, std: 0.09 },
      },
    ],
  } as EngineGraphV3;
}

/**
 * The `/v1/run` leg reaches ISL through `analyseRobustness`, which consumes the
 * trust-layer `Graph` (edges carry `weight` / `belief_exists` / `strength_std`,
 * not a `strength` object). `weight` is PLoT's own coefficient: ISL's `EdgeV2`
 * declares no such field, and `analyseRobustness` was forwarding it alongside
 * the `strength` distribution it derives from it.
 */
function buildV1Graph(): any {
  return {
    nodes: [
      nodeWithInternalMetadata(),
      { id: 'fac_cost', kind: 'factor', label: 'Cost', observed_state: { value: 0.55, std: 0.05 } },
      { id: 'goal_margin', kind: 'outcome', label: 'Margin' },
    ],
    edges: [
      {
        from: 'fac_headcount',
        to: 'goal_margin',
        weight: 0.5,
        belief_exists: 0.9,
        strength_std: 0.1,
      },
      { from: 'fac_cost', to: 'goal_margin', weight: -0.4, belief_exists: 0.85, strength_std: 0.09 },
    ],
  };
}

const OPTIONS: OptionV3[] = [
  { id: 'opt_a', label: 'Hire', interventions: { fac_headcount: { value: 0.8 } } },
  { id: 'opt_b', label: 'Hold', interventions: { fac_headcount: { value: 0.2 } } },
] as unknown as OptionV3[];

const CONSTRAINTS: GoalConstraint[] = [
  { constraint_id: 'c1', node_id: 'fac_cost', operator: '<=', value: 0.7, label: 'Cost cap' },
] as unknown as GoalConstraint[];

function buildV2Request(): ISLRobustnessRequestV3 {
  const graph = buildGraph();
  const request = toISLRobustnessRequest(
    graph,
    OPTIONS,
    'goal_margin',
    'req_slice6',
    2000,
    undefined,
    CONSTRAINTS,
    'seed-slice6',
  );
  // The /v2/run route runs this immediately after building the request
  // (run.ts:5659-5663); it MUTATES request.parameter_uncertainties, so a
  // translator-only assertion would miss the key it re-adds.
  injectConstraintParameterUncertainties(request, CONSTRAINTS, graph.nodes, 'goal_margin');
  return request;
}

function newClient(): ISLClient {
  return new ISLClient({
    baseUrl: 'https://isl.test',
    apiKey: 'test-key',
    timeoutMs: 5_000,
    maxRetries: 1,
  });
}

// -----------------------------------------------------------------------------

describe('PLoT → ISL egress carries no undeclared request key (slice 6)', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    installFetchCapture({ status: 'ok' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  describe('/api/v1/robustness/analyze/v2 — the /v2/run analysis body', () => {
    async function captureV2Body(): Promise<Capture> {
      await newClient().request({
        endpoint: '/api/v1/robustness/analyze/v2',
        body: buildV2Request(),
        requestId: 'req_slice6',
      });
      expect(captured).toHaveLength(1);
      return captured[0]!;
    }

    it('POSITIVE CONTROL: the instrument sees the bytes and their declared keys', async () => {
      const c = await captureV2Body();

      // The capture is real bytes, not an empty object (trap 13).
      expect(c.bodyText.length).toBeGreaterThan(200);
      expect(c.url).toContain('/api/v1/robustness/analyze/v2');

      // All three `mean` producers fired, so the absence assertions below are
      // being made over a body that HAS parameter_uncertainties to inspect.
      const pu = c.body.parameter_uncertainties as any[];
      expect(pu.map((p) => p.node_id).sort()).toEqual(['fac_cost', 'fac_headcount', 'fac_market']);
      for (const p of pu) {
        expect(typeof p.node_id).toBe('string');
        expect(p.distribution).toBe('normal');
        expect(typeof p.std).toBe('number');
      }

      // Edge `strength.mean` IS declared by ISL — proof that the assertions
      // below target the specific undeclared keys and not the string "mean".
      for (const e of c.body.graph.edges as any[]) {
        expect(typeof e.strength.mean).toBe('number');
        expect(typeof e.strength.std).toBe('number');
      }

      // The observed_state allowlist must keep every ISL-DECLARED field.
      const os = (c.body.graph.nodes as any[]).find((n) => n.id === 'fac_headcount')!.observed_state;
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
      expect((c.body.goal_constraints as any[])[0].constraint_id).toBe('c1');
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
    async function captureProbeBody(): Promise<Capture[]> {
      const original = buildV2Request();
      const client = newClient();
      const inferenceFn = createISLInferenceFn(
        async (endpoint, body, requestId, signal) => {
          const res = await client.request<any>({ endpoint, body, requestId, signal });
          return { data: res.data };
        },
        original as any,
        'req_slice6',
      );
      // A probe on a factor already in the PU list (clone path) and one on a
      // factor that is not (insert path) — the two branches at
      // flip-thresholds.ts:840-859.
      await inferenceFn('fac_headcount', 0.75);
      await inferenceFn('fac_no_obs', 0.25);
      expect(captured).toHaveLength(2);
      return captured;
    }

    it('POSITIVE CONTROL: both probe branches produced real bytes with PU entries', async () => {
      const [clonePath, insertPath] = await captureProbeBody();
      expect(clonePath!.body.parameter_uncertainties.length).toBe(3);
      expect(insertPath!.body.parameter_uncertainties.length).toBe(4);
      for (const c of [clonePath!, insertPath!]) {
        for (const p of c.body.parameter_uncertainties as any[]) {
          expect(typeof p.std).toBe('number');
        }
      }
      // The probe moves observed_state.value — the field ISL actually reads.
      const moved = (clonePath!.body.graph.nodes as any[]).find((n) => n.id === 'fac_headcount');
      expect(moved.observed_state.value).toBe(0.75);
    });

    it('no parameter_uncertainties[].mean on either probe branch', async () => {
      for (const c of await captureProbeBody()) {
        expect(undeclaredKeyPaths(c, collectParameterUncertainties, 'mean')).toEqual([]);
      }
    });

    it('no observed_state.metadata survives the probe clone', async () => {
      for (const c of await captureProbeBody()) {
        expect(undeclaredKeyPaths(c, collectObservedStates, 'metadata')).toEqual([]);
      }
    });
  });

  describe('/v1/run → analyseRobustness — the second live ISL producer', () => {
    async function captureV1Body(): Promise<Capture> {
      process.env.ISL_ENABLE = '1';
      process.env.ISL_BASE_URL = 'https://isl.test';
      process.env.ISL_API_KEY = 'test-key';

      const service = createISLService();
      await service.analyseRobustness(
        buildV1Graph(),
        'goal_margin',
        [
          { id: 'opt_a', label: 'Hire', interventions: { fac_headcount: 0.8 } },
          { id: 'opt_b', label: 'Hold', interventions: { fac_headcount: 0.2 } },
        ],
        'req_slice6_v1',
      );
      expect(captured).toHaveLength(1);
      return captured[0]!;
    }

    it('POSITIVE CONTROL: the /v1 body was captured and carries its declared edge fields', async () => {
      const c = await captureV1Body();
      expect(c.body.graph.edges.length).toBe(2);
      for (const e of c.body.graph.edges as any[]) {
        expect(typeof e.from).toBe('string');
        expect(typeof e.to).toBe('string');
        expect(typeof e.exists_probability).toBe('number');
        // `weight` is dropped, but the quantity it carried must survive in the
        // ISL-declared location — otherwise this cleanup silently removed data.
        expect(typeof e.strength.mean).toBe('number');
        expect(typeof e.strength.std).toBe('number');
      }
      expect((c.body.graph.edges as any[]).map((e) => e.strength.mean)).toEqual([0.5, -0.4]);
      expect((c.body.parameter_uncertainties as any[]).length).toBeGreaterThan(0);
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
});
