/**
 * Per-Principal Quota Tracker
 * Bounds idempotency keys per IP/token to prevent single-principal DoS
 */

export interface PrincipalQuotasOptions {
  maxKeysPerPrincipal: number;
}

export class PrincipalQuotas {
  private principalKeys = new Map<string, Set<string>>();
  private readonly maxKeysPerPrincipal: number;
  private evictions = 0;

  constructor(options: PrincipalQuotasOptions) {
    this.maxKeysPerPrincipal = options.maxKeysPerPrincipal;
  }

  track(principal: string, key: string): void {
    let keys = this.principalKeys.get(principal);
    
    if (!keys) {
      keys = new Set();
      this.principalKeys.set(principal, keys);
    }
    
    // If at quota and key is new, evict oldest for this principal
    if (keys.size >= this.maxKeysPerPrincipal && !keys.has(key)) {
      const oldest = keys.values().next().value;
      if (oldest) {
        keys.delete(oldest);
        this.evictions++;
      }
    }
    
    keys.add(key);
  }

  untrack(principal: string, key: string): void {
    const keys = this.principalKeys.get(principal);
    if (keys) {
      keys.delete(key);
      if (keys.size === 0) {
        this.principalKeys.delete(principal);
      }
    }
  }

  getPrincipalCount(): number {
    return this.principalKeys.size;
  }

  getEvictions(): number {
    return this.evictions;
  }

  clear(): void {
    this.principalKeys.clear();
    this.evictions = 0;
  }
}
