/**
 * Helper to skip flaky tests in CI only
 * Local dev still runs them for debugging
 */
import { describe, it } from 'vitest';

export function skipIfCI(why: string, issue: string) {
  const isCI = !!process.env.CI;
  const prefix = `FLAKY: ${why} (${issue})`;
  
  return {
    describe: (name: string, fn: () => void) => {
      if (isCI) {
        describe.skip(`${prefix} - ${name}`, fn);
      } else {
        describe(name, fn);
      }
    },
    it: (name: string, fn: () => void | Promise<void>, timeout?: number) => {
      if (isCI) {
        it.skip(`${prefix} - ${name}`, fn, timeout);
      } else {
        it(name, fn, timeout);
      }
    }
  };
}
