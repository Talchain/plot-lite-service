import { describe, it } from 'vitest';
import { sha256Stable, stampResponseHash } from '../src/util/canonical-json.js';

describe('Hash theory', () => {
  it('test hash values', () => {
    const base = {
      model_card: { seed: 42, foo: 'bar' },
      data: 'test'
    };
    
    // Hash of base (no response_hash)
    const hash1 = sha256Stable(base);
    console.log('\n1. Hash of base (no response_hash):', hash1);
    
    // Stamp response_hash
    const stamped = stampResponseHash(base);
    console.log('2. response_hash added by stamp:', stamped.model_card.response_hash);
    console.log('3. Match with hash1?', hash1 === stamped.model_card.response_hash);
    
    // Hash of stamped (with response_hash)
    const hash2 = sha256Stable(stamped);
    console.log('4. Hash of stamped (should strip response_hash):', hash2);
    console.log('5. Match with hash1?', hash1 === hash2);
  });
});
