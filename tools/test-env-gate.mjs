#!/usr/bin/env node
/**
 * Test Environment Cleanliness Gate
 * 
 * Verifies that tests do not leak environment variables.
 * Run after npm test to ensure no suite left TEST_ROUTES or FEATURE_STREAM set.
 */

const leakKeys = ['TEST_ROUTES', 'FEATURE_STREAM'];
const leaks = leakKeys.filter(k => process.env[k] !== undefined);

if (leaks.length > 0) {
  console.error('❌ Test environment leak detected!\n');
  console.error(`GATES: FAIL — leaked env keys after tests: ${leaks.join(', ')}`);
  console.error('\nLeaked values:');
  for (const k of leaks) {
    console.error(`  ${k}=${process.env[k]}`);
  }
  console.error('\nTests must restore env vars in afterAll() or use withEnv() helper.');
  console.error('See tests/utils/withEnv.ts for safe env management.\n');
  process.exit(1);
}

console.log('✅ No environment leaks detected');
console.log('GATES: PASS — no leaked env keys after tests\n');
process.exit(0);
