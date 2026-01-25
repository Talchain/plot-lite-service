/**
 * Golden Fixtures Loader
 *
 * Loads test fixtures from contracts/examples/ directory.
 * Provides a centralized way to access fixture data for golden tests.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACTS_PATH = resolve(__dirname, '../../contracts/examples');

/**
 * Safely require a JSON file, returning undefined if not found
 */
function optionalLoad<T>(filePath: string): T | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Load a JSON file, throwing if not found
 */
function requireLoad<T>(filePath: string): T {
  if (!existsSync(filePath)) {
    throw new Error(`Required fixture not found: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Scenario fixture data structure
 */
export interface ScenarioFixtures {
  islResponse: unknown;
  plotResponse: unknown;
  islRequest?: unknown;
  ceeResponse?: unknown;
  /** CEE graph draft with nodes/edges (different from cee-response M1 review format) */
  ceeGraph?: unknown;
}

/**
 * Load all fixtures for a given scenario
 *
 * @param name - Scenario name (e.g., 'pricing-canary')
 * @returns Object containing all fixture data for the scenario
 *
 * @example
 * ```typescript
 * const { islResponse, plotResponse } = loadScenario('pricing-canary');
 * ```
 */
export function loadScenario(name: string): ScenarioFixtures {
  const scenarioPath = resolve(CONTRACTS_PATH, name);

  if (!existsSync(scenarioPath)) {
    throw new Error(`Scenario not found: ${name} (expected at ${scenarioPath})`);
  }

  return {
    islResponse: requireLoad(resolve(scenarioPath, 'isl-response.json')),
    plotResponse: requireLoad(resolve(scenarioPath, 'plot-response.json')),
    // Optional files loaded only if present
    islRequest: optionalLoad(resolve(scenarioPath, 'isl-request.json')),
    ceeResponse: optionalLoad(resolve(scenarioPath, 'cee-response.json')),
    ceeGraph: optionalLoad(resolve(scenarioPath, 'cee-graph.json')),
  };
}

/**
 * List available scenarios
 */
export function listScenarios(): string[] {
  const { readdirSync, statSync } = require('fs');
  const entries = readdirSync(CONTRACTS_PATH);
  return entries.filter((entry: string) => {
    const fullPath = resolve(CONTRACTS_PATH, entry);
    return statSync(fullPath).isDirectory();
  });
}

/**
 * Pre-loaded pricing-canary scenario for convenience
 * This matches the existing import pattern in golden tests
 */
export const pricingCanary = loadScenario('pricing-canary');

/**
 * Pre-loaded cee-graph-supplied scenario (full scenario with CEE graph)
 *
 * Tests graph coherence when a CEE-generated graph is supplied to PLoT.
 * The CEE graph was generated in a prior request (different request_id).
 */
export const ceeGraphSupplied = loadScenario('cee-graph-supplied');
