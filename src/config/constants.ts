export const MAX_RATE_KEYS = Number(process.env.MAX_RATE_KEYS || 20000);
export const MAX_IDEM_ENTRIES = Number(process.env.MAX_IDEM_ENTRIES || 10);
export const SSE_SLOT_MAX_MS = Number(process.env.SSE_MAX_MS || 120000); // C3: 2min default

// Body size limits (bytes)
export const BODY_LIMIT_BYTES = 96 * 1024; // 96 KiB for /v1/run
