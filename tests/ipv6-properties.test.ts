import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { canonicalizeRemote } from '../src/lib/net.js';

const SEED = Number(process.env.PROPERTY_SEED) || 4242;
const RUNS = 1000;

describe('IPv6 Canonicalization Properties (G2)', () => {
  it('idempotence: f(f(x)) === f(x) for IPv4', () => {
    fc.assert(
      fc.property(fc.ipV4(), (ip) => {
        const once = canonicalizeRemote(ip);
        const twice = canonicalizeRemote(once);
        return once === twice;
      }),
      { seed: SEED, numRuns: RUNS }
    );
  });

  it('idempotence: f(f(x)) === f(x) for IPv6', () => {
    fc.assert(
      fc.property(fc.ipV6(), (ip) => {
        const once = canonicalizeRemote(ip);
        const twice = canonicalizeRemote(once);
        return once === twice;
      }),
      { seed: SEED, numRuns: RUNS }
    );
  });

  it('equivalence: ::ffff:a.b.c.d ≡ a.b.c.d', () => {
    fc.assert(
      fc.property(fc.ipV4(), (ipv4) => {
        const mapped = `::ffff:${ipv4}`;
        const canon4 = canonicalizeRemote(ipv4);
        const canonMapped = canonicalizeRemote(mapped);
        return canon4 === canonMapped;
      }),
      { seed: SEED, numRuns: RUNS }
    );
  });

  it('case insensitivity for IPv6', () => {
    const testCases = [
      ['2001:DB8::1', '2001:db8::1'],
      ['FE80::1', 'fe80::1'],
      ['::FFFF:192.0.2.1', '::ffff:192.0.2.1']
    ];

    for (const [upper, lower] of testCases) {
      expect(canonicalizeRemote(upper)).toBe(canonicalizeRemote(lower));
    }
  });
});
