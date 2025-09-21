import { createServer } from '../src/createServer.js';
const port = Number(process.env.TEST_PORT || 4313);
const start = async () => {
    const app = await createServer({ enableTestRoutes: true });
    await app.listen({ port, host: '127.0.0.1' });
};
start().catch((e) => { console.error('test-server failed', e); process.exit(1); });
