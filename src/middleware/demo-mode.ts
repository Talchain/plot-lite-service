/**
 * Demo Mode Middleware
 * Detects ?demo=1 or X-Demo: 1 header
 */

import type { FastifyRequest } from 'fastify';

/**
 * Check if request is in demo mode
 */
export function isDemoMode(req: FastifyRequest): boolean {
  const query = (req as any).query || {};
  const raw = query.demo ?? (req.headers['x-demo'] as any) ?? (req.headers['x-demo-mode'] as any);
  if (raw === 1 || raw === '1') return true;
  if (raw === true || raw === 'true') return true;
  return false;
}

/**
 * Get demo seed from request (for deterministic responses)
 */
export function getDemoSeed(req: FastifyRequest): number {
  const query = (req as any).query || {};
  const seed = parseInt(query.seed || '42', 10);
  return isNaN(seed) ? 42 : seed;
}
