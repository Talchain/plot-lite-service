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

import { readFileSync, readdirSync, statSync, createWriteStream, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

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
async function runtimeCheck() {
  const PORT = 4331;
  const HOST = '127.0.0.1';
  const BASE = `http://${HOST}:${PORT}`;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  async function waitForHealth(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${BASE}/v1/health`);
        if (res.ok) return true;
      } catch {}
      await sleep(100);
    }
    return false;
  }

  // Start server with stdout/stderr piped to a log file
  const logPath = `/tmp/engine-privacy-${PORT}.log`;
  const child = spawn('node', ['dist/main.js'], {
    env: {
      ...process.env,
      TEST_ROUTES: '1',
      AUTH_ENABLED: '0',
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stream = createWriteStream(logPath);
  child.stdout.pipe(stream);
  child.stderr.pipe(stream);

  const healthy = await waitForHealth(8000);
  if (!healthy) {
    try { child.kill(); } catch {}
    return { violations: ['engine failed to start'], events: 0, skipped: false };
  }

  // Exercise one happy path per route (demo allowed)
  const requests = [
    fetch(`${BASE}/v1/health`),
    fetch(`${BASE}/v1/version`),
    fetch(`${BASE}/v1/run?demo=1`, { method: 'POST' }),
    fetch(`${BASE}/v1/counterfactual?demo=1`, { method: 'POST' }),
    fetch(`${BASE}/v1/critique?demo=1`, { method: 'POST' }),
    fetch(`${BASE}/v1/draft?demo=1`, { method: 'POST' }),
    fetch(`${BASE}/v1/self-check`),
  ];
  await Promise.allSettled(requests);

  // Give logger a moment to flush
  await sleep(200);
  try { child.kill(); } catch {}
  await sleep(200);

  if (!existsSync(logPath)) {
    return { violations: [], events: 0, skipped: false };
  }
  const text = readFileSync(logPath, 'utf8');
  const lines = text.split('\n').filter(Boolean);
  const events = lines.length;

  // Very light runtime checks: ensure no obvious graph dumps
  const runtimeViolations = [];
  const disallowed = [/\"nodes\":\s*\[/i, /\"edges\":\s*\[/i, /\"graph\"\s*:\s*\{/i];
  for (const ln of lines) {
    for (const pat of disallowed) {
      if (pat.test(ln)) {
        runtimeViolations.push('graph-like structure logged');
        break;
      }
    }
  }

  return { violations: runtimeViolations, events, skipped: false };
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
  const runtime = await runtimeCheck();
  
  // Single-line GATES output
  if (runtime.skipped) {
    console.log('GATES: FAIL — privacy tap missing or 0 events');
    process.exit(1);
  }
  if (!runtime || runtime.events === 0) {
    console.log('GATES: FAIL — privacy tap missing or 0 events');
    process.exit(1);
  }
  if (runtime.violations.length > 0) {
    console.log('GATES: FAIL — privacy violations');
    process.exit(1);
  }
  console.log(`GATES: PASS — privacy OK (events=${runtime.events}, violations=0)`);
  process.exit(0);
}

// Run gate
runPrivacyGate().catch(err => {
  console.error('❌ Privacy gate error:', err.message);
  console.log('GATES: FAIL — privacy gate error');
  process.exit(1);
});
