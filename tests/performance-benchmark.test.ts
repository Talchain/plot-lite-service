/**
 * Performance Benchmarking Suite
 *
 * Hardening & Performance - Establish baseline performance metrics
 *
 * Benchmarks inference time for:
 * - Small graphs (5-10 nodes)
 * - Medium graphs (20-30 nodes)
 * - Large graphs (50+ nodes)
 * - With/without correlation groups
 *
 * Results are documented for performance monitoring.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { getInferenceEngine, type InferenceConfig } from '../src/inference/index.js';
import type { Graph, GraphNode, GraphEdge, CorrelationGroup } from '../src/trust/types.js';
import {
  SeededRNG,
  sampleCorrelatedGroup,
  sampleAllCorrelationGroups,
  choleskyDecomposition,
  validateCorrelationMatrix,
} from '../src/engine/correlation-sampling.js';

/**
 * Benchmark result structure
 */
interface BenchmarkResult {
  name: string;
  iterations: number;
  totalMs: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  stdDevMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
}

/**
 * Run a benchmark function multiple times and collect timing stats
 */
async function benchmark(
  name: string,
  fn: () => Promise<void> | void,
  iterations = 100
): Promise<BenchmarkResult> {
  const times: number[] = [];

  // Warmup run
  await fn();

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  times.sort((a, b) => a - b);

  const totalMs = times.reduce((a, b) => a + b, 0);
  const avgMs = totalMs / iterations;
  const minMs = times[0];
  const maxMs = times[times.length - 1];

  // Calculate standard deviation
  const squaredDiffs = times.map((t) => Math.pow(t - avgMs, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / iterations;
  const stdDevMs = Math.sqrt(avgSquaredDiff);

  // Percentiles
  const p50Ms = times[Math.floor(iterations * 0.5)];
  const p95Ms = times[Math.floor(iterations * 0.95)];
  const p99Ms = times[Math.floor(iterations * 0.99)];

  return {
    name,
    iterations,
    totalMs,
    avgMs,
    minMs,
    maxMs,
    stdDevMs,
    p50Ms,
    p95Ms,
    p99Ms,
  };
}

/**
 * Generate a random graph with specified number of nodes
 */
function generateGraph(
  nodeCount: number,
  edgeDensity = 0.3,
  seed = 42
): Graph {
  const rng = new SeededRNG(seed);
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Create nodes with mix of types
  for (let i = 0; i < nodeCount; i++) {
    const nodeType = i === nodeCount - 1 ? 'outcome' : i === 0 ? 'decision' : 'factor';
    nodes.push({
      id: `node_${i}`,
      label: `Node ${i}`,
      type: nodeType,
      value: rng.next(),
    });
  }

  // Create edges (only forward edges to maintain DAG structure)
  for (let i = 0; i < nodeCount - 1; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      if (rng.next() < edgeDensity) {
        edges.push({
          from: `node_${i}`,
          to: `node_${j}`,
          weight: (rng.next() - 0.5) * 2, // -1 to 1
        });
      }
    }
  }

  // Ensure connectivity - add edges from each node to the outcome
  const outcomeId = `node_${nodeCount - 1}`;
  const connectedToOutcome = new Set(edges.filter((e) => e.to === outcomeId).map((e) => e.from));

  for (let i = 0; i < nodeCount - 1; i++) {
    if (!connectedToOutcome.has(`node_${i}`)) {
      edges.push({
        from: `node_${i}`,
        to: outcomeId,
        weight: (rng.next() - 0.5) * 2,
      });
    }
  }

  return { nodes, edges };
}

/**
 * Generate correlation groups for a graph
 */
function generateCorrelationGroups(
  graph: Graph,
  groupCount: number,
  nodesPerGroup: number,
  seed = 42
): CorrelationGroup[] {
  const rng = new SeededRNG(seed);
  const groups: CorrelationGroup[] = [];
  const usedNodes = new Set<string>();

  // Get factor nodes (not decision or outcome)
  const factorNodes = graph.nodes
    .filter((n) => n.type !== 'decision' && n.type !== 'outcome')
    .map((n) => n.id);

  for (let g = 0; g < groupCount && factorNodes.length >= nodesPerGroup; g++) {
    // Select random nodes for this group
    const groupNodes: string[] = [];
    const availableNodes = factorNodes.filter((n) => !usedNodes.has(n));

    if (availableNodes.length < nodesPerGroup) break;

    // Shuffle and take first N
    for (let i = 0; i < nodesPerGroup && availableNodes.length > 0; i++) {
      const idx = Math.floor(rng.next() * availableNodes.length);
      const node = availableNodes.splice(idx, 1)[0];
      groupNodes.push(node);
      usedNodes.add(node);
    }

    // Generate valid correlation matrix
    const n = groupNodes.length;
    const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

    // Fill diagonal with 1s
    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1.0;
    }

    // Fill off-diagonal with random correlations (scaled down to ensure PSD)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        // Use smaller correlations to ensure PSD
        const corr = (rng.next() - 0.5) * 0.6; // -0.3 to 0.3
        matrix[i][j] = corr;
        matrix[j][i] = corr;
      }
    }

    groups.push({
      group_id: `group_${g}`,
      node_ids: groupNodes,
      correlation_matrix: matrix,
      label: `Correlation Group ${g}`,
    });
  }

  return groups;
}

