/**
 * PR-2A: Sliding Window Tests
 * Verifies burst vs drip detection with ring buffer
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SlidingWindow } from '../src/middleware/cb/window.js';

describe('PR-2A: Sliding Window (Ring Buffer)', () => {
  describe('SlidingWindow class', () => {
    it('counts events within window', () => {
      const window = new SlidingWindow(10);
      const now = Date.now();
      
      // Add 5 events in current window
      for (let i = 0; i < 5; i++) {
        window.add(now - i * 100); // Spread over 500ms
      }
      
      // Count within 1s window
      const count = window.countSince(now, 1000);
      expect(count).toBe(5);
    });

    it('excludes events outside window', () => {
      const window = new SlidingWindow(10);
      const now = Date.now();
      
      // Add old events (outside window)
      window.add(now - 5000);
      window.add(now - 6000);
      
      // Add recent events (inside window)
      window.add(now - 500);
      window.add(now - 100);
      
      // Count within 1s window
      const count = window.countSince(now, 1000);
      expect(count).toBe(2); // Only recent events
    });

    it('handles ring buffer wraparound', () => {
      const window = new SlidingWindow(3); // Small capacity
      const now = Date.now();
      
      // Add more than capacity
      window.add(now - 5000); // Old, will be overwritten
      window.add(now - 4000); // Old, will be overwritten
      window.add(now - 3000); // Old, will be overwritten
      window.add(now - 500);  // Recent
      window.add(now - 100);  // Recent
      
      // Count within 1s window
      const count = window.countSince(now, 1000);
      expect(count).toBe(2); // Only recent events visible
    });

    it('burst detection: 5 failures in 1s → trips', () => {
      const window = new SlidingWindow(5);
      const now = Date.now();
      const windowMs = 1000;
      const threshold = 5;
      
      // Simulate burst: 5 failures within 1s
      for (let i = 0; i < 5; i++) {
        window.add(now - i * 100); // 0ms, 100ms, 200ms, 300ms, 400ms ago
      }
      
      const count = window.countSince(now, windowMs);
      expect(count).toBeGreaterThanOrEqual(threshold);
    });

    it('drip detection: 5 failures over 3s → does not trip', () => {
      const window = new SlidingWindow(5);
      const now = Date.now();
      const windowMs = 1000;
      const threshold = 5;
      
      // Simulate drip: 5 failures spread over 3s
      window.add(now - 3000);
      window.add(now - 2500);
      window.add(now - 2000);
      window.add(now - 1500);
      window.add(now - 500);
      
      const count = window.countSince(now, windowMs);
      expect(count).toBeLessThan(threshold); // Only 1 in window
    });

    it('edge case: fills exactly to capacity (== threshold)', () => {
      const capacity = 5;
      const window = new SlidingWindow(capacity);
      const now = Date.now();
      
      // Add exactly capacity events
      for (let i = 0; i < capacity; i++) {
        window.add(now - i * 100);
      }
      
      expect(window.getSize()).toBe(capacity);
      const count = window.countSince(now, 1000);
      expect(count).toBe(capacity);
    });

    it('edge case: wraparound after >capacity adds', () => {
      const capacity = 3;
      const window = new SlidingWindow(capacity);
      const now = Date.now();
      
      // Add more than capacity (oldest get overwritten)
      window.add(now - 5000); // Will be overwritten
      window.add(now - 4000); // Will be overwritten
      window.add(now - 3000); // Will be overwritten
      window.add(now - 500);  // Kept
      window.add(now - 400);  // Kept
      window.add(now - 300);  // Kept
      
      expect(window.getSize()).toBe(capacity);
      const count = window.countSince(now, 1000);
      expect(count).toBe(3); // Only recent 3
    });

    it('edge case: boundary exclusion (timestamp exactly at now - windowMs)', () => {
      const window = new SlidingWindow(5);
      const now = Date.now();
      const windowMs = 1000;
      
      // Add event exactly at boundary
      window.add(now - windowMs);
      
      // Add events inside window
      window.add(now - 500);
      window.add(now - 100);
      
      // Boundary event should NOT count (strict > comparison)
      const count = window.countSince(now, windowMs);
      expect(count).toBe(2); // Only events strictly within window
    });
  });

  describe('Integration with circuit breaker', () => {
    it('exposes window config in /v1/health when enabled', async () => {
      const origEnv = process.env.RL_CB_ENABLE;
      process.env.RL_CB_ENABLE = '1';
      
      // Dynamic import to pick up env
      const { createServer } = await import('../src/createServer.js');
      const app = await createServer({ enableTestRoutes: false });
      
      const res = await app.inject({ method: 'GET', url: '/v1/health' });
      const data = JSON.parse(res.body);
      
      expect(data.circuit_breaker).toBeDefined();
      expect(data.circuit_breaker.window).toBeDefined();
      expect(data.circuit_breaker.window.windowMs).toBeGreaterThan(0);
      expect(data.circuit_breaker.window.failureThreshold).toBeGreaterThan(0);
      
      await app.close();
      process.env.RL_CB_ENABLE = origEnv;
    });
  });
});
