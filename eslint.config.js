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
      // ROADMAP 2.879 — `@eslint/js` was IMPORTED and never SPREAD, so this
      // config resolved exactly FIVE rules and the entire core recommended set
      // was absent, `no-dupe-keys` among them. That is not a style gap: a
      // duplicate object key silently overriding a `value_frame: 'delta'` stamp
      // with `'level'` is a live fabrication shape in this repo's constraint
      // chain (2.855/2.878), and the linter was structurally incapable of
      // seeing it. An unspread plugin import is the hand-maintained-mirror
      // defect in its purest form — the config LOOKED like it enabled the
      // recommended set and enabled none of it.
      //
      // Guarded by tests/gates/eslint-config-resolution.test.ts, which DERIVES
      // the expected rule set from `@eslint/js` itself rather than pinning a
      // copied count, so a future edit that drops the spread REDs by name.
      ...js.configs.recommended.rules,

      // `no-undef` is OFF for TypeScript, and this is the VENDOR's own position
      // read at the bytes in this repo's tree, not a preference:
      // `node_modules/@typescript-eslint/eslint-plugin/dist/configs/
      //  eslint-recommended-raw.js:31` sets `'no-undef': 'off'` with the comment
      // `ts(2304) & ts(2552)` — i.e. the compiler already reports an undefined
      // identifier, with type information eslint does not have.
      //
      // Measured here: with the recommended set spread and this rule left on,
      // `no-undef` produced 950 of 957 findings and EVERY ONE was a false
      // positive against the `globals` list below — `fetch` (872), `performance`
      // (49), `expect` (9), `NodeJS`, `global`, `require`, `structuredClone`.
      // All resolve under `tsc`. Leaving it on would not add a guard; it would
      // add 950 findings that teach a reader to stop reading lint output, which
      // is the broken-alarm failure this repo has paid for before.
      //
      // Note what that also shows: the `globals` block above is a
      // hand-maintained mirror of the runtime environment and had already
      // drifted. It now feeds no enabled rule.
      'no-undef': 'off',

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
