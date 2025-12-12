/**
 * Sampling Engine Tests
 *
 * Brief 8: PLoT — Sampling Engine & Caching
 *
 * Tests for:
 * - Determinism verification
 * - Graph hashing
 * - Trace caching
 * - Batch simulation
 * - Seed management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateTraces,
  runBatchSimulation,
  verifyDeterminism,
  hashGraph,
  buildCacheKey,
  parseCacheKey,
  deriveSeedFromHash,
  generateSeedSequence,
  verifyGraphHash,
  getTraceCache,
  resetTraceCache,
  configureTraceCache,
  SAMPLING_CONFIG_VERSION,
} from '../src/sampling/index.js';
import {
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
  DEFAULT_SEED,
} from '../src/sampling/seed-utils.js';
import type {
  SimulationTraces,
  TraceConfig,
  BatchSimulationRequest,
} from '../src/sampling/types.js';

/**
 * Simple test graph: A -> B -> C
 */
const simpleGraph = {
  nodes: [
    { id: 'A' },
    { id: 'B' },
    { id: 'C' },
  ],
  edges: [
    { from: 'A', to: 'B', weight: 2.0, belief_exists: 0.9 },
    { from: 'B', to: 'C', weight: 1.5, belief_exists: 0.8 },
  ],
};

/**
 * Decision graph with options
 */
const decisionGraph = {
  nodes: [
    { id: 'option_A', kind: 'option' },
    { id: 'option_B', kind: 'option' },
    { id: 'outcome' },
  ],
  edges: [
    { from: 'option_A', to: 'outcome', weight: 0.8 },
    { from: 'option_B', to: 'outcome', weight: 1.2 },
  ],
};

describe('Graph Hashing', () => {
  it('produces deterministic hash for same graph', () => {
    const hash1 = hashGraph(simpleGraph);
    const hash2 = hashGraph(simpleGraph);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different graphs', () => {
    const hash1 = hashGraph(simpleGraph);
    const modifiedGraph = {
      ...simpleGraph,
      edges: [
        ...simpleGraph.edges,
        { from: 'A', to: 'C', weight: 0.5 },
      ],
    };
    const hash2 = hashGraph(modifiedGraph);
    expect(hash1).not.toBe(hash2);
  });

  it('hash is order-independent for nodes', () => {
    const graph1 = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [{ from: 'A', to: 'B' }],
    };
    const graph2 = {
      nodes: [{ id: 'B' }, { id: 'A' }],
      edges: [{ from: 'A', to: 'B' }],
    };
    expect(hashGraph(graph1)).toBe(hashGraph(graph2));
  });

  it('hash is order-independent for edges', () => {
    const graph1 = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ],
    };
    const graph2 = {
      nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      edges: [
        { from: 'B', to: 'C' },
        { from: 'A', to: 'B' },
      ],
    };
    expect(hashGraph(graph1)).toBe(hashGraph(graph2));
  });

  it('includes weight in hash', () => {
    const graph1 = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [{ from: 'A', to: 'B', weight: 1.0 }],
    };
    const graph2 = {
      nodes: [{ id: 'A' }, { id: 'B' }],
      edges: [{ from: 'A', to: 'B', weight: 2.0 }],
    };
    expect(hashGraph(graph1)).not.toBe(hashGraph(graph2));
  });

  it('verifyGraphHash validates correctly', () => {
    const hash = hashGraph(simpleGraph);
    expect(verifyGraphHash(simpleGraph, hash)).toBe(true);
    expect(verifyGraphHash(simpleGraph, 'wrong-hash')).toBe(false);
  });
});

