import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)

export default defineConfig({
  // Ensure Vite/Vitest root is a plain string path (not URL/object)
  root: __dirname,
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['e2e/**', 'dist/**', 'node_modules/**', 'tests/tools.*.test.ts', 'tests/**/*.quarantined.test.ts'],
    reporters: 'basic',
    allowOnly: false,
    
    // In-process env guard to detect leaks immediately
    setupFiles: ['tests/setup/env-guard.ts'],
    
    // Test isolation settings to prevent cross-suite bleed
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    isolate: true,  // Fresh module state between tests
    
    poolOptions: {
      threads: { 
        singleThread: false,
        maxThreads: 4,
        minThreads: 1
      }
    },
    
    // Increase timeouts for server spawn/teardown
    testTimeout: 15000,
    hookTimeout: 10000,

    // Coverage configuration (run with --coverage flag)
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        'e2e/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        'tools/**',
        'scripts/**',
      ],
      // Thresholds - start conservative, increase over time
      // Per-path thresholds for critical modules require higher coverage
      thresholds: {
        // Global baseline thresholds
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
        // Critical module thresholds (higher bar)
        'src/trust/**': {
          lines: 75,
          functions: 75,
          branches: 65,
          statements: 75,
        },
        'src/routes/v1/run.ts': {
          lines: 70,
          functions: 70,
          branches: 60,
          statements: 70,
        },
        'src/engine/**': {
          lines: 70,
          functions: 70,
          branches: 60,
          statements: 70,
        },
      },
    },
  }
})
