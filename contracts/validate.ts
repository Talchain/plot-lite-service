/**
 * Contract Validation Script
 *
 * Validates all example files against their corresponding schemas.
 * Run with: npm run validate:contracts
 *
 * Exit codes:
 *   0 - All validations passed
 *   1 - One or more validations failed
 */

import Ajv from 'ajv';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCHEMAS_PATH = resolve(__dirname, 'schemas');
const EXAMPLES_PATH = resolve(__dirname, 'examples');

// Schema mapping: example file name -> schema file name
const SCHEMA_MAPPING: Record<string, string> = {
  'isl-response.json': 'isl-response.schema.json',
  'plot-response.json': 'plot-response.schema.json',
  'isl-request.json': 'isl-request.schema.json',
  'cee-response.json': 'cee-response.schema.json',
  'cee-graph.json': 'cee-graph.schema.json',
};

// Files explicitly allowed without schema validation
const ALLOWED_UNVALIDATED: string[] = [
  // Add files here that don't need validation (e.g., metadata files)
];

// Scenario requirements: defines what files each scenario must have
type ScenarioType = 'minimal' | 'full';

interface ScenarioRequirement {
  type: ScenarioType;
  requiredFiles: string[];
}

const DEFAULT_MINIMAL_REQUIREMENTS: ScenarioRequirement = {
  type: 'minimal',
  requiredFiles: ['isl-response.json', 'plot-response.json'],
};

const SCENARIO_REQUIREMENTS: Record<string, ScenarioRequirement> = {
  'pricing-canary': {
    type: 'minimal',
    requiredFiles: ['isl-response.json', 'plot-response.json'],
  },
  'cee-graph-supplied': {
    type: 'full',
    requiredFiles: ['cee-graph.json', 'isl-request.json', 'isl-response.json', 'plot-response.json'],
  },
};

interface ValidationResult {
  scenario: string;
  file: string;
  schema: string;
  valid: boolean;
  errors?: string[];
}

interface UnmappedFile {
  scenario: string;
  file: string;
}

interface MissingSchema {
  scenario: string;
  file: string;
  schemaName: string;
}

interface IncompleteScenario {
  scenario: string;
  type: ScenarioType;
  missingFiles: string[];
  presentFiles: string[];
  requiredFiles: string[];
}

/**
 * Load and parse a JSON file
 */