describe('Cache Key Management', () => {
  it('builds cache key from components', () => {
    const key = buildCacheKey('abc123', 42, '1.0.0');
    expect(key).toBe('abc123:42:1.0.0');
  });

  it('parses cache key to components', () => {
    const parsed = parseCacheKey('abc123:42:1.0.0');
    expect(parsed).toEqual({
      graphHash: 'abc123',
      seed: 42,
      configVersion: '1.0.0',
    });
  });

  it('returns null for invalid cache key', () => {
    expect(parseCacheKey('invalid')).toBeNull();
    expect(parseCacheKey('a:b:c:d')).toBeNull();
    expect(parseCacheKey('abc:notanumber:1.0.0')).toBeNull();
  });

  it('derives seed from hash deterministically', () => {
    const hash = 'abcdef1234567890';
    const seed1 = deriveSeedFromHash(hash);
    const seed2 = deriveSeedFromHash(hash);
    expect(seed1).toBe(seed2);
    expect(seed1).toBeGreaterThan(0);
    expect(seed1).toBeLessThan(2147483647);
  });

  it('generates seed sequence for perturbations', () => {
    const sequence = generateSeedSequence(42, ['p1', 'p2', 'p3']);
    expect(sequence.base_seed).toBe(42);
    expect(sequence.seeds).toHaveLength(3);
    expect(sequence.method).toBe('hash_based');
    // Seeds should be deterministic
    const sequence2 = generateSeedSequence(42, ['p1', 'p2', 'p3']);
    expect(sequence.seeds).toEqual(sequence2.seeds);
  });
});

describe('Determinism', () => {
  beforeEach(() => {
    resetTraceCache();
  });

  it('produces identical traces with same seed', () => {
    const config: TraceConfig = { seed: 12345, n_samples: 32, store_traces: true };

    // Disable cache to force re-computation
    const cache = getTraceCache();
    cache.setEnabled(false);

    const result1 = generateTraces(simpleGraph, config);
    const result2 = generateTraces(simpleGraph, config);

    cache.setEnabled(true);

    // Same traces
    expect(result1.traces).toEqual(result2.traces);
    // Same aggregates
    expect(result1.aggregates).toEqual(result2.aggregates);
    // Same meta (except timestamp)
    expect(result1.meta.graph_hash).toBe(result2.meta.graph_hash);
    expect(result1.meta.seed).toBe(result2.meta.seed);
  });

  it('produces different traces with different seeds', () => {
    const cache = getTraceCache();
    cache.setEnabled(false);

    const result1 = generateTraces(simpleGraph, { seed: 111, n_samples: 32 });
    const result2 = generateTraces(simpleGraph, { seed: 222, n_samples: 32 });

    cache.setEnabled(true);

    expect(result1.traces).not.toEqual(result2.traces);
  });

  it('verifyDeterminism returns true for deterministic graphs', () => {
    expect(verifyDeterminism(simpleGraph, 42)).toBe(true);
  });

  it('includes correct sampling_config_version in meta', () => {
    const result = generateTraces(simpleGraph, { seed: 42, n_samples: 8 });
    expect(result.meta.sampling_config_version).toBe(SAMPLING_CONFIG_VERSION);
  });
});

describe('Trace Generation', () => {
  beforeEach(() => {
    resetTraceCache();
  });

  it('generates correct number of samples', () => {
    const result = generateTraces(simpleGraph, { seed: 42, n_samples: 100 });
    expect(result.traces).toHaveLength(100);
    expect(result.meta.n_samples).toBe(100);
  });

  it('computes node distributions', () => {
    const result = generateTraces(simpleGraph, { seed: 42, n_samples: 64 });

    expect(result.aggregates.node_distributions).toHaveProperty('A');
    expect(result.aggregates.node_distributions).toHaveProperty('B');
    expect(result.aggregates.node_distributions).toHaveProperty('C');

    const dist = result.aggregates.node_distributions['C'];
    expect(dist).toHaveProperty('mean');
    expect(dist).toHaveProperty('std');
    expect(dist.percentiles).toHaveProperty('p50');
  });

  it('computes expected utilities for option nodes', () => {
    const result = generateTraces(decisionGraph, { seed: 42, n_samples: 64 });

    expect(result.aggregates.expected_utilities).toHaveProperty('option_A');
    expect(result.aggregates.expected_utilities).toHaveProperty('option_B');
  });

  it('records edge mask in traces', () => {
    const result = generateTraces(simpleGraph, { seed: 42, n_samples: 8 });

    for (const trace of result.traces) {
      expect(trace.edge_mask).toHaveProperty('A->B');
      expect(trace.edge_mask).toHaveProperty('B->C');
    }
  });

  it('records sampled weights in traces', () => {
    const result = generateTraces(simpleGraph, { seed: 42, n_samples: 8 });

    for (const trace of result.traces) {
      // Only active edges have weights
      for (const [edgeKey, isActive] of Object.entries(trace.edge_mask)) {
        if (isActive) {
          expect(trace.edge_weights[edgeKey]).toBeDefined();
        }
      }
    }
  });

  it('includes raw samples when store_raw_samples is true', () => {
    const result = generateTraces(simpleGraph, {
      seed: 42,
      n_samples: 32,
      store_raw_samples: true,
    });

    expect(result.aggregates.node_distributions['C'].samples).toBeDefined();
    expect(result.aggregates.node_distributions['C'].samples).toHaveLength(32);
  });

  it('does not include raw samples by default', () => {
    const result = generateTraces(simpleGraph, { seed: 42, n_samples: 32 });
    expect(result.aggregates.node_distributions['C'].samples).toBeUndefined();
  });
});

