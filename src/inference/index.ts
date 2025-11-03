/**
 * Inference Engine Registry
 * 
 * Central registry for pluggable inference modes.
 */

import type { InferenceEngine } from './types.js';
import { modelBasedInference } from './model_based.js';
import { modelOfInferenceEngine } from './model_of_inference.js';

export type { InferenceEngine, InferenceConfig, InferenceResult } from './types.js';

export type InferenceMode = 'model_based' | 'model_of_inference';

const engines: Record<InferenceMode, InferenceEngine> = {
  model_based: modelBasedInference,
  model_of_inference: modelOfInferenceEngine,
};

/**
 * Get inference engine by mode
 */
export function getInferenceEngine(mode: InferenceMode): InferenceEngine {
  const engine = engines[mode];
  if (!engine) {
    throw new Error(`Unknown inference mode: ${mode}`);
  }
  return engine;
}

/**
 * List available inference modes
 */
export function listInferenceModes(): InferenceMode[] {
  return Object.keys(engines) as InferenceMode[];
}
