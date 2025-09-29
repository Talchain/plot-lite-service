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
    poolOptions: {
      threads: { singleThread: true }
    }
  }
})
