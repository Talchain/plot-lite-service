import { describe, it, expect, vi } from 'vitest';
import { containsSensitiveSafe } from '../src/lib/sensitive-safe.js';
import * as sensitive from '../src/lib/sensitive.js';

describe('Sensitive-content guard (fail closed)', () => {
  it('blocks when scanner detects sensitive content', () => {
    const result = containsSensitiveSafe({ password: 'secret123' });
    expect(result.blocked).toBe(true);
    expect(result.scannerError).toBe(false);
  });

  it('allows when scanner finds no sensitive content', () => {
    const result = containsSensitiveSafe({ data: 'normal content' });
    expect(result.blocked).toBe(false);
    expect(result.scannerError).toBe(false);
  });

  it('blocks when scanner throws error (fail closed)', () => {
    vi.spyOn(sensitive, 'containsSensitive').mockImplementation(() => {
      throw new Error('Scanner crashed');
    });

    const result = containsSensitiveSafe({ test: 'data' });
    
    expect(result.blocked).toBe(true);
    expect(result.scannerError).toBe(true);
    expect(result.error).toContain('Scanner');

    vi.restoreAllMocks();
  });

  it('returns error details on scanner failure', () => {
    vi.spyOn(sensitive, 'containsSensitive').mockImplementation(() => {
      throw new Error('Out of memory');
    });

    const result = containsSensitiveSafe({ test: 'data' });
    
    expect(result.error).toBe('Out of memory');

    vi.restoreAllMocks();
  });

  it('handles scanner returning non-boolean', () => {
    vi.spyOn(sensitive, 'containsSensitive').mockImplementation(() => {
      return 'invalid' as any;
    });

    const result = containsSensitiveSafe({ test: 'data' });
    
    // Should treat truthy as blocked (JavaScript truthiness)
    expect(result.blocked).toBeTruthy();

    vi.restoreAllMocks();
  });
});
