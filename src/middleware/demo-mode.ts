/**
 * Demo Mode Middleware
 * Detects ?demo=1 or X-Demo: 1 header
 *
 * IMPORTANT: Demo mode is gated behind DEMO_MODE_ENABLED environment variable.
 * This prevents accidental demo mode activation in production.
 */

import type { FastifyRequest } from 'fastify';

/**
 * Check if demo mode feature is enabled globally
 */
export function isDemoModeEnabled(): boolean {
  const flag = process.env.DEMO_MODE_ENABLED;
  return flag === 'true' || flag === '1';
}

/**
 * Check if request is in demo mode
 *
 * Returns false if DEMO_MODE_ENABLED is not set (production safety).
 * Only checks for demo indicators when the feature is enabled.
 */
export function isDemoMode(req: FastifyRequest): boolean {
  // Safety gate: demo mode must be explicitly enabled
  if (!isDemoModeEnabled()) {
    return false;
  }

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
