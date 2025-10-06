#!/usr/bin/env node
/**
 * A2: Generate OpenAPI 3.1 fragment from report.v1.schema.json
 *
 * Deterministic, sorted keys, 2-space indentation, SHA-256 digest.
 */

import { readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { resolve } from 'path';

const CONTRACTS_DIR = process.env.CONTRACTS_DIR || '/Users/paulslee/olumi/olumi-contracts';

function jsonSchemaToOpenAPI(schema, name = 'ReportV1') {
  const { $schema, $id, $comment, examples, ...rest } = schema;

  // Map JSON Schema to OpenAPI
  const openapi = {
    type: rest.type,
    description: rest.description,
    required: rest.required,
    additionalProperties: rest.additionalProperties,
    properties: {}
  };

  // Process properties
  if (rest.properties) {
    const sortedKeys = Object.keys(rest.properties).sort();
    for (const key of sortedKeys) {
      const prop = rest.properties[key];
      openapi.properties[key] = convertProperty(prop);
    }
  }

  return openapi;
}

function convertProperty(prop) {
  const result = {};

  // Handle const
  if (prop.const !== undefined) {
    result.enum = [prop.const];
    result.description = prop.description;
    return result;
  }

  // Copy basic fields
  if (prop.type) result.type = prop.type;
  if (prop.description) result.description = prop.description;
  if (prop.format) result.format = prop.format;
  if (prop.enum) result.enum = prop.enum;
  if (prop.minimum !== undefined) result.minimum = prop.minimum;
  if (prop.maximum !== undefined) result.maximum = prop.maximum;
  if (prop.minLength !== undefined) result.minLength = prop.minLength;
  if (prop.minItems !== undefined) result.minItems = prop.minItems;
  if (prop.additionalProperties !== undefined) result.additionalProperties = prop.additionalProperties;

  // Handle required
  if (prop.required && Array.isArray(prop.required)) {
    result.required = prop.required;
  }

  // Handle nested properties
  if (prop.properties) {
    result.properties = {};
    const sortedKeys = Object.keys(prop.properties).sort();
    for (const key of sortedKeys) {
      result.properties[key] = convertProperty(prop.properties[key]);
    }
  }

  // Handle array items
  if (prop.items) {
    result.items = convertProperty(prop.items);
  }

  return result;
}

function sortObject(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const sorted = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    sorted[key] = sortObject(obj[key]);
  }
  return sorted;
}

function toYAML(obj, indent = 0) {
  const spaces = '  '.repeat(indent);
  let yaml = '';

  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && !Array.isArray(item)) {
        yaml += `${spaces}-\n`;
        yaml += toYAML(item, indent + 1).split('\n').map(line =>
          line ? `${spaces}  ${line}` : ''
        ).join('\n') + '\n';
      } else {
        yaml += `${spaces}- ${item}\n`;
      }
    }
    return yaml.trimEnd();
  }

  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    const value = obj[key];

    if (value === null || value === undefined) {
      continue;
    }

    if (typeof value === 'object' && !Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      yaml += toYAML(value, indent + 1);
    } else if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      yaml += toYAML(value, indent + 1);
    } else if (typeof value === 'string') {
      yaml += `${spaces}${key}: "${value}"\n`;
    } else if (typeof value === 'boolean') {
      yaml += `${spaces}${key}: ${value}\n`;
    } else {
      yaml += `${spaces}${key}: ${value}\n`;
    }
  }

  return yaml;
}

async function main() {
  const schemaPath = resolve(CONTRACTS_DIR, 'schemas/report.v1.schema.json');
  const yamlOutPath = resolve(CONTRACTS_DIR, 'contracts/openapi/report.v1.fragment.yaml');
  const jsonOutPath = resolve(CONTRACTS_DIR, 'contracts/openapi/report.v1.fragment.json');
  const digestPath = resolve(CONTRACTS_DIR, 'contracts/openapi/report.v1.fragment.sha256');

  // Load schema
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  // Convert to OpenAPI
  const openapi = jsonSchemaToOpenAPI(schema);

  // Wrap in OpenAPI structure
  const fragment = {
    openapi: '3.1.0',
    info: {
      title: 'Report V1 Schema',
      version: '1.0.0'
    },
    components: {
      schemas: {
        ReportV1: sortObject(openapi)
      }
    }
  };

  // Write JSON (2-space, sorted)
  const jsonContent = JSON.stringify(fragment, null, 2);
  writeFileSync(jsonOutPath, jsonContent + '\n', 'utf8');

  // Write YAML (2-space, sorted)
  const yamlContent = toYAML(fragment, 0);
  writeFileSync(yamlOutPath, yamlContent + '\n', 'utf8');

  // Generate SHA-256 digest of YAML
  const yamlBytes = readFileSync(yamlOutPath);
  const digest = createHash('sha256').update(yamlBytes).digest('hex');
  writeFileSync(digestPath, digest + '\n', 'utf8');

  console.log(`GATES: PASS — openapi generated (sha256=${digest.slice(0, 8)}, keys=ReportV1)`);
  process.exit(0);
}

main().catch(err => {
  console.error('GATES: FAIL — openapi generation:', err.message);
  process.exit(1);
});
