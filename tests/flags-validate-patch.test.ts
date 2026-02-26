/**
 * ENABLE_VALIDATE_PATCH flag auto-enable tests
 *
 * Tests the real FLAGS.ENABLE_VALIDATE_PATCH getter (live ES getter on
 * process.env — not cached, so env mutations are reflected immediately).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { FLAGS } from '../src/config/flags.js';

describe('ENABLE_VALIDATE_PATCH flag', () => {
  const savedEnv: Record<string, string | undefined> = {};

  function saveAndClear(...keys: string[]) {
    for (const key of keys) {
      savedEnv[key] = process.env[key];
    }
  }

  afterEach(() => {
    for (const key of ['ENABLE_VALIDATE_PATCH', 'NODE_ENV', 'RENDER_SERVICE_NAME']) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('defaults to false in production (no env var set)', () => {
    saveAndClear('ENABLE_VALIDATE_PATCH', 'NODE_ENV', 'RENDER_SERVICE_NAME');
    delete process.env.ENABLE_VALIDATE_PATCH;
    process.env.NODE_ENV = 'production';
    delete process.env.RENDER_SERVICE_NAME;
    expect(FLAGS.ENABLE_VALIDATE_PATCH).toBe(false);
  });

  it('auto-enables when RENDER_SERVICE_NAME includes "staging"', () => {
    saveAndClear('ENABLE_VALIDATE_PATCH', 'NODE_ENV', 'RENDER_SERVICE_NAME');
    delete process.env.ENABLE_VALIDATE_PATCH;
    process.env.NODE_ENV = 'production';
    process.env.RENDER_SERVICE_NAME = 'plot-lite-service-staging';
    expect(FLAGS.ENABLE_VALIDATE_PATCH).toBe(true);
  });

  it('explicit ENABLE_VALIDATE_PATCH=false overrides auto-enable on staging', () => {
    saveAndClear('ENABLE_VALIDATE_PATCH', 'NODE_ENV', 'RENDER_SERVICE_NAME');
    process.env.ENABLE_VALIDATE_PATCH = 'false';
    process.env.NODE_ENV = 'production';
    process.env.RENDER_SERVICE_NAME = 'plot-lite-service-staging';
    expect(FLAGS.ENABLE_VALIDATE_PATCH).toBe(false);
  });

  it('explicit ENABLE_VALIDATE_PATCH=0 overrides auto-enable on staging', () => {
    saveAndClear('ENABLE_VALIDATE_PATCH', 'NODE_ENV', 'RENDER_SERVICE_NAME');
    process.env.ENABLE_VALIDATE_PATCH = '0';
    process.env.NODE_ENV = 'production';
    process.env.RENDER_SERVICE_NAME = 'plot-lite-service-staging';
    expect(FLAGS.ENABLE_VALIDATE_PATCH).toBe(false);
  });

  it('explicit ENABLE_VALIDATE_PATCH=1 enables in any environment', () => {
    saveAndClear('ENABLE_VALIDATE_PATCH', 'NODE_ENV', 'RENDER_SERVICE_NAME');
    process.env.ENABLE_VALIDATE_PATCH = '1';
    process.env.NODE_ENV = 'production';
    delete process.env.RENDER_SERVICE_NAME;
    expect(FLAGS.ENABLE_VALIDATE_PATCH).toBe(true);
  });

  it('explicit ENABLE_VALIDATE_PATCH=true enables in any environment', () => {
    saveAndClear('ENABLE_VALIDATE_PATCH', 'NODE_ENV', 'RENDER_SERVICE_NAME');
    process.env.ENABLE_VALIDATE_PATCH = 'true';
    process.env.NODE_ENV = 'production';
    delete process.env.RENDER_SERVICE_NAME;
    expect(FLAGS.ENABLE_VALIDATE_PATCH).toBe(true);
  });

  it('auto-enables in test environment', () => {
    saveAndClear('ENABLE_VALIDATE_PATCH', 'NODE_ENV', 'RENDER_SERVICE_NAME');
    delete process.env.ENABLE_VALIDATE_PATCH;
    process.env.NODE_ENV = 'test';
    delete process.env.RENDER_SERVICE_NAME;
    expect(FLAGS.ENABLE_VALIDATE_PATCH).toBe(true);
  });
});
