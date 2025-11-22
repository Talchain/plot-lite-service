import { createServer } from '../src/createServer.js';
const port = Number(process.env.TEST_PORT || 4314);
const start = async () => {
  const app = await createServer({ enableTestRoutes: false });
  await app.listen({ port, host: '127.0.0.1' });
};
start().catch((e) => { console.error('test-server-no-test-routes failed', e); process.exit(1); });