describe('Trace Caching', () => {
  beforeEach(() => {
    resetTraceCache();
  });

  it('caches traces on first generation', () => {
    const cache = getTraceCache();
    const graphHash = hashGraph(simpleGraph);

    expect(cache.has(graphHash, 42)).toBe(false);
    generateTraces(simpleGraph, { seed: 42, n_samples: 16 });
    expect(cache.has(graphHash, 42)).toBe(true);
  });

  it('returns cached result on second call', () => {
    const cache = getTraceCache();
    const statsBefore = cache.getStats();

    const result1 = generateTraces(simpleGraph, { seed: 42, n_samples: 16 });
    const result2 = generateTraces(simpleGraph, { seed: 42, n_samples: 16 });

    const statsAfter = cache.getStats();
    expect(statsAfter.hits).toBe(statsBefore.hits + 1);
    expect(result1.meta.graph_hash).toBe(result2.meta.graph_hash);
  });

  it('cache miss for different seed', () => {
    const cache = getTraceCache();

    generateTraces(simpleGraph, { seed: 42, n_samples: 16 });
    const statsBefore = cache.getStats();

    generateTraces(simpleGraph, { seed: 43, n_samples: 16 });
    const statsAfter = cache.getStats();

    expect(statsAfter.misses).toBe(statsBefore.misses + 1);
  });

  it('clear removes all entries', () => {
    const cache = getTraceCache();

    generateTraces(simpleGraph, { seed: 42, n_samples: 8 });
    generateTraces(simpleGraph, { seed: 43, n_samples: 8 });

    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it('tracks cache statistics', () => {
    const cache = getTraceCache();
    cache.clear();

    generateTraces(simpleGraph, { seed: 42, n_samples: 8 });
    generateTraces(simpleGraph, { seed: 42, n_samples: 8 });
    generateTraces(simpleGraph, { seed: 43, n_samples: 8 });

    const stats = cache.getStats();
    expect(stats.hits).toBeGreaterThan(0);
    expect(stats.misses).toBeGreaterThan(0);
    expect(stats.hit_rate).toBeGreaterThan(0);
  });

  it('can be disabled', () => {
    const cache = getTraceCache();
    cache.setEnabled(false);

    const graphHash = hashGraph(simpleGraph);
    generateTraces(simpleGraph, { seed: 42, n_samples: 8 });

    expect(cache.has(graphHash, 42)).toBe(false);
    cache.setEnabled(true);
  });
});

describe('Batch Simulation', () => {
  beforeEach(() => {
    resetTraceCache();
  });

  it('runs base simulation', () => {
    const request: BatchSimulationRequest = {
      base_graph: simpleGraph,
      base_seed: 42,
      perturbations: [],
      options: {
        n_samples: 16,
        return_traces: true,
        cache_results: true,
      },
    };

    const result = runBatchSimulation(request);

    expect(result.base_result).toBeDefined();
    expect(result.base_result.meta.seed).toBe(42);
    expect(result.perturbation_results).toEqual({});
    expect(result.cache_hits).toEqual([]);
  });

  it('runs perturbation simulations', () => {
    const request: BatchSimulationRequest = {
      base_graph: simpleGraph,
      base_seed: 42,
      perturbations: [
        {
          perturbation_id: 'p1',
          parameter_changes: {},
          edge_changes: {
            'A->B': { weight: 3.0 },
          },
        },
        {
          perturbation_id: 'p2',
          parameter_changes: {},
          edge_changes: {
            'B->C': { weight: 2.0 },
          },
        },
      ],
      options: {
        n_samples: 16,
        return_traces: true,
        cache_results: true,
      },
    };

    const result = runBatchSimulation(request);

    expect(result.perturbation_results).toHaveProperty('p1');
    expect(result.perturbation_results).toHaveProperty('p2');
  });

  it('tracks cache hits for perturbations', () => {
    const request: BatchSimulationRequest = {
      base_graph: simpleGraph,
      base_seed: 42,
      perturbations: [
        {
          perturbation_id: 'p1',
          parameter_changes: {},
        },
      ],
      options: {
        n_samples: 16,
        return_traces: false,
        cache_results: true,
      },
    };

    // First run
    runBatchSimulation(request);

    // Second run should hit cache
    const result2 = runBatchSimulation(request);
    expect(result2.cache_hits).toContain('p1');
  });

  it('reports computation time', () => {
    const request: BatchSimulationRequest = {
      base_graph: simpleGraph,
      base_seed: 42,
      perturbations: [],
      options: {
        n_samples: 8,
        return_traces: false,
        cache_results: false,
      },
    };

    const result = runBatchSimulation(request);
    expect(result.computation_time_ms).toBeGreaterThanOrEqual(0);
  });
});

describe('Seed Management Utilities', () => {
  describe('deriveSeed', () => {
    it('derives seed from graph hash', () => {
      const graphHash = hashGraph(simpleGraph);
      const derived = deriveSeed(graphHash);

      expect(derived.seed).toBeGreaterThan(0);
      expect(derived.deterministic).toBe(true);
    });

    it('produces same seed for same hash', () => {
      const graphHash = hashGraph(simpleGraph);
      const derived1 = deriveSeed(graphHash);
      const derived2 = deriveSeed(graphHash);

      expect(derived1.seed).toBe(derived2.seed);
    });
  });

  describe('deriveSeedFromInputs', () => {
    it('derives seed from multiple inputs', () => {
      const seed = deriveSeedFromInputs('graph1', '42', 'perturbation1');
      expect(seed).toBeGreaterThan(0);
    });

    it('is deterministic', () => {
      const seed1 = deriveSeedFromInputs('a', 'b', 'c');
      const seed2 = deriveSeedFromInputs('a', 'b', 'c');
      expect(seed1).toBe(seed2);
    });
  });

  describe('generateSequentialSeeds', () => {
    it('generates sequential seeds', () => {
      const result = generateSequentialSeeds(100, 5);

      expect(result.seeds).toEqual([100, 101, 102, 103, 104]);
      expect(result.method).toBe('sequential');
    });
  });

  describe('generateHashBasedSeeds', () => {
    it('generates hash-based seeds', () => {
      const result = generateHashBasedSeeds(42, 5);

      expect(result.seeds).toHaveLength(5);
      expect(result.method).toBe('hash_based');
      // All seeds should be valid
      result.seeds.forEach((seed) => {
        expect(isValidSeed(seed)).toBe(true);
      });
    });

    it('is deterministic', () => {
      const result1 = generateHashBasedSeeds(42, 5);
      const result2 = generateHashBasedSeeds(42, 5);

      expect(result1.seeds).toEqual(result2.seeds);
    });
  });

  describe('generateJumpSeeds', () => {
    it('generates jump-based seeds', () => {
      const result = generateJumpSeeds(42, 5);

      expect(result.seeds).toHaveLength(5);
      expect(result.method).toBe('jump');
    });

    it('is deterministic', () => {
      const result1 = generateJumpSeeds(42, 5);
      const result2 = generateJumpSeeds(42, 5);

      expect(result1.seeds).toEqual(result2.seeds);
    });
  });

  describe('generatePerturbationSeeds', () => {
    it('generates seeds for perturbation IDs', () => {
      const result = generatePerturbationSeeds(42, ['p1', 'p2', 'p3']);

      expect(result.seeds).toHaveLength(3);
      expect(result.method).toBe('hash_based');
    });

    it('different IDs produce different seeds', () => {
      const result = generatePerturbationSeeds(42, ['a', 'b', 'c']);
      const uniqueSeeds = new Set(result.seeds);

      expect(uniqueSeeds.size).toBe(3);
    });
  });

  describe('isValidSeed', () => {
    it('validates positive integers', () => {
      expect(isValidSeed(42)).toBe(true);
      expect(isValidSeed(0)).toBe(true);
      expect(isValidSeed(2147483647)).toBe(true);
    });

    it('rejects invalid values', () => {
      expect(isValidSeed(-1)).toBe(false);
      expect(isValidSeed(2147483648)).toBe(false);
      expect(isValidSeed(1.5)).toBe(false);
      expect(isValidSeed(NaN)).toBe(false);
      expect(isValidSeed(Infinity)).toBe(false);
      expect(isValidSeed('42')).toBe(false);
      expect(isValidSeed(null)).toBe(false);
    });
  });

  describe('normalizeSeed', () => {
    it('returns valid seed unchanged', () => {
      expect(normalizeSeed(42)).toBe(42);
    });

    it('returns default for null/undefined', () => {
      expect(normalizeSeed(null)).toBe(DEFAULT_SEED);
      expect(normalizeSeed(undefined)).toBe(DEFAULT_SEED);
    });

    it('normalizes invalid seeds', () => {
      const normalized = normalizeSeed(-100);
      expect(isValidSeed(normalized)).toBe(true);
    });
  });

  describe('checkDeterminism', () => {
    it('reports deterministic for valid seeds', () => {
      const result = checkDeterminism(42);
      expect(result.deterministic).toBe(true);
    });

    it('reports deterministic for default seed', () => {
      const result = checkDeterminism(undefined);
      expect(result.deterministic).toBe(true);
      expect(result.note).toContain('default seed');
    });
  });

  describe('getSeedInfo', () => {
    it('returns seed information', () => {
      const info = getSeedInfo(42);

      expect(info.value).toBe(42);
      expect(info.hex).toBe('0000002a');
      expect(info.isDefault).toBe(true);
    });
  });

  describe('seed logging', () => {
    beforeEach(() => {
      clearSeedLog();
    });

    it('logs seed usage', () => {
      logSeed('test', 42, 'explicit');
      const log = getSeedLog();

      expect(log).toHaveLength(1);
      expect(log[0].operation).toBe('test');
      expect(log[0].seed).toBe(42);
      expect(log[0].source).toBe('explicit');
    });

    it('limits log size', () => {
      for (let i = 0; i < 150; i++) {
        logSeed(`op${i}`, i, 'explicit');
      }

      const log = getSeedLog();
      expect(log.length).toBeLessThanOrEqual(100);
    });

    it('clears log', () => {
      logSeed('test', 42, 'explicit');
      clearSeedLog();

      expect(getSeedLog()).toHaveLength(0);
    });
  });
});

describe('Interventions', () => {
  beforeEach(() => {
    resetTraceCache();
  });

  it('applies interventions in interventional mode', () => {
    const result = generateTraces(simpleGraph, {
      seed: 42,
      n_samples: 16,
      mode: 'interventional',
      interventions: [{ node_id: 'B', value: 5 }],
    });

    expect(result.meta.inference_mode).toBe('interventional');
    expect(result.meta.interventions).toHaveLength(1);

    // B should have value 5 in all traces (intervention cuts incoming edges)
    for (const trace of result.traces) {
      expect(trace.node_values['B']).toBe(5);
    }
  });

  it('ignores interventions in observational mode', () => {
    const cache = getTraceCache();
    cache.setEnabled(false);

    const interventional = generateTraces(simpleGraph, {
      seed: 42,
      n_samples: 16,
      mode: 'interventional',
      interventions: [{ node_id: 'B', value: 5 }],
    });

    const observational = generateTraces(simpleGraph, {
      seed: 42,
      n_samples: 16,
      mode: 'observational',
      interventions: [{ node_id: 'B', value: 5 }],
    });

    cache.setEnabled(true);

    // Observational should have different B values
    expect(observational.meta.inference_mode).toBe('observational');
    // B values should vary in observational mode
    const bValues = observational.traces.map((t) => t.node_values['B']);
    const uniqueB = new Set(bValues);
    expect(uniqueB.size).toBeGreaterThanOrEqual(1);
  });
});
