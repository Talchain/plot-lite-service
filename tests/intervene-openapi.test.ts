import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';
import { readFileSync } from 'fs';
import { parse } from 'yaml';

describe('POST /v1/intervene - OpenAPI Example Round-trip', () => {
  let server: ServerHandle;
  let openapi: any;

  beforeAll(async () => {
    server = await spawnServer();
    const openapiYaml = readFileSync('./contracts/openapi.yaml', 'utf-8');
    openapi = parse(openapiYaml);
  });

  afterAll(async () => { await server.kill(); });

  it('processes OpenAPI example request successfully', async () => {
    expect(openapi.paths).toBeDefined();
    expect(openapi.paths['/v1/intervene']).toBeDefined();
    
    const exampleRequest = openapi.paths['/v1/intervene'].post.requestBody.content['application/json'].example;

    const res = await fetch(`${server.baseUrl}/v1/intervene`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exampleRequest)
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    // Verify response matches OpenAPI schema
    expect(data.schema).toBe('intervene.v1');
    expect(data.baseline).toBeDefined();
    expect(data.counterfactual).toBeDefined();
    expect(data.delta).toBeDefined();
    expect(data.delta.p10).toBeTypeOf('number');
    expect(data.delta.p50).toBeTypeOf('number');
    expect(data.delta.p90).toBeTypeOf('number');
    expect(data.identifiability).toBeTypeOf('string');
    expect(data.meta).toBeDefined();
    expect(data.meta.seed).toBe(4242);
  });

  it('validates OpenAPI error examples structure', () => {
    const errorExamples = openapi.paths['/v1/intervene'].post.responses['400'].content['application/json'].examples;

    // Verify error examples have required fields
    for (const [key, example] of Object.entries(errorExamples)) {
      const ex = example as any;
      expect(ex.value.error).toBeDefined();
      expect(ex.value.error.type).toBeDefined();
      expect(ex.value.error.message).toBeDefined();
    }
  });
});
