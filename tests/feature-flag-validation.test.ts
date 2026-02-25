import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateFeatureFlags, getAllFeatureFlags, KNOWN_FEATURE_FLAGS } from '../src/config/feature-flags.js';
import { createServer } from '../src/createServer.js';

describe('Feature Flag Validation', () => {
  let origEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    origEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('warns on unknown *_ENABLE flag', () => {
    process.env.FOO_ENABLE = '1';
    const warnings: string[] = [];
    const mockLogger = {
      warn: (data: any, msg: string) => warnings.push(msg),
    };
    
    validateFeatureFlags(mockLogger);
    
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('FOO_ENABLE');
  });

  it('no warning for known flags', () => {
    process.env.SCM_LITE_ENABLE = '1';
    process.env.IDENT_TAG_ENABLE = '1';
    const warnings: string[] = [];
    const mockLogger = {
      warn: (data: any, msg: string) => warnings.push(msg),
    };
    
    validateFeatureFlags(mockLogger);
    
    expect(warnings.length).toBe(0);
  });

  it('ENABLE_REVIEW_PASS is a known flag', () => {
    expect(KNOWN_FEATURE_FLAGS).toContain('ENABLE_REVIEW_PASS');
  });

  it('/version shows all flags', async () => {
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/version' });
    const body = JSON.parse(res.body);
    
    expect(body.flags).toBeDefined();
    expect(body.flags).toHaveProperty('SCM_LITE_ENABLE');
    expect(body.flags).toHaveProperty('IDENT_TAG_ENABLE');
    
    await app.close();
  });
});
