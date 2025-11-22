/**
 * Test helper for starting Fastify server with consistent configuration
 * Always uses app.listen({ port: 0 }) for reliable E2E/integration tests
 */

import type { FastifyInstance } from 'fastify';

export interface ServerTestContext {
  app: FastifyInstance;
  baseUrl: string;
  port: number;
}

/**
 * Start a Fastify server for testing
 * 
 * @param app - Fastify instance to start
 * @returns Server context with app, baseUrl, and port
 * 
 * @example
 * ```typescript
 * const app = await createServer();
 * const { baseUrl } = await startServer(app);
 * 
 * // Make requests
 * await fetch(`${baseUrl}/v1/health`);
 * 
 * // Cleanup
 * await app.close();
 * ```
 */
export async function startServer(app: FastifyInstance): Promise<ServerTestContext> {
  // Listen on random available port
  await app.listen({ port: 0 });
  
  // Extract actual port
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 3000;
  
  // Build base URL
  const baseUrl = `http://127.0.0.1:${port}`;
  
  return { app, baseUrl, port };
}

/**
 * Cleanup helper - closes server gracefully
 * 
 * @param app - Fastify instance to close
 * 
 * @example
 * ```typescript
 * afterAll(async () => {
 *   await closeServer(app);
 * });
 * ```
 */
export async function closeServer(app: FastifyInstance): Promise<void> {
  await app.close();
}
