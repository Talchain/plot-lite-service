import { describe, it, expect } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('Version Flags Visibility (C7)', () => {
  it('/version includes flags map', async () => {
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/version' });
    expect(res.statusCode).toBe(200);
    
    const body = JSON.parse(res.body);
    expect(body.flags).toBeDefined();
    expect(typeof body.flags).toBe('object');
    
    await app.close();
  });

  it('flags show ON/OFF status', async () => {
    process.env.PROMETHEUS_ENABLE = '1';
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/version' });
    const body = JSON.parse(res.body);
    
    expect(body.flags.PROMETHEUS_ENABLE).toBe('ON');
    expect(body.flags.IDENT_TAG_ENABLE).toBe('OFF');
    
    await app.close();
    delete process.env.PROMETHEUS_ENABLE;
  });

  it('version payload shape is stable', async () => {
    const app = await createServer({ enableTestRoutes: false });
    
    const res = await app.inject({ method: 'GET', url: '/version' });
    const body = JSON.parse(res.body);
    
    expect(body.api).toBeDefined();
    expect(body.build).toBeDefined();
    expect(body.model).toBeDefined();
    expect(body.flags).toBeDefined();
    
    await app.close();
  });
});
