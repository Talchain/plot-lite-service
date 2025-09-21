export function containsSensitive(obj: unknown): boolean {
  // Case-insensitive token patterns; broad but deterministic
  const TOKENS: RegExp[] = [
    /password/i,
    /passwd/i,
    /api_?key/i,
    /\bsecret\b/i,
    /\btoken\b/i,
    /bearer\s+[A-Za-z0-9._-]+/i,
    /authorization/i,
    /\bssn\b/i,
    /private_?key/i,
  ];
  const stack: unknown[] = [obj];
  let visited = 0;
  const MAX_VISITS = 5000;
  const MAX_DEPTH = 6;
  const depths: WeakMap<object, number> = new WeakMap();

  while (stack.length && visited < MAX_VISITS) {
    const cur = stack.pop();
    visited++;
    if (cur == null) continue;
    if (typeof cur === 'string') {
      if (TOKENS.some((rx) => rx.test(cur))) return true;
    } else if (typeof cur === 'object') {
      const objCur = cur as Record<string, unknown>;
      const depth = depths.get(objCur as object) ?? 0;
      if (depth >= MAX_DEPTH) continue;
      for (const [k, v] of Object.entries(objCur)) {
        if (TOKENS.some((rx) => rx.test(k))) return true;
        if (v && typeof v === 'object') {
          depths.set(v as object, depth + 1);
          stack.push(v);
        } else if (typeof v === 'string') {
          if (TOKENS.some((rx) => rx.test(v))) return true;
        }
      }
    }
  }
  return false;
}