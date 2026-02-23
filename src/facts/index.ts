/**
 * Facts module — structured FactObjectV1 assembly from inference results.
 *
 * Public API:
 *  - assembleFactObjects()           — generic ISL-style input
 *  - assembleFactsFromBundleResults() — run_bundle-specific input
 *  - Types: FactObjectV1, FactsEnvelope, FactKey, FactLineage, etc.
 */

export {
  FACTS_SCHEMA_VERSION,
  type FactKey,
  type FactType,
  type FactObjectV1,
  type FactData,
  type ProbabilityFactData,
  type FactorSensitivityFactData,
  type CritiqueFactData,
  type RobustnessFactData,
  type FactLineage,
  type FactsEnvelope,
} from './types.js';

export {
  assembleFactObjects,
  assembleFactsFromBundleResults,
  compareFactKeys,
  type ISLResponseInput,
  type BundleResultInput,
  type OptionResultInput,
  type FactorSensitivityInput,
  type CritiqueInput,
  type RobustnessInput,
} from './mapper.js';

export {
  generateFactId,
  generateContentHash,
  canonicalJson,
} from './hash.js';
