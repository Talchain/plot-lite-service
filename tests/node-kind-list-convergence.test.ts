/**
 * Node-kind list convergence + narrowing pins.
 *
 * `VALID_NODE_KINDS` was declared three times in this service with three
 * different memberships. PR #344 derived ONE of them (`trust/types.ts`) from the
 * pinned `@talchain/schemas` `NodeKind` enum. This suite settles the other two by
 * DERIVING which are drift and which are a deliberate narrowing, then pins each
 * verdict so the next reader does not "fix" the narrowing.
 *
 * DRIFT (converged here):
 *   `routes/v1/validate-patch.ts` — a hand-written 7-member Set whose own comment
 *   states its intent as "EngineNodeKindV3 values plus 'option' … UI-layer graphs".
 *   `constraint` is a UI-layer kind the pinned contract declares and this service
 *   COMPILES (`normalisation/constraint-compiler.ts`), yet the route answered
 *   HTTP 422 `status:'rejected'` on it. That is a hard failure of a contract-legal
 *   edit, not a warning.
 *
 * DELIBERATE NARROWING (left alone, pinned here):
 *   `normalisation/graph-normaliser.ts` — its 6 members are exactly
 *   `EngineNodeKindV3`, the ENGINE's causal kinds. Widening it to the contract's 8
 *   would suppress the only user-visible signal that a kind is not causally
 *   handled. Its membership is unchanged; only its status as a hand-copy is fixed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { NodeKind as PinnedNodeKindEnum } from '@talchain/schemas';
import { registerValidatePatchRoute } from '../src/routes/v1/validate-patch.js';
import { normaliseNode, normaliseGraph, type NormalisationWarning } from '../src/normalisation/graph-normaliser.js';
import { NON_CAUSAL_NODE_KINDS, ENGINE_CAUSAL_NODE_KINDS } from '../src/types/engine-v3.js';
import { REPAIR_CODES } from '../src/normalisation/repair-codes.js';

let app: FastifyInstance;

beforeAll(async () => {
  process.env.ENABLE_VALIDATE_PATCH = '1';
  app = Fastify();
  await registerValidatePatchRoute(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  delete process.env.ENABLE_VALIDATE_PATCH;
});

function postPatch(body: unknown) {
  return app.inject({
    method: 'POST',
    url: '/v1/validate-patch',
    headers: { 'Content-Type': 'application/json' },
    payload: body,
  });
}

/** add_node carrying `kind`, onto a minimal graph the rest of the pipeline accepts. */
function addNodeWithKind(kind: string) {
  return postPatch({
    graph: { nodes: [{ id: 'goal', kind: 'goal', label: 'Goal' }], edges: [] },
    operations: [{ op: 'add_node', path: 'n1', value: { id: 'n1', kind, label: 'N1' } }],
  });
}

// =============================================================================
// A. THE HARM — a contract-legal kind is hard-rejected by /v1/validate-patch
// =============================================================================

