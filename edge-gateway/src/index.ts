import Fastify from 'fastify';
import cors from '@fastify/cors';
import { BudgetManager } from './budget.js';
import { SessionManager } from './sessions.js';
import { TokenSimulator } from './simulator.js';
import { ProxyService } from './proxy.js';

const app = Fastify({
  logger: {
    level: 'info',
    transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined
  }
});

// Global managers
const budgetManager = new BudgetManager();
const sessionManager = new SessionManager();
const simulator = new TokenSimulator();

// Gateway mode configuration
const GATEWAY_MODE = process.env.GATEWAY_MODE || 'sim';
const PROXY_TARGET = process.env.PROXY_TARGET || 'http://localhost:4311';

const proxyService = new ProxyService({
  targetUrl: PROXY_TARGET,
  timeout: 30000
});

// CORS for development
await app.register(cors, {
  origin: true,
  credentials: true
});

// Add X-Request-ID if missing
app.addHook('onRequest', async (req, reply) => {
  if (!req.headers['x-request-id']) {
    req.headers['x-request-id'] = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  reply.header('X-Request-ID', req.headers['x-request-id']);
});

// Health check
app.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    activeSessions: sessionManager.getActiveSessionCount(),
    budgetBuckets: budgetManager.getBucketCount(),
    mode: GATEWAY_MODE,
    proxyTarget: GATEWAY_MODE === 'proxy' ? PROXY_TARGET : undefined
  };
});

// SSE Stream endpoint
app.get('/stream', async (req, reply) => {
  const { sessionId, org, route, seed } = req.query as any;
  const lastEventId = req.headers['last-event-id'] as string;

  if (!sessionId || !org) {
    return reply.code(400).send({ error: 'sessionId and org are required' });
  }

  // Budget check - consume 1 token to start stream
  if (!budgetManager.consume(org, 1)) {
    return reply.code(429).send({
      error: 'budget_exceeded',
      remaining: budgetManager.getRemainingTokens(org)
    });
  }

  // Parse resume index from Last-Event-ID
  const startIdx = lastEventId ? parseInt(lastEventId, 10) : 0;

  // Create session
  const controller = sessionManager.createSession(sessionId, org, route || 'stream', seed ? parseInt(seed) : undefined);

  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control',
    'X-Session-ID': sessionId
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    if (!controller.signal.aborted) {
      reply.raw.write(`event: heartbeat\ndata: ${JSON.stringify({ sessionId, ts: Date.now() })}\n\n`);
    }
  }, 15000);

  // Handle client disconnect
  req.raw.on('close', () => {
    clearInterval(heartbeatInterval);
    sessionManager.cancelSession(sessionId);
  });

  try {
    // Choose streaming source based on mode
    let eventStream;
    if (GATEWAY_MODE === 'proxy') {
      // Extract headers to forward
      const forwardHeaders: Record<string, string> = {};
      const headersToForward = ['x-request-id', 'x-org-id', 'x-user-id'];
      for (const header of headersToForward) {
        const value = req.headers[header];
        if (value) {
          forwardHeaders[header] = String(value);
        }
      }

      // Default to /critique route if not specified
      const proxyRoute = route || '/critique';

      // Create payload for critique endpoint
      const payload = {
        parse_json: {
          type: 'flow',
          steps: [
            {
              id: 'step1',
              type: 'ai_response',
              content: 'Generate a detailed response that will be streamed back token by token.'
            }
          ]
        }
      };

      eventStream = proxyService.streamFromUpstream(
        sessionId,
        proxyRoute,
        payload,
        forwardHeaders,
        controller.signal
      );
    } else {
      // Simulation mode
      eventStream = simulator.streamTokens(sessionId, startIdx, controller.signal);
    }

    // Stream events
    for await (const event of eventStream) {
      if (controller.signal.aborted) break;

      // Budget check for each token (except hello and heartbeat)
      if (event.event === 'token' && !budgetManager.consume(org, 1)) {
        reply.raw.write(`event: limit\ndata: ${JSON.stringify({
          sessionId,
          reason: 'budget_exceeded',
          remaining: budgetManager.getRemainingTokens(org),
          ts: Date.now()
        })}\n\n`);
        break;
      }

      // Track token count
      if (event.event === 'token') {
        sessionManager.incrementTokenCount(sessionId);
      }

      // Write SSE event
      reply.raw.write(`event: ${event.event}\n`);
      if (event.id) {
        reply.raw.write(`id: ${event.id}\n`);
      }
      reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({
        sessionId,
        error: 'stream_error',
        message: String(error),
        ts: Date.now()
      })}\n\n`);
    }
  } finally {
    clearInterval(heartbeatInterval);
    sessionManager.cancelSession(sessionId);
    reply.raw.end();
  }
});

// Cancel endpoint
app.post('/cancel', async (req, reply) => {
  const { sessionId } = req.body as any;

  if (!sessionId) {
    return reply.code(400).send({ error: 'sessionId is required' });
  }

  const cancelled = sessionManager.cancelSession(sessionId);

  return {
    success: cancelled,
    sessionId,
    timestamp: new Date().toISOString()
  };
});

// Debug endpoint for active sessions
app.get('/sessions', async () => {
  return {
    activeSessions: sessionManager.getAllSessions().map(s => ({
      sessionId: s.sessionId,
      orgId: s.orgId,
      route: s.route,
      startTime: s.startTime,
      tokenCount: s.tokenCount,
      duration: Date.now() - s.startTime
    }))
  };
});

// Cleanup interval
setInterval(() => {
  sessionManager.cleanup();
}, 5 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  budgetManager.destroy();
  app.close();
});

// Start server
const start = async () => {
  try {
    const port = Number(process.env.PORT || 3001);
    await app.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 Edge Gateway listening on port ${port}`);
    console.log(`📊 Budget: ${process.env.BUDGET_BURST || 200} burst, ${process.env.BUDGET_SUSTAINED_PER_MIN || 5000}/min sustained`);
    console.log(`🔄 Mode: ${GATEWAY_MODE}${GATEWAY_MODE === 'proxy' ? ` -> ${PROXY_TARGET}` : ''}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();