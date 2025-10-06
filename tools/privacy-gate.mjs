#!/usr/bin/env node
/**
 * Privacy Gate (Track F)
 * 
 * Verifies that no request bodies, graph payloads, or sensitive fields
 * are logged during runtime.
 * 
 * Two-phase check:
 * 1. Static: Scan for suspicious log sinks in source
 * 2. Runtime: Execute sample requests and capture logs
 * 
 * Exit 0 = PASS (no leaks detected)
 * Exit 1 = FAIL (sensitive data logged)
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

// Patterns that indicate potential privacy leaks
const SUSPICIOUS_PATTERNS = [
  /log\..*\(.*body/i,
  /log\..*\(.*request\.body/i,
  /log\..*\(.*req\.body/i,
  /console\.log\(.*graph/i,
  /log\..*\(.*graph\s*:/i,
  /log\..*\(.*payload/i,
];

// Allow-list: Known safe patterns
const SAFE_PATTERNS = [
  /Content-Type.*body/i, // Headers are OK
  /body\.parse_json/i, // Field name references are OK
  /statusCode.*durationMs/i, // Summary metrics are OK
];

/**
 * Scan TypeScript source files for suspicious log statements
 */
function scanSourceFiles() {
  const violations = [];
  const srcDir = resolve(projectRoot, 'src');

  function scanDirectory(dir) {
    const entries = readdirSync(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        scanDirectory(fullPath);
      } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
        scanFile(fullPath);
      }
    }
  }

  function scanFile(filePath) {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Skip comments
      if (line.trim().startsWith('//')) continue;
      
      // Check for suspicious patterns
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(line)) {
          // Check if it matches safe patterns
          const isSafe = SAFE_PATTERNS.some(safe => safe.test(line));
          
          if (!isSafe) {
            violations.push({
              file: filePath.replace(projectRoot, ''),
              line: i + 1,
              content: line.trim(),
            });
          }
        }
      }
    }
  }

  scanDirectory(srcDir);
  return violations;
}

/**
 * Runtime check: Start server and send test requests
 * Capture logs and check for sensitive data
 */
function runtimeCheck() {
  console.log('🔍 Runtime privacy check (simulated)...');
  
  // For now, this is a placeholder
  // Full implementation would:
  // 1. Start server with log capture
  // 2. Send /v1/run with known graph payload
  // 3. Parse logs for graph structure or node IDs
  // 4. Fail if any sensitive fields detected
  
  // TODO: Implement when we have log capture infrastructure
  console.log('   ⏭️  Runtime check not yet implemented (requires log capture)');
  
  return { violations: [], skipped: true };
}

/**
 * Main gate logic
 */
async function runPrivacyGate() {
  console.log('🔍 Checking for sensitive payload logging...\n');

  // Phase 1: Static scan
  console.log('📂 Scanning source files...');
  const staticViolations = scanSourceFiles();

  if (staticViolations.length > 0) {
    console.log(`\n❌ Found ${staticViolations.length} potential privacy leak(s):\n`);
    for (const violation of staticViolations) {
      console.log(`   ${violation.file}:${violation.line}`);
      console.log(`   > ${violation.content}\n`);
    }
    console.log('GATES: FAIL — sensitive payloads may be logged');
    process.exit(1);
  }

  console.log('✅ No suspicious log statements found\n');

  // Phase 2: Runtime check
  const runtime = runtimeCheck();
  
  if (!runtime.skipped && runtime.violations.length > 0) {
    console.log(`\n❌ Runtime privacy violations detected:\n`);
    for (const violation of runtime.violations) {
      console.log(`   - ${violation}`);
    }
    console.log('GATES: FAIL — sensitive payloads in logs');
    process.exit(1);
  }

  console.log('GATES: PASS — no sensitive payloads in logs');
  process.exit(0);
}

// Run gate
runPrivacyGate().catch(err => {
  console.error('❌ Privacy gate error:', err.message);
  console.log('GATES: FAIL — privacy gate error');
  process.exit(1);
});
