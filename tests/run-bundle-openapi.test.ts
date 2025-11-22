import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnServer, type ServerHandle } from './utils.js';
import { readFileSync } from 'fs';
import { parse } from 'yaml';

describe('POST /v1/run_bundle - OpenAPI Example Round-trip', () => {
  let server: ServerHandle;
  let openapi: any;

  beforeAll(async () => {
    server = await spawnServer();
    const openapiYaml = readFileSync('./contracts/openapi.yaml', 'utf-8');
    openapi = parse(openapiYaml);
  });

  afterAll(async () => { await server.kill(); });

  it('processes OpenAPI example request successfully', async () => {
    // Verify OpenAPI has the path
    expect(openapi.paths).toBeDefined();
    expect(openapi.paths['/v1/run_bundle']).toBeDefined();
    
    const exampleRequest = openapi.paths['/v1/run_bundle'].post.requestBody.content['application/json'].examples.basic.value;

    const res = await fetch(`${server.baseUrl}/v1/run_bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(exampleRequest)
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    // Verify response matches OpenAPI schema
    expect(data.schema).toBe('run_bundle.v1');
    expect(data.results).toBeInstanceOf(Array);
    expect(data.results).toHaveLength(2);
    expect(data.meta).toBeDefined();
    expect(data.meta.seed).toBe(4242);
    expect(data.meta.total_scenarios).toBe(2);

    // Verify each result has required fields
    for (const result of data.results) {
      expect(result.label).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.p10).toBeTypeOf('number');
      expect(result.summary.p50).toBeTypeOf('number');
      expect(result.summary.p90).toBeTypeOf('number');
      expect(result.model_card).toBeDefined();
      expect(result.model_card.schema).toBe('report.v1');
      expect(result.model_card.seed).toBe(4242);
      expect(result.model_card.nodes).toBeTypeOf('number');
      expect(result.model_card.edges).toBeTypeOf('number');
      expect(result.model_card.response_hash).toMatch(/^[0-9a-f]{16}$/);
    }

    // Verify labels match request
    expect(data.results[0].label).toBe('Low Price');
    expect(data.results[1].label).toBe('High Price');
  });

  it('validates OpenAPI error examples structure', () => {
    const errorExamples = openapi.paths['/v1/run_bundle'].post.responses['400'].content['application/json'].examples;

    // Verify all error examples have required fields
    for (const [key, example] of Object.entries(errorExamples)) {
      const ex = example as any;
      expect(ex.value.schema).toBe('error.v1');
      expect(ex.value.code).toBe('BAD_INPUT');
      expect(ex.value.message).toBeDefined();
    }
  });
});
