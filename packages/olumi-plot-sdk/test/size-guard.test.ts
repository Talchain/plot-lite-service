import { describe, it, expect } from 'vitest';

describe('Size Guard', () => {
  it('uses TextEncoder for size calculation', () => {
    const text = 'Hello, world!';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text).length;
    expect(bytes).toBe(13);
  });

  it('calculates oversized payload correctly', () => {
    const largeText = 'x'.repeat(100 * 1024); // 100 KB
    const encoder = new TextEncoder();
    const kb = encoder.encode(largeText).length / 1024;
    expect(kb).toBeGreaterThan(96);
  });
});
