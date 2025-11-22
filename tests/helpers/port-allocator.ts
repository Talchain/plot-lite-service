import net from 'node:net';

export async function getFreePort(preferred?: number, retries = 1): Promise<number> {
  function attempt(port?: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const srv = net.createServer();
      srv.unref();
      srv.on('error', (e) => reject(e));
      srv.listen({ port: port || 0, host: '127.0.0.1' }, () => {
        const addr = srv.address();
        const p = typeof addr === 'object' && addr ? addr.port : 0;
        srv.close(() => resolve(p));
      });
    });
  }
  try {
    return await attempt(preferred);
  } catch {
    if (retries > 0) return attempt(undefined);
    throw new Error('no free port');
  }
}
