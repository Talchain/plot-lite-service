import { describe, it, expect } from 'vitest';
import { sha256Stable, stampResponseHash } from '../src/util/canonical-json.js';

function baseDoc() {
  return {
    schema: 'run.v1',
    meta: { seed: 42, commit: 'dev', version: '1.0.0' },
    graph: {
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }]
    },
    results: { most_likely: { outcome: 1 } },
    model_card: {
      seed: 42,
      assumptions_summary: ['x'],
      compute_budget: { k_samples: 1000 },
      flags_on: ['DEMO_MODE'],
      determinism_note: 'stable'
    },
    confidence: { level: 'high', reason: 'DEMO', score: 0.99, factors: {} }
  } as any;
}

describe('hash invariants', () => {
  it('stampResponseHash is idempotent', () => {
    const doc1 = stampResponseHash(baseDoc());
    const doc2 = stampResponseHash(doc1);
    expect(doc2.model_card.response_hash).toBe(doc1.model_card.response_hash);
    // Ensure no other fields changed
    const { response_hash, ...mc1 } = doc1.model_card;
    const { response_hash: _, ...mc2 } = doc2.model_card;
    expect(JSON.stringify(mc2)).toBe(JSON.stringify(mc1));
  });

  it('sha256Stable identical when object keys are reordered', () => {
    const a = baseDoc();
    const b = baseDoc();
    // Reorder top-level keys and nested object keys
    const aHash = sha256Stable(a);
    const reordered = {
      model_card: { determinism_note: b.model_card.determinism_note, flags_on: b.model_card.flags_on, compute_budget: b.model_card.compute_budget, assumptions_summary: b.model_card.assumptions_summary, seed: b.model_card.seed },
      results: b.results,
      graph: { edges: b.graph.edges, nodes: b.graph.nodes },
      meta: { version: b.meta.version, commit: b.meta.commit, seed: b.meta.seed },
      schema: b.schema,
      confidence: b.confidence,
    } as any;
    const bHash = sha256Stable(reordered);
    expect(bHash).toBe(aHash);
  });
});