function loadJson(filePath: string): unknown {
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Get all scenarios (directories in examples/)
 */
function getScenarios(): string[] {
  const entries = readdirSync(EXAMPLES_PATH);
  return entries
    .filter((entry) => {
      const fullPath = resolve(EXAMPLES_PATH, entry);
      return statSync(fullPath).isDirectory();
    })
    .sort(); // Deterministic order
}

/**
 * Get scenario requirements, using defaults for unknown scenarios
 */
function getScenarioRequirements(scenario: string): { requirements: ScenarioRequirement; isDefault: boolean } {
  const requirements = SCENARIO_REQUIREMENTS[scenario];
  if (requirements) {
    return { requirements, isDefault: false };
  }
  return { requirements: DEFAULT_MINIMAL_REQUIREMENTS, isDefault: true };
}

/**
 * Check scenario completeness
 */
function checkScenarioCompleteness(
  scenario: string,
  scenarioPath: string,
  requirements: ScenarioRequirement
): { complete: boolean; missingFiles: string[]; presentFiles: string[] } {
  const missingFiles: string[] = [];
  const presentFiles: string[] = [];

  for (const file of requirements.requiredFiles) {
    const filePath = resolve(scenarioPath, file);
    if (existsSync(filePath)) {
      presentFiles.push(file);
    } else {
      missingFiles.push(file);
    }
  }

  return {
    complete: missingFiles.length === 0,
    missingFiles,
    presentFiles,
  };
}

/**
 * Main validation function
 */
function validateContracts(): void {
  console.log('Validating contracts...\n');

  // Initialize Ajv with all errors mode
  const ajv = new Ajv({ allErrors: true, strict: false });

  // Load all schemas first (silently)
  const schemas: Map<string, ReturnType<typeof ajv.compile>> = new Map();
  const schemaFiles = readdirSync(SCHEMAS_PATH)
    .filter((f) => f.endsWith('.schema.json'))
    .sort();

  for (const schemaFile of schemaFiles) {
    const schemaPath = resolve(SCHEMAS_PATH, schemaFile);
    try {
      const schema = loadJson(schemaPath);
      const validate = ajv.compile(schema as object);
      schemas.set(schemaFile, validate);
    } catch (err) {
      console.error(`Error loading schema ${schemaFile}: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  }

  // Track results
  const results: ValidationResult[] = [];
  const unmappedFiles: UnmappedFile[] = [];
  const missingSchemas: MissingSchema[] = [];
  const incompleteScenarios: IncompleteScenario[] = [];
  const scenarios = getScenarios();

  // Validate each scenario
  for (const scenario of scenarios) {
    const scenarioPath = resolve(EXAMPLES_PATH, scenario);
    const { requirements, isDefault } = getScenarioRequirements(scenario);

    // Print scenario header with type
    const typeLabel = requirements.type;
    if (isDefault) {
      console.log(`Scenario: ${scenario} (${typeLabel})`);
      console.log(`  ⚠️ Scenario '${scenario}' not in SCENARIO_REQUIREMENTS — using minimal defaults`);
    } else {
      console.log(`Scenario: ${scenario} (${typeLabel})`);
    }

    // Check completeness first
    const { complete, missingFiles, presentFiles } = checkScenarioCompleteness(
      scenario,
      scenarioPath,
      requirements
    );

    if (complete) {
      console.log(`  ✓ Required files present (${presentFiles.length}/${requirements.requiredFiles.length})`);
    } else {
      console.log(`  ✗ Required files missing (${presentFiles.length}/${requirements.requiredFiles.length})`);
      for (const file of missingFiles) {
        console.log(`      - ${file}`);
      }
      incompleteScenarios.push({
        scenario,
        type: requirements.type,
        missingFiles,
        presentFiles,
        requiredFiles: requirements.requiredFiles,
      });
    }

    // Validate existing files
    const files = readdirSync(scenarioPath)
      .filter((f) => f.endsWith('.json'))
      .sort(); // Deterministic order

    for (const file of files) {
      const schemaName = SCHEMA_MAPPING[file];

      // Check for unmapped files
      if (!schemaName) {
        if (!ALLOWED_UNVALIDATED.includes(file)) {
          unmappedFiles.push({ scenario, file });
          console.log(`  ? ${file} (no schema mapping)`);
        }
        continue;
      }

      const validate = schemas.get(schemaName);
      if (!validate) {
        missingSchemas.push({ scenario, file, schemaName });
        console.log(`  ✗ ${file} (schema ${schemaName} not found)`);
        continue;
      }

      const filePath = resolve(scenarioPath, file);
      const data = loadJson(filePath);
      const valid = validate(data);

      const result: ValidationResult = {
        scenario,
        file,
        schema: schemaName,
        valid: valid as boolean,
      };

      if (!valid && validate.errors) {
        result.errors = validate.errors.map((e) => {
          const path = e.instancePath || '(root)';
          return `${path}: ${e.message}`;
        });
      }

      results.push(result);

      if (result.valid) {
        console.log(`  ✓ ${file} → ${schemaName}`);
      } else {
        console.log(`  ✗ ${file} → ${schemaName}`);
        if (result.errors) {
          for (const err of result.errors) {
            console.log(`      ${err}`);
          }
        }
      }
    }

    console.log('');
  }

  // Calculate summary
  const totalFiles = results.length;
  const totalScenarios = scenarios.length;
  const failed = results.filter((r) => !r.valid).length;
  const incomplete = incompleteScenarios.length;
  const hasUnmapped = unmappedFiles.length > 0;
  const hasMissingSchemas = missingSchemas.length > 0;

  // Print summary
  console.log(`Summary: Validated ${totalFiles} files across ${totalScenarios} scenario${totalScenarios !== 1 ? 's' : ''} (${failed} failed, ${incomplete} incomplete)`);

  // Report incomplete scenarios as errors (checked first - most severe)
  if (incomplete > 0) {
    console.log('\nError: Incomplete scenarios:');
    for (const { scenario, type, missingFiles, presentFiles, requiredFiles } of incompleteScenarios) {
      console.log(`  - ${scenario} (${type}): missing ${missingFiles.length}/${requiredFiles.length} files`);
      for (const file of missingFiles) {
        console.log(`      - ${file}`);
      }
    }
    process.exit(1);
  }

  // Report missing schema files as errors
  if (hasMissingSchemas) {
    console.log('\nError: Schema files not found:');
    for (const { scenario, file, schemaName } of missingSchemas) {
      console.log(`  - ${join(scenario, file)} → ${schemaName} (missing)`);
    }
    console.log('\nEnsure schema files exist in contracts/schemas/.');
    process.exit(1);
  }

  // Report unmapped files as errors
  if (hasUnmapped) {
    console.log('\nError: Files without schema mapping:');
    for (const { scenario, file } of unmappedFiles) {
      console.log(`  - ${join(scenario, file)}`);
    }
    console.log('\nAdd schema mapping in SCHEMA_MAPPING or add to ALLOWED_UNVALIDATED if intentional.');
    process.exit(1);
  }

  // Report validation failures
  if (failed > 0) {
    console.log('\nFailed validations:');
    for (const result of results.filter((r) => !r.valid)) {
      console.log(`  - ${join(result.scenario, result.file)}`);
    }
    process.exit(1);
  }

  // Success
  if (totalFiles === 0) {
    console.log('\nWarning: No files were validated.');
    process.exit(0);
  }

  console.log('\n✓ All validations passed!');
  process.exit(0);
}

// Run validation
validateContracts();
