/**
 * Tests for the timeout chain ordering invariant.
 *
 * Required chain: FASTIFY_REQUEST_TIMEOUT_MS > CEE_PROXY_TIMEOUT_MS > CEE_DRAFT_GRAPH_TIMEOUT_MS
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

describe('timeout chain validation', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'FASTIFY_REQUEST_TIMEOUT_MS',
    'CEE_PROXY_TIMEOUT_MS',
    'CEE_DRAFT_GRAPH_TIMEOUT_MS',
  ] as const;

  beforeAll(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterAll(() => {
    for (const key of envKeys) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it('defaults satisfy chain: FASTIFY > PROXY > DRAFT_GRAPH', async () => {
    vi.resetModules();
    const mod = await import('../src/config/timeouts.js');
    expect(mod.FASTIFY_REQUEST_TIMEOUT_MS).toBe(180_000);
    expect(mod.CEE_PROXY_TIMEOUT_MS).toBe(135_000);
    expect(mod.CEE_DRAFT_GRAPH_TIMEOUT_MS).toBe(120_000);
    expect(mod.FASTIFY_REQUEST_TIMEOUT_MS).toBeGreaterThan(mod.CEE_PROXY_TIMEOUT_MS);
    expect(mod.CEE_PROXY_TIMEOUT_MS).toBeGreaterThan(mod.CEE_DRAFT_GRAPH_TIMEOUT_MS);
  });

  it('validateTimeoutChain returns true with valid defaults', async () => {
    vi.resetModules();
    const mod = await import('../src/config/timeouts.js');
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(mod.validateTimeoutChain()).toBe(true);
    consoleSpy.mockRestore();
  });

  it('validateTimeoutChain returns false when chain is inverted', async () => {
    // Set proxy timeout above fastify timeout to break the chain
    process.env.FASTIFY_REQUEST_TIMEOUT_MS = '60000';
    process.env.CEE_PROXY_TIMEOUT_MS = '135000';
    process.env.CEE_DRAFT_GRAPH_TIMEOUT_MS = '120000';
    vi.resetModules();

    const mod = await import('../src/config/timeouts.js');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(mod.validateTimeoutChain()).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();

    // Restore for other tests
    delete process.env.FASTIFY_REQUEST_TIMEOUT_MS;
    delete process.env.CEE_PROXY_TIMEOUT_MS;
    delete process.env.CEE_DRAFT_GRAPH_TIMEOUT_MS;
  });
});
