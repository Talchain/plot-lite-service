import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.eslint.json',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Core ESLint rules
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      'no-unused-vars': 'off', // Use TypeScript version instead

      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-empty-function': 'error',
    },
  },
  {
    // Test files: relaxed rules for test code
    files: ['**/*.test.ts', '**/*.spec.ts', 'tests/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      'no-empty': 'off',
      'no-console': 'off', // Allow console in tests for debugging
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off', // Allow unused vars in tests
    },
  },
  {
    ignores: [
      'node_modules/',
      'dist/',
      'out/',
      'coverage/',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      'tools/**/*.cjs',
      'scripts/**/*.js',
    ],
  },
];
