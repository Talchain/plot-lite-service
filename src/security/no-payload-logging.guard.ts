// Dev/test-only guard to prevent accidental payload logging
// Usage: only enable via env or in unit tests to ensure instrumentation rejects bodies
// Default runtime is unchanged. This module is not loaded unless explicitly imported.

export type LogMethod = (...args: any[]) => any;
export type LoggerLike = { info?: LogMethod; warn?: LogMethod; error?: LogMethod; debug?: LogMethod } & Record<string, any>;

const FORBIDDEN_KEYS = new Set(['body', 'payload', 'requestBody', 'responseBody', 'parse_json', 'parse_text']);

function containsForbidden(obj: any): boolean {
  try {
    const stack: any[] = [obj];
    const seen = new Set<any>();
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (seen.has(cur)) continue; seen.add(cur);
      for (const [k, v] of Object.entries(cur)) {
        if (FORBIDDEN_KEYS.has(String(k))) return true;
        if (typeof v === 'string') {
          const s = v.toLowerCase();
          if (s.includes('password') || s.includes('apikey') || s.includes('authorization') || s.includes('bearer ') || s.includes('secret') || s.includes('parse_json')) return true;
        } else if (typeof v === 'object' && v !== null) {
          stack.push(v);
        }
      }
    }
  } catch {}
  return false;
}

export function enforceNoPayloadLogging<T extends LoggerLike>(logger: T): T {
  const handler: ProxyHandler<T> = {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig === 'function' && ['info','warn','error','debug','trace'].includes(String(prop))) {
        return new Proxy(orig as LogMethod, {
          apply(fn, _thisArg, argArray) {
            for (const a of argArray) {
              if (containsForbidden(a)) throw new Error('no-payload-logging: forbidden body detected in log arguments');
            }
            return Reflect.apply(fn, target, argArray);
          }
        });
      }
      return orig;
    }
  };
  return new Proxy(logger, handler);
}
