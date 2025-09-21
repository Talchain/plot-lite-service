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
    return value.map((v) => canonicalise(v)) as JSONArray;
  }
  if (isPlainObject(value)) {
    const out: JSONObject = {};
    const keys = Object.keys(value).sort();
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k] as JSONValue;
      out[k] = canonicalise(v);
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