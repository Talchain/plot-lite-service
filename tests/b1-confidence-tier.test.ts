/**
 * B1 — Confidence tier classification tests.
 * Maps M1 coaching readiness to UI vocabulary:
 *   ready → 'strong', close_call → 'fair',
 *   needs_evidence | needs_framing → 'needs_work'
 */

import { describe, it, expect } from 'vitest';
import { deriveConfidenceTier } from '../src/trust/confidence-tier.js';

describe('deriveConfidenceTier', () => {
  it('maps ready → strong', () => {
    expect(deriveConfidenceTier('ready')).toBe('strong');
  });

  it('maps close_call → fair', () => {
    expect(deriveConfidenceTier('close_call')).toBe('fair');
  });

  it('maps needs_evidence → needs_work', () => {
    expect(deriveConfidenceTier('needs_evidence')).toBe('needs_work');
  });

  it('maps needs_framing → needs_work', () => {
    expect(deriveConfidenceTier('needs_framing')).toBe('needs_work');
  });

  it('returns a valid tier for every Readiness value', () => {
    const validTiers = new Set(['strong', 'fair', 'needs_work']);
    for (const readiness of ['ready', 'close_call', 'needs_evidence', 'needs_framing'] as const) {
      expect(validTiers.has(deriveConfidenceTier(readiness))).toBe(true);
    }
  });
});
