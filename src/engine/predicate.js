// Tiny predicate compiler with cache
// Supports:  ${path} OP value   where OP ∈ [===, !==, >=, <=, >, <]
// No eval; parses into a function and caches by expression string.
import { get } from './util.js';

const cache = new Map();

function parseValue(raw) {
  const s = String(raw).trim();
  // quoted string
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s;
}

function parse(expr) {
  const re = /^\s*\$\{\s*([^}]+?)\s*\}\s*(===|!==|>=|<=|>|<)\s*(.+)\s*$/;
  const m = typeof expr === 'string' ? expr.match(re) : null;
  if (!m) throw new Error('invalid predicate expression');
  const [, path, op, rawRight] = m;
  const right = parseValue(rawRight);
  const pathTrim = path.trim();
  return { path: pathTrim, op, right };
}

export function compile(expr) {
  if (cache.has(expr)) return cache.get(expr);
  const { path, op, right } = parse(expr);
  const fn = (ctx) => {
    const left = get(ctx, path);
    switch (op) {
      case '===': return left === right;
      case '!==': return left !== right;
      case '>=': return Number(left) >= Number(right);
      case '<=': return Number(left) <= Number(right);
      case '>': return Number(left) > Number(right);
      case '<': return Number(left) < Number(right);
      default: return false;
    }
  };
  cache.set(expr, fn);
  return fn;
}