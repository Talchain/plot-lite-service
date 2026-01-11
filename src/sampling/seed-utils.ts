/**
 * Seed Management Utilities
 *
 * Brief 8: Task 7 - Seed Management
 *
 * Seed Generation Strategy
 * ========================
 *
 * When caller provides seed:
 *   - Use provided seed directly
 *   - Return in seed_used field
 *   - Guarantees reproducibility
 *
 * When caller omits seed:
 *   - Compute deterministic seed from graph canonical hash
 *   - Same graph → same seed → same results
 *   - Return computed seed in seed_used field
 *
 * NOTE: The V2 /run endpoint derives seed from graph hash when not provided.
 * This ensures determinism: identical requests without seed produce identical
 * results and response_hash values. See src/routes/v2/run.ts resolveSeed().
 *
 * For guaranteed reproducibility across API versions, callers
 * should provide explicit seed and persist seed_used from response.
 *
 * Provides utilities for:
 * - Default seed derivation from graph_hash (reproducible without explicit seed)
 * - Seed sequence generation for perturbation sweeps
 * - Seed logging for debugging
 */

import { createHash } from 'node:crypto';
import { XorShift128Plus } from '../scm-lite/rng.js';

/**
 * Default seed when none is provided
 */
export const DEFAULT_SEED = 42;

/**
 * Seed generation methods
 */
export type SeedMethod = 'sequential' | 'hash_based' | 'jump' | 'derived';

/**
 * Seed sequence result
 */
export interface SeedSequenceResult {
  /** Base seed used */
  base_seed: number;
  /** Generated seeds */
  seeds: number[];
  /** Method used to generate */
  method: SeedMethod;
  /** Human-readable description */
  description: string;
}

/**
 * Seed derivation result
 */
export interface DerivedSeed {
  /** The derived seed value */
  seed: number;
  /** Source of derivation */
  source: string;
  /** Whether this is deterministic */
  deterministic: boolean;
  /** Human-readable note */
  note: string;
}

/**
 * Seed log entry for debugging
 */
export interface SeedLogEntry {
  /** Timestamp */
  timestamp: Date;
  /** Operation that used the seed */
  operation: string;
  /** Seed value used */
  seed: number;
  /** How the seed was obtained */
  source: SeedMethod | 'explicit' | 'default';
  /** Additional context */
  context?: Record<string, unknown>;
}

/**
 * In-memory seed log (limited size)
 */
const seedLog: SeedLogEntry[] = [];
const MAX_SEED_LOG_SIZE = 100;

/**
 * Log a seed usage for debugging
 */
export function logSeed(
  operation: string,
  seed: number,
  source: SeedLogEntry['source'],
  context?: Record<string, unknown>
): void {
  const entry: SeedLogEntry = {
    timestamp: new Date(),
    operation,
    seed,
    source,
    context,
  };

  seedLog.push(entry);

  // Trim log to max size
  while (seedLog.length > MAX_SEED_LOG_SIZE) {
    seedLog.shift();
  }
}

/**
 * Get recent seed log entries
 */
export function getSeedLog(limit = 20): SeedLogEntry[] {
  return seedLog.slice(-limit);
}

/**
 * Clear seed log
 */
export function clearSeedLog(): void {
  seedLog.length = 0;
}

/**
 * Derive a deterministic seed from a hash string
 *
 * @param hash - Hash string (hex)
 * @returns Positive integer seed
 */
export function seedFromHash(hash: string): number {
  // Take first 8 hex characters and convert to number
  const hexPart = hash.slice(0, 8);
  const seed = parseInt(hexPart, 16);

  // Ensure positive and within safe integer range
  // Using 2^31 - 1 for compatibility with various RNGs
  return Math.abs(seed) % 2147483647 || DEFAULT_SEED;
}

/**
 * Derive a seed from a graph hash
 *
 * Use this when no explicit seed is provided to ensure reproducibility.
 *
 * @param graphHash - Hash of the graph
 * @returns Derived seed result
 */
export function deriveSeed(graphHash: string): DerivedSeed {
  const seed = seedFromHash(graphHash);

  return {
    seed,
    source: `graph_hash:${graphHash.slice(0, 16)}...`,
    deterministic: true,
    note: 'Seed derived from graph hash - same graph always produces same seed',
  };
}

/**
 * Derive a seed from multiple inputs
 *
 * @param inputs - Array of strings to combine
 * @returns Derived seed
 */
export function deriveSeedFromInputs(...inputs: string[]): number {
  const combined = inputs.join(':');
  const hash = createHash('sha256').update(combined).digest('hex');
  return seedFromHash(hash);
}

/**
 * Generate sequential seed sequence
 *
 * Simple approach: base_seed, base_seed + 1, base_seed + 2, ...
 *
 * @param baseSeed - Starting seed
 * @param count - Number of seeds to generate
 * @returns Seed sequence
 */
