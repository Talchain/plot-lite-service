import { containsSensitive } from './sensitive.js';

export interface ScanResult {
  blocked: boolean;
  scannerError?: boolean;
  error?: string;
}

/**
 * Fail-closed sensitive content scanner
 * If scanner throws, treat as blocked (deny request)
 */
export function containsSensitiveSafe(body: unknown): ScanResult {
  try {
    const blocked = containsSensitive(body);
    return { blocked, scannerError: false };
  } catch (err: any) {
    // Fail closed: treat scanner errors as blocked
    return { 
      blocked: true, 
      scannerError: true,
      error: err?.message || 'Scanner error' 
    };
  }
}
