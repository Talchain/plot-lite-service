/**
 * Track S — Request-side value provenance forwarding
 *
 * Companion to `track-s-provenance-passthrough.test.ts`, which covers the ISL
 * *response* echo (value_source / value_extraction_type). This file covers the
 * *request* path: factor value provenance emitted by CEE on each factor node's
 * `observed_state` — `source` and `extractionType` — must survive PLoT
 * normalisation and reach the ISL robustness request unchanged.
 *
 * Drop point fixed: `src/normalisation/graph-normaliser.ts` rebuilt
 * `observed_state` from an explicit allow-list that omitted `source` and
 * `extractionType`. The translator (`toISLNode`) is a pure passthrough, so
 * preserving the two fields in the normaliser is sufficient for them to reach
 * the ISL request.
 *
 * Casing contract: the request-side names are `source` (lowercase) and
 * `extractionType` (camelCase) on BOTH the CEE emit and the ISL receive side —
 * NOT the response-side echo names `value_source` / `value_extraction_type`.
 *
 * Preserve-only-when-present: provenance is copied verbatim and is `undefined`
 * when absent; `JSON.stringify` drops undefined keys, so the wire request omits
 * provenance entirely when the incoming node had none (no invented fields).
 */

import { describe, it, expect } from 'vitest';
import { normaliseNode } from '../src/normalisation/graph-normaliser.js';
import { normaliseGraphWithRepairs } from '../src/normalisation/normalise-and-repair.js';
import { toISLRobustnessRequest } from '../src/integrations/isl/translator-v3.js';
import type {
  UpstreamNode,
  UpstreamGraph,
  EngineGraphV3,
  EngineNodeV3,
  OptionV3,
} from '../src/types/engine-v3.js';

// A factor node as CEE emits it: full observed_state including both provenance
// fields and the V3 expansion fields.
const RICH_FACTOR: UpstreamNode = {
  id: 'fac_cost',
  kind: 'factor',
  label: 'Hiring Cost',
  observed_state: {
    value: 120000,
    unit: 'GBP',
    raw_value: 120000,
    cap: 500000,
    factor_type: 'cost',
    uncertainty_drivers: ['market rate volatility'],
    source: 'brief_extraction',
    extractionType: 'explicit',
  },
};

const OPTIONS: OptionV3[] = [
  { id: 'opt_a', label: 'Option A', interventions: { fac_cost: { value: 100000, source: 'user_specified' } } },
  { id: 'opt_b', label: 'Option B', interventions: { fac_cost: { value: 140000, source: 'user_specified' } } },
];

// =============================================================================
// Normaliser — must preserve provenance through observed_state reconstruction
// =============================================================================

describe('graph-normaliser preserves Track S value provenance', () => {
  it('keeps source and extractionType on the normalised observed_state', () => {
    const node = normaliseNode(RICH_FACTOR);
    expect(node.observed_state?.source).toBe('brief_extraction');
    expect(node.observed_state?.extractionType).toBe('explicit');
  });

  it('regression: existing observed_state fields still survive normalisation', () => {
    const node = normaliseNode(RICH_FACTOR);
    expect(node.observed_state?.value).toBe(120000);
    expect(node.observed_state?.unit).toBe('GBP');
    expect(node.observed_state?.raw_value).toBe(120000);
    expect(node.observed_state?.cap).toBe(500000);
    expect(node.observed_state?.factor_type).toBe('cost');
    expect(node.observed_state?.uncertainty_drivers).toEqual(['market rate volatility']);
  });

  it('preserve-only-when-present: does not invent provenance when absent', () => {
    const bare = normaliseNode({
      id: 'fac_velocity',
      kind: 'factor',
      label: 'Team Velocity',
      observed_state: { value: 0.7 },
    });
    expect(bare.observed_state?.value).toBe(0.7);
    expect(bare.observed_state?.source).toBeUndefined();
    expect(bare.observed_state?.extractionType).toBeUndefined();
  });
});

// =============================================================================
// Translator — must forward provenance into the ISL robustness request
// =============================================================================

