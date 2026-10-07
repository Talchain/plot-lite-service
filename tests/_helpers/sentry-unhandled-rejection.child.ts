/**
 * Child process for tests/sentry-contract.test.ts (S-H): does an unhandled
 * rejection still end the process once Sentry is initialised?
 * CHILD_MODE=contract → PLoT's initSentry(); CHILD_MODE=sdk-default → the SDK's
 * default integrations (precondition twin). Prints ALIVE if the process
 * survives the rejection.
 */
import * as Sentry from '@sentry/node';
import { initSentry } from '../../src/observability/sentry.js';

const transport = () => ({ send: async () => ({ statusCode: 200 }), flush: async () => true });
const dsn = 'https://public@o0.ingest.sentry.io/0';

if (process.env.CHILD_MODE === 'sdk-default') {
  Sentry.init({ dsn, transport });
} else {
  initSentry({ SENTRY_DSN: dsn } as NodeJS.ProcessEnv, { transport });
}

void Promise.reject(new Error('boot failed'));
setTimeout(() => {
  process.stdout.write('ALIVE\n');
  process.exit(0);
}, 1500);
