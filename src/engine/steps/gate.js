import { registerStep } from '../registry.js';
import { get } from '../util.js';

function parseValue(raw) {
  const s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  return s;
}

function evalConditionString(str, ctx) {
  const re = /^\s*\$\{\s*([^}]+?)\s*\}\s*(===|!==|>=|<=|>|<)\s*(.+)\s*$/;
  const m = typeof str === 'string' ? str.match(re) : null;
  if (!m) return false;
  const [, path, op, rawRight] = m;
  const left = get(ctx, path.trim());
  const right = parseValue(rawRight);
  switch (op) {
    case '===': return left === right;
    case '!==': return left !== right;
    case '>=': return Number(left) >= Number(right);
    case '<=': return Number(left) <= Number(right);
    case '>': return Number(left) > Number(right);
    case '<': return Number(left) < Number(right);
    default: return false;
  }
}

export async function handleGate({ ctx, step }) {
  const inputs = step.inputs || {};
  let nextId;
  let forkUsed = false;

  if (step.fork) {
    forkUsed = true;
    const ok = evalConditionString(step.fork.condition, ctx);
    nextId = ok ? step.fork.onTrue : step.fork.onFalse;
  } else if (inputs && inputs.path && inputs.op) {
    const left = get(ctx, inputs.path);
    const right = inputs.value;
    let ok = false;
    switch (inputs.op) {
      case '===': ok = left === right; break;
      case '!==': ok = left !== right; break;
      case '>=': ok = Number(left) >= Number(right); break;
      case '<=': ok = Number(left) <= Number(right); break;
      case '>': ok = Number(left) > Number(right); break;
      case '<': ok = Number(left) < Number(right); break;
      default: ok = false;
    }
    if (ok && typeof inputs.onTrue === 'string') nextId = inputs.onTrue;
    else if (!ok && typeof inputs.onFalse === 'string') nextId = inputs.onFalse;
  }
  return { ctx, nextId, forkUsed };
}

registerStep('gate', handleGate);
