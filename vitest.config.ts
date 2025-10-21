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
    exclude: ['e2e/**', 'dist/**', 'node_modules/**', 'tests/tools.*.test.ts'],
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
      threads: { singleThread: true }
    },
    
    // P1D-1: Coverage thresholds for core paths
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: [
        'src/trust/**',
        'src/scm-lite/**',
        'src/middleware/input-validation.ts',
        'src/util/canonical-json.ts'
      ],
      thresholds: {
        functions: 90,
        lines: 85,
        branches: 80,
        statements: 85
      }
    }
  }
})
