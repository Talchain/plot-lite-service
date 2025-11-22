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

export async function handleMap({ ctx, step }) {
  const inputs = step.inputs || {};
  const fromPath = String(inputs.fromPath || '').trim();
  if (!fromPath) throw new Error('BAD_INPUT:{"fromPath":"required"}');
  const mapping = (inputs.mapping && typeof inputs.mapping === 'object') ? inputs.mapping : null;
  if (!mapping) throw new Error('BAD_INPUT:{"mapping":"must be an object"}');
  const key = get(ctx, fromPath);
  const has = Object.prototype.hasOwnProperty.call(mapping, key);
  const val = has ? mapping[key] : (Object.prototype.hasOwnProperty.call(inputs, 'default') ? inputs.default : undefined);
  if (Object.prototype.hasOwnProperty.call(inputs, 'assignTo') && typeof inputs.assignTo !== 'string') {
    throw new Error('BAD_INPUT:{"assignTo":"must be a string"}');
  }
  const toPath = (typeof inputs.assignTo === 'string' && inputs.assignTo.trim()) ? inputs.assignTo.trim() : fromPath;
  setPath(ctx, toPath, val);
  return { ctx };
}

registerStep('map', handleMap);
