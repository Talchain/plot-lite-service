/**
 * /v1/validate-patch — `graph_hash` determinism against the producer-claim
 * passthrough fields.
 *
 * WHY THIS FILE EXISTS. `normaliseEdge` now carries three producer claims
 * across PLoT's first hop — `defaulted`, `origin`, `provenance`. Three of
 * PLoT's four canonicalisers are FIELD ALLOWLISTS (`canonicaliseEdge` in
 * `normalisation/canonicalise.ts`, `toISLEdge` in `isl/translator-v3.ts`,
 * `canonicalEdge` in `sampling/graph-hash.ts`), so nothing extra can reach
 * them. The FOURTH — `computeGraphHash` in this route — was
 * `JSON.stringify` over whole node/edge objects, so all three claims reached
 * the hash and the response field `graph_hash`, which both OpenAPI specs
 * declare REQUIRED and describe as *"Deterministic SHA-256 hash of the
 * normalised graph"*, stopped being deterministic in three separate ways:
 *
 *   V1  marker PRESENCE moved the hash;
 *   V2  provenance KEY ORDER moved the hash — the type carries
 *       `[key: string]: unknown` and CEE declares it `.passthrough()`, and
 *       `computeGraphHash` sorts nodes and edges but cannot sort INSIDE a
 *       nested object;
 *   V3  rewording the free-text `provenance.reasoning` moved the hash.
 *
 * Each vector below was RED at 438a352c before the allowlist landed; the
 * signatures are in the PR body. V2 is the one an ordinary test misses,
 * because a spec's object literals are all written in one order — so the two
 * provenance objects here are built by two different key-insertion routes and
 * the test PINS ITS OWN PRECONDITION (they must serialise differently while
 * comparing equal) before it asserts anything about a hash.
 *
 * ⚠ AN ALLOWLIST HAS TWO FAILURE DIRECTIONS AND THIS FILE COVERS BOTH.
 * Too WIDE and a claim leaks back into the hash. Too NARROW and the hash stops
 * moving when the graph genuinely changes — an equally silent failure, and the
 * one a "make the hash stable" fix drifts towards. The
 * `still discriminates` block is that second door: strip the allowlist to
 * `from`/`to` and those tests RED.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { createServer } from '../src/createServer.js';
import {
  HASHED_NODE_FIELDS,
  HASHED_EDGE_FIELDS,
  HASH_EXCLUDED_NODE_FIELDS,
  HASH_EXCLUDED_EDGE_FIELDS,
} from '../src/routes/v1/validate-patch.js';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;

const savedEnv: Record<string, string | undefined> = {};

function saveAndSet(key: string, value: string) {
  savedEnv[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  saveAndSet('ENABLE_VALIDATE_PATCH', '1');
  saveAndSet('RATE_LIMIT_ENABLED', '0');
  saveAndSet('AUTH_ENABLED', '0');
  app = await createServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AppliedBody {
  status: string;
  graph_hash: string;
  normalised_graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
}

/** POST the graph with a no-op patch and return the full `applied` body. */
async function apply(graph: unknown): Promise<AppliedBody> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/validate-patch',
    headers: { 'Content-Type': 'application/json' },
    payload: { graph, operations: [] },
  });
  expect(res.statusCode).toBe(200);
  const body = res.json() as AppliedBody;
  expect(body.status).toBe('applied');
  expect(body.graph_hash).toMatch(/^[a-f0-9]{16}$/);
  return body;
}

async function hashOf(graph: unknown): Promise<string> {
  return (await apply(graph)).graph_hash;
}

/**
 * The edge under test is addressed by its (from, to) IDENTITY everywhere below,
 * never by a value predicate — `price -> revenue` is unique in every fixture
 * here and `margin -> revenue` exists precisely so a value-matching assertion
 * would have a second candidate to land on.
 */
const MARKED_FROM = 'price';
const MARKED_TO = 'revenue';

function findEdge(edges: Record<string, unknown>[], from: string, to: string) {
  const hit = edges.filter((e) => e.from === from && e.to === to);
  expect(hit).toHaveLength(1);
  return hit[0];
}

/** Base graph with NO producer claims on any edge. */
function bareGraph() {
  return {
    nodes: [
      { id: 'price', kind: 'factor', label: 'Price' },
      { id: 'margin', kind: 'factor', label: 'Margin' },
      { id: 'revenue', kind: 'goal', label: 'Revenue' },
    ],
    edges: [
      { from: 'price', to: 'revenue', exists_probability: 0.9, strength: { mean: 0.5, std: 0.2 } },
      { from: 'margin', to: 'revenue', exists_probability: 0.9, strength: { mean: 0.5, std: 0.2 } },
    ],
  };
}

/** The same graph with producer claims attached to `price -> revenue` only. */
function markedGraph(claims: Record<string, unknown>) {
  const g = bareGraph();
  Object.assign(g.edges[0], claims);
  return g;
}

/**
 * CEE's `transformEdgeToV3` provenance object, key `reasoning` (renamed from
 * the enricher's `quote`), `source` remapped into the V3 enum.
 */
