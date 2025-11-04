/**
 * Assistants Proxy Guard
 *
 * Shared safety rails for both JSON and SSE proxy routes.
 * Enforces:
 * - Request payload limits (≤1MB)
 * - Response size limits
 * - SSE duration caps
 * - Idle timeout detection
 * - Post-proxy engine validation
 */

import { getProxyConfig } from './config.js';
import { getCostCap } from '../utils/cost.js';
import type { FastifyRequest } from 'fastify';

/**
 * Error envelope for consistent error responses
 */
export interface GuardError {
  type: 'BAD_INPUT' | 'PAYLOAD_TOO_LARGE' | 'TIMEOUT' | 'UPSTREAM_ERROR' | 'VALIDATION_FAILED';
  message: string;
  details?: unknown;
}

/**
 * Validation result from engine validator
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  issues?: Array<{ field: string; message: string }>;
}

/**
 * Guard request payload size.
 * Rejects requests exceeding 1MB before proxying.
 *
 * @throws GuardError if payload too large
 */
export function guardRequestSize(request: FastifyRequest): void {
  const contentLength = request.headers['content-length'];

  if (contentLength) {
    const sizeBytes = parseInt(contentLength, 10);
    const maxBytes = 1_000_000; // 1MB

    if (sizeBytes > maxBytes) {
      throw createGuardError(
        'PAYLOAD_TOO_LARGE',
        `Request payload ${sizeBytes} bytes exceeds maximum ${maxBytes} bytes`
      );
    }
  }

  // Also check parsed body size if available
  if (request.body) {
    const bodyJson = JSON.stringify(request.body);
    const sizeBytes = Buffer.byteLength(bodyJson, 'utf8');
    const maxBytes = 1_000_000;

    if (sizeBytes > maxBytes) {
      throw createGuardError(
        'PAYLOAD_TOO_LARGE',
        `Request payload ${sizeBytes} bytes exceeds maximum ${maxBytes} bytes`
      );
    }
  }
}

/**
 * Guard response size.
 * Checks if response body exceeds configured limit.
 *
 * @throws GuardError if response too large
 */
export function guardResponseSize(body: unknown): void {
  const config = getProxyConfig();
  const bodyJson = JSON.stringify(body);
  const sizeBytes = Buffer.byteLength(bodyJson, 'utf8');

  if (sizeBytes > config.maxResponseBytes) {
    throw createGuardError(
      'PAYLOAD_TOO_LARGE',
      `Response ${sizeBytes} bytes exceeds maximum ${config.maxResponseBytes} bytes`
    );
  }
}

/**
 * Validate brief input
 */
export function validateBrief(brief: unknown): void {
  if (typeof brief !== 'string' || brief.trim().length === 0) {
    throw createGuardError('BAD_INPUT', 'Brief is required and must be a non-empty string');
  }

  if (brief.length > 5000) {
    throw createGuardError('BAD_INPUT', `Brief too long (${brief.length} chars, max 5000)`);
  }
}

/**
 * Create a guard error with consistent structure
 */
export function createGuardError(
  type: GuardError['type'],
  message: string,
  details?: unknown
): GuardError {
  return { type, message, details };
}

const MAX_NODES = 12;
const MAX_EDGES = 24;

function ensureArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function guardGraphShape(graph: unknown): void {
  if (!graph || typeof graph !== 'object') {
    throw createGuardError('VALIDATION_FAILED', 'Draft graph must be an object');
  }

  const nodes = ensureArray((graph as any).nodes);
  const edges = ensureArray((graph as any).edges);

  if (nodes.length > MAX_NODES) {
    throw createGuardError('VALIDATION_FAILED', `Graph has ${nodes.length} nodes, max is ${MAX_NODES}`);
  }

  if (edges.length > MAX_EDGES) {
    throw createGuardError('VALIDATION_FAILED', `Graph has ${edges.length} edges, max is ${MAX_EDGES}`);
  }
}

