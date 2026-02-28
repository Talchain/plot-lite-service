// @ts-expect-error — dist/ has no .d.ts; types checked via src/ tsconfig
import { createServer } from '../dist/createServer.js';

const port = Number(process.env.TEST_PORT || 4313);

const start = async () => {
  const app = await createServer({ enableTestRoutes: true });

  // SIGHUP hot-reload: refresh runtime config and record reload timestamp
  process.on('SIGHUP', async () => {
    try {
      // @ts-expect-error — dist/ has no .d.ts
      const { loadFromFile, refreshFromEnv } = await import('../dist/config/runtimeConfig.js');
      // @ts-expect-error — dist/ has no .d.ts
      const { setLastConfigReloadISO } = await import('../dist/metrics.js');
      const cfgPath = process.env.RUNTIME_CONFIG_PATH;
      if (cfgPath) {
        loadFromFile(cfgPath);
      } else {
        refreshFromEnv();
      }
      setLastConfigReloadISO(new Date().toISOString());
    } catch (err) {
      console.error('runtime config reload failed', err);
    }
  });

  await app.listen({ port, host: '127.0.0.1' });
};

start().catch((e) => { console.error('test-server failed', e); process.exit(1); });