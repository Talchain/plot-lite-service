import { createHash } from 'crypto';

export interface CacheKeyInput {
  route: string;
  orgId?: string;
  userId?: string;
  body: any;
  seed?: number;
  templateId?: string;
  policy?: string;
}

/**
 * Canonical JSON stringify - ensures deterministic string representation
 * Sorts keys recursively and handles undefined/null consistently
 */
export function canonicalStringify(obj: any): string {
  if (obj === null) return 'null';
  if (obj === undefined) return 'undefined';
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }

  const keys = Object.keys(obj).sort();
  const pairs = keys.map(key => `${JSON.stringify(key)}:${canonicalStringify(obj[key])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Generate deterministic cache key from request components
 */
export function makeCacheKey(input: CacheKeyInput): string {
  const keyData = {
    route: input.route,
    orgId: input.orgId || null,
    userId: input.userId || null,
    body: input.body,
    seed: input.seed || null,
    templateId: input.templateId || null,
    policy: input.policy || null
  };

  const canonical = canonicalStringify(keyData);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/**
 * Generate cache tags for targeted invalidation
 */
export function makeCacheTags(input: CacheKeyInput): string[] {
  const tags: string[] = [`route:${input.route}`];

  if (input.orgId) {
    tags.push(`org:${input.orgId}`);
  }

  return tags;
}

/**
 * Extract relevant fields from request body for cache key
 */
export function extractKeyFields(body: any): Pick<CacheKeyInput, 'seed' | 'templateId' | 'policy'> {
  return {
    seed: typeof body?.seed === 'number' ? body.seed : undefined,
    templateId: typeof body?.templateId === 'string' ? body.templateId : undefined,
    policy: typeof body?.policy === 'string' ? body.policy : undefined
  };
}