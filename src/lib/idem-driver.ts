/**
 * Pluggable idempotency store driver (E2)
 */
import { BoundedLRU } from './BoundedLRU.js';
import { PrincipalQuotas } from './PrincipalQuotas.js';

export interface IdemDriver {
  get(principal: string, key: string): Promise<any | undefined>;
  set(principal: string, key: string, value: any, ttlMs: number): Promise<void>;
  size(): Promise<number>;
  principalsCount(): Promise<number>;
}

class MemoryIdemDriver implements IdemDriver {
  private cache = new BoundedLRU<any>({ maxSize: 5000, ttlMs: 10 * 60 * 1000 });
  private quotas = new PrincipalQuotas({ maxKeysPerPrincipal: 100 });

  async get(principal: string, key: string): Promise<any | undefined> {
    return this.cache.get(`${principal}:${key}`);
  }

  async set(principal: string, key: string, value: any, ttlMs: number): Promise<void> {
    const fullKey = `${principal}:${key}`;
    this.quotas.track(principal, fullKey);
    this.cache.set(fullKey, value);
  }

  async size(): Promise<number> {
    return this.cache.getSize();
  }

  async principalsCount(): Promise<number> {
    return this.quotas.getPrincipalCount();
  }
}

export function getDriver(): IdemDriver {
  return new MemoryIdemDriver();
}
