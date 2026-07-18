/**
 * A3 remediation item 8 (2026-07-18) — env-configurable 1-in-N sampling for the
 * producer-side enrichment egress guard. Every request outside production; 1-in-N
 * in production; `ENRICHMENT_GUARD_SAMPLE_N` overrides. A deterministic envelope
 * break still surfaces within N (round-robin, not random).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldAssessEnrichmentContract,
  resolveEnrichmentGuardSampleN,
  __resetEnrichmentGuardSampler,
  DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD,
} from '../src/routes/v2/enrichment-egress-guard.js';

const ENV = 'ENRICHMENT_GUARD_SAMPLE_N';
let savedNodeEnv: string | undefined;

beforeEach(() => {
  savedNodeEnv = process.env.NODE_ENV;
  delete process.env[ENV];
  __resetEnrichmentGuardSampler();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  delete process.env[ENV];
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  __resetEnrichmentGuardSampler();
  vi.restoreAllMocks();
});

function sequence(n: number): boolean[] {
  return Array.from({ length: n }, () => shouldAssessEnrichmentContract());
}

describe('item 8 — enrichment guard sampling', () => {
  it('default outside production: assess EVERY request (N = 1)', () => {
    process.env.NODE_ENV = 'test';
    expect(resolveEnrichmentGuardSampleN()).toBe(1);
    expect(sequence(5)).toEqual([true, true, true, true, true]);
  });

  it('default in production: 1-in-N (N = DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD)', () => {
    process.env.NODE_ENV = 'production';
    expect(resolveEnrichmentGuardSampleN()).toBe(DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD);
    const seq = sequence(DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD * 2);
    // Exactly one assessment per window of N, at the window start.
    expect(seq.filter(Boolean)).toHaveLength(2);
    expect(seq[0]).toBe(true);
    expect(seq[DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD]).toBe(true);
  });

  it('ENRICHMENT_GUARD_SAMPLE_N overrides — deterministic 1-in-3 round-robin', () => {
    process.env.NODE_ENV = 'production';
    process.env[ENV] = '3';
    expect(resolveEnrichmentGuardSampleN()).toBe(3);
    // Round-robin: request 1, 4, 7 assessed — a deterministic break surfaces within 3.
    expect(sequence(7)).toEqual([true, false, false, true, false, false, true]);
  });

  it('ENRICHMENT_GUARD_SAMPLE_N=1 forces every-request even in production', () => {
    process.env.NODE_ENV = 'production';
    process.env[ENV] = '1';
    expect(sequence(4)).toEqual([true, true, true, true]);
  });

  it('malformed ENRICHMENT_GUARD_SAMPLE_N falls back to the env default (never misparsed)', () => {
    process.env.NODE_ENV = 'production';
    for (const bad of ['', '3.5', '1_0', '10abc', '-2', '0']) {
      process.env[ENV] = bad;
      expect(resolveEnrichmentGuardSampleN()).toBe(DEFAULT_ENRICHMENT_GUARD_SAMPLE_N_PROD);
    }
  });
});
