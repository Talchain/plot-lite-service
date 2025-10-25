import { createServer } from '../../../src/createServer.js';
import type { FastifyInstance } from 'fastify';

export interface ServerInstance {
  app: FastifyInstance;
  url: string;
  port: number;
}

export async function startServer(env?: Record<string, string>): Promise<ServerInstance> {
  const originalEnv: Record<string, string | undefined> = {};
  if (env) {
    for (const [key, value] of Object.entries(env)) {
      originalEnv[key] = process.env[key];
      process.env[key] = value;
    }
  }
  
  const app = await createServer({ enableTestRoutes: false });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = (app.server.address() as any)?.port;
  const url = `http://127.0.0.1:${port}`;
  (app as any).__e2e_original_env = originalEnv;
  
  return { app, url, port };
}

export async function stopServer(instance: ServerInstance): Promise<void> {
  const originalEnv = (instance.app as any).__e2e_original_env;
  await instance.app.close();
  
  if (originalEnv) {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
