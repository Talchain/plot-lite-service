import { createServer } from './createServer.js';

const PORT = Number(process.env.PORT || 4311);
const HOST = '0.0.0.0';

async function start() {
  const app = await createServer({ enableTestRoutes: process.env.TEST_ROUTES === '1' });
  await app.listen({ port: PORT, host: HOST });
  app.log.info({ port: PORT }, 'server started');

  for (const sig of ['SIGINT','SIGTERM'] as const) {
    process.on(sig, async () => {
      app.log.info({ sig }, 'shutting down');
      try { await app.close(); process.exit(0); } catch { process.exit(1); }
    });
  }
}

start();