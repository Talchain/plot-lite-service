/**
 * Minimal test for CEE_PROXY_TIMEOUT_MS default value.
 *
 * Ensures the default (when env var is unset) matches the expected
 * timeout chain: CEE LLM (105s) < CEE budget (120s) < PLoT proxy (135s).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

describe('CEE_PROXY_TIMEOUT_MS default', () => {
  let savedEnv: string | undefined;

  beforeAll(() => {
    // Capture and clear any existing env override
    savedEnv = process.env.CEE_PROXY_TIMEOUT_MS;
    delete process.env.CEE_PROXY_TIMEOUT_MS;
  });

  afterAll(() => {
    // Restore original env
    if (savedEnv !== undefined) {
      process.env.CEE_PROXY_TIMEOUT_MS = savedEnv;
    }
  });

  it('defaults to 135000ms when env var is unset', async () => {
    // Reset module registry so the dynamic import re-evaluates the env var
    vi.resetModules();
    const mod = await import('../src/config/timeouts.js');
    expect(mod.CEE_PROXY_TIMEOUT_MS).toBe(135_000);
  });
});
