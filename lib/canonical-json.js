import { createHash } from 'crypto';
function isPlainObject(value) {
    return (typeof value === 'object' &&
        value !== null &&
        Object.getPrototypeOf(value) === Object.prototype);
}
function canonicalise(value) {
    if (Array.isArray(value)) {
        return value.map((v) => canonicalise(v));
    }
    if (isPlainObject(value)) {
        const out = {};
        const keys = Object.keys(value).sort();
        for (const k of keys) {
            const v = value[k];
            out[k] = canonicalise(v);
        }
        return out;
    }
    return value;
}
export function canonicalStringify(input) {
    // Only handle JSON-serialisable structures reasonably
    const prepared = canonicalise(input);
    return JSON.stringify(prepared);
}
export function sha256Hex(text) {
    return createHash('sha256').update(text).digest('hex');
}
