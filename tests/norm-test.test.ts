import { describe, it, expect } from 'vitest';
import { normaliseReport } from '../src/util/canonical-json.js';

describe('Normalization test', () => {
  it('strips response_hash', () => {
    const report = {
      model_card: {
        seed: 42,
        response_hash: 'should-be-removed',
        bma_hash: 'also-removed'
      }
    };
    
    const norm = normaliseReport(report) as any;
    
    expect(norm.model_card.seed).toBe(42);
    expect('response_hash' in norm.model_card).toBe(false);
    expect('bma_hash' in norm.model_card).toBe(false);
  });
});
