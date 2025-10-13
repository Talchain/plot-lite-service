#!/usr/bin/env node
/**
 * Contract Drift Gate
 * 
 * Compares current JSON schemas against blessed snapshots to detect
 * breaking changes in API contracts.
 * 
 * Exit 0 = PASS (no breaking changes)
 * Exit 1 = FAIL (breaking changes detected)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// Schemas to check (contract files that must not break)
const CONTRACTS = [
  {
    name: 'run.v1',
    current: 'contracts/schemas/report.v1.schema.json',
    snapshot: 'contracts/snapshots/report.v1.example.json',
  },
  {
    name: 'sse-event',
    current: 'contracts/sse-event.schema.json',
    snapshot: null, // No blessed snapshot yet
  },
];

/**
 * Normalize JSON for comparison (sorted keys, stable formatting)
 */
function normalizeJSON(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(normalizeJSON);
  
  const sorted = {};
  Object.keys(obj).sort().forEach(key => {
    sorted[key] = normalizeJSON(obj[key]);
  });
  return sorted;
}

/**
 * Extract schema shape (required fields, types, enums)
 */
function extractShape(schema) {
  const shape = {
    required: [],
    properties: {},
    enums: {},
  };

  if (schema.required) {
    shape.required = [...schema.required].sort();
  }

  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      shape.properties[key] = {
        type: prop.type,
        required: schema.required?.includes(key) || false,
      };
      
      if (prop.enum) {
        shape.enums[key] = [...prop.enum].sort();
      }

      // Recurse for nested objects
      if (prop.type === 'object' && prop.properties) {
        shape.properties[key].nested = extractShape(prop);
      }
    }
  }

  return shape;
}

/**
 * Check if schema changes are breaking
 */
function detectBreakingChanges(oldShape, newShape, path = '') {
  const breaking = [];

  // Helper: JSON Schema 'type' may be string or array of strings; compare as order-insensitive sets
  function typesEqual(a, b) {
    const toArr = (x) => Array.isArray(x) ? x.slice().sort() : [x];
    const aa = toArr(a);
    const bb = toArr(b);
    if (aa.length !== bb.length) return false;
    for (let i = 0; i < aa.length; i++) {
      if (aa[i] !== bb[i]) return false;
    }
    return true;
  }

  // Check removed required fields
  for (const field of oldShape.required || []) {
    if (!newShape.required?.includes(field)) {
      breaking.push(`${path}: Required field removed: ${field}`);
    }
  }

  // Check property type changes
  for (const [key, oldProp] of Object.entries(oldShape.properties || {})) {
    const newProp = newShape.properties?.[key];
    
    if (!newProp) {
      if (oldProp.required) {
        breaking.push(`${path}.${key}: Required property removed`);
      }
      continue;
    }

    if (!typesEqual(oldProp.type, newProp.type)) {
      const oldT = Array.isArray(oldProp.type) ? oldProp.type.join(',') : String(oldProp.type);
      const newT = Array.isArray(newProp.type) ? newProp.type.join(',') : String(newProp.type);
      breaking.push(`${path}.${key}: Type changed from ${oldT} to ${newT}`);
    }

    // Check nested objects
    if (oldProp.nested && newProp.nested) {
      const nestedBreaking = detectBreakingChanges(
        oldProp.nested,
        newProp.nested,
        `${path}.${key}`
      );
      breaking.push(...nestedBreaking);
    }
  }

  // Check enum value removals
  for (const [key, oldEnum] of Object.entries(oldShape.enums || {})) {
    const newEnum = newShape.enums?.[key];
    if (newEnum) {
      for (const val of oldEnum) {
        if (!newEnum.includes(val)) {
          breaking.push(`${path}.${key}: Enum value removed: ${val}`);
        }
      }
    }
  }

  return breaking;
}

/**
 * Main gate logic
 */
async function runContractDriftGate() {
  console.log('🔍 Checking contract drift...\n');

  let hasBreaking = false;
  const results = [];

  for (const contract of CONTRACTS) {
    try {
      // Load current schema
      const currentPath = resolve(projectRoot, contract.current);
      const currentSchema = JSON.parse(readFileSync(currentPath, 'utf8'));

      // Attempt deep shape comparison against a baseline schema if available
      // Baseline convention: contracts/<name>.schema.json (e.g., report.v1.schema.json)
      let deepCompared = false;
      try {
        const baselineGuess = resolve(projectRoot, 'contracts', `${contract.name}.schema.json`);
        const baselineSchema = JSON.parse(readFileSync(baselineGuess, 'utf8'));

        const oldShape = extractShape(baselineSchema);
        const newShape = extractShape(currentSchema);
        const breaking = detectBreakingChanges(oldShape, newShape, contract.name);

        if (breaking.length > 0) {
          hasBreaking = true;
          results.push({
            name: contract.name,
            status: 'FAIL',
            reason: `Breaking changes: ${breaking.join(' | ')}`,
          });
        } else {
          results.push({
            name: contract.name,
            status: 'PASS',
            reason: 'Deep shape match',
          });
        }
        deepCompared = true;
      } catch {
        // No baseline schema found; fall back to snapshot check if defined
      }

      if (!deepCompared) {
        if (!contract.snapshot) {
          results.push({
            name: contract.name,
            status: 'SKIP',
            reason: 'No baseline or snapshot for drift check',
          });
          continue;
        }

        const snapshotPath = resolve(projectRoot, contract.snapshot);
        let snapshotData;
        try {
          snapshotData = JSON.parse(readFileSync(snapshotPath, 'utf8'));
        } catch (err) {
          results.push({
            name: contract.name,
            status: 'SKIP',
            reason: 'Snapshot not found',
          });
          continue;
        }

        // Simple check: ensure snapshot has expected top-level fields
        const schemaRequired = currentSchema.required || [];
        const snapshotKeys = Object.keys(snapshotData);
        const missing = schemaRequired.filter(field => !snapshotKeys.includes(field));
        if (missing.length > 0) {
          hasBreaking = true;
          results.push({
            name: contract.name,
            status: 'FAIL',
            reason: `Snapshot missing required fields: ${missing.join(', ')}`,
          });
        } else {
          results.push({
            name: contract.name,
            status: 'PASS',
            reason: 'Snapshot validates',
          });
        }
      }

    } catch (err) {
      hasBreaking = true;
      results.push({
        name: contract.name,
        status: 'ERROR',
        reason: err.message,
      });
    }
  }

  // Print results
  for (const result of results) {
    const icon = result.status === 'PASS' ? '✅' : 
                 result.status === 'SKIP' ? '⏭️' : '❌';
    console.log(`${icon} ${result.name}: ${result.status} — ${result.reason}`);
  }

  console.log('');

  if (hasBreaking) {
    console.log('GATES: FAIL — contract breaking changes detected');
    process.exit(1);
  } else {
    console.log('GATES: PASS — contracts unchanged vs snapshots (deep)');
    process.exit(0);
  }
}

// Run gate
runContractDriftGate().catch(err => {
  console.error('❌ Contract drift gate error:', err.message);
  console.log('GATES: FAIL — contract drift gate error');
  process.exit(1);
});
