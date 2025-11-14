import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';
import { readFileSync } from 'fs';
import { parse } from 'yaml';

describe('POST /v1/optimise - OpenAPI Example Round-trip', () => {
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
    expect(openapi.paths['/v1/optimise']).toBeDefined();
    
    const exampleRequest = openapi.paths['/v1/optimise'].post.requestBody.content['application/json'].example;

    const res = await fetch(`${server.baseUrl}/v1/optimise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exampleRequest)
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    // Verify response matches OpenAPI schema
    expect(data.schema).toBe('optimise.v1');
    expect(data.result).toBeDefined();
    expect(data.result.optimal_value).toBeTypeOf('number');
    expect(data.result.recommendations).toBeInstanceOf(Array);
    expect(data.meta).toBeDefined();
    expect(data.meta.seed).toBeDefined();
  });

  it('validates OpenAPI error examples structure', () => {
    const errorExamples = openapi.paths['/v1/optimise'].post.responses['400'].content['application/json'].examples;

    // Verify error examples have required fields
    for (const [key, example] of Object.entries(errorExamples)) {
      const ex = example as any;
      expect(ex.value.error).toBeDefined();
      expect(ex.value.error.type).toBeDefined();
      expect(ex.value.error.message).toBeDefined();
    }
  });
});
