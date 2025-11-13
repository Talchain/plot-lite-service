/**
 * Audit Ring Buffer - Runtime-only audit surface
 * No payload bodies, only hashes + meta
 */
import { createHash } from 'crypto';

export interface AuditEntry {
  evt: string;
  route: string;
  id: string;
  seed?: number;
  inference_mode?: string;
  bma_hash?: string;
  response_hash?: string;
  status: number;
  ts: string;
}

// Ring buffer with max size
const MAX_ENTRIES = 100;
const auditRing: AuditEntry[] = [];

export function recordAuditEvent(entry: AuditEntry): void {
  if (auditRing.length >= MAX_ENTRIES) {
    auditRing.shift(); // Remove oldest
  }
  auditRing.push(entry);
}

export function getRecentAuditEvents(limit: number = 50): AuditEntry[] {
  return auditRing.slice(-limit);
}

export function clearAuditEvents(): void {
  auditRing.length = 0;
}

export function getAuditStats() {
  return {
    total_entries: auditRing.length,
    max_entries: MAX_ENTRIES,
    oldest_ts: auditRing.length > 0 ? auditRing[0].ts : null,
    newest_ts: auditRing.length > 0 ? auditRing[auditRing.length - 1].ts : null
  };
}
