import { describe, it, expect, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('production guard for test routes', () => {
  const prevEnv = process.env.NODE_ENV;
  const prevTest = process.env.TEST_ROUTES;
  afterAll(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
    if (prevTest === undefined) delete process.env.TEST_ROUTES; else process.env.TEST_ROUTES = prevTest;
  });

  it('throws when NODE_ENV=production and TEST_ROUTES=1', async () => {
    process.env.NODE_ENV = 'production';
    process.env.TEST_ROUTES = '1';
    let threw = false;
    try {
      await createServer();
    } catch (e) {
      threw = true;
      expect(String((e as any)?.message || '')).toContain('TEST_ROUTES');
    }
    expect(threw).toBe(true);
  });
});