export function generateSequentialSeeds(
  baseSeed: number,
  count: number
): SeedSequenceResult {
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push((baseSeed + i) % 2147483647);
  }

  return {
    base_seed: baseSeed,
    seeds,
    method: 'sequential',
    description: `Sequential seeds from ${baseSeed} to ${baseSeed + count - 1}`,
  };
}

/**
 * Generate hash-based seed sequence
 *
 * Each seed is derived from hash(baseSeed + index), providing
 * independent streams that are reproducible.
 *
 * @param baseSeed - Base seed
 * @param count - Number of seeds to generate
 * @returns Seed sequence
 */
export function generateHashBasedSeeds(
  baseSeed: number,
  count: number
): SeedSequenceResult {
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    const input = `${baseSeed}:${i}`;
    const hash = createHash('sha256').update(input).digest('hex');
    seeds.push(seedFromHash(hash));
  }

  return {
    base_seed: baseSeed,
    seeds,
    method: 'hash_based',
    description: `Hash-based seeds from base ${baseSeed} with ${count} independent streams`,
  };
}

/**
 * Generate seeds using RNG jump
 *
 * Uses the XorShift128Plus jump function to generate independent
 * parallel streams. This is the most statistically sound approach
 * for parallel Monte Carlo.
 *
 * @param baseSeed - Base seed for RNG initialization
 * @param count - Number of seeds/streams to generate
 * @returns Seed sequence
 */
export function generateJumpSeeds(
  baseSeed: number,
  count: number
): SeedSequenceResult {
  const rng = new XorShift128Plus(baseSeed);
  const seeds: number[] = [];

  for (let i = 0; i < count; i++) {
    // Use current RNG state to generate a seed
    seeds.push(Math.floor(rng.next() * 2147483647));
    // Jump to next independent stream
    rng.jump();
  }

  return {
    base_seed: baseSeed,
    seeds,
    method: 'jump',
    description: `Jump-based seeds with ${count} independent parallel streams`,
  };
}

/**
 * Generate seeds for a list of perturbation IDs
 *
 * @param baseSeed - Base seed
 * @param perturbationIds - List of perturbation identifiers
 * @returns Seed sequence with one seed per perturbation
 */
export function generatePerturbationSeeds(
  baseSeed: number,
  perturbationIds: string[]
): SeedSequenceResult {
  const seeds: number[] = [];
  for (const id of perturbationIds) {
    const input = `${baseSeed}:${id}`;
    const hash = createHash('sha256').update(input).digest('hex');
    seeds.push(seedFromHash(hash));
  }

  return {
    base_seed: baseSeed,
    seeds,
    method: 'hash_based',
    description: `Seeds for ${perturbationIds.length} perturbations based on IDs`,
  };
}

/**
 * Validate a seed value
 *
 * @param seed - Seed to validate
 * @returns True if valid seed
 */
export function isValidSeed(seed: unknown): seed is number {
  if (typeof seed !== 'number') return false;
  if (!Number.isFinite(seed)) return false;
  if (seed < 0 || seed > 2147483647) return false;
  if (!Number.isInteger(seed)) return false;
  return true;
}

/**
 * Normalize a seed value
 *
 * Converts invalid seeds to valid ones, returning default for null/undefined.
 *
 * @param seed - Seed value (may be invalid)
 * @param defaultSeed - Default to use if null/undefined
 * @returns Valid seed
 */
export function normalizeSeed(
  seed: number | null | undefined,
  defaultSeed = DEFAULT_SEED
): number {
  if (seed === null || seed === undefined) {
    return defaultSeed;
  }

  if (!isValidSeed(seed)) {
    // Try to make it valid
    const normalized = Math.abs(Math.floor(seed)) % 2147483647;
    return normalized || defaultSeed;
  }

  return seed;
}

/**
 * Check if results would be deterministic with given seed
 *
 * Note: In V2, when seed is omitted, it's derived from graph hash (deterministic).
 * This function is for utility purposes; actual V2 determinism is handled in run.ts.
 *
 * @param seed - Seed value
 * @returns Object with deterministic flag and note
 */
export function checkDeterminism(seed: number | null | undefined): {
  deterministic: boolean;
  note: string;
} {
  if (seed === null || seed === undefined) {
    return {
      deterministic: true,
      note: 'Seed will be derived from graph hash - results are deterministic for same graph',
    };
  }

  if (!isValidSeed(seed)) {
    return {
      deterministic: false,
      note: `Invalid seed value (${seed}) - results may not be reproducible`,
    };
  }

  return {
    deterministic: true,
    note: `Using explicit seed (${seed}) - results are deterministic`,
  };
}

/**
 * Get seed info for debugging/logging
 */
export function getSeedInfo(seed: number): {
  value: number;
  hex: string;
  binary: string;
  isDefault: boolean;
} {
  return {
    value: seed,
    hex: seed.toString(16).padStart(8, '0'),
    binary: seed.toString(2).padStart(31, '0'),
    isDefault: seed === DEFAULT_SEED,
  };
}
