import { createServer } from './server.js';

const PORT = Number(process.env.PORT || 4500);
const HOST = '0.0.0.0';

async function start() {
  const app = await createServer();

  await app.listen({ port: PORT, host: HOST });
  app.log.info({ port: PORT }, 'Jobs service started');

  // Graceful shutdown
  const signals = ['SIGINT', 'SIGTERM'] as const;
  for (const signal of signals) {
    process.on(signal, async () => {
      app.log.info({ signal }, 'Shutting down');
      try {
        await app.close();
        process.exit(0);
      } catch (error) {
        app.log.error({ error }, 'Error during shutdown');
        process.exit(1);
      }
    });
  }
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});