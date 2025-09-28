import { registerStep } from '../registry.js';

export async function handleTransform({ ctx, step }) {
  const inputs = step.inputs || {};
  // Validate inputs: assign must be an object if provided
  if (Object.prototype.hasOwnProperty.call(inputs, 'assign')) {
    if (inputs.assign == null || typeof inputs.assign !== 'object' || Array.isArray(inputs.assign)) {
      throw new Error('BAD_INPUT:{"assign":"must be an object"}');
    }
  }
  if (inputs && inputs.assign && typeof inputs.assign === 'object') {
    Object.assign(ctx, inputs.assign);
  }
  return { ctx };
}

registerStep('transform', handleTransform);
