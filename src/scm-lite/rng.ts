/**
 * Deterministic Seeded RNG (xorshift128+)
 */
import type { SeededRNG } from './types.js';

export class XorShift128Plus implements SeededRNG {
  private s0: bigint;
  private s1: bigint;

  constructor(seed: number) {
    const splitmix = (s: bigint): bigint => {
      s = (s + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
      s = ((s ^ (s >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
      s = ((s ^ (s >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
      return (s ^ (s >> 31n)) & 0xffffffffffffffffn;
    };
    const state = BigInt(seed >>> 0);
    this.s0 = splitmix(state);
    this.s1 = splitmix(state + 1n);
  }

  next(): number {
    let x = this.s0;
    const y = this.s1;
    this.s0 = y;
    x ^= (x << 23n) & 0xffffffffffffffffn;
    x ^= x >> 17n;
    x ^= y ^ (y >> 26n);
    this.s1 = x & 0xffffffffffffffffn;
    const result = (x + y) & 0xffffffffffffffffn;
    return Number(result & 0x1fffffffffffffn) / 0x20000000000000;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  jump(): void {
    // Advance by 2^64 calls for parallel streams
    const JUMP = [0x8a5cd789635d2dffn, 0x121fd2155c472f96n];
    let s0 = 0n, s1 = 0n;
    for (const j of JUMP) {
      for (let b = 0n; b < 64n; b++) {
        if (j & (1n << b)) {
          s0 ^= this.s0;
          s1 ^= this.s1;
        }
        this.next();
      }
    }
    this.s0 = s0;
    this.s1 = s1;
  }
}
