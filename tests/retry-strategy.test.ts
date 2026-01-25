/**
 * Retry Strategy Tests
 *
 * Tests for the retry utility in src/lib/retry-strategy.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  withRetry,
  isTransientError,
  calculateDelay,
  DEFAULT_RETRY_CONFIG,
  type RetryConfig,
  type RetryContext,
  type RetryError,
} from '../src/lib/retry-strategy.js';
import { resetIslCircuitBreaker, recordIslFailure } from '../src/integrations/isl-circuit-breaker.js';

describe('Retry Strategy', () => {
  // Reset circuit breaker before each test
  beforeEach(() => {
    resetIslCircuitBreaker();
  });

  describe('isTransientError', () => {
    it('returns true for HTTP 503', () => {
      expect(isTransientError({ status: 503 })).toBe(true);
      expect(isTransientError({ statusCode: 503 })).toBe(true);
    });

    it('returns true for HTTP 502', () => {
      expect(isTransientError({ status: 502 })).toBe(true);
    });

    it('returns true for HTTP 504', () => {
      expect(isTransientError({ status: 504 })).toBe(true);
    });

    it('returns true for HTTP 429', () => {
      expect(isTransientError({ status: 429 })).toBe(true);
    });

    it('returns false for HTTP 400', () => {
      expect(isTransientError({ status: 400 })).toBe(false);
    });

    it('returns false for HTTP 401', () => {
      expect(isTransientError({ status: 401 })).toBe(false);
    });

    it('returns false for HTTP 404', () => {
      expect(isTransientError({ status: 404 })).toBe(false);
    });

    it('returns false for HTTP 500', () => {
      expect(isTransientError({ status: 500 })).toBe(false);
    });

    it('returns true for ETIMEDOUT', () => {
      expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
    });

    it('returns true for ECONNRESET', () => {
      expect(isTransientError({ code: 'ECONNRESET' })).toBe(true);
    });

    it('returns true for ECONNREFUSED', () => {
      expect(isTransientError({ code: 'ECONNREFUSED' })).toBe(true);
    });

    it('returns false for null/undefined', () => {
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });

    it('handles axios-style errors with response.status', () => {
      expect(isTransientError({ response: { status: 503 } })).toBe(true);
      expect(isTransientError({ response: { status: 400 } })).toBe(false);
    });

    it('handles errors with cause chain', () => {
      const error = { cause: { code: 'ETIMEDOUT' } };
      expect(isTransientError(error)).toBe(true);
    });
  });

  describe('calculateDelay', () => {
    const baseConfig: RetryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      baseDelayMs: 100,
      maxDelayMs: 5000,
      jitter: false, // Disable jitter for deterministic tests
    };

    it('uses exponential backoff', () => {
      expect(calculateDelay(0, baseConfig)).toBe(100); // 100 * 2^0
      expect(calculateDelay(1, baseConfig)).toBe(200); // 100 * 2^1
      expect(calculateDelay(2, baseConfig)).toBe(400); // 100 * 2^2
      expect(calculateDelay(3, baseConfig)).toBe(800); // 100 * 2^3
    });

    it('caps at maxDelayMs', () => {
      expect(calculateDelay(10, baseConfig)).toBe(5000); // Would be 102400, capped at 5000
    });

    it('adds jitter when enabled', () => {
      const configWithJitter: RetryConfig = { ...baseConfig, jitter: true };
      const delays = new Set<number>();

      // Generate multiple delays, they should vary
      for (let i = 0; i < 10; i++) {
        delays.add(calculateDelay(1, configWithJitter));
      }

      // With jitter, we should get different values (statistically unlikely to get same value 10 times)
      expect(delays.size).toBeGreaterThan(1);
    });
  });

  describe('withRetry', () => {
    const testConfig: RetryConfig = {
      maxAttempts: 3,
      baseDelayMs: 10, // Short delays for tests
      maxDelayMs: 100,
      budgetMs: 5000,
      perAttemptTimeoutMs: 1000,
      jitter: false, // Deterministic for tests
    };

    const testContext: RetryContext = {
      requestId: 'test-request-123',
    };

    it('returns result on success', async () => {
      const result = await withRetry(
        async () => 'success',
        testConfig,
        testContext
      );
      expect(result).toBe('success');
    });

    it('retries on 503, succeeds on retry', async () => {
      let attempts = 0;
      const result = await withRetry(
        async () => {
          attempts++;
          if (attempts < 2) {
            throw { status: 503, message: 'Service Unavailable' };
          }
          return 'success';
        },
        testConfig,
        testContext
      );

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('does not retry on 400', async () => {
      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw { status: 400, message: 'Bad Request' };
          },
          testConfig,
          testContext
        )
      ).rejects.toThrow();

      expect(attempts).toBe(1);
    });

    it('does not retry on 401', async () => {
      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw { status: 401, message: 'Unauthorized' };
          },
          testConfig,
          testContext
        )
      ).rejects.toThrow();

      expect(attempts).toBe(1);
    });

    it('does not retry on 500', async () => {
      let attempts = 0;
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw { status: 500, message: 'Internal Server Error' };
          },
          testConfig,
          testContext
        )
      ).rejects.toThrow();

      expect(attempts).toBe(1);
    });

    it('respects per-attempt timeout', async () => {
      const shortTimeoutConfig: RetryConfig = {
        ...testConfig,
        perAttemptTimeoutMs: 50, // Very short timeout
      };

      let attempts = 0;
      await expect(
        withRetry(
          async (signal) => {
            attempts++;
            // Simulate slow operation
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(resolve, 200);
              signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new Error('Aborted'));
              });
            });
            return 'success';
          },
          shortTimeoutConfig,
          testContext
        )
      ).rejects.toThrow();

      // Should have attempted multiple times before giving up
      expect(attempts).toBeGreaterThanOrEqual(1);
    });

    it('respects overall budget', async () => {
      const tightBudgetConfig: RetryConfig = {
        ...testConfig,
        budgetMs: 100, // Very tight budget
        baseDelayMs: 50,
      };

      let attempts = 0;
      const startTime = Date.now();

      await expect(
        withRetry(
          async () => {
            attempts++;
            throw { status: 503, message: 'Service Unavailable' };
          },
          tightBudgetConfig,
          testContext
        )
      ).rejects.toThrow();

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(tightBudgetConfig.budgetMs + 100); // Allow some margin
    });

    it('respects circuit breaker state', async () => {
      // Open the circuit breaker by recording failures
      recordIslFailure();
      recordIslFailure();
      recordIslFailure(); // Default threshold is 3

      let attempts = 0;

      // First attempt should work (circuit breaker check is only on retries)
      // But subsequent retries should be blocked
      await expect(
        withRetry(
          async () => {
            attempts++;
            throw { status: 503, message: 'Service Unavailable' };
          },
          testConfig,
          testContext
        )
      ).rejects.toThrow(/circuit breaker/i);

      // Should have made only 1 attempt before circuit breaker blocked retries
      expect(attempts).toBe(1);
    });

    it('exhausts max attempts on persistent transient errors', async () => {
      let attempts = 0;

      try {
        await withRetry(
          async () => {
            attempts++;
            throw { status: 503, message: 'Service Unavailable' };
          },
          testConfig,
          testContext
        );
      } catch (error) {
        const retryError = error as RetryError;
        expect(retryError.isRetryExhausted).toBe(true);
        expect(retryError.attempts).toBe(testConfig.maxAttempts);
      }

      expect(attempts).toBe(testConfig.maxAttempts);
    });

    it('provides retry error with metadata', async () => {
      try {
        await withRetry(
          async () => {
            throw { status: 503, message: 'Service Unavailable' };
          },
          testConfig,
          testContext
        );
        expect.fail('Should have thrown');
      } catch (error) {
        const retryError = error as RetryError;
        expect(retryError.attempts).toBe(testConfig.maxAttempts);
        expect(retryError.totalTimeMs).toBeGreaterThan(0);
        expect(retryError.lastError).toBeDefined();
        expect(retryError.isRetryExhausted).toBe(true);
      }
    });

    it('is deterministic when jitter is disabled', async () => {
      const results: number[] = [];

      for (let i = 0; i < 3; i++) {
        let attemptTimes: number[] = [];
        let lastAttemptTime = Date.now();

        try {
          await withRetry(
            async () => {
              const now = Date.now();
              attemptTimes.push(now - lastAttemptTime);
              lastAttemptTime = now;
              throw { status: 503, message: 'Service Unavailable' };
            },
            { ...testConfig, maxAttempts: 2 },
            testContext
          );
        } catch {
          // Expected to fail
        }

        results.push(attemptTimes[1] || 0); // Delay before second attempt
      }

      // All delays should be similar (within 20ms tolerance due to execution time)
      const avgDelay = results.reduce((a, b) => a + b, 0) / results.length;
      for (const delay of results) {
        expect(Math.abs(delay - avgDelay)).toBeLessThan(30);
      }
    });

    it('handles cancellation via AbortSignal', async () => {
      const controller = new AbortController();
      let attempts = 0;

      // Cancel immediately
      controller.abort();

      await expect(
        withRetry(
          async () => {
            attempts++;
            return 'success';
          },
          { ...testConfig, maxAttempts: 5 },
          { ...testContext, signal: controller.signal }
        )
      ).rejects.toThrow(/cancelled/i);

      // Should not have made any attempts since cancelled before start
      expect(attempts).toBe(0);
    });
  });

  describe('Wiring Compatibility', () => {
    /**
     * These tests verify the retry utility type-aligns with actual client signatures.
     * They don't enable retry functionality - just confirm the wrapper can accept
     * real client shapes without type errors. This prevents "dead but green" code
     * by ensuring the retry path compiles against production types.
     */

    it('type-compatible with ISL client signature', async () => {
      // Mock matching actual ISL client shape (robustness analysis response)
      const mockIslCall = async (_signal: AbortSignal): Promise<{ robustness: unknown }> => {
        return { robustness: { level: 'high', fragile_edges: [] } };
      };

      const config: RetryConfig = {
        maxAttempts: 1, // Single attempt - no retry
        baseDelayMs: 100,
        maxDelayMs: 1000,
        budgetMs: 5000,
        perAttemptTimeoutMs: 2000,
        jitter: false,
      };

      // Should not throw - verifies types align
      const result = await withRetry(mockIslCall, config, { requestId: 'isl-wiring-test' });
      expect(result).toHaveProperty('robustness');
    });

    it('type-compatible with CEE client signature', async () => {
      // Mock matching actual CEE client shape (graph draft response)
      const mockCeeCall = async (_signal: AbortSignal): Promise<{ nodes: unknown[]; edges: unknown[] }> => {
        return { nodes: [{ id: 'n1' }], edges: [{ id: 'e1' }] };
      };

      const result = await withRetry(mockCeeCall, DEFAULT_RETRY_CONFIG, { requestId: 'cee-wiring-test' });
      expect(result).toHaveProperty('nodes');
      expect(result).toHaveProperty('edges');
    });

    it('type-compatible with CEE review signature', async () => {
      // Mock matching CEE review response (M1 contract)
      const mockCeeReviewCall = async (_signal: AbortSignal): Promise<{
        intent: string;
        analysis_state: 'ran' | 'skipped' | 'failed';
        readiness: { level: string; headline: string; factors: string[] };
        blocks: Array<{ id: string; status: string }>;
      }> => {
        return {
          intent: 'selection',
          analysis_state: 'ran',
          readiness: { level: 'ready', headline: 'Good to go', factors: [] },
          blocks: [{ id: 'structure', status: 'ok' }],
        };
      };

      const result = await withRetry(mockCeeReviewCall, DEFAULT_RETRY_CONFIG, { requestId: 'cee-review-wiring-test' });
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('analysis_state');
      expect(result).toHaveProperty('readiness');
      expect(result).toHaveProperty('blocks');
    });

    it('passes abort signal through to wrapped function', async () => {
      let receivedSignal: AbortSignal | undefined;

      const mockCall = async (signal: AbortSignal): Promise<string> => {
        receivedSignal = signal;
        return 'done';
      };

      const config: RetryConfig = {
        maxAttempts: 1,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        budgetMs: 5000,
        perAttemptTimeoutMs: 2000,
        jitter: false,
      };

      await withRetry(mockCall, config, { requestId: 'signal-test' });

      // Verify the function received an AbortSignal
      expect(receivedSignal).toBeDefined();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });
  });
});