describe('toISLRobustnessRequest forwards Track S value provenance', () => {
  function buildGraph(factor: EngineNodeV3): EngineGraphV3 {
    const goal: EngineNodeV3 = { id: 'goal', kind: 'goal', label: 'Profit' } as EngineNodeV3;
    return {
      nodes: [goal, factor],
      edges: [{ from: 'fac_cost', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
    } as EngineGraphV3;
  }

  it('ISL request observed_state contains source and extractionType', () => {
    const graph = buildGraph(normaliseNode(RICH_FACTOR));
    const islReq = toISLRobustnessRequest(graph, OPTIONS, 'goal', 'req-translator', 1000);

    const islFactor = islReq.graph.nodes.find((n) => n.id === 'fac_cost');
    expect(islFactor?.observed_state?.source).toBe('brief_extraction');
    expect(islFactor?.observed_state?.extractionType).toBe('explicit');
  });

  it('survives JSON serialisation (the actual HTTP wire body to ISL)', () => {
    const graph = buildGraph(normaliseNode(RICH_FACTOR));
    const islReq = toISLRobustnessRequest(graph, OPTIONS, 'goal', 'req-wire', 1000);

    const wire = JSON.parse(JSON.stringify(islReq));
    const wireFactor = wire.graph.nodes.find((n: { id: string }) => n.id === 'fac_cost');
    expect(wireFactor.observed_state.source).toBe('brief_extraction');
    expect(wireFactor.observed_state.extractionType).toBe('explicit');
  });
});

// =============================================================================
// End-to-end production path — normaliseGraphWithRepairs → toISLRobustnessRequest
// (exactly the chain run.ts executes for /v2/run)
// =============================================================================

describe('Track S provenance survives the full /v2/run request path', () => {
  it('CEE-shaped graph → normalise → ISL request carries provenance + existing fields', () => {
    const upstream: UpstreamGraph = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Profit' },
        RICH_FACTOR,
      ],
      edges: [{ from: 'fac_cost', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
    };

    const { graph } = normaliseGraphWithRepairs(upstream);
    const islReq = toISLRobustnessRequest(graph, OPTIONS, 'goal', 'req-e2e', 1000);

    const wire = JSON.parse(JSON.stringify(islReq));
    const wireFactor = wire.graph.nodes.find((n: { id: string }) => n.id === 'fac_cost');

    // Provenance forwarded
    expect(wireFactor.observed_state.source).toBe('brief_extraction');
    expect(wireFactor.observed_state.extractionType).toBe('explicit');

    // Regression: the fields that already reached ISL must still reach it
    expect(wireFactor.observed_state.value).toBe(120000);
    expect(wireFactor.observed_state.unit).toBe('GBP');
    expect(wireFactor.observed_state.raw_value).toBe(120000);
    expect(wireFactor.observed_state.cap).toBe(500000);
    expect(wireFactor.observed_state.factor_type).toBe('cost');
    expect(wireFactor.observed_state.uncertainty_drivers).toEqual(['market rate volatility']);
  });

  it('preserve-only-when-present: wire request omits provenance keys when absent', () => {
    const upstream: UpstreamGraph = {
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Profit' },
        { id: 'fac_velocity', kind: 'factor', label: 'Team Velocity', observed_state: { value: 0.7 } },
      ],
      edges: [{ from: 'fac_velocity', to: 'goal', strength: { mean: 0.5, std: 0.1 } }],
    };

    const { graph } = normaliseGraphWithRepairs(upstream);
    const islReq = toISLRobustnessRequest(
      graph,
      [
        { id: 'opt_a', label: 'Option A', interventions: { fac_velocity: { value: 0.8, source: 'user_specified' } } },
        { id: 'opt_b', label: 'Option B', interventions: { fac_velocity: { value: 0.9, source: 'user_specified' } } },
      ],
      'goal',
      'req-absent',
      1000,
    );

    const wire = JSON.parse(JSON.stringify(islReq));
    const wireFactor = wire.graph.nodes.find((n: { id: string }) => n.id === 'fac_velocity');
    expect(wireFactor.observed_state).toBeDefined();
    expect(wireFactor.observed_state.value).toBe(0.7);
    expect(wireFactor.observed_state).not.toHaveProperty('source');
    expect(wireFactor.observed_state).not.toHaveProperty('extractionType');
  });
});
