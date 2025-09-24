import { registerStep } from '../registry.js';

export async function handleTransform({ ctx, step }) {
  const inputs = step.inputs || {};
  if (inputs && inputs.assign && typeof inputs.assign === 'object') {
    Object.assign(ctx, inputs.assign);
  }
  return { ctx };
}

registerStep('transform', handleTransform);
