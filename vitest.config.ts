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
      threads: { 
        singleThread: false,
        maxThreads: 4,
        minThreads: 1
      }
    },
    
    // Increase timeouts for server spawn/teardown
    testTimeout: 15000,
    hookTimeout: 10000
  }
})
