import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { SERVICE_VERSION } from './helpers/version.js';
import { sha256Stable } from '../src/util/canonical-json.js';

function baseDoc() {
  return {
    schema: 'run.v1',
    meta: { seed: 42, commit: 'dev', version: SERVICE_VERSION },
    graph: {
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' }
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' }
      ]
    },
    results: {
      conservative: { outcome: 1.0 },
      most_likely: { outcome: 1.1 },
      optimistic: { outcome: 1.2 }
    },
    model_card: {
      seed: 42,
      assumptions_summary: ['lin', 'iid'],
      compute_budget: { k_samples: 1000, downgraded: false },
      flags_on: ['TEST_ROUTES'],
      determinism_note: 'stable'
    },
    confidence: { level: 'HIGH', reason: 'DEMO', score: 0.99, factors: {} },
    explain_delta: { top_drivers: [], summary: 'none' }
  } as any;
}

// Utility to reorder object keys at top-level and for model_card
function reorderKeys<T extends Record<string, any>>(obj: T, order: string[]): T {
  const out: any = {};
  for (const k of order) if (k in obj) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = (obj as any)[k];
  return out as T;
}

describe('normaliser fuzz (100 trials)', () => {
  it('hash remains stable under benign permutations', () => {
    const doc = baseDoc();
    const baseline = sha256Stable(doc);

    fc.assert(
      fc.property(
        // Generate permutations of key orders only (array permutations are semantic)
        fc.array(fc.constantFrom('schema','meta','graph','results','model_card','confidence','explain_delta'), { minLength: 3, maxLength: 7 }),
        (topOrder) => {
          const mutated: any = { ...doc };
          mutated.model_card = reorderKeys(mutated.model_card, ['determinism_note','flags_on','compute_budget','assumptions_summary','seed']);
          const reordered = reorderKeys(mutated, topOrder as string[]);
          const h = sha256Stable(reordered);
          expect(h).toBe(baseline);
        }
      ),
      { numRuns: 100 }
    );
  });
});