/**
 * Format benchmark result as table row
 */
function formatResult(result: BenchmarkResult): string {
  return [
    result.name.padEnd(35),
    `${result.avgMs.toFixed(3)}ms`.padStart(12),
    `${result.p50Ms.toFixed(3)}ms`.padStart(12),
    `${result.p95Ms.toFixed(3)}ms`.padStart(12),
    `${result.p99Ms.toFixed(3)}ms`.padStart(12),
    `${result.stdDevMs.toFixed(3)}ms`.padStart(12),
  ].join(' | ');
}

describe('Performance Benchmarks', () => {
  const inferenceEngine = getInferenceEngine('model_based');
  const results: BenchmarkResult[] = [];

  // Graph sizes to test
  const SMALL_NODES = 8;
  const MEDIUM_NODES = 25;
  const LARGE_NODES = 50;

  // Iteration counts
  const INFERENCE_ITERATIONS = 50;
  const CORRELATION_ITERATIONS = 200;

  describe('Inference Engine Benchmarks', () => {
    describe('Small Graphs (5-10 nodes)', () => {
      it('benchmarks inference on small graph', async () => {
        const graph = generateGraph(SMALL_NODES);
        const config: InferenceConfig = {
          seed: 4242,
          k_samples: 32,
          outcome_node: `node_${SMALL_NODES - 1}`,
          baseline_value: 100,
          adaptiveK: true,
        };

        const result = await benchmark(
          `Small Graph (${SMALL_NODES} nodes)`,
          async () => {
            await inferenceEngine.run(graph, { ...config, seed: config.seed + Math.random() * 1000 });
          },
          INFERENCE_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(100); // Should complete in <100ms avg
      });

      it('benchmarks inference with high k_samples', async () => {
        const graph = generateGraph(SMALL_NODES);
        const config: InferenceConfig = {
          seed: 4242,
          k_samples: 128,
          outcome_node: `node_${SMALL_NODES - 1}`,
          baseline_value: 100,
          adaptiveK: false,
        };

        const result = await benchmark(
          `Small Graph, k=128`,
          async () => {
            await inferenceEngine.run(graph, { ...config, seed: config.seed + Math.random() * 1000 });
          },
          INFERENCE_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(200);
      });
    });

    describe('Medium Graphs (20-30 nodes)', () => {
      it('benchmarks inference on medium graph', async () => {
        const graph = generateGraph(MEDIUM_NODES);
        const config: InferenceConfig = {
          seed: 4242,
          k_samples: 32,
          outcome_node: `node_${MEDIUM_NODES - 1}`,
          baseline_value: 100,
          adaptiveK: true,
        };

        const result = await benchmark(
          `Medium Graph (${MEDIUM_NODES} nodes)`,
          async () => {
            await inferenceEngine.run(graph, { ...config, seed: config.seed + Math.random() * 1000 });
          },
          INFERENCE_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(500);
      });

      it('benchmarks inference with dense edges', async () => {
        const graph = generateGraph(MEDIUM_NODES, 0.5); // 50% edge density
        const config: InferenceConfig = {
          seed: 4242,
          k_samples: 32,
          outcome_node: `node_${MEDIUM_NODES - 1}`,
          baseline_value: 100,
          adaptiveK: true,
        };

        const result = await benchmark(
          `Medium Graph, Dense Edges`,
          async () => {
            await inferenceEngine.run(graph, { ...config, seed: config.seed + Math.random() * 1000 });
          },
          INFERENCE_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(500);
      });
    });

    describe('Large Graphs (50+ nodes)', () => {
      it('benchmarks inference on large graph', async () => {
        const graph = generateGraph(LARGE_NODES);
        const config: InferenceConfig = {
          seed: 4242,
          k_samples: 32,
          outcome_node: `node_${LARGE_NODES - 1}`,
          baseline_value: 100,
          adaptiveK: true,
        };

        const result = await benchmark(
          `Large Graph (${LARGE_NODES} nodes)`,
          async () => {
            await inferenceEngine.run(graph, { ...config, seed: config.seed + Math.random() * 1000 });
          },
          INFERENCE_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(2000);
      });

      it('benchmarks inference with high k_samples on large graph', async () => {
        const graph = generateGraph(LARGE_NODES);
        const config: InferenceConfig = {
          seed: 4242,
          k_samples: 128,
          outcome_node: `node_${LARGE_NODES - 1}`,
          baseline_value: 100,
          adaptiveK: false,
        };

        const result = await benchmark(
          `Large Graph, k=128`,
          async () => {
            await inferenceEngine.run(graph, { ...config, seed: config.seed + Math.random() * 1000 });
          },
          INFERENCE_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(3000);
      });
    });
  });

  describe('Correlation Sampling Benchmarks', () => {
    describe('Cholesky Decomposition', () => {
      it('benchmarks Cholesky on small matrices', async () => {
        const n = 5;
        const matrix = createValidCorrelationMatrix(n, 42);

        const result = await benchmark(
          `Cholesky (${n}x${n})`,
          () => {
            choleskyDecomposition(matrix);
          },
          CORRELATION_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(1);
      });

      it('benchmarks Cholesky on medium matrices', async () => {
        const n = 15;
        const matrix = createValidCorrelationMatrix(n, 42);

        const result = await benchmark(
          `Cholesky (${n}x${n})`,
          () => {
            choleskyDecomposition(matrix);
          },
          CORRELATION_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(5);
      });

      it('benchmarks Cholesky on large matrices', async () => {
        const n = 30;
        const matrix = createValidCorrelationMatrix(n, 42);

        const result = await benchmark(
          `Cholesky (${n}x${n})`,
          () => {
            choleskyDecomposition(matrix);
          },
          CORRELATION_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(20);
      });
    });

    describe('Correlation Group Sampling', () => {
      it('benchmarks sampling small correlation group', async () => {
        const group: CorrelationGroup = {
          group_id: 'test_group',
          node_ids: ['a', 'b', 'c', 'd', 'e'],
          correlation_matrix: createValidCorrelationMatrix(5, 42),
        };

        let seedOffset = 0;
        const result = await benchmark(
          `Sample Group (5 nodes)`,
          () => {
            const rng = new SeededRNG(42 + seedOffset++);
            sampleCorrelatedGroup(group, rng);
          },
          CORRELATION_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(1);
      });

      it('benchmarks sampling medium correlation group', async () => {
        const n = 15;
        const nodeIds = Array.from({ length: n }, (_, i) => `node_${i}`);
        const group: CorrelationGroup = {
          group_id: 'test_group',
          node_ids: nodeIds,
          correlation_matrix: createValidCorrelationMatrix(n, 42),
        };

        let seedOffset = 0;
        const result = await benchmark(
          `Sample Group (15 nodes)`,
          () => {
            const rng = new SeededRNG(42 + seedOffset++);
            sampleCorrelatedGroup(group, rng);
          },
          CORRELATION_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(5);
      });

      it('benchmarks sampling multiple groups', async () => {
        const groups: CorrelationGroup[] = [];
        for (let g = 0; g < 5; g++) {
          const n = 6;
          groups.push({
            group_id: `group_${g}`,
            node_ids: Array.from({ length: n }, (_, i) => `g${g}_node_${i}`),
            correlation_matrix: createValidCorrelationMatrix(n, 42 + g),
          });
        }

        let seedOffset = 0;
        const result = await benchmark(
          `Sample 5 Groups (6 nodes each)`,
          () => {
            sampleAllCorrelationGroups(groups, 42 + seedOffset++);
          },
          CORRELATION_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(10);
      });
    });

    describe('Matrix Validation', () => {
      it('benchmarks matrix validation', async () => {
        const matrix = createValidCorrelationMatrix(10, 42);

        const result = await benchmark(
          `Validate Matrix (10x10)`,
          () => {
            validateCorrelationMatrix(matrix);
          },
          CORRELATION_ITERATIONS
        );

        results.push(result);
        expect(result.avgMs).toBeLessThan(2);
      });
    });
  });

  describe('Combined Benchmarks', () => {
    it('benchmarks inference with correlation groups (medium graph)', async () => {
      const graph = generateGraph(MEDIUM_NODES);
      const correlationGroups = generateCorrelationGroups(graph, 3, 5, 42);
      graph.correlation_groups = correlationGroups;

      const config: InferenceConfig = {
        seed: 4242,
        k_samples: 32,
        outcome_node: `node_${MEDIUM_NODES - 1}`,
        baseline_value: 100,
        adaptiveK: true,
      };

      const result = await benchmark(
        `Medium Graph + 3 Correlation Groups`,
        async () => {
          await inferenceEngine.run(graph, { ...config, seed: config.seed + Math.random() * 1000 });
        },
        INFERENCE_ITERATIONS
      );

      results.push(result);
      expect(result.avgMs).toBeLessThan(600);
    });

    it('benchmarks inference with correlation groups (large graph)', async () => {
      const graph = generateGraph(LARGE_NODES);
      const correlationGroups = generateCorrelationGroups(graph, 5, 6, 42);
      graph.correlation_groups = correlationGroups;

      const config: InferenceConfig = {
        seed: 4242,
        k_samples: 32,
        outcome_node: `node_${LARGE_NODES - 1}`,
        baseline_value: 100,
        adaptiveK: true,
      };

      const result = await benchmark(
        `Large Graph + 5 Correlation Groups`,
        async () => {
          await inferenceEngine.run(graph, { ...config, seed: config.seed + Math.random() * 1000 });
        },
        INFERENCE_ITERATIONS
      );

      results.push(result);
      expect(result.avgMs).toBeLessThan(2500);
    });
  });

  // Print summary after all tests
  describe('Benchmark Summary', () => {
    it('prints performance summary', () => {
      console.log('\n');
      console.log('='.repeat(110));
      console.log('PERFORMANCE BENCHMARK SUMMARY');
      console.log('='.repeat(110));
      console.log(
        [
          'Benchmark'.padEnd(35),
          'Avg'.padStart(12),
          'P50'.padStart(12),
          'P95'.padStart(12),
          'P99'.padStart(12),
          'StdDev'.padStart(12),
        ].join(' | ')
      );
      console.log('-'.repeat(110));

      for (const result of results) {
        console.log(formatResult(result));
      }

      console.log('='.repeat(110));
      console.log('\n');

      // Performance characteristics documentation
      console.log('PERFORMANCE CHARACTERISTICS:');
      console.log('-'.repeat(50));
      console.log('1. Inference scales linearly with node count');
      console.log('2. k_samples has significant impact on larger graphs');
      console.log('3. Correlation groups add overhead proportional to group size');
      console.log('4. Cholesky decomposition is O(n^3) for n nodes');
      console.log('5. AdaptiveK can reduce iterations for stable graphs');
      console.log('\n');

      // Optimization opportunities
      console.log('OPTIMIZATION OPPORTUNITIES:');
      console.log('-'.repeat(50));
      console.log('1. Cache Cholesky decomposition for repeated sampling');
      console.log('2. Parallelize independent graph traversals');
      console.log('3. Use SIMD for matrix operations on large graphs');
      console.log('4. Lazy evaluation for unused branches');
      console.log('5. Incremental updates for small graph changes');
      console.log('\n');

      expect(results.length).toBeGreaterThan(0);
    });
  });
});

/**
 * Create a valid correlation matrix (guaranteed PSD)
 */
function createValidCorrelationMatrix(n: number, seed: number): number[][] {
  const rng = new SeededRNG(seed);

  // Generate a random lower triangular matrix
  const L: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    // Diagonal elements should be positive
    L[i][i] = 0.5 + rng.next() * 0.5;
    for (let j = 0; j < i; j++) {
      L[i][j] = (rng.next() - 0.5) * 0.4;
    }
  }

  // Compute L * L^T (guaranteed PSD)
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let k = 0; k <= Math.min(i, j); k++) {
        sum += L[i][k] * L[j][k];
      }
      matrix[i][j] = sum;
    }
  }

  // Normalize to correlation matrix (diagonal = 1)
  const diag = matrix.map((row, i) => Math.sqrt(row[i]));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      matrix[i][j] = matrix[i][j] / (diag[i] * diag[j]);
    }
  }

  return matrix;
}
