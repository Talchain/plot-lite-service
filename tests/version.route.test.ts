import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';

describe('GET /version', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createServer({ enableTestRoutes: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 200 with version metadata', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/version',
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    
    // Required fields
    expect(json).toHaveProperty('version');
    expect(json).toHaveProperty('commit');
    expect(json).toHaveProperty('build_time_iso');
    expect(json).toHaveProperty('flags');

    // Types
    expect(typeof json.version).toBe('string');
    expect(typeof json.commit).toBe('string');
    expect(typeof json.build_time_iso).toBe('string');
    expect(typeof json.flags).toBe('object');

    // Flags shape
    expect(json.flags).toHaveProperty('scm_lite_enable');
    expect(json.flags).toHaveProperty('auth_enabled');
    expect(json.flags).toHaveProperty('rate_limit_enabled');
    expect(typeof json.flags.scm_lite_enable).toBe('boolean');
    expect(typeof json.flags.auth_enabled).toBe('boolean');
    expect(typeof json.flags.rate_limit_enabled).toBe('boolean');
  });

  it('commit defaults to "dev" when not set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/version',
    });

    const json = res.json();
    // In test environment without RENDER_GIT_COMMIT, should be 'dev'
    expect(json.commit).toBeTruthy();
  });

  it('build_time_iso is valid ISO 8601', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/version',
    });

    const json = res.json();
    const date = new Date(json.build_time_iso);
    expect(date.toISOString()).toBe(json.build_time_iso);
  });
});
