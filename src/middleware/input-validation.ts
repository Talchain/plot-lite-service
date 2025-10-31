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

import type { FastifyRequest, FastifyReply } from 'fastify';
import { isDemoMode } from './demo-mode.js';

// Lazy-initialized Ajv validators
let validateRun: any;
let validateCounterfactual: any;
let validateCritique: any;
let validateDraft: any;
let validateStreamQuery: any;

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
          belief: { type: 'number', minimum: 0, maximum: 1 },
          provenance: { type: 'string', maxLength: 100 },
        },
      },
    },
  },
};

// /v1/run request schema
const runRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['graph'],
  properties: {
    graph: graphSchema,
    seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
    k_samples: { type: 'integer', minimum: 100, maximum: 10000 },
    treatment_node: { type: 'string', maxLength: 100 },
    outcome_node: { type: 'string', maxLength: 100 },
    baseline_value: { type: 'number', minimum: -1000000, maximum: 1000000 },
    // Optional inputs object (free-form for PoC)
    inputs: { type: 'object', additionalProperties: true },
    inference_mode: { type: 'string', enum: ['model_based', 'model_of_inference'] },
    include_debug: { type: 'boolean' },
  },
};

// /v1/counterfactual request schema
const counterfactualRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['graph', 'intervention', 'outcome_node'],
  properties: {
    graph: graphSchema,
    intervention: {
      type: 'object',
      additionalProperties: false,
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
  additionalProperties: false,
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
  additionalProperties: false,
  required: ['description'],
  properties: {
    description: { type: 'string', minLength: 1, maxLength: 500 },
    domain: { type: 'string', enum: ['pricing', 'product', 'marketing'] },
  },
};

/**
 * Initialize validators (lazy loading)
 */
async function initValidators() {
  if (validateRun) return; // Already initialized

  const AjvCtor = (await import('ajv')).default as any;
  const ajv = new AjvCtor({ allErrors: true, strict: false, useDefaults: true, coerceTypes: true });

  validateRun = ajv.compile(runRequestSchema);
  validateCounterfactual = ajv.compile(counterfactualRequestSchema);
  validateCritique = ajv.compile(critiqueRequestSchema);
  validateDraft = ajv.compile(draftRequestSchema);
  // Stream query schema (strict keys, tolerant types): demo and latency_ms only
  const streamQuerySchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      demo: {
        anyOf: [
          { type: 'integer', enum: [0, 1] },
          { type: 'boolean' },
          { type: 'string', enum: ['0', '1', 'true', 'false'] },
        ],
        default: 0,
      },
      latency_ms: {
        anyOf: [
          { type: 'integer', minimum: 0, maximum: 10000 },
          { type: 'string', pattern: '^(?:[0-9]{1,4}|10000)$' },
        ],
        default: 0,
      },
    },
  } as const;
  validateStreamQuery = ajv.compile(streamQuerySchema);
}

/**
 * Format Ajv errors into BAD_INPUT response with field and hint (WP-P4)
 */
function formatValidationErrors(errors: any[]): any {
  const messages: string[] = [];
  const paths: string[] = [];
  let field = '';
  let hint = '';

  for (const err of errors) {
    const path = err.instancePath || '/';
    const keyword = err.keyword;
    const params = err.params;

    let msg = '';
    if (keyword === 'required') {
      field = params.missingProperty;
      msg = `Missing required field: ${params.missingProperty}`;
      hint = `Include '${params.missingProperty}' in your request`;
    } else if (keyword === 'additionalProperties') {
      field = params.additionalProperty;
      msg = `Unknown field: ${params.additionalProperty}`;
      hint = `Remove '${params.additionalProperty}' or check spelling`;
    } else if (keyword === 'maxItems') {
      field = path;
      msg = `${path}: too many items (max ${params.limit})`;
      hint = `Reduce array size to ${params.limit} or fewer items`;
    } else if (keyword === 'maxLength') {
      field = path;
      msg = `${path}: string too long (max ${params.limit})`;
      hint = `Shorten to ${params.limit} characters or fewer`;
    } else if (keyword === 'maximum') {
      field = path;
      msg = `${path}: value exceeds maximum (${params.limit})`;
      hint = `Use a value ≤ ${params.limit}`;
    } else if (keyword === 'minimum') {
      field = path;
      msg = `${path}: value below minimum (${params.limit})`;
      hint = `Use a value ≥ ${params.limit}`;
    } else if (keyword === 'type') {
      field = path;
      msg = `${path}: wrong type (expected ${params.type})`;
      hint = `Provide a ${params.type} value`;
    } else {
      msg = `${path}: ${err.message}`;
      hint = 'Check the API documentation';
    }

    messages.push(msg);
    paths.push(path);
  }

  const out: any = {
    schema: 'error.v1',
    code: 'BAD_INPUT',
    message: messages.join('; '),
    field: field || paths[0] || 'unknown',
    hint: hint || 'Check request format',
    path: paths,
  };
  // Additive concise error string for assertions and DX (present in all envs)
  try { out.error = messages[0] || 'BAD_INPUT'; } catch {}
  return out;
}

