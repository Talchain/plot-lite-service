/**
 * Input Validation Middleware (Ajv)
 * 
 * Enforces OpenAPI bounds on /v1/* endpoints:
 * - Graph: ≤50 nodes, ≤200 edges
 * - Numeric: ranges per OpenAPI spec
 * - Strings: maxLength per field
 * 
 * Returns BAD_INPUT error on violations
 */

import Ajv from 'ajv';
import type { FastifyRequest, FastifyReply } from 'fastify';

const ajv = new Ajv.default({ allErrors: true, strict: false });

// Graph schema with OpenAPI bounds
const graphSchema = {
  type: 'object',
  required: ['nodes', 'edges'],
  properties: {
    nodes: {
      type: 'array',
      minItems: 1,
      maxItems: 50,
      items: {
        type: 'object',
        required: ['id', 'label'],
        properties: {
          id: { type: 'string', maxLength: 100 },
          label: { type: 'string', maxLength: 200 },
          type: { type: 'string', maxLength: 50 },
        },
      },
    },
    edges: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: { type: 'string', maxLength: 100 },
          to: { type: 'string', maxLength: 100 },
          label: { type: 'string', maxLength: 200 },
          weight: { type: 'number', minimum: -1000000, maximum: 1000000 },
        },
      },
    },
  },
};

// /v1/run request schema
const runRequestSchema = {
  type: 'object',
  required: ['graph'],
  properties: {
    graph: graphSchema,
    seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
    k_samples: { type: 'integer', minimum: 100, maximum: 10000 },
    treatment_node: { type: 'string', maxLength: 100 },
    outcome_node: { type: 'string', maxLength: 100 },
    baseline_value: { type: 'number', minimum: -1000000, maximum: 1000000 },
  },
};

// /v1/counterfactual request schema
const counterfactualRequestSchema = {
  type: 'object',
  required: ['graph', 'intervention', 'outcome_node'],
  properties: {
    graph: graphSchema,
    intervention: {
      type: 'object',
      required: ['node_id', 'from_value', 'to_value'],
      properties: {
        node_id: { type: 'string', maxLength: 100 },
        from_value: { type: 'number', minimum: -1000000, maximum: 1000000 },
        to_value: { type: 'number', minimum: -1000000, maximum: 1000000 },
      },
    },
    outcome_node: { type: 'string', maxLength: 100 },
    seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
    k_samples: { type: 'integer', minimum: 100, maximum: 10000 },
  },
};

// /v1/critique request schema
const critiqueRequestSchema = {
  type: 'object',
  required: ['graph'],
  properties: {
    graph: graphSchema,
    assumptions: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', maxLength: 500 },
    },
    treatment_node: { type: 'string', maxLength: 100 },
    outcome_node: { type: 'string', maxLength: 100 },
    seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
  },
};

// /v1/draft request schema
const draftRequestSchema = {
  type: 'object',
  required: ['description'],
  properties: {
    description: { type: 'string', minLength: 1, maxLength: 500 },
    domain: { type: 'string', enum: ['pricing', 'product', 'marketing'] },
  },
};

// Compile validators
const validateRun = ajv.compile(runRequestSchema);
const validateCounterfactual = ajv.compile(counterfactualRequestSchema);
const validateCritique = ajv.compile(critiqueRequestSchema);
const validateDraft = ajv.compile(draftRequestSchema);

/**
 * Format Ajv errors into BAD_INPUT response
 */
function formatValidationErrors(errors: any[]): any {
  const messages: string[] = [];
  const paths: string[] = [];

  for (const err of errors) {
    const path = err.instancePath || '/';
    const keyword = err.keyword;
    const params = err.params;

    let msg = '';
    if (keyword === 'required') {
      msg = `Missing required field: ${params.missingProperty}`;
    } else if (keyword === 'maxItems') {
      msg = `${path}: too many items (max ${params.limit})`;
    } else if (keyword === 'maxLength') {
      msg = `${path}: string too long (max ${params.limit})`;
    } else if (keyword === 'maximum') {
      msg = `${path}: value exceeds maximum (${params.limit})`;
    } else if (keyword === 'minimum') {
      msg = `${path}: value below minimum (${params.limit})`;
    } else {
      msg = `${path}: ${err.message}`;
    }

    messages.push(msg);
    paths.push(path);
  }

  return {
    schema: 'error.v1',
    code: 'BAD_INPUT',
    message: messages.join('; '),
    path: paths,
  };
}

/**
 * Validation middleware factory
 */
export function createValidator(route: 'run' | 'counterfactual' | 'critique' | 'draft') {
  let validator: any;
  
  switch (route) {
    case 'run':
      validator = validateRun;
      break;
    case 'counterfactual':
      validator = validateCounterfactual;
      break;
    case 'critique':
      validator = validateCritique;
      break;
    case 'draft':
      validator = validateDraft;
      break;
  }

  return async function validationHandler(req: FastifyRequest, reply: FastifyReply) {
    const body = (req as any).body;

    if (!validator(body)) {
      const errorResponse = formatValidationErrors(validator.errors || []);
      return reply.code(400).send(errorResponse);
    }
  };
}
