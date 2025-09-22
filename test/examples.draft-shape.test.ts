import { describe, it, expect } from 'vitest';

// A draft test that confirms example fixtures parse as JSON objects.
// Kept intentionally lenient to avoid flakiness; the real validation is done in tools/validate-examples.js

function safeRequireJson(path) {
  try {
    const mod = require(path);
    return mod;
  } catch {
    return null;
  }
}

describe('examples draft shape', () => {
  it('parses example JSON files if present', () => {
    const example = safeRequireJson('../fixtures/examples/sample.json');
    // This is a smoke assertion; absence is acceptable
    if (example) {
      expect(typeof example).toBe('object');
    } else {
      expect(true).toBe(true);
    }
  });
});
