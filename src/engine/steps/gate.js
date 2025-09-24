import { registerStep } from '../registry.js';
import { get } from '../util.js';
import * as predicate from '../predicate.js';

export async function handleGate({ ctx, step }) {
  const inputs = step.inputs || {};
  let nextId;
  let forkUsed = false;

  if (step.fork && typeof step.fork.condition === 'string') {
    forkUsed = true;
    const pred = predicate.compile(step.fork.condition);
    const ok = !!pred(ctx);
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
