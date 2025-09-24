import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

export const calcSchema = {
  type: 'object',
  properties: {
    inputs: {
      type: 'object',
      properties: {
        assignTo: { type: 'string', minLength: 1 },
        expr: { type: 'string', minLength: 1 },
        vars: { type: 'object', additionalProperties: true }
      },
      required: ['assignTo','expr'],
      additionalProperties: true
    }
  },
  additionalProperties: true
};

export const mapSchema = {
  type: 'object',
  properties: {
    inputs: {
      type: 'object',
      properties: {
        fromPath: { type: 'string', minLength: 1 },
        mapping: { type: 'object', additionalProperties: true },
        default: {},
        assignTo: { type: 'string' }
      },
      required: ['fromPath','mapping'],
      additionalProperties: true
    }
  },
  additionalProperties: true
};

export const validators = new Map([
  ['calc', ajv.compile(calcSchema)],
  ['map', ajv.compile(mapSchema)],
]);

export function validateStep(step) {
  const v = validators.get(step.type);
  if (!v) return { ok: true };
  const ok = v(step);
  if (ok) return { ok: true };
  const err = (v.errors && v.errors[0]) || {};
  const path = (err.instancePath || '').replace(/^\//,'');
  const msg = path ? `${path}: ${err.message || 'invalid'}` : (err.message || 'invalid');
  return { ok: false, message: msg };
}
