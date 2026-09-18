/**
 * Graph Normaliser — edge invented-value marker passthrough
 *
 * CEE's factor enricher stamps every enrichment-created edge with a literal
 * `strength_mean: 0.5` / `strength_std: 0.2` AND with `defaulted: true` — the
 * producer's own statement that the magnitude is a prior, not a measurement.
 * The magnitude survives the whole chain (CEE flat → `transformEdgeToV3`
 * flat-first → nested `strength:{mean,std}` → V3 persisted graph →
 * `plotPayload.graph` → PLoT), reaches `computeFactorInfluence`, and becomes a
 * user-visible influence percentage.
 *
 * The MARKER did not survive. `normaliseEdge` returned an explicit five-field
 * object, so `defaulted` (and `provenance`, already declared on `UpstreamEdge`
 * but absent from `EngineEdgeV3`) were structurally deleted at PLoT's first
 * hop — measured at staging d37c8cfd: `.defaulted` reads in `src/` = 0,
 * `edge.origin` = 0, `edge.provenance` on the v2/v3 path = 0, against a
 * contrast control of `.exists_probability` = 15 files on the same paths.
 *
 * These tests pin the marker's SURVIVAL across that hop. They deliberately do
 * NOT pin any consumer: no consumer exists yet, and pretending otherwise is
 * the failure mode this estate keeps paying for.
 *
 * ⚠ They also pin that carrying the marker changes NO computed value — the
 * arithmetic assertions here are the guard against a later "while we're here"
 * edit to the defaults themselves. A model is entitled to a prior; it is not
 * entitled to present one as a measurement, and the fix for that is the flag
 * travelling, not the number changing.
 */

import { describe, it, expect } from 'vitest';
import { normaliseEdge } from '../src/normalisation/graph-normaliser.js';
import { normaliseGraphWithRepairs } from '../src/normalisation/normalise-and-repair.js';
import type { UpstreamEdge, UpstreamGraph } from '../src/types/engine-v3.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Node kinds for the two factor ids used throughout. */
const KINDS = new Map<string, string>([
  ['fac_price', 'factor'],
  ['fac_churn', 'factor'],
  ['goal_revenue', 'outcome'],
]);

/**
 * An edge shaped exactly as CEE's factor enricher emits one: FLAT strength
 * fields plus the producer's `defaulted` claim. The literals 0.5 / 0.2 are
 * CEE's, reproduced verbatim so a change to them shows up here.
 */
/**
 * The provenance object CEE's `transformEdgeToV3` actually emits — key
 * `reasoning` (renamed from the enricher's `quote`), `source` remapped into the
 * V3 enum. Reproduced verbatim so a PLoT-side guard written against the OLD
 * flat-string declaration fails here rather than in production.
 */
const CEE_V3_PROVENANCE = {
  source: 'cee_hypothesis',
  reasoning: 'Brief extraction: "margin pressure from supplier costs"',
} as const;

function ceeEnrichmentEdge(from: string, extras: Record<string, unknown> = {}): UpstreamEdge {
  return {
    from,
    to: 'goal_revenue',
    strength_mean: 0.5,
    strength_std: 0.2,
    ...extras,
  } as UpstreamEdge;
}

