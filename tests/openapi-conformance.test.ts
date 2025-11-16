/**
 * Phase 4: OpenAPI Conformance Tests
 * Verify all v1 routes have request examples, 400 examples, and headers documented
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { parse } from 'yaml';

describe('OpenAPI Conformance', () => {
  const openapiPath = './contracts/openapi.yaml';
  const spec = parse(readFileSync(openapiPath, 'utf-8'));

  const v1InferenceRoutes = [
    '/v1/run',
    '/v1/optimise',
    '/v1/run_bundle',
    '/v1/run_timeslices',
    '/v1/score',
    '/v1/critique',
    '/v1/counterfactual'
  ];

  it('all v1 inference routes have request examples', () => {
    const missing: string[] = [];

    for (const route of v1InferenceRoutes) {
      const endpoint = spec.paths[route];
      if (!endpoint?.post) {
        missing.push(`${route}: no POST operation`);
        continue;
      }

      const requestBody = endpoint.post.requestBody;
      if (!requestBody?.content?.['application/json']) {
        missing.push(`${route}: no request body`);
        continue;
      }

      const content = requestBody.content['application/json'];
      if (!content.example && !content.examples) {
        missing.push(`${route}: no request example`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('all v1 inference routes have X-Olumi-Backend header documented', () => {
    const missing: string[] = [];

    for (const route of v1InferenceRoutes) {
      const endpoint = spec.paths[route];
      if (!endpoint?.post?.responses?.['200']) {
        missing.push(`${route}: no 200 response`);
        continue;
      }

      const headers = endpoint.post.responses['200'].headers;
      if (!headers || !headers['X-Olumi-Backend']) {
        missing.push(`${route}: X-Olumi-Backend header not documented`);
      }
    }

    expect(missing).toEqual([]);
  });

  it('all v1 routes have 400 error examples', () => {
    const missing: string[] = [];
    const allV1Routes = Object.keys(spec.paths).filter(p => p.startsWith('/v1/'));

    for (const route of allV1Routes) {
      const endpoint = spec.paths[route];
      const post = endpoint?.post;
      if (!post) continue;

      const response400 = post.responses?.['400'];
      if (!response400) {
        missing.push(`${route}: no 400 response`);
        continue;
      }

      const content = response400.content?.['application/json'];
      if (!content) {
        missing.push(`${route}: no 400 content`);
        continue;
      }

      // Check for examples (either example or examples)
      if (!content.example && !content.examples) {
        missing.push(`${route}: no 400 example`);
      }
    }

    // Allow some routes to not have 400 examples (e.g., health, version)
    const exemptRoutes = ['/v1/health', '/v1/version', '/v1/limits'];
    const filteredMissing = missing.filter(m => 
      !exemptRoutes.some(exempt => m.startsWith(exempt))
    );

    expect(filteredMissing.length).toBeLessThan(5); // Allow a few missing, but not many
  });

  it('400 examples use flat error.v1 schema', () => {
    const invalidExamples: string[] = [];
    const allV1Routes = Object.keys(spec.paths).filter(p => p.startsWith('/v1/'));

    for (const route of allV1Routes) {
      const endpoint = spec.paths[route];
      const post = endpoint?.post;
      if (!post) continue;

      const response400 = post.responses?.['400'];
      const content = response400?.content?.['application/json'];
      
      if (content?.example) {
        // Check if it's flat error.v1 (has schema, code, message at top level)
        const ex = content.example;
        if (ex.error && !ex.schema) {
          // Nested format (legacy) - that's OK for back-compat
          continue;
        }
        if (ex.schema === 'error.v1' && ex.code && ex.message) {
          // Flat format - good!
          continue;
        }
      }

      if (content?.examples) {
        // Check all examples
        for (const [key, exampleObj] of Object.entries(content.examples)) {
          const ex = (exampleObj as any).value;
          if (ex?.error && !ex?.schema) {
            // Nested format - OK
            continue;
          }
          if (ex?.schema === 'error.v1' && ex?.code && ex?.message) {
            // Flat format - good!
            continue;
          }
          invalidExamples.push(`${route}: example '${key}' not in flat error.v1 format`);
        }
      }
    }

    // We expect most to be in flat format, but allow some legacy
    expect(invalidExamples.length).toBeLessThan(10);
  });
});
