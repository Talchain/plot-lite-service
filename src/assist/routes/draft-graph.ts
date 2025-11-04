/**
 * POST /assist/draft-graph - Draft decision graph from brief (PROXY)
 * POST /assist/draft-graph/stream - SSE streaming version (PROXY)
 *
 * These routes proxy requests to the standalone assistants service.
 * Both routes use shared guards for consistent safety rails.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { proxyRequest } from '../proxy/client.js';
import {
  guardRequestSize,
  guardResponseSize,
  guardDraftGraphResponse,
  validateBrief,
  createGuardError,
  runEngineValidation,
  formatValidationIssues,
  SSEStreamGuard,
} from '../proxy/guard.js';
import { getProxyConfig } from '../proxy/config.js';

interface DraftGraphRequest {
  brief: string;
  seed?: number;
  docs?: Array<{
    filename: string;
    content_type: string;
    preview: string;
    page_count?: number;
  }>;
}

/**
 * Register assistants proxy routes on the Fastify app
 */
export async function registerAssistRoutes(app: FastifyInstance) {
  // JSON endpoint - proxies to upstream
  app.post('/assist/draft-graph', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as DraftGraphRequest;

    try {
      // Apply guards
      guardRequestSize(request);
      validateBrief(body.brief);

      // Telemetry: request start
      const startMs = Date.now();
      app.log.info({
        event: 'assist.proxy.request',
        method: 'POST',
        route: '/assist/draft-graph',
        requestId: request.id,
      }, 'Proxying draft-graph request');

      // Proxy to upstream
      const proxyResponse = await proxyRequest({
        method: 'POST',
        path: '/assist/draft-graph',
        body: {
          brief: body.brief,
          seed: body.seed || 17,
          docs: body.docs || [],
        },
        requestId: request.id,
      });

      const latencyMs = Date.now() - startMs;

      // Handle upstream error responses
      if (proxyResponse.status >= 400) {
        app.log.warn({
          event: 'assist.proxy.response',
          status: proxyResponse.status,
          latencyMs,
          retried: proxyResponse.retried,
        }, 'Upstream returned error');

        return reply.code(proxyResponse.status).send(proxyResponse.body);
      }

      // Guard response: size, shape (node/edge caps), and cost presence
      guardResponseSize(proxyResponse.body);
      guardDraftGraphResponse(proxyResponse.body);

      // Run engine validation on the draft graph (non-blocking)
      const responseBody = proxyResponse.body as any;
      if (responseBody.graph) {
        const validationResult = await runEngineValidation(responseBody.graph);

        if (!validationResult.valid) {
          const issues = formatValidationIssues(validationResult);

          // Include validation issues in response without failing the request
          responseBody.validation_issues = issues;

          app.log.warn({
            event: 'assist.proxy.validation',
            issues: issues.length,
          }, 'Engine validation found issues in draft graph');
        }
      }

      // Telemetry: success (always include provider and cost_usd with fallbacks)
      const provider = responseBody.provider || 'unknown';
      const costUsd = typeof responseBody.cost_usd === 'number' ? responseBody.cost_usd : 0;

      app.log.info({
        event: 'assist.proxy.response',
        status: proxyResponse.status,
        latencyMs,
        retried: proxyResponse.retried,
        bytes: JSON.stringify(proxyResponse.body).length,
        has_validation_issues: !!responseBody.validation_issues,
        provider,
        cost_usd: costUsd,
        ...(responseBody.model && { model: responseBody.model }),
      }, 'Draft graph proxy completed');

      return proxyResponse.body;

    } catch (error: any) {
      app.log.error({
        error: error.message,
        code: error.code,
        type: error.type,
        status: error.status,
      }, 'Draft graph proxy failed');

      const statusCode = error.type === 'BAD_INPUT' ? 400 :
        error.type === 'VALIDATION_FAILED' ? 400 :
        error.type === 'PAYLOAD_TOO_LARGE' ? 413 :
        error.type === 'TIMEOUT' ? 504 :
        error.code === 'PROXY_DISABLED' ? 503 :
        error.code === 'UPSTREAM_FAILURE' ? 502 :
        500;

      return reply.code(statusCode).send({
        error: {
          type: error.type || error.code || 'INTERNAL_ERROR',
          message: error.message || 'Internal server error',
        },
      });
    }
  });

  // SSE streaming endpoint - proxies upstream SSE stream
  app.post('/assist/draft-graph/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as DraftGraphRequest;

    try {
      // Apply guards
      guardRequestSize(request);
      validateBrief(body.brief);

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      // Initialize stream guard
      const streamGuard = new SSEStreamGuard();

      const config = getProxyConfig();
      const upstreamUrl = `${config.baseUrl}/assist/draft-graph/stream`;

      app.log.info({
        event: 'assist.proxy.sse_start',
        requestId: request.id,
        upstream_url: upstreamUrl,
      }, 'Starting SSE proxy stream');

      // Create fetch request with streaming
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), config.sseTimeoutMs);

      try {
        const upstreamResponse = await fetch(upstreamUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-request-id': request.id,
          },
          body: JSON.stringify({
            brief: body.brief,
            seed: body.seed || 17,
            docs: body.docs || [],
          }),
          signal: controller.signal,
        });

        if (!upstreamResponse.ok) {
          clearTimeout(timeoutHandle);

          // Send error event
          const errorData = {
            error: {
              type: 'UPSTREAM_ERROR',
              message: `Upstream returned ${upstreamResponse.status}`,
            },
          };
          reply.raw.write(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`);
          reply.raw.end();

          app.log.warn({
            event: 'assist.proxy.sse_abort',
            reason: 'upstream_error',
            status: upstreamResponse.status,
          }, 'SSE proxy aborted');
          return;
        }

        // Stream upstream response to client
        const reader = upstreamResponse.body?.getReader();
        if (!reader) {
          throw new Error('No readable stream from upstream');
        }

        const decoder = new TextDecoder();
        let buffer = ''; // Accumulate partial lines
        let currentEventType = ''; // Track event type (stage, complete, error)
        let currentEventDataLines: string[] = []; // Accumulate data lines for current event (RFC 8895)

        while (true) {
          // Check guards before reading next chunk
          const guardCheck = streamGuard.shouldAbort();
          if (guardCheck.abort) {
            clearTimeout(timeoutHandle);
            reader.cancel();

            // Send abort error event
            const errorData = {
              error: {
                type: 'TIMEOUT',
                message: guardCheck.reason,
              },
            };
            reply.raw.write(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`);
            reply.raw.end();

            const metrics = streamGuard.getMetrics();
            app.log.warn({
              event: 'assist.proxy.sse_abort',
              reason: guardCheck.reason,
              ...metrics,
            }, 'SSE proxy aborted due to guard');
            return;
          }

          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Decode chunk and add to buffer
          const chunk = decoder.decode(value, { stream: true });
          streamGuard.trackChunk(chunk);
          buffer += chunk;

          // Process complete lines
          while (buffer.includes('\n')) {
            const newlineIndex = buffer.indexOf('\n');
            const line = buffer.substring(0, newlineIndex);
            buffer = buffer.substring(newlineIndex + 1);

            // Parse SSE line
            if (line.startsWith('event:')) {
              currentEventType = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              // RFC 8895: Preserve data as-is (don't trim), accumulate multiple data lines
              currentEventDataLines.push(line.substring(5));
            } else if (line === '' || line === '\r') {
              // Event boundary - process complete event
              if (currentEventType === 'complete' && currentEventDataLines.length > 0) {
                // Validate complete event before forwarding
                try {
                  // Join multiple data lines with newline (RFC 8895), trim trailing whitespace only
                  const eventData = currentEventDataLines.join('\n').trimEnd();
                  const parsed = JSON.parse(eventData);

                  // Apply post-response guard (same as JSON route)
                  guardDraftGraphResponse(parsed);

                  // Run non-blocking engine validation
                  if (parsed.graph) {
                    const validationResult = await runEngineValidation(parsed.graph);
                    if (!validationResult.valid) {
                      const issues = formatValidationIssues(validationResult);
                      parsed.validation_issues = issues;

                      app.log.warn({
                        event: 'assist.proxy.validation',
                        issues: issues.length,
                      }, 'SSE: Engine validation found issues in draft graph');
                    }
                  }

                  // Extract telemetry metadata (with fallbacks)
                  const provider = parsed.provider || 'unknown';
                  const costUsd = typeof parsed.cost_usd === 'number' ? parsed.cost_usd : 0;
                  streamGuard.setCompleteMetadata({ provider, cost_usd: costUsd });

                  // Forward validated complete event
                  reply.raw.write(`event: complete\ndata: ${JSON.stringify(parsed)}\n\n`);
                } catch (error: any) {
                  // Guard or validation failed - emit error and close stream
                  clearTimeout(timeoutHandle);
                  reader.cancel();

                  const errorData = {
                    error: {
                      type: error.type || 'VALIDATION_FAILED',
                      message: error.message || 'Validation failed',
                    },
                  };
                  reply.raw.write(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`);
                  reply.raw.end();

                  app.log.warn({
                    event: 'assist.proxy.sse_abort',
                    reason: 'validation_failed',
                    error: error.message,
                    error_type: error.type,
                  }, 'SSE aborted due to validation failure');
                  return;
                }
              } else if (currentEventType && currentEventDataLines.length > 0) {
                // Forward other events (stage, error) immediately
                // Join multiple data lines with newline (RFC 8895)
                const eventData = currentEventDataLines.join('\n');
                reply.raw.write(`event: ${currentEventType}\ndata: ${eventData}\n\n`);
              }

              // Reset for next event
              currentEventType = '';
              currentEventDataLines = [];
            }
          }
        }

        clearTimeout(timeoutHandle);
        reply.raw.end();

        const metrics = streamGuard.getMetrics();
        const completeMetadata = streamGuard.getCompleteMetadata();
        app.log.info({
          event: 'assist.proxy.sse_complete',
          ...metrics,
          provider: completeMetadata.provider,
          cost_usd: completeMetadata.cost_usd,
        }, 'SSE proxy stream completed');

      } catch (streamError: any) {
        clearTimeout(timeoutHandle);

        // Send error event if stream failed
        const errorData = {
          error: {
            type: streamError.name === 'AbortError' ? 'TIMEOUT' : 'UPSTREAM_ERROR',
            message: streamError.message || 'Stream failed',
          },
        };
        reply.raw.write(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`);
        reply.raw.end();

        const metrics = streamGuard.getMetrics();
        app.log.error({
          event: 'assist.proxy.sse_abort',
          reason: 'stream_error',
          error: streamError.message,
          ...metrics,
        }, 'SSE proxy stream failed');
      }

    } catch (error: any) {
      // Send error event
      const errorData = {
        error: {
          type: error.type || error.code || 'INTERNAL_ERROR',
          message: error.message || 'Internal server error',
        },
      };
      reply.raw.write(`event: error\ndata: ${JSON.stringify(errorData)}\n\n`);
      reply.raw.end();

      app.log.error({
        error: error.message,
        code: error.code,
      }, 'SSE proxy setup failed');
    }
  });

  app.log.info(
    { routes: ['/assist/draft-graph', '/assist/draft-graph/stream'] },
    'Assistants proxy routes registered'
  );
}
