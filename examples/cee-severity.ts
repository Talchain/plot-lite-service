import {
  classifyCeeSeverity,
  isBlockingError,
  describeSeverity,
  ERROR_CODES,
  WARNING_CODES,
  INFO_CODES,
} from '../src/cee/severity.js';

/**
 * Minimal CLI example for CEE severity classification.
 *
 * Run with:
 *   npx tsx examples/cee-severity.ts
 */
async function main() {
  const sampleCodes = [
    ...Array.from(ERROR_CODES).slice(0, 3),
    ...Array.from(WARNING_CODES).slice(0, 3),
    ...Array.from(INFO_CODES).slice(0, 2),
    'UNKNOWN_CODE',
  ];

  console.log('CEE Severity Classification Example');
  console.log('===================================');
  console.log('code\tseverity\tblocking\tdescription');

  for (const code of sampleCodes) {
    const severity = classifyCeeSeverity(code);
    const blocking = isBlockingError(code);
    const description = describeSeverity(severity);
    console.log(`${code}\t${severity}\t${blocking ? 'yes' : 'no'}\t${description}`);
  }
}

main().catch((err) => {
  console.error('cee-severity example failed:', err);
  process.exitCode = 1;
});
