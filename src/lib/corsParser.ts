export interface ParseCorsOptions {
  allowWildcardDev?: boolean;
}

function normalizeOrigin(origin: string): string {
  const s = origin.trim();
  try {
    const u = new URL(s);
    const proto = (u.protocol || '').toLowerCase();
    const host = (u.hostname || '').toLowerCase();
    const port = u.port ? `:${u.port}` : '';
    if (!proto || !host) return s;
    return `${proto}//${host}${port}`;
  } catch {
    // If it isn't a valid URL origin, return a conservative lowercase trim
    return s.toLowerCase();
  }
}

/**
 * Parse a CSV of CORS origins.
 * - Trims items and normalises scheme/host/port (lowercase scheme + host).
 * - Forbids "*" unless allowWildcardDev is true (e.g. CORS_DEV=1 for local dev).
 * - Returns a de-duped array.
 */
export function parseCorsCsv(input: string, opts: ParseCorsOptions = {}): string[] {
  const allowWildcard = Boolean(opts.allowWildcardDev ?? (process.env.CORS_DEV === '1'));
  const items = String(input || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const out = new Set<string>();
  for (const raw of items) {
    if (raw === '*') {
      if (!allowWildcard) throw new Error('Wildcard * not allowed without CORS_DEV=1');
      out.add('*');
      continue;
    }
    out.add(normalizeOrigin(raw));
  }
  return Array.from(out);
}
