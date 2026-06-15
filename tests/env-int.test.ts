/**
 * Track S — strict, bounded integer env parsing (parseBoundedIntEnv).
 *
 * Guards against the parseInt foot-guns that would let a malformed ops env value
 * silently set a garbage Monte Carlo sample depth and bypass the /v2/run bound.
 */

import { describe, it, expect } from 'vitest';
import { parseBoundedIntEnv, MIN_N_SAMPLES, MAX_N_SAMPLES } from '../src/config/env-int.js';

const within = (raw: string | undefined) => parseBoundedIntEnv(raw, MIN_N_SAMPLES, MAX_N_SAMPLES);

describe('parseBoundedIntEnv', () => {
  it('accepts a plain in-bounds integer (with surrounding whitespace)', () => {
    expect(within('1000')).toBe(1000);
    expect(within('4000')).toBe(4000);
    expect(within('  2000  ')).toBe(2000);
    expect(within('100')).toBe(MIN_N_SAMPLES);
    expect(within('10000')).toBe(MAX_N_SAMPLES);
  });

  it('rejects malformed numeric-prefix / separator values (the parseInt foot-guns)', () => {
    // parseInt would return 1, 4, and 1000 respectively — all unsafe.
    expect(within('1,000')).toBeNull();
    expect(within('4_000')).toBeNull();
    expect(within('1000abc')).toBeNull();
  });

  it('rejects empty, non-numeric, fractional, signed, and scientific forms', () => {
    expect(within(undefined)).toBeNull();
    expect(within('')).toBeNull();
    expect(within('   ')).toBeNull();
    expect(within('oops')).toBeNull();
    expect(within('1.5')).toBeNull();
    expect(within('-500')).toBeNull();
    expect(within('+1000')).toBeNull();
    expect(within('1e3')).toBeNull();
  });

  it('rejects out-of-bounds positives (cannot bypass the 100..10000 guard)', () => {
    expect(within('99')).toBeNull();
    expect(within('0')).toBeNull();
    expect(within('10001')).toBeNull();
    expect(within('50000')).toBeNull();
  });

  it('honours custom bounds', () => {
    expect(parseBoundedIntEnv('5', 1, 10)).toBe(5);
    expect(parseBoundedIntEnv('11', 1, 10)).toBeNull();
  });
});
