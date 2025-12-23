import { createHash } from 'crypto';

type JSONPrimitive = string | number | boolean | null;
type JSONValue = JSONPrimitive | JSONObject | JSONArray;
interface JSONObject { [key: string]: JSONValue }
interface JSONArray extends Array<JSONValue> {}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function canonicalise(value: JSONValue): JSONValue {
  if (Array.isArray(value)) {
    // P1: Filter out undefined values from arrays to match documented behavior
    return value
      .filter((v) => v !== undefined)
      .map((v) => canonicalise(v)) as JSONArray;
  }
  if (isPlainObject(value)) {
    const out: JSONObject = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      // P1: Skip undefined values in objects (already implicit in JSON.stringify, but explicit here)
      if (v !== undefined) {
        out[k] = canonicalise(v as JSONValue);
      }
    }
    return out;
  }
  return value as JSONPrimitive;
}

export function canonicalStringify(input: unknown): string {
  const prepared = canonicalise(input as JSONValue);
  return JSON.stringify(prepared);
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Compute a 12-character response hash from an object.
 * Used for x-olumi-response-hash and x-olumi-payload-hash headers.
 *
 * Canonical form: sort keys recursively, skip undefined values (in both arrays and objects).
 * Hash: SHA-256 hex, first 12 chars.
 *
 * Test vectors:
 * - { z: 1, a: 2, m: 3 } → "ebba85cfdc0a"
 * - { outer: { z: 1, a: 2 }, name: "test" } → "08b91d33cd40"
 * - { items: [undefined, 1, 2] } → same as { items: [1, 2] }
 */
export function computeOlumiHash(body: unknown): string {
  const canonical = canonicalStringify(body);
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 12);
}