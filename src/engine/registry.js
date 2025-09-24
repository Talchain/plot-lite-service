const handlers = new Map();

export function registerStep(type, fn) {
  handlers.set(type, fn);
}

export function getStepHandler(type) {
  return handlers.get(type);
}

// default stub for http (no network)
registerStep('http', async ({ ctx }) => ({ ctx }));

