import { replyWithAppError } from './errors.js';
const perIp = new Map();
const LIMIT = Number(process.env.RATE_LIMIT_RPM || process.env.RATE_LIMIT_PER_MIN || 60);
const MAX_ENTRIES = 10000; // Cap to prevent unbounded growth
// Track 429s per-minute to expose last5m_429 in /health
const perMinute429 = new Map();
function record429(now) {
    const minute = Math.floor(now / 60000);
    perMinute429.set(minute, (perMinute429.get(minute) || 0) + 1);
    // prune older than 10 minutes just to be safe
    const cutoff = minute - 10;
    for (const m of perMinute429.keys()) {
        if (m < cutoff)
            perMinute429.delete(m);
    }
}
function last5m429(now) {
    const minute = Math.floor(now / 60000);
    let sum = 0;
    for (let m = minute - 4; m <= minute; m++)
        sum += perMinute429.get(m) || 0;
    return sum;
}
// Prune old entries to prevent memory leak
function pruneOldEntries() {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);
    const cutoff = currentMinute - 2; // Keep current + 1 previous minute
    let pruned = 0;
    for (const [key, state] of perIp) {
        // Split from right to handle IPv6 addresses (which contain multiple colons)
        const lastColonIndex = key.lastIndexOf(':');
        const keyMinute = parseInt(key.substring(lastColonIndex + 1));
        if (keyMinute < cutoff) {
            perIp.delete(key);
            pruned++;
        }
    }
    // Cap enforcement: drop oldest entries if over limit
    if (perIp.size > MAX_ENTRIES) {
        const sorted = Array.from(perIp.entries())
            .sort((a, b) => a[1].resetAt - b[1].resetAt);
        const toDrop = sorted.slice(0, perIp.size - MAX_ENTRIES);
        toDrop.forEach(([key]) => perIp.delete(key));
        pruned += toDrop.length;
    }
    return pruned;
}
// Periodic cleanup to prevent memory leak (runs every minute)
// Use .unref() to allow process to exit when only this timer is active
setInterval(pruneOldEntries, 60000).unref();
export async function rateLimit(req, reply) {
    // Opportunistic pruning (1% of requests to avoid overhead)
    if (Math.random() < 0.01) {
        pruneOldEntries();
    }
    const ENABLED = process.env.RATE_LIMIT_ENABLED !== '0';
    if (!ENABLED)
        return; // disabled
    // Exempt basic health/readiness endpoints from rate limiting
    const url = req.url || '';
    if (req.method === 'GET' && (url.startsWith('/health') || url.startsWith('/ready') || url.startsWith('/live') || url.startsWith('/version') || url.startsWith('/ops/snapshot'))) {
        return;
    }
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const key = `${ip}:${minute}`;
    let s = perIp.get(key);
    if (!s) {
        s = { count: 1, resetAt: (minute + 1) * 60000 };
        perIp.set(key, s);
        // set 2xx rate-limit headers for allowed request
        reply.header('X-RateLimit-Limit', String(LIMIT));
        reply.header('X-RateLimit-Remaining', String(Math.max(0, LIMIT - s.count)));
        return;
    }
    s.count += 1;
    if (s.count > LIMIT) {
        const retryMs = Math.max(1, s.resetAt - now);
        const retrySec = Math.ceil(retryMs / 1000);
        const resetEpoch = Math.ceil(s.resetAt / 1000);
        reply.header('Retry-After', retrySec);
        reply.header('X-RateLimit-Reset', String(resetEpoch));
        record429(now);
        return replyWithAppError(reply, { type: 'RATE_LIMIT', statusCode: 429, hint: `Please retry after ${retrySec} seconds` });
    }
    // set 2xx rate-limit headers for allowed request
    reply.header('X-RateLimit-Limit', String(LIMIT));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, LIMIT - s.count)));
}
export function rateLimitState() {
    const enabled = process.env.RATE_LIMIT_ENABLED !== '0';
    const now = Date.now();
    return {
        enabled,
        rpm: LIMIT,
        last5m_429: last5m429(now),
    };
}
