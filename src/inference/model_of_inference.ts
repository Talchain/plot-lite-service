/**
 * Model-of-Inference Engine (Stub)
 * 
 * Future: Meta-reasoning about inference quality.
 * Current: Delegates to model_based for parity.
 */

import type { Graph } from '../trust/types.js';
import type { InferenceEngine, InferenceConfig, InferenceResult } from './types.js';
import { modelBasedInference } from './model_based.js';

export class ModelOfInferenceEngine implements InferenceEngine {
  name = 'model_of_inference';

  run(graph: Graph, config: InferenceConfig): InferenceResult {
    // TODO: Implement meta-reasoning about inference quality
    // For now, delegate to model_based to maintain parity
    return modelBasedInference.run(graph, config);
  }
}

export const modelOfInferenceEngine = new ModelOfInferenceEngine();
