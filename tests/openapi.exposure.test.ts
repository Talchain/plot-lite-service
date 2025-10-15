import { describe, it, expect } from 'vitest';
import { createServer } from '../src/createServer.js';

describe('OpenAPI exposure', () => {
  it('GET /openapi.json returns valid JSON when OPENAPI_DEV=1', async () => {
    // Set env flag to enable route
    const orig = process.env.OPENAPI_DEV;
    process.env.OPENAPI_DEV = '1';
    
    try {
      const app = await createServer({ enableTestRoutes: false });
      
      const res = await app.inject({
        method: 'GET',
        url: '/openapi.json',
      });
      
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      
      const spec = JSON.parse(res.body);
      expect(spec).toHaveProperty('openapi');
      expect(spec).toHaveProperty('paths');
      
      // Verify /v1/run is documented
      expect(spec.paths).toHaveProperty('/v1/run');
      
      await app.close();
    } finally {
      if (orig !== undefined) {
        process.env.OPENAPI_DEV = orig;
      } else {
        delete process.env.OPENAPI_DEV;
      }
    }
  });

  it('OpenAPI spec contains required endpoints', async () => {
    const orig = process.env.OPENAPI_DEV;
    process.env.OPENAPI_DEV = '1';
    
    try {
      const app = await createServer({ enableTestRoutes: false });
      const res = await app.inject({ method: 'GET', url: '/openapi.json' });
      
      const spec = JSON.parse(res.body);
      const paths = Object.keys(spec.paths || {});
      
      // Core endpoints should be documented
      expect(paths).toContain('/v1/run');
      expect(paths).toContain('/v1/health');
      
      await app.close();
    } finally {
      if (orig !== undefined) {
        process.env.OPENAPI_DEV = orig;
      } else {
        delete process.env.OPENAPI_DEV;
      }
    }
  });
});