/**
 * Query validation middleware factory (for GET routes)
 */
export function createQueryValidator(route: 'stream') {
  return async function validationHandler(req: FastifyRequest, reply: FastifyReply) {
    await initValidators();
    const q = (req as any).query || {};
    switch (route) {
      case 'stream': {
        // Demo short-circuit: bypass validation completely
        try { if (isDemoMode(req)) return; } catch {}
        // Fast path upper bound: latency_ms ≤ 10000
        try {
          const rawUrl = (req.raw?.url ?? (req as any).url ?? '').toString();
          const i = rawUrl.indexOf('?');
          if (i !== -1) {
            const qs = new URLSearchParams(rawUrl.slice(i + 1));
            const s = qs.get('latency_ms');
            const v = s == null ? NaN : Number(s);
            if (Number.isFinite(v) && v > 10000) {
              return reply.code(400).send({ schema: 'error.v1', code: 'BAD_INPUT', message: 'latency_ms must be ≤ 10000' });
            }
          }
        } catch {}
        if (!validateStreamQuery(q)) {
          try { reply.log.warn({ q, errors: validateStreamQuery.errors }, 'stream query validation failed'); } catch {}
          const errorResponse = formatValidationErrors(validateStreamQuery.errors || []);
          return reply.code(400).send(errorResponse);
        }
        break;
      }
    }
  };
}

/**
 * Validation middleware factory
 */
export function createValidator(route: 'run' | 'counterfactual' | 'critique' | 'draft') {
  return async function validationHandler(req: FastifyRequest, reply: FastifyReply) {
    // Initialize validators on first use
    await initValidators();

    // Select appropriate validator
    let validator: any;
    // Allowed top-level keys per route for explicit guardrail
    let allowedKeys: Set<string> = new Set();
    switch (route) {
      case 'run':
        validator = validateRun;
        allowedKeys = new Set(['graph','seed','k_samples','treatment_node','outcome_node','baseline_value','inputs','inference_mode','include_debug']);
        break;
      case 'counterfactual':
        validator = validateCounterfactual;
        allowedKeys = new Set(['graph','intervention','outcome_node','seed','k_samples']);
        break;
      case 'critique':
        validator = validateCritique;
        allowedKeys = new Set(['graph','assumptions','treatment_node','outcome_node','seed']);
        break;
      case 'draft':
        validator = validateDraft;
        allowedKeys = new Set(['description','domain']);
        break;
    }

    const body = (req as any).body;

    // Explicit top-level additionalProperties guard (defensive, mirrors Ajv schema intent)
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const keys = Object.keys(body);
      const unknown = keys.filter(k => !allowedKeys.has(k));
      if (unknown.length > 0) {
        const errorResponse = formatValidationErrors([
          { instancePath: '/', keyword: 'additionalProperties', params: { additionalProperty: unknown[0] }, message: `must NOT have additional property '${unknown[0]}'` },
        ] as any);
        return reply.code(400).send(errorResponse);
      }
    }

    if (!validator(body)) {
      const errorResponse = formatValidationErrors(validator.errors || []);
      return reply.code(400).send(errorResponse);
    }
  };
}
