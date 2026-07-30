#!/usr/bin/env node
/**
 * Developer Shell (Track H - DX)
 * 
 * Enhanced development environment starter that:
 * - Boots server with test routes enabled
 * - Displays available endpoints and probe links
 * - Shows SLO budgets and current performance
 * - Provides quick-access commands
 * 
 * Usage: npm run dev:engine
 */

import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const PORT = process.env.PORT || 4311;
const HOST = '127.0.0.1';

/**
 * Print banner
 */
function printBanner() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║              🔥 PLoT Engine — Dev Shell                      ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
}

/**
 * Print environment info
 */
function printEnvironment() {
  console.log('📋 Environment:');
  console.log(`   Node:          ${process.version}`);
  console.log(`   PORT:          ${PORT}`);
  console.log(`   TEST_ROUTES:   ${process.env.TEST_ROUTES || '1'} (enabled for dev)`);
  console.log(`   FEATURE_STREAM: ${process.env.FEATURE_STREAM || '1'} (enabled for dev)`);
  console.log(`   RATE_LIMIT:    ${process.env.RATE_LIMIT_ENABLED !== '0' ? 'ON' : 'OFF'}`);
  console.log('');
}

/**
 * Print SLO budgets
 */
function printSLOBudgets() {
  console.log('⏱️  SLO Budgets:');
  console.log('   /v1/run p95:   ≤ 600ms');
  console.log('   TTFF:          ≤ 500ms');
  console.log('   Cancel:        ≤ 150ms');
  
  // Try to load actual performance if available
  const sloPath = resolve(projectRoot, 'artifact', 'slos.json');
  if (existsSync(sloPath)) {
    try {
      const slos = JSON.parse(readFileSync(sloPath, 'utf8'));
      if (slos.endpoints?.run?.p95_ms) {
        console.log(`   Last measured: ${slos.endpoints.run.p95_ms.toFixed(2)}ms (run p95)`);
      }
    } catch {}
  }
  
  console.log('');
}

/**
 * Print endpoint guide
 */
function printEndpoints() {
  const baseUrl = `http://${HOST}:${PORT}`;
  
  console.log('🚀 Available Endpoints:');
  console.log('');
  console.log('   Production Routes:');
  console.log(`   • GET  ${baseUrl}/v1/health`);
  console.log(`   • GET  ${baseUrl}/v1/version`);
  console.log(`   • POST ${baseUrl}/v1/run`);
  console.log(`   • POST ${baseUrl}/v1/counterfactual   [WITHDRAWN — returns 501]`);
  console.log(`   • POST ${baseUrl}/v1/critique`);
  console.log(`   • POST ${baseUrl}/v1/draft`);
  console.log('');
  console.log('   Test & Debug Routes:');
  console.log(`   • GET  ${baseUrl}/v1/self-check         (Trust signals validation)`);
  console.log(`   • GET  ${baseUrl}/demo/sse              (SSE smoke test)`);
  console.log(`   • GET  ${baseUrl}/stream                (SSE inference)`);
  console.log(`   • GET  ${baseUrl}/_inflight             (Inflight connections probe)`);
  console.log(`   • GET  ${baseUrl}/_metrics              (Prometheus metrics, set METRICS=1)`);
  console.log('');
}

/**
 * Print quick commands
 */
function printCommands() {
  console.log('🔧 Quick Commands:');
  console.log('');
  console.log('   Run all gates:      npm run gates');
  console.log('   Run tests:          npm test');
  console.log('   Self-check:         curl http://localhost:4311/v1/self-check | jq');
  console.log('   Inflight probe:     curl http://localhost:4311/_inflight');
  console.log('   Generate Evidence:  npm run evidence:pack');
  console.log('');
}

/**
 * Print footer
 */
function printFooter() {
  console.log('───────────────────────────────────────────────────────────────');
  console.log('🎯 Server starting with TEST_ROUTES enabled...');
  console.log('   Press Ctrl+C to stop');
  console.log('');
}

/**
 * Start server with enhanced logging
 */
function startServer() {
  printBanner();
  printEnvironment();
  printSLOBudgets();
  printEndpoints();
  printCommands();
  printFooter();

  // Set dev-friendly environment
  const env = {
    ...process.env,
    PORT: String(PORT),
    TEST_ROUTES: '1',
    FEATURE_STREAM: '1',
    NODE_ENV: 'development',
  };

  // Start server
  const serverProcess = spawn('node', ['dist/main.js'], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });

  serverProcess.on('error', (err) => {
    console.error('❌ Failed to start server:', err.message);
    process.exit(1);
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`\n❌ Server exited with code ${code}`);
      process.exit(code);
    }
  });

  // Handle Ctrl+C gracefully
  process.on('SIGINT', () => {
    console.log('\n\n👋 Shutting down dev server...');
    serverProcess.kill('SIGTERM');
    setTimeout(() => {
      process.exit(0);
    }, 500);
  });
}

// Check if server is built
const distPath = resolve(projectRoot, 'dist', 'main.js');
if (!existsSync(distPath)) {
  console.error('❌ Server not built. Run: npm run build');
  process.exit(1);
}

// Start
startServer();