const PROV_SOURCE = 'cee_hypothesis';
const PROV_REASONING = 'Brief extraction: "margin pressure from supplier costs"';

/** Built source-first. */
function provenanceSourceFirst(): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  p.source = PROV_SOURCE;
  p.reasoning = PROV_REASONING;
  return p;
}

/** The SAME logical object, built reasoning-first. */
function provenanceReasoningFirst(): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  p.reasoning = PROV_REASONING;
  p.source = PROV_SOURCE;
  return p;
}

// ===========================================================================
// The three vectors the review reproduced
// ===========================================================================

describe('graph_hash is blind to the producer-claim passthrough fields', () => {
  it('V1 — marker PRESENCE does not move the hash, and the markers really did arrive', async () => {
    const marked = await apply(
      markedGraph({
        defaulted: true,
        origin: 'enrichment',
        provenance: provenanceSourceFirst(),
      })
    );
    const bare = await hashOf(bareGraph());

    // ⚠ PRECONDITION PIN. Without this the equality below would also hold if
    // the normaliser had silently gone back to deleting the claims — i.e. the
    // test would pass by testing nothing (trap 13b). Bind by (from, to)
    // identity, not by a value another edge could satisfy.
    const edge = findEdge(marked.normalised_graph.edges, MARKED_FROM, MARKED_TO);
    expect(edge.defaulted).toBe(true);
    expect(edge.origin).toBe('enrichment');
    expect(edge.provenance).toEqual({ source: PROV_SOURCE, reasoning: PROV_REASONING });
    // ...and the unmarked sibling stayed unmarked, so the claims are bound to
    // one edge rather than stamped across the batch.
    const sibling = findEdge(marked.normalised_graph.edges, 'margin', MARKED_TO);
    expect('defaulted' in sibling).toBe(false);

    expect(marked.graph_hash).toBe(bare);
  });

  it('V2 — provenance KEY ORDER does not move the hash', async () => {
    const a = provenanceSourceFirst();
    const b = provenanceReasoningFirst();

    // ⚠ PRECONDITION PIN, and the whole point of this vector: the two objects
    // are logically identical and serialise DIFFERENTLY. If a later edit made
    // them serialise the same, this test would still pass while proving
    // nothing — so the discrimination is asserted, not assumed.
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));

    const hashA = await hashOf(markedGraph({ defaulted: true, provenance: a }));
    const hashB = await hashOf(markedGraph({ defaulted: true, provenance: b }));

    expect(hashA).toBe(hashB);
  });

  it('V3 — rewording the free-text provenance.reasoning does not move the hash', async () => {
    const original = { source: PROV_SOURCE, reasoning: PROV_REASONING };
    const reworded = { source: PROV_SOURCE, reasoning: 'Supplier costs are squeezing the margin.' };
    expect(original.reasoning).not.toBe(reworded.reasoning);

    const hashA = await hashOf(markedGraph({ provenance: original }));
    const hashB = await hashOf(markedGraph({ provenance: reworded }));

    expect(hashA).toBe(hashB);
  });

  it('a DIFFERENT origin value does not move the hash', async () => {
    const a = await hashOf(markedGraph({ origin: 'enrichment' }));
    const b = await hashOf(markedGraph({ origin: 'repair' }));
    expect(a).toBe(b);
    expect(a).toBe(await hashOf(bareGraph()));
  });

  it('defaulted:false — an explicit not-defaulted claim — does not move the hash either', async () => {
    const marked = await apply(markedGraph({ defaulted: false }));
    // Precondition: `false` is a claim, not absence, and it did arrive.
    const edge = findEdge(marked.normalised_graph.edges, MARKED_FROM, MARKED_TO);
    expect(edge.defaulted).toBe(false);
    expect(marked.graph_hash).toBe(await hashOf(bareGraph()));
  });
});

// ===========================================================================
// The value classes `provenance` admits that the corpus would otherwise omit.
// `EdgeProvenanceClaim` carries `[key: string]: unknown` and CEE declares it
// `.passthrough()`, so the shapes it can carry are NOT limited to the two the
// producers are known to send. `null` and array inputs additionally exercise
// the two `normaliseEdge` guards that had zero coverage before this file.
// ===========================================================================

describe('graph_hash over the value classes provenance admits', () => {
  it('a NESTED object and an UNKNOWN key inside provenance do not move the hash', async () => {
    const hash = await hashOf(
      markedGraph({
        provenance: {
          source: PROV_SOURCE,
          reasoning: PROV_REASONING,
          confidence: { score: 0.4, basis: 'hypothesis' },
          extracted_at: '2026-09-10T00:00:00Z',
        },
      })
    );
    expect(hash).toBe(await hashOf(bareGraph()));
  });

  it('provenance:null is dropped by the normaliser and does not move the hash', async () => {
    const marked = await apply(markedGraph({ provenance: null }));
    const edge = findEdge(marked.normalised_graph.edges, MARKED_FROM, MARKED_TO);
    expect('provenance' in edge).toBe(false);
    expect(marked.graph_hash).toBe(await hashOf(bareGraph()));
  });

  it('an ARRAY provenance is dropped by the normaliser and does not move the hash', async () => {
    const marked = await apply(markedGraph({ provenance: [{ source: PROV_SOURCE }] }));
    const edge = findEdge(marked.normalised_graph.edges, MARKED_FROM, MARKED_TO);
    expect('provenance' in edge).toBe(false);
    expect(marked.graph_hash).toBe(await hashOf(bareGraph()));
  });
});

