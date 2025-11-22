/**
 * Ajv validation with strict bounds enforcement
 * Returns deterministic BAD_INPUT envelopes
 */

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ajv = new Ajv({
  strict: true,
  allowUnionTypes: false,
  removeAdditional: false,
  allErrors: true,
  verbose: true,
});

addFormats(ajv);

// Load canonical report.v1 schema
const CONTRACTS_DIR = process.env.CONTRACTS_DIR || '/Users/paulslee/olumi/olumi-contracts';
const schemaPath = resolve(CONTRACTS_DIR, 'schemas', 'report.v1.schema.json');
let reportSchema;

try {
  const raw = readFileSync(schemaPath, 'utf8');
  reportSchema = JSON.parse(raw);
} catch (err) {
  console.error(`Failed to load schema from ${schemaPath}:`, err.message);
  process.exit(2);
}

// Compile validators
const validateReport = ajv.compile(reportSchema);

// Request schemas for v1 endpoints
const runRequestSchema = {
  type: 'object',
  required: ['graph'],
  properties: {
    graph: {
      type: 'object',
      required: ['nodes', 'edges'],
      properties: {
        nodes: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 64 },
            },
          },
        },
        edges: {
          type: 'array',
          maxItems: 500,
          items: {
            type: 'object',
            required: ['from', 'to'],
            properties: {
              from: { type: 'string', minLength: 1, maxLength: 64 },
              to: { type: 'string', minLength: 1, maxLength: 64 },
              weight: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
      },
    },
    seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
    k_samples: { type: 'integer', minimum: 10, maximum: 10000 },
    treatment_node: { type: 'string', minLength: 1, maxLength: 64 },
    outcome_node: { type: 'string', minLength: 1, maxLength: 64 },
    baseline_value: { type: 'number', minimum: 0, maximum: 1e12 },
  },
  additionalProperties: false,
};

const validateRunRequest = ajv.compile(runRequestSchema);

/**
 * Validate request and return BAD_INPUT envelope on failure
 * @param {string} endpoint - e.g., 'run', 'counterfactual', 'critique'
 * @param {object} payload
 * @returns {{ ok: boolean, errors?: Array }}
 */
export function validateRequest(endpoint, payload) {
  let validator;

  if (endpoint === 'run' || endpoint === 'counterfactual') {
    validator = validateRunRequest;
  } else {
    // Other endpoints use similar patterns
    return { ok: true };
  }

  const valid = validator(payload);

  if (valid) {
    return { ok: true };
  }

  // Sort errors by JSONPath then keyword for determinism
  const errors = (validator.errors || [])
    .map(e => ({
      path: e.instancePath || '/',
      keyword: e.keyword,
      message: e.message || 'validation failed',
      params: e.params,
    }))
    .sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      if (pathCmp !== 0) return pathCmp;
      return a.keyword.localeCompare(b.keyword);
    });

  return {
    ok: false,
    errors,
    envelope: {
      schema: 'bad_input.v1',
      code: 'BAD_INPUT',
      message: 'Request validation failed',
      errors: errors.map(e => ({
        path: e.path,
        keyword: e.keyword,
        message: e.message,
      })),
    },
  };
}

export { validateReport };
