import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { BudgetManager } from '../src/budget.js';

describe('BudgetManager', () => {
  let budgetManager: BudgetManager;

  beforeEach(() => {
    budgetManager = new BudgetManager(100, 1000); // 100 burst, 1000/min
  });

  afterEach(() => {
    budgetManager.destroy();
  });

  describe('Token bucket mechanics', () => {
    test('should start with full bucket', () => {
      expect(budgetManager.canConsume('org1', 100)).toBe(true);
      expect(budgetManager.canConsume('org1', 101)).toBe(false);
      expect(budgetManager.getRemainingTokens('org1')).toBe(100);
    });

    test('should consume tokens correctly', () => {
      expect(budgetManager.consume('org1', 50)).toBe(true);
      expect(budgetManager.getRemainingTokens('org1')).toBe(50);

      expect(budgetManager.consume('org1', 50)).toBe(true);
      expect(budgetManager.getRemainingTokens('org1')).toBe(0);

      expect(budgetManager.consume('org1', 1)).toBe(false);
    });

    test('should handle separate buckets per org', () => {
      budgetManager.consume('org1', 50);
      budgetManager.consume('org2', 30);

      expect(budgetManager.getRemainingTokens('org1')).toBe(50);
      expect(budgetManager.getRemainingTokens('org2')).toBe(70);
    });

    test('should not consume if insufficient tokens', () => {
      budgetManager.consume('org1', 90);
      expect(budgetManager.getRemainingTokens('org1')).toBe(10);

      expect(budgetManager.consume('org1', 20)).toBe(false);
      expect(budgetManager.getRemainingTokens('org1')).toBe(10); // unchanged
    });
  });

  describe('Token refill', () => {
    test('should refill tokens over time', async () => {
      // Consume all tokens
      budgetManager.consume('org1', 100);
      expect(budgetManager.getRemainingTokens('org1')).toBe(0);

      // Wait for refill (1000/min = ~16.67/second)
      await new Promise(resolve => setTimeout(resolve, 100)); // 100ms

      // Should have refilled some tokens
      const remaining = budgetManager.getRemainingTokens('org1');
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThan(5); // Not too many in 100ms
    });

    test('should not exceed burst capacity', async () => {
      // Start with partial consumption
      budgetManager.consume('org1', 50);

      // Wait longer than needed for full refill
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should not exceed burst capacity
      expect(budgetManager.getRemainingTokens('org1')).toBeLessThanOrEqual(100);
    });
  });

  describe('Bucket management', () => {
    test('should track bucket count', () => {
      expect(budgetManager.getBucketCount()).toBe(0);

      budgetManager.consume('org1', 1);
      expect(budgetManager.getBucketCount()).toBe(1);

      budgetManager.consume('org2', 1);
      expect(budgetManager.getBucketCount()).toBe(2);
    });

    test('should handle canConsume without creating bucket', () => {
      expect(budgetManager.getBucketCount()).toBe(0);
      expect(budgetManager.canConsume('org1', 50)).toBe(true);
      expect(budgetManager.getBucketCount()).toBe(1); // Created on access
    });
  });

  describe('Edge cases', () => {
    test('should handle zero token consumption', () => {
      expect(budgetManager.consume('org1', 0)).toBe(true);
      expect(budgetManager.getRemainingTokens('org1')).toBe(100);
    });

    test('should handle negative token requests', () => {
      expect(budgetManager.canConsume('org1', -1)).toBe(true);
      expect(budgetManager.consume('org1', -1)).toBe(true);
      expect(budgetManager.getRemainingTokens('org1')).toBe(100); // Stays at capacity
    });

    test('should handle very large token requests', () => {
      expect(budgetManager.canConsume('org1', 1000000)).toBe(false);
      expect(budgetManager.consume('org1', 1000000)).toBe(false);
    });
  });
});