/**
 * Runtime config snapshot + validator
 * - Allowed keys: sse_per_ip_max, sse_global_max, rate_limit_rpm
 * - Bounds: >= 1, integers
 */
import { readFileSync } from 'node:fs';
import { FLAGS } from './flags.js';

export type RuntimeConfig = {
  sse_per_ip_max: number;
  sse_global_max: number;
  rate_limit_rpm: number;
};

function fromEnv(): RuntimeConfig {
  return {
    sse_per_ip_max: Math.max(1, Number(process.env.SSE_PER_IP_MAX ?? 10) | 0),
    sse_global_max: Math.max(1, Number(process.env.SSE_GLOBAL_MAX ?? 100) | 0),
    rate_limit_rpm: Number(process.env.RATE_LIMIT_RPM) || FLAGS.RATE_LIMIT_RPM,
  };
}

let snapshot: RuntimeConfig = fromEnv();

function isPosInt(n: any): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 && Math.floor(n) === n;
}

export function validateConfig(obj: any): RuntimeConfig {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('config must be object');
  const allowed = new Set(['sse_per_ip_max','sse_global_max','rate_limit_rpm']);
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) throw new Error(`unknown key ${k}`);
  }
  const merged: RuntimeConfig = {
    sse_per_ip_max: isPosInt(obj.sse_per_ip_max) ? obj.sse_per_ip_max : snapshot.sse_per_ip_max,
    sse_global_max: isPosInt(obj.sse_global_max) ? obj.sse_global_max : snapshot.sse_global_max,
    rate_limit_rpm: isPosInt(obj.rate_limit_rpm) ? obj.rate_limit_rpm : snapshot.rate_limit_rpm,
  };
  return merged;
}

export function applyNewSnapshot(obj: any): RuntimeConfig {
  const next = validateConfig(obj);
  snapshot = next;
  return snapshot;
}

// Refresh runtime snapshot from current environment variables
export function refreshFromEnv(): RuntimeConfig {
  snapshot = fromEnv();
  return snapshot;
}

export function loadFromFile(filePath: string): RuntimeConfig {
  const txt = readFileSync(filePath, 'utf8');
  const obj = JSON.parse(txt);
  return applyNewSnapshot(obj);
}

export function getSnapshot(): RuntimeConfig { return { ...snapshot }; }
export function getSsePerIpMax(): number { return snapshot.sse_per_ip_max; }
export function getSseGlobalMax(): number { return snapshot.sse_global_max; }
export function getRateLimitRpm(): number { return snapshot.rate_limit_rpm; }
