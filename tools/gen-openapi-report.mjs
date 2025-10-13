#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const args = process.argv.slice(2);
const schemaIndex = args.indexOf('--schema');
const outIndex = args.indexOf('--out');

if (schemaIndex === -1 || outIndex === -1) {
  console.error('Usage: gen-openapi-report.mjs --schema <path> --out <prefix>');
  process.exit(1);
}

const schemaPath = args[schemaIndex + 1];
const outPrefix = args[outIndex + 1];

// Read schema
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

// Generate OpenAPI fragment (YAML)
const yaml = `components:
  schemas:
    Report:
      type: object
      required:
        - schema
        - timestamp
        - status
      properties:
        schema:
          type: string
          enum: [${schema.properties?.schema?.enum?.map(e => `"${e}"`).join(', ') || '"report.v1"'}]
        timestamp:
          type: string
          format: date-time
        status:
          type: string
          enum: ${JSON.stringify(schema.properties?.status?.enum || ['PASS', 'FAIL', 'WARN'])}
        violations:
          type: array
          items:
            type: object
        warnings:
          type: array
          items:
            type: object
`;

// Generate JSON example
const json = {
  schema: schema.properties?.schema?.enum?.[0] || 'report.v1',
  timestamp: '2025-10-06T20:00:00.000Z',
  status: 'PASS',
  violations: [],
  warnings: []
};

// Write outputs
mkdirSync(dirname(outPrefix + '.yaml'), { recursive: true });
writeFileSync(outPrefix + '.yaml', yaml);
writeFileSync(outPrefix + '.json', JSON.stringify(json, null, 2));

console.log('GATES: PASS — OpenAPI fragment regenerated');
