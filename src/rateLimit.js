const perIp = new Map();
const LIMIT = Number(process.env.RATE_LIMIT_RPM || process.env.RATE_LIMIT_PER_MIN || 60);
export async function rateLimit(req, reply) {
    const ENABLED = process.env.RATE_LIMIT_ENABLED !== '0';
    if (!ENABLED)
        return; // disabled
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const key = `${ip}:${minute}`;
    const s = perIp.get(key);
    if (!s) {
        perIp.set(key, { count: 1, resetAt: (minute + 1) * 60000 });
        return;
    }
    s.count += 1;
    if (s.count > LIMIT) {
        const retryMs = Math.max(1, s.resetAt - now);
        reply.header('Retry-After', Math.ceil(retryMs / 1000));
        return reply.code(429).send({ error: { type: 'RETRYABLE', message: 'Rate limit exceeded', hint: `Please retry after ${Math.ceil(retryMs / 1000)} seconds` } });
    }
}
export function rateLimitState() {
    const enabled = process.env.RATE_LIMIT_ENABLED !== '0';
    return {
        enabled,
        limit_per_min: LIMIT,
        buckets: perIp.size,
    };
}