// ===========================================================================
// The second door: the allowlist must not be so narrow that the hash stops
// describing the graph. Reduce HASHED_EDGE_FIELDS to ['from','to'] and every
// test in this block REDs.
// ===========================================================================

describe('graph_hash still discriminates the graph it names', () => {
  it('a change to edge strength.mean moves the hash', async () => {
    const g = bareGraph();
    g.edges[0].strength = { mean: 0.9, std: 0.2 };
    expect(await hashOf(g)).not.toBe(await hashOf(bareGraph()));
  });

  it('a change to edge exists_probability moves the hash', async () => {
    const g = bareGraph();
    g.edges[0].exists_probability = 0.4;
    expect(await hashOf(g)).not.toBe(await hashOf(bareGraph()));
  });

  it('a change to an edge label moves the hash', async () => {
    const withLabel = markedGraph({ label: 'drives' });
    expect(await hashOf(withLabel)).not.toBe(await hashOf(bareGraph()));
  });

  it('a change to a node label moves the hash', async () => {
    const g = bareGraph();
    g.nodes[0].label = 'Unit price';
    expect(await hashOf(g)).not.toBe(await hashOf(bareGraph()));
  });

  it('adding an edge moves the hash', async () => {
    const g = bareGraph();
    g.edges.push({ from: 'price', to: 'margin', exists_probability: 0.7, strength: { mean: 0.2, std: 0.1 } });
    expect(await hashOf(g)).not.toBe(await hashOf(bareGraph()));
  });

  it('the same graph submitted twice still hashes identically', async () => {
    expect(await hashOf(bareGraph())).toBe(await hashOf(bareGraph()));
  });
});

// ===========================================================================
// The allowlists are HAND-WRITTEN. This is the fail-loud drift guard that
// makes them safe: the CLASSIFICATION is remembered, but the COMPLETENESS is
// derived from the contract type declarations themselves, so a new field on
// EngineNodeV3 / EngineEdgeV3 REDs here until someone decides whether the hash
// should see it. Same shape as tests/util/structural-keys-drift.test.ts and as
// the ingress/egress agreement pin in
// tests/observed-state-provenance-ingress.test.ts.
// ===========================================================================

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE_V3_PATH = join(HERE, '..', 'src', 'types', 'engine-v3.ts');

/** Every property name declared DIRECTLY on the named top-level interface. */
function declaredFieldsOf(interfaceName: string): string[] {
  const text = readFileSync(ENGINE_V3_PATH, 'utf8');
  const sf = ts.createSourceFile(ENGINE_V3_PATH, text, ts.ScriptTarget.Latest, true);
  const decl = sf.statements.find(
    (s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === interfaceName
  );
  if (!decl) throw new Error(`${interfaceName} not found in ${ENGINE_V3_PATH}`);
  return decl.members
    .filter(ts.isPropertySignature)
    .map((m) => m.name.getText(sf).replace(/^['"]|['"]$/g, ''))
    .filter((n) => !n.startsWith('['))
    .sort();
}

describe('the graph_hash allowlists are complete against the contract types', () => {
  it('the extraction is not blind — it finds the fields both interfaces are known to declare', () => {
    // Positive control. An AST walk that silently matched nothing would make
    // every classification assertion below vacuous.
    expect(declaredFieldsOf('EngineEdgeV3')).toEqual(
      expect.arrayContaining(['from', 'to', 'strength', 'exists_probability'])
    );
    expect(declaredFieldsOf('EngineNodeV3')).toEqual(expect.arrayContaining(['id', 'kind', 'label']));
  });

  it('every declared EngineEdgeV3 field is classified exactly once — hashed or excluded', () => {
    const declared = declaredFieldsOf('EngineEdgeV3');
    const hashed = [...HASHED_EDGE_FIELDS] as string[];
    const excluded = [...HASH_EXCLUDED_EDGE_FIELDS] as string[];
    expect(hashed.filter((f) => excluded.includes(f))).toEqual([]);
    expect([...hashed, ...excluded].sort()).toEqual(declared);
  });

  it('every declared EngineNodeV3 field is classified exactly once — hashed or excluded', () => {
    const declared = declaredFieldsOf('EngineNodeV3');
    const hashed = [...HASHED_NODE_FIELDS] as string[];
    const excluded = [...HASH_EXCLUDED_NODE_FIELDS] as string[];
    expect(hashed.filter((f) => excluded.includes(f))).toEqual([]);
    expect([...hashed, ...excluded].sort()).toEqual(declared);
  });

  it('the three producer claims are the excluded edge set, named', () => {
    expect([...HASH_EXCLUDED_EDGE_FIELDS].sort()).toEqual(['defaulted', 'origin', 'provenance']);
  });
});
