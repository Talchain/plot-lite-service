import { createServer } from '../src/createServer.js';
const port = Number(process.env.TEST_PORT || 4313);
const start = async () => {
    const app = await createServer({ enableTestRoutes: true });
    // SIGHUP hot-reload: refresh runtime config and record reload timestamp
    process.on('SIGHUP', async () => {
        try {
            const { loadFromFile, refreshFromEnv } = await import('../src/config/runtimeConfig.js');
            const { setLastConfigReloadISO } = await import('../src/metrics.js');
            const cfgPath = process.env.RUNTIME_CONFIG_PATH;
            if (cfgPath) {
                loadFromFile(cfgPath);
            }
            else {
                refreshFromEnv();
            }
            setLastConfigReloadISO(new Date().toISOString());
        }
        catch (err) {
            console.error('runtime config reload failed', err);
        }
    });
    await app.listen({ port, host: '127.0.0.1' });
};
start().catch((e) => { console.error('test-server failed', e); process.exit(1); });