describe('normaliseEdge — invented-value marker survives the canonicalisation hop', () => {
  it('carries defaulted:true from the upstream edge onto the canonical edge', () => {
    const out = normaliseEdge(ceeEnrichmentEdge('fac_price', { defaulted: true }), 0, KINDS);

    expect((out as Record<string, unknown>).defaulted).toBe(true);
  });

  it('carries defaulted:false verbatim — an explicit not-invented claim is not absence', () => {
    const out = normaliseEdge(ceeEnrichmentEdge('fac_price', { defaulted: false }), 0, KINDS);

    expect((out as Record<string, unknown>).defaulted).toBe(false);
    expect('defaulted' in (out as object)).toBe(true);
  });

  it('absence in, absence out — an unmarked edge gains no defaulted key', () => {
    const out = normaliseEdge(ceeEnrichmentEdge('fac_price'), 0, KINDS);

    expect('defaulted' in (out as object)).toBe(false);
  });

  it('does not carry a non-boolean defaulted — the declared type must not become a lie', () => {
    const out = normaliseEdge(
      ceeEnrichmentEdge('fac_price', { defaulted: 'yes' }),
      0,
      KINDS
    );

    expect('defaulted' in (out as object)).toBe(false);
  });

  it("carries CEE's OBJECT provenance — the live V2/V3 wire form — without flattening it", () => {
    const out = normaliseEdge(
      ceeEnrichmentEdge('fac_price', { provenance: CEE_V3_PROVENANCE }),
      0,
      KINDS
    );

    // Not merely present: the object arrives intact, `reasoning` included. A
    // `typeof === 'string'` guard would silently drop this whole class.
    expect((out as Record<string, unknown>).provenance).toEqual(CEE_V3_PROVENANCE);
  });

  it('carries the flat STRING provenance too — the V1/legacy form is still real', () => {
    const out = normaliseEdge(ceeEnrichmentEdge('fac_price', { provenance: 'template' }), 0, KINDS);

    expect((out as Record<string, unknown>).provenance).toBe('template');
  });

  it('absence in, absence out — an edge with no provenance gains no provenance key', () => {
    const out = normaliseEdge(ceeEnrichmentEdge('fac_price'), 0, KINDS);

    expect('provenance' in (out as object)).toBe(false);
  });

  it("carries origin:'enrichment' — a DIFFERENT claim from defaulted, and equally dropped", () => {
    const out = normaliseEdge(
      ceeEnrichmentEdge('fac_price', { origin: 'enrichment', defaulted: true }),
      0,
      KINDS
    );

    expect((out as Record<string, unknown>).origin).toBe('enrichment');
    expect((out as Record<string, unknown>).defaulted).toBe(true);
  });

  it('absence in, absence out — an edge with no origin gains no origin key', () => {
    const out = normaliseEdge(ceeEnrichmentEdge('fac_price'), 0, KINDS);

    expect('origin' in (out as object)).toBe(false);
  });

  it('binds the marker to the edge that carried it, not to every edge in the batch', () => {
    const marked = normaliseEdge(
      ceeEnrichmentEdge('fac_price', { defaulted: true }),
      0,
      KINDS
    ) as Record<string, unknown>;
    const unmarked = normaliseEdge(ceeEnrichmentEdge('fac_churn'), 1, KINDS) as Record<string, unknown>;

    expect(marked.from).toBe('fac_price');
    expect(marked.defaulted).toBe(true);
    expect(unmarked.from).toBe('fac_churn');
    expect('defaulted' in unmarked).toBe(false);
  });

  it('changes no computed value: strength and exists_probability are identical with and without the marker', () => {
    const withMarker = normaliseEdge(
      ceeEnrichmentEdge('fac_price', {
        defaulted: true,
        origin: 'enrichment',
        provenance: CEE_V3_PROVENANCE,
      }),
      0,
      KINDS
    );
    const withoutMarker = normaliseEdge(ceeEnrichmentEdge('fac_price'), 0, KINDS);

    expect(withMarker.strength).toEqual(withoutMarker.strength);
    expect(withMarker.exists_probability).toBe(withoutMarker.exists_probability);
    // CEE's literals reach the compute unchanged. This PR does not touch them.
    expect(withMarker.strength.mean).toBe(0.5);
    expect(withMarker.strength.std).toBe(0.2);
  });
});

describe('normaliseGraphWithRepairs — the marker crosses the hop /v2/run actually calls', () => {
  const graph: UpstreamGraph = {
    nodes: [
      { id: 'fac_price', kind: 'factor', label: 'Price' },
      { id: 'fac_churn', kind: 'factor', label: 'Churn' },
      { id: 'goal_revenue', kind: 'outcome', label: 'Revenue' },
    ],
    edges: [
      ceeEnrichmentEdge('fac_price', {
        defaulted: true,
        origin: 'enrichment',
        provenance: CEE_V3_PROVENANCE,
      }),
      ceeEnrichmentEdge('fac_churn'),
    ],
  };

  /**
   * This describe's title is a claim, so it is pinned rather than asserted in
   * prose. `normaliseGraphWithRepairs` IS the hop `/v2/run` calls
   * (`routes/v2/run.ts:5466`), and this fixture really does cross the REPAIR
   * path rather than sailing past it — an independent review read the fixture
   * as repair-free, which measurement refutes: CEE's enricher emits no
   * `exists_probability`, so both edges take `DEFAULT_EXISTS_PROBABILITY`. A
   * marker that survived only a repair-free traversal would prove much less.
   */
  it('the fixture really does cross the repair path — both edges take the exists_probability default', () => {
    const result = normaliseGraphWithRepairs(graph);
    const codes = result.repairs.map((r) => r.code);
    expect(codes).toEqual(['DEFAULT_EXISTS_PROBABILITY', 'DEFAULT_EXISTS_PROBABILITY']);
  });

  it('a CEE enrichment-created edge keeps defaulted:true through normaliseGraphWithRepairs', () => {
    const result = normaliseGraphWithRepairs(graph);
    const edge = result.graph.edges.find((e) => e.from === 'fac_price') as Record<string, unknown>;

    expect(edge).toBeDefined();
    expect(edge.defaulted).toBe(true);
    expect(edge.provenance).toEqual(CEE_V3_PROVENANCE);
    expect(edge.origin).toBe('enrichment');
  });

  it('an unmarked sibling edge stays unmarked through normaliseGraphWithRepairs', () => {
    const result = normaliseGraphWithRepairs(graph);
    const edge = result.graph.edges.find((e) => e.from === 'fac_churn') as Record<string, unknown>;

    expect(edge).toBeDefined();
    expect('defaulted' in edge).toBe(false);
  });

  it("CEE's 0.5/0.2 defaults reach the compute unchanged alongside the marker", () => {
    const result = normaliseGraphWithRepairs(graph);
    const marked = result.graph.edges.find((e) => e.from === 'fac_price');
    const unmarked = result.graph.edges.find((e) => e.from === 'fac_churn');

    expect(marked?.strength.mean).toBe(0.5);
    expect(marked?.strength.std).toBe(0.2);
    // The marker is metadata: the two edges compute identically.
    expect(marked?.strength).toEqual(unmarked?.strength);
    expect(marked?.exists_probability).toBe(unmarked?.exists_probability);
  });
});
