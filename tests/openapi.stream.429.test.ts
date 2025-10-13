import fs from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { describe, it, expect } from 'vitest';

describe('OpenAPI /v1/stream 429 contract', () => {
  it('documents 429 error.v1', () => {
    const doc = parseYaml(fs.readFileSync('contracts/openapi.yaml', 'utf8')) as any;
    const stream = doc.paths['/v1/stream'].get;
    expect(stream.responses['429']).toBeTruthy();
    const schema = stream.responses['429'].content['application/json'].schema;
    const refOrExample = schema?.$ref || schema?.properties?.schema?.example;
    expect(String(refOrExample || '')).toMatch(/errorV1|error\.v1/i);

    // 403 documented
    expect(stream.responses['403']).toBeTruthy();

    // RATE_LIMITED in enum
    const enumCodes = doc.components?.schemas?.errorV1?.properties?.code?.enum || [];
    expect(enumCodes).toContain('RATE_LIMITED');
  });
});
