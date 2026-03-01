/**
 * DSK Canonical Hashing
 *
 * Computes a deterministic SHA-256 hash from a DSK bundle using the
 * shared canonicalisation logic. The hash covers `version` + `objects`
 * only — `generated_at` and `dsk_version_hash` are excluded.
 */

import { createHash } from 'node:crypto';
import { canonicalise } from './canonicalise.js';
import type { DSKBundle } from './types.js';

/**
 * Compute the canonical SHA-256 hash of a DSK bundle.
 * Returns a lowercase hex-encoded string.
 */
export function computeDSKHash(bundle: DSKBundle): string {
  const canonical = canonicalise(bundle);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Verify that the stored `dsk_version_hash` matches the computed hash.
 */
export function verifyDSKHash(bundle: DSKBundle): boolean {
  return bundle.dsk_version_hash === computeDSKHash(bundle);
}
