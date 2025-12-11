/**
 * Report Contract Test - Freeze report.v1 Shape
 * 
 * Validates /v1/run responses against:
 * 1. JSON Schema (required fields, types)
 * 2. Blessed snapshot (stable normalized output)
 * 
 * Uses golden scenario (seed=42) for deterministic comparison.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import { createServer } from '../src/createServer.js';
import type { FastifyInstance } from 'fastify';
import { GOLDEN_SCENARIO } from '../src/fixtures/self-check.js';
import { stableStringify, normaliseReport } from '../src/util/canonical-json.js';

const SCHEMA_PATH = resolve(process.cwd(), 'contracts/schemas/report.v1.schema.json');
const SNAPSHOT_PATH = resolve(process.cwd(), 'contracts/snapshots/report.v1.example.json');

describe('Report Contract (report.v1)', () => {
  let app: FastifyInstance;
  let port: number;
  let schema: any;
  let snapshot: string;

  // Capture original env to restore after suite
  const prevTestRoutes = process.env.TEST_ROUTES;
  const prevRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;

  beforeAll(async () => {
    process.env.TEST_ROUTES = '1';
    process.env.RATE_LIMIT_ENABLED = '0';
    
    // Load schema and snapshot
    schema = JSON.parse(await readFile(SCHEMA_PATH, 'utf-8'));
    snapshot = await readFile(SNAPSHOT_PATH, 'utf-8');
    
    // Start server
    app = await createServer({ enableTestRoutes: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await app.close();
    
    if (prevRateLimitEnabled === undefined) {
      delete process.env.RATE_LIMIT_ENABLED;
    } else {
      process.env.RATE_LIMIT_ENABLED = prevRateLimitEnabled;
    }
    
    // Restore env to original state
    if (prevTestRoutes === undefined) {
      delete process.env.TEST_ROUTES;
    } else {
      process.env.TEST_ROUTES = prevTestRoutes;
    }
  });

  it('validates against report.v1.schema.json', async () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(schema);

    // Call /v1/run with golden scenario
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...GOLDEN_SCENARIO,
        treatment_node: GOLDEN_SCENARIO.graph.nodes[0]?.id,
        outcome_node: GOLDEN_SCENARIO.graph.nodes[GOLDEN_SCENARIO.graph.nodes.length - 1]?.id,
        baseline_value: 100,
      }),
    });

    expect(res.status).toBe(200);
    const report = await res.json();

    // Validate against schema
    const valid = validate(report);
    if (!valid) {
      console.error('Schema validation errors:', validate.errors);
    }
    expect(valid).toBe(true);

    // Check required top-level fields
    expect(report.schema).toBe('run.v1');
    expect(report.model_card).toBeDefined();
    expect(report.confidence).toBeDefined();
    
    // Check model_card structure
    expect(typeof report.model_card.seed).toBe('number');
    expect(Array.isArray(report.model_card.assumptions_summary)).toBe(true);
    
    // Check confidence structure
    expect(typeof report.confidence.score).toBe('number');
    expect(['high', 'medium', 'low']).toContain(report.confidence.level);
    expect(report.confidence.factors).toBeDefined();
  });

  it('matches blessed snapshot (normalised)', async () => {
    // Call /v1/run with golden scenario
    const res = await fetch(`http://127.0.0.1:${port}/v1/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...GOLDEN_SCENARIO,
        treatment_node: GOLDEN_SCENARIO.graph.nodes[0]?.id,
        outcome_node: GOLDEN_SCENARIO.graph.nodes[GOLDEN_SCENARIO.graph.nodes.length - 1]?.id,
        baseline_value: 100,
      }),
    });

    expect(res.status).toBe(200);
    const report = await res.json();

    // Normalise and canonicalise
    const normalised = normaliseReport(report);
    const canonical = stableStringify(normalised);

    // Compare with snapshot
    if (canonical !== snapshot) {
      // Generate diff for debugging
      const snapshotObj = JSON.parse(snapshot);
      const currentObj = JSON.parse(canonical);
      
      console.error('\n❌ Snapshot mismatch detected!\n');
      console.error('Expected snapshot hash:', require('crypto').createHash('sha256').update(snapshot, 'utf-8').digest('hex').substring(0, 16));
      console.error('Current output hash:', require('crypto').createHash('sha256').update(canonical, 'utf-8').digest('hex').substring(0, 16));
      console.error('\nTip: Run tools/generate-contract-snapshot.mjs to update snapshot if change is intentional.\n');
      
      // Find first difference
      const findDiff = (a: any, b: any, path = ''): string | null => {
        if (typeof a !== typeof b) return `Type mismatch at ${path}: ${typeof a} vs ${typeof b}`;
        if (typeof a === 'object' && a !== null && b !== null) {
          const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
          for (const key of allKeys) {
            if (!(key in a)) return `Missing key in current: ${path}.${key}`;
            if (!(key in b)) return `Extra key in current: ${path}.${key}`;
            const diff = findDiff(a[key], b[key], `${path}.${key}`);
            if (diff) return diff;
          }
        } else if (a !== b) {
          return `Value mismatch at ${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
        }
        return null;
      };
      
      const firstDiff = findDiff(snapshotObj, currentObj);
      if (firstDiff) {
        console.error('First difference:', firstDiff);
      }
    }

    expect(canonical).toBe(snapshot);
  });
});
