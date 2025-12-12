/**
 * Sampling Engine Module
 *
 * Brief 8: PLoT — Sampling Engine & Caching
 *
 * Provides:
 * - Deterministic simulation traces for ISL robustness analysis
 * - Trace caching with LRU eviction
 * - Batch simulation for sensitivity sweeps
 * - Seed management utilities
 *
 * Determinism Contract:
 * Given (graph_hash, seed, sampling_config_version), PLoT produces identical traces.
 */

// Types
export type {
  SimulationTraces,
  Trace,
  TraceMeta,
  TraceAggregates,
  Distribution,
  TraceConfig,
  Perturbation,
  BatchSimulationRequest,
  BatchSimulationResponse,
  TraceCacheKey,
  TraceCacheStats,
  SamplingMetrics,
  StratifiedSamplingConfig,
  ImportanceSamplingConfig,
  SeedSequence,
} from './types.js';

export { SAMPLING_CONFIG_VERSION } from './types.js';

// Graph hashing
export {
  hashGraph,
  buildCacheKey,
  parseCacheKey,
  deriveSeedFromHash,
  generateSeedSequence,
  verifyGraphHash,
} from './graph-hash.js';

// Trace caching
export {
  getTraceCache,
  resetTraceCache,
  configureTraceCache,
  TraceCacheImpl,
} from './trace-cache.js';
export type { TraceCacheConfig } from './trace-cache.js';

// Sampling engine
export {
  generateTraces,
  runBatchSimulation,
  getSamplingMetrics,
  verifyDeterminism,
} from './engine.js';

// Seed utilities
export {
  DEFAULT_SEED,
  deriveSeed,
  deriveSeedFromInputs,
  generateSequentialSeeds,
  generateHashBasedSeeds,
  generateJumpSeeds,
  generatePerturbationSeeds,
  isValidSeed,
  normalizeSeed,
  checkDeterminism,
  getSeedInfo,
  logSeed,
  getSeedLog,
  clearSeedLog,
} from './seed-utils.js';
export type {
  SeedMethod,
  SeedSequenceResult,
  DerivedSeed,
  SeedLogEntry,
} from './seed-utils.js';

// Advanced sampling (optional enhancements)
export {
  generateStratifiedSamples,
  generateLatinHypercubeSamples,
  computeImportanceWeights,
  computeWeightedStatistics,
  generateTailSamples,
  isStratifiedSamplingAvailable,
  isImportanceSamplingAvailable,
} from './advanced-sampling.js';

// Performance metrics
export {
  recordSimulationTiming,
  getComprehensiveSamplingMetrics,
  resetSamplingMetrics,
  createSimulationTimer,
  SimulationTimer,
  estimateMemoryUsage,
  getProcessMemoryStats,
} from './metrics.js';