export function guardDraftGraphResponse(body: unknown): void {
  if (!body || typeof body !== 'object') {
    throw createGuardError('UPSTREAM_ERROR', 'Upstream response payload missing');
  }

  if (!('graph' in (body as any))) {
    throw createGuardError('VALIDATION_FAILED', 'Draft graph response missing graph payload');
  }

  guardGraphShape((body as any).graph);

  if (!('cost_usd' in (body as any))) {
    throw createGuardError('VALIDATION_FAILED', 'Draft graph response missing cost_usd for cost guard');
  }

  const costUsd = Number((body as any).cost_usd);
  if (!Number.isFinite(costUsd)) {
    throw createGuardError('VALIDATION_FAILED', 'Draft graph cost_usd must be numeric');
  }

  const costCap = getCostCap();
  if (costUsd > costCap) {
    throw createGuardError(
      'VALIDATION_FAILED',
      `Draft cost $${costUsd.toFixed(4)} exceeds cap $${costCap.toFixed(2)}`
    );
  }
}

/**
 * SSE Stream Guard
 *
 * Tracks bytes written and duration to enforce caps.
 * Usage:
 *   const guard = new SSEStreamGuard();
 *   guard.trackChunk(chunk);
 *   if (guard.shouldAbort()) { ... }
 */
export class SSEStreamGuard {
  private bytesWritten = 0;
  private startMs: number;
  private lastChunkMs: number;
  private aborted = false;

  constructor() {
    this.startMs = Date.now();
    this.lastChunkMs = Date.now();
  }

  /**
   * Track a chunk being written to the stream
   */
  trackChunk(chunk: string | Buffer): void {
    const size = typeof chunk === 'string'
      ? Buffer.byteLength(chunk, 'utf8')
      : chunk.length;

    this.bytesWritten += size;
    this.lastChunkMs = Date.now();
  }

  /**
   * Check if stream should abort due to caps
   */
  shouldAbort(): { abort: boolean; reason?: string } {
    if (this.aborted) {
      return { abort: true, reason: 'already_aborted' };
    }

    const config = getProxyConfig();

    // Check duration cap
    const durationMs = Date.now() - this.startMs;
    if (durationMs > config.sseTimeoutMs) {
      this.aborted = true;
      return {
        abort: true,
        reason: `Stream duration ${durationMs}ms exceeds limit ${config.sseTimeoutMs}ms`,
      };
    }

    // Check idle timeout (no chunks for 10s)
    const idleMs = Date.now() - this.lastChunkMs;
    if (idleMs > 10000) {
      this.aborted = true;
      return {
        abort: true,
        reason: `Stream idle for ${idleMs}ms (no activity for 10s)`,
      };
    }

    // Check bytes cap
    if (this.bytesWritten > config.maxResponseBytes) {
      this.aborted = true;
      return {
        abort: true,
        reason: `Stream size ${this.bytesWritten} bytes exceeds limit ${config.maxResponseBytes} bytes`,
      };
    }

    return { abort: false };
  }

  /**
   * Get stream metrics for telemetry
   */
  getMetrics(): { bytesWritten: number; durationMs: number } {
    return {
      bytesWritten: this.bytesWritten,
      durationMs: Date.now() - this.startMs,
    };
  }
}

/**
 * Run engine validation on a draft graph response.
 * Non-blocking; returns issues if found but doesn't throw.
 *
 * This validates the graph structure using the engine's validator
 * but doesn't mutate the upstream payload.
 */
export async function runEngineValidation(graph: unknown): Promise<ValidationResult> {
  try {
    // Import validator dynamically to avoid circular deps
    const { validateGraph } = await import('../../trust/validator.js');

    // Basic type guard
    if (!graph || typeof graph !== 'object') {
      return {
        valid: false,
        errors: ['Graph must be an object'],
      };
    }

    const result = validateGraph(graph as any);

    return {
      valid: result.valid,
      errors: result.errors,
    };
  } catch (err: any) {
    // Don't fail the request if validator throws
    return {
      valid: true, // Assume valid if validator errors
      issues: [{
        field: 'validator',
        message: `Validation error: ${err.message}`,
      }],
    };
  }
}

/**
 * Format validation issues for response
 */
export function formatValidationIssues(result: ValidationResult): Array<{ field: string; message: string }> {
  const issues: Array<{ field: string; message: string }> = [];

  if (result.errors) {
    result.errors.forEach(error => {
      issues.push({ field: 'graph', message: error });
    });
  }

  if (result.issues) {
    issues.push(...result.issues);
  }

  return issues;
}
