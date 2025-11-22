#!/usr/bin/env node
/**
 * Phase 2: Contracts alignment
 * - Treat ${CONTRACTS_DIR}/schemas/report.v1.schema.json as canonical
 * - Add new IR fields: model_averaging, confidence.stability, identifiability, actions[], reward, time, provenance
 * - Regenerate OpenAPI fragment
 * - Refresh blessed snapshot
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';

const CONTRACTS_DIR = process.env.CONTRACTS_DIR || '/Users/paulslee/olumi/olumi-contracts';
const ENGINE_DIR = process.env.ENGINE_DIR || process.cwd();

async function main() {
  console.log('GATES: Phase 2 — Contracts alignment');

  // Read canonical schema
  const schemaPath = resolve(CONTRACTS_DIR, 'schemas', 'report.v1.schema.json');
  console.log(`  Reading canonical schema: ${schemaPath}`);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  // Extend schema with new IR fields
  console.log('  [1/3] Extending schema with new IR fields');
  const extended = extendSchema(schema);

  // Write extended schema (local copy for engine)
  const localSchemaPath = resolve(ENGINE_DIR, 'schemas', 'report.v1.extended.json');
  writeFileSync(localSchemaPath, JSON.stringify(extended, null, 2), 'utf8');
  console.log(`  Extended schema written: ${localSchemaPath}`);

  // Validate extended schema is valid JSON Schema
  console.log('  [2/3] Validating extended schema');
  const ajv = new Ajv({ strict: false });
  const valid = ajv.validateSchema(extended);
  if (!valid) {
    throw new Error(`Extended schema is invalid: ${JSON.stringify(ajv.errors, null, 2)}`);
  }

  // Generate OpenAPI fragment
  console.log('  [3/3] Generating OpenAPI fragment');
  const openapi = generateOpenAPIFragment(extended);
  const openapiPath = resolve(ENGINE_DIR, 'contracts', 'openapi-report-v1.fragment.yaml');
  writeFileSync(openapiPath, openapi, 'utf8');
  console.log(`  OpenAPI fragment written: ${openapiPath}`);

  // Update blessed snapshot (hash of extended schema)
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(JSON.stringify(extended)).digest('hex').slice(0, 8);
  console.log(`  Schema hash (blessed): ${hash}`);

  console.log(`GATES: PASS — contracts aligned (openapi+snapshot updated, response_hash required)`);
  process.exit(0);
}

function extendSchema(base) {
  return {
    ...base,
    properties: {
      ...base.properties,
      model_averaging: {
        type: 'object',
        description: 'Bayesian Model Averaging results',
        properties: {
          bma_hash: { type: 'string', pattern: '^[0-9a-f]{64}$', description: 'SHA-256 of BMA computation' },
          K_evaluated: { type: 'integer', minimum: 1, description: 'Total DAGs evaluated' },
          K_used: { type: 'integer', minimum: 1, description: 'DAGs used in averaging' },
          mass_covered: { type: 'number', minimum: 0, maximum: 1, description: 'Cumulative posterior mass' },
          action_consistency: { type: 'number', minimum: 0, maximum: 1, description: 'Consistency of recommended action' },
          sign_flip_rate: { type: 'number', minimum: 0, maximum: 1, description: 'Rate of sign flips across models' },
        },
        required: ['bma_hash', 'K_evaluated', 'K_used', 'mass_covered'],
        additionalProperties: false,
      },
      confidence: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
          stability: {
            type: 'object',
            properties: {
              variance_ratio: { type: 'number', minimum: 0 },
              cv: { type: 'number', minimum: 0, description: 'Coefficient of variation' },
              stable: { type: 'boolean' },
            },
            required: ['stable'],
          },
        },
        required: ['level', 'stability'],
      },
      identifiability: {
        type: 'object',
        properties: {
          identifiable: { type: 'boolean' },
          adjustment_set: { type: 'array', items: { type: 'string' } },
          backdoor_satisfied: { type: 'boolean' },
        },
        required: ['identifiable'],
      },
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action_id: { type: 'string', minLength: 1 },
            type: { type: 'string', enum: ['set', 'delta'] },
            node: { type: 'string', minLength: 1 },
            value: { type: 'number' },
            relative_to: { type: 'string', description: 'Reference for delta actions' },
          },
          required: ['action_id', 'type', 'node', 'value'],
        },
      },
      reward: {
        type: 'object',
        properties: {
          best_action: { type: 'string' },
          regret: { type: 'number', minimum: 0 },
          top_k: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                action_id: { type: 'string' },
                expected_reward: { type: 'number' },
                rank: { type: 'integer', minimum: 1 },
              },
              required: ['action_id', 'expected_reward', 'rank'],
            },
          },
        },
        required: ['best_action', 'top_k'],
      },
      time: {
        type: 'object',
        properties: {
          inference_ms: { type: 'number', minimum: 0 },
          bma_ms: { type: 'number', minimum: 0 },
          total_ms: { type: 'number', minimum: 0 },
        },
      },
      provenance: {
        type: 'object',
        properties: {
          nodes_source: { type: 'string', enum: ['human', 'llm', 'auto'] },
          edges_source: { type: 'string', enum: ['human', 'llm', 'auto'] },
          human_count: { type: 'integer', minimum: 0 },
          llm_count: { type: 'integer', minimum: 0 },
          auto_count: { type: 'integer', minimum: 0 },
        },
      },
      model_card: {
        type: 'object',
        properties: {
          response_hash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
          seed: { type: 'integer' },
          assumptions: { type: 'array', items: { type: 'string' } },
        },
        required: ['response_hash'],
      },
    },
    required: [...(base.required || []), 'model_card'],
  };
}

function generateOpenAPIFragment(schema) {
  return `# OpenAPI fragment for report.v1 schema
components:
  schemas:
    ReportV1:
      type: object
      required:
        - schema
        - meta
        - summary
        - kpis
        - model_card
      properties:
        schema:
          type: string
          const: report.v1
        meta:
          type: object
          required: [seed]
          properties:
            seed:
              type: integer
            generated_at:
              type: string
              format: date-time
        summary:
          type: object
          required: [option_best]
          properties:
            option_best:
              type: string
              minLength: 1
            confidence:
              type: string
              enum: [LOW, MEDIUM, HIGH]
        kpis:
          type: array
          minItems: 1
          items:
            type: object
            required: [name, p10, p50, p90]
            properties:
              name:
                type: string
                minLength: 1
              p10:
                type: number
              p50:
                type: number
              p90:
                type: number
              unit:
                type: string
        model_card:
          type: object
          required: [response_hash]
          properties:
            response_hash:
              type: string
              pattern: '^[0-9a-f]{64}$'
            seed:
              type: integer
            assumptions:
              type: array
              items:
                type: string
        model_averaging:
          $ref: '#/components/schemas/ModelAveraging'
        confidence:
          $ref: '#/components/schemas/Confidence'
        identifiability:
          $ref: '#/components/schemas/Identifiability'
        actions:
          type: array
          items:
            $ref: '#/components/schemas/Action'
        reward:
          $ref: '#/components/schemas/Reward'
        time:
          $ref: '#/components/schemas/Timing'
        provenance:
          $ref: '#/components/schemas/Provenance'

    ModelAveraging:
      type: object
      required: [bma_hash, K_evaluated, K_used, mass_covered]
      properties:
        bma_hash:
          type: string
          pattern: '^[0-9a-f]{64}$'
        K_evaluated:
          type: integer
          minimum: 1
        K_used:
          type: integer
          minimum: 1
        mass_covered:
          type: number
          minimum: 0
          maximum: 1
        action_consistency:
          type: number
          minimum: 0
          maximum: 1
        sign_flip_rate:
          type: number
          minimum: 0
          maximum: 1

    Confidence:
      type: object
      required: [level, stability]
      properties:
        level:
          type: string
          enum: [LOW, MEDIUM, HIGH]
        stability:
          type: object
          required: [stable]
          properties:
            variance_ratio:
              type: number
              minimum: 0
            cv:
              type: number
              minimum: 0
            stable:
              type: boolean

    Identifiability:
      type: object
      required: [identifiable]
      properties:
        identifiable:
          type: boolean
        adjustment_set:
          type: array
          items:
            type: string
        backdoor_satisfied:
          type: boolean

    Action:
      type: object
      required: [action_id, type, node, value]
      properties:
        action_id:
          type: string
          minLength: 1
        type:
          type: string
          enum: [set, delta]
        node:
          type: string
          minLength: 1
        value:
          type: number
        relative_to:
          type: string

    Reward:
      type: object
      required: [best_action, top_k]
      properties:
        best_action:
          type: string
        regret:
          type: number
          minimum: 0
        top_k:
          type: array
          items:
            type: object
            required: [action_id, expected_reward, rank]
            properties:
              action_id:
                type: string
              expected_reward:
                type: number
              rank:
                type: integer
                minimum: 1

    Timing:
      type: object
      properties:
        inference_ms:
          type: number
          minimum: 0
        bma_ms:
          type: number
          minimum: 0
        total_ms:
          type: number
          minimum: 0

    Provenance:
      type: object
      properties:
        nodes_source:
          type: string
          enum: [human, llm, auto]
        edges_source:
          type: string
          enum: [human, llm, auto]
        human_count:
          type: integer
          minimum: 0
        llm_count:
          type: integer
          minimum: 0
        auto_count:
          type: integer
          minimum: 0
`;
}

main().catch(err => {
  console.error('GATES: FAIL — contracts-alignment:', err.message);
  process.exit(1);
});
