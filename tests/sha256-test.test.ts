import { describe, it, expect } from 'vitest';
import { sha256Stable } from '../src/util/canonical-json.js';

describe('sha256Stable test', () => {
  it('strips response_hash before hashing', () => {
    const report1 = {
      model_card: { seed: 42 }
    };
    
    const report2 = {
      model_card: { seed: 42, response_hash: 'should-be-ignored' }
    };
    
    const hash1 = sha256Stable(report1);
    const hash2 = sha256Stable(report2);
    
    console.log('\nHash without response_hash:', hash1);
    console.log('Hash with response_hash:', hash2);
    console.log('Match?', hash1 === hash2);
    
    expect(hash1).toBe(hash2);
  });
});
