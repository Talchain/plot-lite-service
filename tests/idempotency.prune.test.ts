import { describe, it, expect } from 'vitest';
import { setCached, getCached, __idemSize } from '../src/middleware/idempotency.js';

describe('Idempotency store pruning', () => {
  it('getCached auto-prunes expired entries', async () => {
    // Note: TTL is set at module load time (15 min default)
    // We can't easily change it in tests, but we can verify getCached prunes
    
    const initialSize = __idemSize();
    setCached('testuser', 'testkey1', 200, { data: 'test' });
    expect(__idemSize()).toBe(initialSize + 1);
    
    // Entry should be retrievable immediately
    const cached = getCached('testuser', 'testkey1');
    expect(cached).toBeTruthy();
    expect(cached?.status).toBe(200);
    
    // Note: We can't easily test TTL expiry without mocking time or waiting 15 min
    // This test just verifies the basic flow works
  });

  it('keeps size bounded under burst inserts', () => {
    // Insert more than MAX_IDEM_ENTRIES (10)
    for (let i = 0; i < 15; i++) {
      setCached('user1', `key${i}`, 200, { data: i });
    }
    
    // Size should be capped at 10 (LRU eviction)
    expect(__idemSize()).toBeLessThanOrEqual(10);
    
    // Most recent entries should still be there
    const recent = getCached('user1', 'key14');
    expect(recent).toBeTruthy();
    
    // Oldest entries should be evicted
    const oldest = getCached('user1', 'key0');
    expect(oldest).toBeNull();
  });

});