describe('validate-patch: node-kind gate vs the pinned contract', () => {
  it('THE HARM: add_node with kind="constraint" is not rejected', async () => {
    const res = await addNodeWithKind('constraint');

    // Bind by identity, not by a value predicate another failure could satisfy:
    // assert the specific violation code is absent, not merely that some 2xx came back.
    const body = res.json() as { code?: string; violations?: Array<{ code: string; node_id?: string }> };
    expect(
      body.violations?.some((v) => v.code === 'INVALID_NODE_KIND' && v.node_id === 'n1') ?? false
    ).toBe(false);
    expect(body.code).not.toBe('INVALID_NODE_KIND');
    expect(res.statusCode).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // B. DERIVED guard — agreement with the pin, so the two cannot drift again.
  //    Derivation proves AGREEMENT and can never prove the list is RIGHT
  //    (programme trap 12d), which is why corpus C below is not redundant.
  // ---------------------------------------------------------------------------
  it('DERIVED: every kind the pinned @talchain/schemas NodeKind enum declares is accepted', async () => {
    const declared = PinnedNodeKindEnum.options as readonly string[];
    // Guard the guard: a short/empty enum would make this vacuous (trap 13).
    expect(declared.length).toBeGreaterThanOrEqual(8);

    const rejected: string[] = [];
    for (const kind of declared) {
      const res = await addNodeWithKind(kind);
      const body = res.json() as { violations?: Array<{ code: string }> };
      if (body.violations?.some((v) => v.code === 'INVALID_NODE_KIND')) rejected.push(kind);
    }
    expect(rejected).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // C. HAND-WRITTEN negative corpus — NOT derived from the pin, so it can notice
  //    a gate that passes B by accepting everything. The two guards are not
  //    redundant and neither supersedes the other.
  // ---------------------------------------------------------------------------
  it('CORPUS: kinds outside the contract are still rejected (the gate has not been opened)', async () => {
    const outsiders = ['banana', 'chance', 'Goal', 'GOAL', 'constraints', 'node', ' factor'];
    const wronglyAccepted: string[] = [];
    for (const kind of outsiders) {
      const res = await addNodeWithKind(kind);
      const body = res.json() as { violations?: Array<{ code: string }> };
      if (!body.violations?.some((v) => v.code === 'INVALID_NODE_KIND')) wronglyAccepted.push(kind);
    }
    expect(wronglyAccepted).toEqual([]);
  });
});

// =============================================================================
// D. THE REFUTATION — the normaliser does NOT rewrite an unrecognised kind.
//    An unrecognised kind reaching ISL is a real hazard (ISL's NON_INFERENCE_KINDS
//    is {decision, option, constraint} and EVERYTHING ELSE participates in
//    inference), so the warning below is load-bearing and must not be removed.
// =============================================================================

describe('graph-normaliser: the `?? factor` default and what it does NOT cover', () => {
  it('an UNRECOGNISED kind is forwarded UNCHANGED — it is not rewritten to "factor"', () => {
    const warnings: NormalisationWarning[] = [];
    const node = normaliseNode({ id: 'x', kind: 'banana', label: 'X' }, warnings);

    expect(node.kind).toBe('banana');
    expect(node.kind).not.toBe('factor');
    expect(warnings.some((w) => w.code === REPAIR_CODES.UNKNOWN_NODE_KIND)).toBe(true);
  });

  it('the "factor" default applies ONLY to a node with NO kind on any accepted path', () => {
    const warnings: NormalisationWarning[] = [];
    const node = normaliseNode({ id: 'y', label: 'Y' }, warnings);
    expect(node.kind).toBe('factor');

    // …and it does not fire when the kind arrives via the React Flow data bag.
    const nested = normaliseNode({ id: 'z', label: 'Z', data: { kind: 'outcome' } }, []);
    expect(nested.kind).toBe('outcome');
  });

  it('the deliberate narrowing is 6 causal kinds + 2 non-causal — constraint is NOT recognised, by design', () => {
    // Non-causal set is PLoT's mirror of ISL's NON_INFERENCE_KINDS, which carries
    // THREE members ({decision, option, constraint}). PLoT's carries two. That
    // divergence is a rowed, quarantined gap (tests/v2-option-filter.test.ts has a
    // skipped "removes constraint nodes" fixture) — pinned here so it stays visible.
    expect([...NON_CAUSAL_NODE_KINDS].sort()).toEqual(['decision', 'option']);

    const warnings: NormalisationWarning[] = [];
    normaliseGraph({ nodes: [{ id: 'c1', kind: 'constraint', label: 'C' }], edges: [] });
    normaliseNode({ id: 'c1', kind: 'constraint', label: 'C' }, warnings);
    expect(warnings.some((w) => w.code === REPAIR_CODES.UNKNOWN_NODE_KIND)).toBe(true);
  });
});

// =============================================================================
// E. THE NARROWING, PINNED — so the next reader does not "converge" it.
// =============================================================================

describe('ENGINE_CAUSAL_NODE_KINDS: the deliberate narrowing', () => {
  it('is exactly the six CAUSAL kinds — deliberately NOT the pinned contract enum', () => {
    expect([...ENGINE_CAUSAL_NODE_KINDS].sort()).toEqual(
      ['action', 'decision', 'factor', 'goal', 'outcome', 'risk']
    );
    // The contract is WIDER, and that difference is the point of this pin.
    expect(ENGINE_CAUSAL_NODE_KINDS.length).toBeLessThan(PinnedNodeKindEnum.options.length);
  });

  it('accounts for EVERY contract kind it excludes — no kind is merely forgotten', () => {
    const causal = new Set<string>(ENGINE_CAUSAL_NODE_KINDS);
    const nonCausal = new Set<string>(NON_CAUSAL_NODE_KINDS);
    // `constraint` is excluded from BOTH, on purpose: it is neither analysed as a
    // causal node nor filtered here — it is COMPILED into goal_constraints.
    const compiled = new Set<string>(['constraint']);

    const unaccounted = (PinnedNodeKindEnum.options as readonly string[]).filter(
      (k) => !causal.has(k) && !nonCausal.has(k) && !compiled.has(k)
    );
    expect(unaccounted).toEqual([]);
  });

  it('the normaliser recognises causal ∪ non-causal, and nothing wider', () => {
    const recognised = (kind: string): boolean => {
      const warnings: NormalisationWarning[] = [];
      normaliseNode({ id: 'n', kind, label: 'N' }, warnings);
      return !warnings.some((w) => w.code === REPAIR_CODES.UNKNOWN_NODE_KIND);
    };
    const expected = new Set<string>([...ENGINE_CAUSAL_NODE_KINDS, ...NON_CAUSAL_NODE_KINDS]);

    for (const kind of PinnedNodeKindEnum.options as readonly string[]) {
      expect({ kind, recognised: recognised(kind) }).toEqual({ kind, recognised: expected.has(kind) });
    }
    // Positive control: the probe can observe a TRUE as well as a FALSE, so an
    // always-false predicate cannot fake this table (trap 13).
    expect(recognised('factor')).toBe(true);
    expect(recognised('banana')).toBe(false);
  });
});
