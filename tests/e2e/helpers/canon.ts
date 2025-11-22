import { sha256Stable, normaliseReport } from '../../../src/util/canonical-json.js';
import { expect } from 'vitest';

export function expectRoundTripHash(body: any): void {
  const expected = sha256Stable(body);
  const actual = body?.model_card?.response_hash;
  expect(actual, 'response_hash should match sha256Stable(body)').toBe(expected);
}

export { sha256Stable, normaliseReport };
