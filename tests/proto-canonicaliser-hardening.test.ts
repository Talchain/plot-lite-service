/**
 * __proto__ canonicaliser hardening — correctness regression suite.
 *
 * PLoT's shared object-canonicalisers accumulated JSON.parse-derived keys into
 * a plain `{}`. An own `__proto__` key (which JSON.parse DOES create as an own
 * enumerable property) hits the inherited `Object.prototype` setter on assign
 * and is silently swallowed, so two semantically-different payloads canonicalise
 * identically and collide to one hash. On the idempotency path
 * (src/util/canonical.ts -> idempotency middleware) that lets one request replay
 * another's cached response. The fix seeds each accumulator with
 * `Object.create(null)`.
 *
 * These tests: (1) prove the collision is gone, (2) prove `__proto__` survives,
 * (3) prove NO DRIFT — benign inputs canonicalise byte-identically to the
 * pre-fix plain-`{}` behaviour, (4) prove no prototype pollution.
 *
 * NOTE: inputs carrying an own `__proto__` key MUST be built with JSON.parse.
 * An object literal `{ __proto__: ... }` sets the prototype, not an own key,
 * and would not reproduce the bug.
 */
import { describe, it, expect } from 'vitest';
import { canonicalStringify, sha256Hex, computeOlumiHash } from '../src/util/canonical.js';
import { stableStringify, sha256Stable } from '../src/util/canonical-json.js';
import { canonicalJson, generateContentHash } from '../src/facts/hash.js';

// Own-__proto__ payloads (JSON.parse so the key is a real own property).
const WITH_PROTO = () => JSON.parse('{"a":1,"__proto__":{"polluted":true},"z":2}');
const WITHOUT_PROTO = () => JSON.parse('{"a":1,"z":2}');
const NESTED_PROTO = () => JSON.parse('{"outer":{"b":1,"__proto__":{"x":9}}}');
const NESTED_PLAIN = () => JSON.parse('{"outer":{"b":1}}');

// Old-style plain-{} canonicaliser: the reference for the "no drift on benign
// inputs" guarantee. For inputs WITHOUT an own __proto__ key this matches the
// pre-fix output exactly, so equality proves the hardening changed nothing for
// existing payloads.
function refCompactCanonical(value: unknown): string {
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.filter((e) => e !== undefined).map(walk);
    if (v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

const BENIGN = [
  { seed: 7, graph: { nodes: [{ id: 'n1', v: 2 }], edges: [] }, options: ['a', 'b'] },
  { z: 1, a: 2, m: { y: 1, x: 2 } },
  { nested: [{ c: 3, b: 2, a: 1 }], flag: true, count: 0, name: 'olumi' },
  {},
  { onlyKey: null },
];

describe('src/util/canonical.ts — canonicalStringify (idempotency body-hash path)', () => {
  it('does NOT collide: __proto__-bearing body hashes differently from the same body without it', () => {
    expect(canonicalStringify(WITH_PROTO())).not.toBe(canonicalStringify(WITHOUT_PROTO()));
    expect(sha256Hex(canonicalStringify(WITH_PROTO()))).not.toBe(
      sha256Hex(canonicalStringify(WITHOUT_PROTO())),
    );
  });

  it('preserves an own __proto__ key in the canonical output (top-level and nested)', () => {
    expect(canonicalStringify(WITH_PROTO())).toContain('__proto__');
    expect(canonicalStringify(NESTED_PROTO())).toContain('__proto__');
    expect(canonicalStringify(NESTED_PROTO())).not.toBe(canonicalStringify(NESTED_PLAIN()));
  });

  it('NO DRIFT: benign inputs canonicalise byte-identically to the pre-fix plain-{} behaviour', () => {
    for (const b of BENIGN) {
      expect(canonicalStringify(b)).toBe(refCompactCanonical(b));
    }
  });

  it('pins exact canonical output for a representative benign body', () => {
    expect(canonicalStringify({ z: 2, a: 1, m: { y: 1, x: 2 } })).toBe('{"a":1,"m":{"x":2,"y":1},"z":2}');
  });

  it('computeOlumiHash distinguishes __proto__-bearing bodies', () => {
    expect(computeOlumiHash(WITH_PROTO())).not.toBe(computeOlumiHash(WITHOUT_PROTO()));
  });

  it('does not pollute Object.prototype', () => {
    canonicalStringify(WITH_PROTO());
    canonicalStringify(JSON.parse('{"__proto__":{"polluted":true}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('src/util/canonical-json.ts — stableStringify / sha256Stable (response_hash path)', () => {
  it('does NOT collide on __proto__-bearing objects', () => {
    expect(stableStringify(WITH_PROTO())).not.toBe(stableStringify(WITHOUT_PROTO()));
    expect(sha256Stable(WITH_PROTO())).not.toBe(sha256Stable(WITHOUT_PROTO()));
  });

  it('preserves an own __proto__ key (top-level and nested)', () => {
    expect(stableStringify(WITH_PROTO())).toContain('__proto__');
    expect(stableStringify(NESTED_PROTO())).toContain('__proto__');
  });

  it('NO DRIFT: benign inputs round-trip and stay stable/sorted', () => {
    for (const b of BENIGN) {
      const out = stableStringify(b);
      // Same logical content, deterministically key-sorted, stable across calls.
      expect(JSON.parse(out)).toEqual(b);
      expect(stableStringify(b)).toBe(out);
      // No own __proto__ leaks into a benign payload's output.
      expect(out).not.toContain('__proto__');
    }
  });

  it('does not pollute Object.prototype', () => {
    sha256Stable(WITH_PROTO());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('src/facts/hash.ts — canonicalJson / generateContentHash (fact content-address)', () => {
  it('does NOT collide: two fact payloads differing only by __proto__ get distinct content hashes', () => {
    expect(canonicalJson(WITH_PROTO())).not.toBe(canonicalJson(WITHOUT_PROTO()));
    expect(generateContentHash(WITH_PROTO() as any)).not.toBe(
      generateContentHash(WITHOUT_PROTO() as any),
    );
  });

  it('preserves an own __proto__ key (top-level and nested)', () => {
    expect(canonicalJson(WITH_PROTO())).toContain('__proto__');
    expect(canonicalJson(NESTED_PROTO())).toContain('__proto__');
  });

  it('NO DRIFT: benign inputs canonicalise byte-identically to the pre-fix plain-{} behaviour', () => {
    for (const b of BENIGN) {
      expect(canonicalJson(b)).toBe(refCompactCanonical(b));
    }
  });

  it('does not pollute Object.prototype', () => {
    generateContentHash(WITH_PROTO() as any);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
