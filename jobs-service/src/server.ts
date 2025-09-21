import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ulid } from 'ulid';
import { readFileSync } from 'fs';
import { createJobRepository } from './repositories/index.js';
import { CreateJobSchema, JobQuerySchema, JobParamsSchema, JobDetailsQuerySchema } from './schemas/job.js';
import { validateBody, validateQuery, validateParams } from './middleware/validation.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { requireApiKey } from './middleware/auth.js';
import { JobWorker, WorkerConfig } from './worker/index.js';
import { createJobHandlers } from './handlers/index.js';

export async function createServer() {
  const jobRepo = createJobRepository();

  // Create job worker
  const workerConfig: WorkerConfig = {
    globalMaxConcurrency: Number(process.env.GLOBAL_MAX_CONCURRENCY || 10),
    orgMaxConcurrency: Number(process.env.ORG_MAX_CONCURRENCY || 2),
    jobMaxRunMs: Number(process.env.JOB_MAX_RUN_MS || 120000),
    pollIntervalMs: 1000, // 1 second
  };

  const jobHandlers = createJobHandlers();
  const jobWorker = new JobWorker(jobRepo, jobHandlers, workerConfig);

  const app = Fastify({
    logger: {
      level: 'info',
      redact: ['req.body', 'reply.body', 'payload'],
    },
    genReqId: () => ulid(),
  });

  // Security
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // CORS (dev-friendly)
  if (process.env.CORS_DEV === '1') {
    await app.register(cors, {
      origin: ['http://localhost:3000', 'http://localhost:5173'],
      credentials: true,
    });
  }

  // OpenAPI documentation
  await app.register(swagger, {
    mode: 'static',
    specification: {
      path: './contracts/openapi.yaml',
      baseDir: '.',
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
  });

  // Echo X-Request-ID
  app.addHook('onRequest', async (request, reply) => {
    const requestId = request.id;
    reply.header('X-Request-ID', requestId);
  });

  // Start the worker
  await jobWorker.start();

  // Health endpoint with repository and worker stats
  app.get('/health', async () => {
    const repoStats = await jobRepo.getStats();
    const workerStats = jobWorker.getStats();
    const repoKind = process.env.REPO_KIND || 'memory';

    return {
      ok: true,
      ...repoStats,
      worker: workerStats,
      repo: { kind: repoKind },
      concurrency: {
        global: Number(process.env.GLOBAL_MAX_CONCURRENCY || 10),
        perOrg: Number(process.env.ORG_MAX_CONCURRENCY || 2),
      },
    };
  });

  // Job API routes

  // POST /jobs - Create a new job
  app.post('/jobs', {
    preHandler: [rateLimitMiddleware, validateBody(CreateJobSchema)],
  }, async (request, reply) => {
    const data = (request as any).validatedBody;
    const maxPayloadBytes = Number(process.env.JOB_MAX_PAYLOAD_BYTES || 65536);

    // Check payload size
    if (data.payload) {
      const payloadSize = Buffer.byteLength(JSON.stringify(data.payload), 'utf8');
      if (payloadSize > maxPayloadBytes) {
        reply.code(413).send({
          error: 'Payload Too Large',
          message: `Payload exceeds maximum size of ${maxPayloadBytes} bytes`,
          code: 'PAYLOAD_TOO_LARGE',
        });
        return;
      }
    }

    // Handle idempotency
    const idempotencyKey = request.headers['idempotency-key'] as string;
    if (idempotencyKey) {
      // Check for existing job with same type, orgId, and idempotency key within last 24h
      const existing = await jobRepo.findByIdempotencyKey(data.type, data.orgId, idempotencyKey, 24);

      if (existing) {
        reply.code(200).send({ jobId: existing.id });
        return;
      }
    }

    // Parse runAt if provided
    let runAt: Date | undefined;
    if (data.runAt) {
      runAt = new Date(data.runAt);
    }

    const job = await jobRepo.create({
      type: data.type,
      orgId: data.orgId,
      payload: data.payload,
      maxAttempts: data.maxAttempts,
      runAt,
      idempotencyKey,
    });

    reply.code(201).send({ jobId: job.id });
  });

  // GET /jobs - List jobs
  app.get('/jobs', {
    preHandler: [validateQuery(JobQuerySchema)],
  }, async (request) => {
    const query = (request as any).validatedQuery;

    // Convert string dates to Date objects
    const searchQuery: any = { ...query };
    if (query.from) {
      searchQuery.from = new Date(query.from);
    }

    const result = await jobRepo.find(searchQuery);

    // Optionally exclude payload from response
    const jobs = result.jobs.map(job => {
      if (query.includePayload === '0') {
        const { payload, ...jobWithoutPayload } = job;
        return jobWithoutPayload;
      }
      return job;
    });

    return {
      jobs,
      nextCursor: result.nextCursor,
    };
  });

  // GET /jobs/:jobId - Get job details
  app.get('/jobs/:jobId', {
    preHandler: [validateParams(JobParamsSchema), validateQuery(JobDetailsQuerySchema)],
  }, async (request, reply) => {
    const { jobId } = (request as any).validatedParams;
    const { includePayload } = (request as any).validatedQuery;

    const job = await jobRepo.get(jobId);
    if (!job) {
      reply.code(404).send({
        error: 'Not Found',
        message: 'Job not found',
        code: 'JOB_NOT_FOUND',
      });
      return;
    }

    if (includePayload === '0') {
      const { payload, ...jobWithoutPayload } = job;
      return jobWithoutPayload;
    }

    return job;
  });

  // POST /jobs/:jobId/cancel - Cancel a job
  app.post('/jobs/:jobId/cancel', {
    preHandler: [validateParams(JobParamsSchema)],
  }, async (request, reply) => {
    const { jobId } = (request as any).validatedParams;

    const job = await jobRepo.get(jobId);
    if (!job) {
      reply.code(404).send({
        error: 'Not Found',
        message: 'Job not found',
        code: 'JOB_NOT_FOUND',
      });
      return;
    }

    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      reply.code(409).send({
        error: 'Conflict',
        message: `Job cannot be cancelled in ${job.status} state`,
        code: 'INVALID_STATE',
      });
      return;
    }

    // Try to cancel running job first
    const wasCancelled = await jobWorker.cancelJob(jobId);

    const updatedJob = await jobRepo.updatePartial(jobId, {
      status: 'cancelled',
      finishedAt: new Date(),
    });

    reply.code(202).send({
      message: 'Cancel request accepted',
      status: updatedJob!.status,
    });
  });

  // POST /jobs/:jobId/retry - Retry a failed job
  app.post('/jobs/:jobId/retry', {
    preHandler: [validateParams(JobParamsSchema)],
  }, async (request, reply) => {
    const { jobId } = (request as any).validatedParams;

    const job = await jobRepo.get(jobId);
    if (!job) {
      reply.code(404).send({
        error: 'Not Found',
        message: 'Job not found',
        code: 'JOB_NOT_FOUND',
      });
      return;
    }

    if (job.status !== 'failed') {
      reply.code(409).send({
        error: 'Conflict',
        message: 'Only failed jobs can be retried',
        code: 'INVALID_STATE',
      });
      return;
    }

    // Calculate backoff delay
    const backoffMs = Math.min(1000 * Math.pow(2, job.attempts), 60000); // Cap at 1 minute
    const jitter = Math.random() * 0.1 * backoffMs; // 10% jitter
    const runAt = new Date(Date.now() + backoffMs + jitter);

    const updatedJob = await jobRepo.updatePartial(jobId, {
      status: 'queued',
      runAt,
      error: null,
      finishedAt: null,
    });

    return {
      message: 'Job queued for retry',
      job: updatedJob,
    };
  });

  // GET /jobs/:jobId/stream - SSE stream (placeholder for now)
  app.get('/jobs/:jobId/stream', {
    preHandler: [validateParams(JobParamsSchema)],
  }, async (request, reply) => {
    if (process.env.SSE_ENABLED !== '1') {
      reply.code(404).send({
        error: 'Not Found',
        message: 'SSE streaming not enabled',
        code: 'SSE_DISABLED',
      });
      return;
    }

    const { jobId } = (request as any).validatedParams;

    reply.header('Content-Type', 'text/event-stream');
    reply.header('Cache-Control', 'no-cache');
    reply.header('Connection', 'keep-alive');

    // Send initial job status
    const job = await jobRepo.get(jobId);
    if (!job) {
      reply.raw.write('event: error\ndata: {"error": "Job not found"}\n\n');
      reply.raw.end();
      return;
    }

    reply.raw.write(`event: status\ndata: ${JSON.stringify({
      id: job.id,
      status: job.status,
      progress: job.progress,
    })}\n\n`);

    // For now, just close the stream
    // In Phase 5, we'll implement real-time updates
    reply.raw.end();
  });

  // POST /webhooks/test - Test webhook (dev only)
  app.post('/webhooks/test', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      reply.code(404).send({
        error: 'Not Found',
        message: 'Test endpoints not available in production',
        code: 'NOT_AVAILABLE',
      });
      return;
    }

    const { url } = request.body as { url: string };

    try {
      const testPayload = {
        event: 'job.test',
        occurredAt: new Date().toISOString(),
        job: {
          id: ulid(),
          type: 'test',
          orgId: 'test-org',
          status: 'completed',
          progress: 1,
        },
      };

      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': 'test-signature',
        },
        body: JSON.stringify(testPayload),
      });

      return { success: true };
    } catch (error) {
      reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Failed to send test webhook',
        code: 'WEBHOOK_FAILED',
      });
    }
  });

  // Add cleanup on server close
  app.addHook('onClose', async () => {
    await jobWorker.stop();
  });

  return app;
}