/**
 * Swagger/OpenAPI Plugin
 * Exposes /openapi.json and /docs for API documentation
 */

import type { FastifyInstance } from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUI from '@fastify/swagger-ui';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export async function registerSwagger(app: FastifyInstance) {
  // Read version from package.json
  let version = '1.0.0';
  try {
    const pkgPath = resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    version = pkg.version || '1.0.0';
  } catch {}

  // Register Swagger
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'PLoT-Lite Service API',
        description: 'Deterministic causal inference engine with trust signals',
        version,
      },
      servers: [
        {
          url: 'https://plot-lite-service-staging.onrender.com',
          description: 'Staging',
        },
        {
          url: 'http://localhost:4311',
          description: 'Local development',
        },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  // Register Swagger UI
  await app.register(fastifySwaggerUI, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
  });

  // Expose /openapi.json route explicitly
  app.get('/openapi.json', async (req, reply) => {
    reply.type('application/json');
    return app.swagger();
  });
}
