/**
 * Producer-side confidence_tier reconciliation (Lane 2, item D).
 *
 * confidence_tier is PLoT-assembled enrichment derived from M1 coaching
 * readiness. A response must never claim 'strong' while its OWN robustness
 * assessment says is_robust=false or level low/very_low — the live capture
 * (tests/fixtures/isl-v2-live-20260706) is exactly such a response
 * (is_robust=false, level='low').
 */

import { describe, it, expect } from 'vitest';
import {
  deriveConfidenceTier,
  reconcileConfidenceTier,
} from '../src/trust/confidence-tier.js';

describe('reconcileConfidenceTier', () => {
  it("caps 'strong' to 'fair' when is_robust === false", () => {
    expect(reconcileConfidenceTier('strong', { is_robust: false })).toBe('fair');
  });

  it("caps 'strong' to 'fair' when level === 'low'", () => {
    expect(reconcileConfidenceTier('strong', { level: 'low' })).toBe('fair');
  });

  it("caps 'strong' to 'fair' when level === 'very_low'", () => {
    expect(reconcileConfidenceTier('strong', { level: 'very_low' })).toBe('fair');
  });

  it('caps on the live-capture combination (is_robust=false AND level=low)', () => {
    expect(reconcileConfidenceTier('strong', { is_robust: false, level: 'low' })).toBe('fair');
  });

  it("leaves 'strong' when robustness agrees (is_robust=true, level high/medium)", () => {
    expect(reconcileConfidenceTier('strong', { is_robust: true, level: 'high' })).toBe('strong');
    expect(reconcileConfidenceTier('strong', { is_robust: true, level: 'medium' })).toBe('strong');
  });

  it("leaves 'strong' when robustness signals are absent (absence is not contradiction)", () => {
    expect(reconcileConfidenceTier('strong', undefined)).toBe('strong');
    expect(reconcileConfidenceTier('strong', null)).toBe('strong');
    expect(reconcileConfidenceTier('strong', {})).toBe('strong');
  });

  it('never raises a lower tier, regardless of robustness', () => {
    expect(reconcileConfidenceTier('fair', { is_robust: true, level: 'high' })).toBe('fair');
    expect(reconcileConfidenceTier('needs_work', { is_robust: true, level: 'high' })).toBe('needs_work');
    expect(reconcileConfidenceTier('fair', { is_robust: false })).toBe('fair');
    expect(reconcileConfidenceTier('needs_work', { level: 'low' })).toBe('needs_work');
  });

  it("composes with deriveConfidenceTier: readiness 'ready' + fragile robustness → 'fair'", () => {
    const tier = deriveConfidenceTier('ready');
    expect(tier).toBe('strong');
    expect(reconcileConfidenceTier(tier, { is_robust: false, level: 'low' })).toBe('fair');
  });
});
