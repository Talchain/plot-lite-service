/**
 * Node-kind vocabulary fidelity: PLoT vs the PINNED shared contract.
 *
 * WHY THIS EXISTS
 * ---------------
 * `@talchain/schemas` (pinned here at `file:./vendor/talchain-schemas-0.40.0.tgz`)
 * declares `NodeKind` with EIGHT members, `constraint` among them. PLoT's
 * `VALID_NODE_KINDS` carried a hand-written SEVEN, without `constraint`.
 *
 * `src/util/normalize.ts` deletes any `kind` not in that list, on six live v1
 * routes (key-insight, run, run-bundle, suggest-utility-weights, templates,
 * validate). So a contract-legal `constraint` node — CEE mints them, and
 * PLoT's own v2 path has a dedicated constraint compiler — arrived and was
 * silently stripped of its classification.
 *
 * The node is not dropped and not defaulted; it continues through the
 * pipeline UNCLASSIFIED, and every downstream consumer compares `kind` by
 * strict equality, so it silently falls out of every bucket. Five of the six
 * routes emit no warning at all; `/v1/run` emits an OBSERVATION critique
 * calling the kind "invalid" — which is itself false, because the shared
 * contract says it is legal.
 *
 * THE OPPOSITE HARM
 * -----------------
 * Preserving a kind PLoT cannot handle would be worse than dropping it. The
 * fix must widen the vocabulary to EXACTLY the pinned contract and no further
 * — a genuinely unknown kind must still be stripped and still warn. The
 * guards below are written in both directions.
 *
 * The membership assertion is DERIVED from the pinned enum rather than
 * mirroring it, so the two cannot drift apart again; the hand-written cases
 * beneath it exist because a derived guard proves agreement and can never
 * prove the list is RIGHT.
 */

import { describe, it, expect } from 'vitest';
import { NodeKind as PinnedNodeKind } from '@talchain/schemas';
import { normalizeNode, normalizeGraphWithWarnings } from '../src/util/normalize.js';
import { VALID_NODE_KINDS } from '../src/trust/types.js';

describe('node-kind vocabulary is the pinned contract', () => {
  it('VALID_NODE_KINDS matches the pinned @talchain/schemas NodeKind enum exactly', () => {
    // Derived on both sides — fails loud if PLoT drops a member OR invents one.
    expect([...VALID_NODE_KINDS].sort()).toEqual([...PinnedNodeKind.options].sort());
  });

  it('the pinned contract still contains constraint (pins this suite\'s own premise)', () => {
    // If this ever fails, the test above is passing for the wrong reason.
    expect(PinnedNodeKind.options).toContain('constraint');
  });
});

describe('normalizeNode preserves a contract-legal constraint node', () => {
  it('keeps kind="constraint" and raises no warning', () => {
    const { node, warning } = normalizeNode({ id: 'c1', kind: 'constraint' });
    expect(node.id).toBe('c1'); // identity: this is the node under test
    expect(node.kind).toBe('constraint');
    expect(warning).toBeUndefined();
  });

  it('promotes a deprecated type="constraint" to kind', () => {
    const { node, warning } = normalizeNode({ id: 'c2', type: 'constraint' });
    expect(node.id).toBe('c2');
    expect(node.kind).toBe('constraint');
    expect(warning).toBeUndefined();
  });

  it('survives graph normalisation alongside other kinds, with no warnings', () => {
    const { graph, warnings } = normalizeGraphWithWarnings({
      nodes: [
        { id: 'g1', kind: 'goal' },
        { id: 'c1', kind: 'constraint' },
        { id: 'f1', kind: 'factor' },
      ],
      edges: [],
    });
    // Bind by id, never by position or by a value predicate.
    const constraintNode = graph.nodes.find((n: any) => n.id === 'c1');
    expect(constraintNode?.kind).toBe('constraint');
    expect(warnings).toEqual([]);
  });
});

describe('the opposite harm: the vocabulary must not widen past the contract', () => {
  it('still strips a kind the contract does not declare, and still warns', () => {
    const { node, warning } = normalizeNode({ id: 'x1', kind: 'sticky_note' });
    expect(node.id).toBe('x1');
    expect(node.kind).toBeUndefined();
    expect(warning).toContain('Invalid node kind');
    expect(warning).toContain('sticky_note');
  });

  it.each(['constraints', 'Constraint', 'CONSTRAINT', 'constraint '])(
    'does not accept %j as a near-miss for constraint',
    (nearMiss) => {
      const { node, warning } = normalizeNode({ id: 'nm', kind: nearMiss });
      expect(node.kind).toBeUndefined();
      expect(warning).toContain('Invalid node kind');
    }
  );

  it('does not invent a kind for a node that has none', () => {
    const { node, warning } = normalizeNode({ id: 'bare' });
    expect(node.id).toBe('bare');
    expect(node.kind).toBeUndefined();
    expect(warning).toBeUndefined();
  });

  it('keeps every previously-valid kind valid (no regression)', () => {
    for (const kind of ['goal', 'decision', 'option', 'outcome', 'risk', 'action', 'factor']) {
      const { node, warning } = normalizeNode({ id: `n_${kind}`, kind });
      expect(node.kind).toBe(kind);
      expect(warning).toBeUndefined();
    }
  });
});
