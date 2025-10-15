import { describe, it, expect } from 'vitest';
import { canonicalizeRemote } from '../src/lib/net.js';

describe('IPv6 Canonicalization (C2)', () => {
  it('maps IPv4-mapped IPv6 to plain IPv4', () => {
    expect(canonicalizeRemote('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(canonicalizeRemote('::ffff:192.168.1.1')).toBe('192.168.1.1');
    expect(canonicalizeRemote('::FFFF:10.0.0.1')).toBe('10.0.0.1');
  });

  it('normalizes compressed IPv6', () => {
    const result1 = canonicalizeRemote('2001:db8::1');
    const result2 = canonicalizeRemote('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(result1).toBe(result2);
    expect(result1).toMatch(/^[0-9a-f:]+$/);
  });

  it('treats localhost forms as same principal', () => {
    const ipv4 = canonicalizeRemote('127.0.0.1');
    const ipv4Mapped = canonicalizeRemote('::ffff:127.0.0.1');
    // Both should be 127.0.0.1
    expect(ipv4).toBe('127.0.0.1');
    expect(ipv4Mapped).toBe('127.0.0.1');
  });

  it('handles invalid addresses gracefully', () => {
    expect(canonicalizeRemote('not-an-ip')).toBe('not-an-ip');
    expect(canonicalizeRemote('')).toBe('unknown');
    expect(canonicalizeRemote('  ')).toBe('');
  });

  it('normalizes mixed case', () => {
    const result = canonicalizeRemote('2001:DB8::CAFE:BEEF');
    expect(result).toMatch(/^[0-9a-f:]+$/); // lowercase
  });
});
