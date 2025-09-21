import { JobHandlerRegistry } from './base.js';
import { SlowCountHandler, FlakyHandler, BlobHandler } from './demo.js';

export * from './base.js';
export * from './demo.js';

export function createJobHandlers(): JobHandlerRegistry {
  const handlers = new Map();

  // Demo handlers
  handlers.set('demo:slow-count', new SlowCountHandler());
  handlers.set('demo:flaky', new FlakyHandler());
  handlers.set('demo:blob', new BlobHandler());

  return handlers;
}