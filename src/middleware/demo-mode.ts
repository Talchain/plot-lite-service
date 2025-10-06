/**
 * Demo Mode Middleware
 * Detects ?demo=1 or X-Demo: 1 header
 */

import type { FastifyRequest } from 'fastify';

/**
 * Check if request is in demo mode
 */
export function isDemoMode(req: FastifyRequest): boolean {
  // Check query parameter
  const query = (req as any).query || {};
  if (query.demo === '1' || query.demo === 'true') {
    return true;
  }

  // Check header
  const demo_header = req.headers['x-demo'];
  if (demo_header === '1' || demo_header === 'true') {
    return true;
  }

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
