import { JobRepository } from './base.js';
import { InMemoryJobRepository } from './memory.js';
import { RedisJobRepository } from './redis.js';

export * from './base.js';
export * from './memory.js';
export * from './redis.js';

export function createJobRepository(): JobRepository {
  const repoKind = process.env.REPO_KIND || 'memory';

  switch (repoKind) {
    case 'memory':
      return new InMemoryJobRepository();

    case 'redis':
      const url = process.env.UPSTASH_REDIS_REST_URL;
      const token = process.env.UPSTASH_REDIS_REST_TOKEN;

      if (!url || !token) {
        throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set when REPO_KIND=redis');
      }

      return new RedisJobRepository(url, token);

    default:
      throw new Error(`Unknown repository kind: ${repoKind}`);
  }
}