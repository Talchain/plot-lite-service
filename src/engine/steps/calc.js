import { registerStep } from '../registry.js';
import { get } from '../util.js';

function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!Object.prototype.hasOwnProperty.call(cur, p) || cur[p] == null || typeof cur[p] !== 'object') cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function toNum(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`NaN:${name}`);
  return n;
}

function makeVarResolver(ctx, vars) {
  return (name) => {
    if (vars && Object.prototype.hasOwnProperty.call(vars, name)) {
      const v = vars[name];
      if (typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/.test(v)) {
        const got = get(ctx, v);
        if (got === undefined) throw new Error(`UNKNOWN_VAR:${name}`);
        return toNum(got, name);
      }
      return toNum(v, name);
    }
    const got = get(ctx, name);
    if (got === undefined) throw new Error(`UNKNOWN_VAR:${name}`);
    return toNum(got, name);
  };
}

function tokenize(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i, dot = 0;
      while (j < s.length && /[0-9.]/.test(s[j])) { if (s[j] === '.') dot++; j++; }
      const num = s.slice(i, j);
      if ((num.match(/\./g)||[]).length > 1) throw new Error('BAD_NUM');
      out.push({ t: 'num', v: num }); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i+1;
      while (j < s.length && /[A-Za-z0-9_.]/.test(s[j])) j++;
      out.push({ t: 'id', v: s.slice(i, j) }); i = j; continue;
    }
    if ('+-*/%(),'.includes(c)) { out.push({ t: c }); i++; continue; }
    if (c === ')') { out.push({ t: ')' }); i++; continue; }
    if (c === '(') { out.push({ t: '(' }); i++; continue; }
    throw new Error('BAD_CHAR');
  }
  return out;
}

function parseExpr(tokens, pos, resolveVar) {
  function peek() { return tokens[pos] || null; }
  function eat(type) { if (peek() && (peek().t === type || peek().t === type)) return tokens[pos++]; return null; }

  function parseFactor() {
    if (eat('+')) return parseFactor();
    if (eat('-')) return -parseFactor();
    const p = peek();
    if (!p) throw new Error('UNEXPECTED_EOF');
    if (p.t === 'num') { pos++; return Number(p.v); }
    if (p.t === 'id') {
      const id = p.v; pos++;
      if (eat('(')) {
        const args = [];
        if (!eat(')')) {
          do { args.push(parseAddSub()); } while (eat(','));
          if (!eat(')')) throw new Error('MISSING_RPAREN');
        }
        if (id === 'max') { if (args.length !== 2) throw new Error('ARITY'); return Math.max(toNum(args[0],'max'), toNum(args[1],'max')); }
        if (id === 'min') { if (args.length !== 2) throw new Error('ARITY'); return Math.min(toNum(args[0],'min'), toNum(args[1],'min')); }
        if (id === 'clamp') {
          if (args.length !== 3) throw new Error('ARITY');
          const v = toNum(args[0],'clamp'), lo = toNum(args[1],'clamp'), hi = toNum(args[2],'clamp');
          return Math.max(lo, Math.min(hi, v));
        }
        throw new Error('BAD_FUNC');
      }
      // variable (dot-path allowed)
      if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/.test(id)) throw new Error('BAD_VAR');
      return resolveVar(id);
    }
    if (eat('(')) {
      const v = parseAddSub();
      if (!eat(')')) throw new Error('MISSING_RPAREN');
      return v;
    }
    throw new Error('BAD_FACTOR');
  }

  function parseMulDiv() {
    let v = parseFactor();
    while (true) {
      if (eat('*')) v = v * parseFactor();
      else if (eat('/')) { const d = parseFactor(); if (d === 0) throw new Error('DIV_ZERO'); v = v / d; }
      else if (eat('%')) { const d = parseFactor(); if (d === 0) throw new Error('DIV_ZERO'); v = v % d; }
      else break;
    }
    return v;
  }

  function parseAddSub() {
    let v = parseMulDiv();
    while (true) {
      if (eat('+')) v = v + parseMulDiv();
      else if (eat('-')) v = v - parseMulDiv();
      else break;
    }
    return v;
  }

  const value = parseAddSub();
  return { value, pos };
}

export async function handleCalc({ ctx, step }) {
  const inputs = step.inputs || {};
  const assignTo = String(inputs.assignTo || '').trim();
  const expr = String(inputs.expr || '').trim();
  if (!assignTo) throw new Error('assignTo required');
  if (!expr) throw new Error('expr required');
  const resolveVar = makeVarResolver(ctx, (inputs.vars && typeof inputs.vars === 'object') ? inputs.vars : null);
  const tokens = tokenize(expr);
  const { value, pos } = parseExpr(tokens, 0, resolveVar);
  if (pos !== tokens.length) throw new Error('TRAILING_INPUT');
  setPath(ctx, assignTo, value);
  return { ctx };
}

registerStep('calc', handleCalc);
