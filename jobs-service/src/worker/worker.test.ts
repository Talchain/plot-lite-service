import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JobWorker, WorkerConfig } from './index.js';
import { InMemoryJobRepository } from '../repositories/memory.js';
import { createJobHandlers } from '../handlers/index.js';

describe('JobWorker', () => {
  let worker: JobWorker;
  let repo: InMemoryJobRepository;
  let config: WorkerConfig;

  beforeEach(() => {
    repo = new InMemoryJobRepository();
    config = {
      globalMaxConcurrency: 2,
      orgMaxConcurrency: 1,
      jobMaxRunMs: 5000,
      pollIntervalMs: 100,
    };
    const handlers = createJobHandlers();
    worker = new JobWorker(repo, handlers, config);
  });

  afterEach(async () => {
    await worker.stop();
  });

  describe('start and stop', () => {
    it('should start and stop successfully', async () => {
      await worker.start();
      const stats = worker.getStats();
      expect(stats.running).toBe(0);

      await worker.stop();
    });

    it('should not start twice', async () => {
      await worker.start();
      await worker.start(); // Should not throw
      await worker.stop();
    });
  });

  describe('job execution', () => {
    it('should execute demo:slow-count job successfully', async () => {
      await worker.start();

      // Create a job
      const job = await repo.create({
        type: 'demo:slow-count',
        orgId: 'test-org',
        payload: { steps: 3 }, // Small number for fast test
      });

      // Wait for job to complete
      let attempts = 0;
      while (attempts < 50) { // 5 seconds max
        const updatedJob = await repo.get(job.id);
        if (updatedJob && updatedJob.status === 'completed') {
          expect(updatedJob.result).toEqual({
            count: 3,
            completed: true,
          });
          expect(updatedJob.progress).toBe(1);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (attempts >= 50) {
        throw new Error('Job did not complete in time');
      }

      const stats = worker.getStats();
      expect(stats.processed).toBe(1);
    });

    it('should handle demo:flaky job with retry', async () => {
      await worker.start();

      // Create a job
      const job = await repo.create({
        type: 'demo:flaky',
        orgId: 'test-org',
      });

      // Wait for job to complete (should succeed after retry)
      let attempts = 0;
      while (attempts < 100) { // 10 seconds max (allows for backoff)
        const updatedJob = await repo.get(job.id);
        if (updatedJob && updatedJob.status === 'completed') {
          expect(updatedJob.result).toHaveProperty('message');
          expect(updatedJob.result).toHaveProperty('attempts');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (attempts >= 100) {
        throw new Error('Flaky job did not complete in time');
      }

      const stats = worker.getStats();
      expect(stats.processed).toBe(1);
    });

    it('should handle unknown job type', async () => {
      await worker.start();

      // Create a job with unknown type
      const job = await repo.create({
        type: 'unknown:type',
        orgId: 'test-org',
      });

      // Wait for job to fail
      let attempts = 0;
      while (attempts < 30) {
        const updatedJob = await repo.get(job.id);
        if (updatedJob && updatedJob.status === 'failed') {
          expect(updatedJob.error).toHaveProperty('message');
          const errorMessage = (updatedJob.error as any)?.message || '';
          expect(errorMessage).toContain('No handler found');
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (attempts >= 30) {
        throw new Error('Job did not fail in time');
      }
    });

    it('should handle job cancellation', async () => {
      await worker.start();

      // Create a job
      const job = await repo.create({
        type: 'demo:slow-count',
        orgId: 'test-org',
        payload: { steps: 20 }, // Long-running job
      });

      // Wait for job to start
      await new Promise(resolve => setTimeout(resolve, 200));

      // Cancel the job
      const cancelled = await worker.cancelJob(job.id);
      expect(cancelled).toBe(true);

      // Wait for job to be marked as cancelled
      let attempts = 0;
      while (attempts < 30) {
        const updatedJob = await repo.get(job.id);
        if (updatedJob && updatedJob.status === 'cancelled') {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (attempts >= 30) {
        throw new Error('Job was not cancelled in time');
      }

      const stats = worker.getStats();
      expect(stats.cancelled).toBe(1);
    });
  });

  describe('concurrency limits', () => {
    it('should respect global concurrency limit', async () => {
      // Create multiple jobs
      await repo.create({ type: 'demo:slow-count', orgId: 'org1', payload: { steps: 10 } });
      await repo.create({ type: 'demo:slow-count', orgId: 'org2', payload: { steps: 10 } });
      await repo.create({ type: 'demo:slow-count', orgId: 'org3', payload: { steps: 10 } });

      await worker.start();

      // Wait a bit for worker to pick up jobs
      await new Promise(resolve => setTimeout(resolve, 300));

      const stats = worker.getStats();
      expect(stats.running).toBeLessThanOrEqual(config.globalMaxConcurrency);
    });

    it('should respect per-org concurrency limit', async () => {
      // Create multiple jobs for the same org
      await repo.create({ type: 'demo:slow-count', orgId: 'org1', payload: { steps: 10 } });
      await repo.create({ type: 'demo:slow-count', orgId: 'org1', payload: { steps: 10 } });

      await worker.start();

      // Wait a bit for worker to pick up jobs
      await new Promise(resolve => setTimeout(resolve, 300));

      const stats = worker.getStats();
      expect(stats.orgConcurrency['org1']).toBeLessThanOrEqual(config.orgMaxConcurrency);
    });
  });

  describe('error handling and retries', () => {
    it('should move job to DLQ after max attempts', async () => {
      await worker.start();

      // Create a job that will always fail
      const job = await repo.create({
        type: 'demo:flaky',
        orgId: 'test-org',
        maxAttempts: 1, // Only one attempt
      });

      // Wait for job to fail and move to DLQ
      let attempts = 0;
      while (attempts < 50) {
        const dlqJobs = await repo.getDLQJobs();
        if (dlqJobs.length > 0) {
          expect(dlqJobs[0].id).toBe(job.id);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (attempts >= 50) {
        throw new Error('Job was not moved to DLQ in time');
      }

      const stats = worker.getStats();
      expect(stats.failed).toBe(1);
    });
  });

  describe('stats', () => {
    it('should track worker statistics correctly', async () => {
      const initialStats = worker.getStats();
      expect(initialStats.running).toBe(0);
      expect(initialStats.processed).toBe(0);
      expect(initialStats.failed).toBe(0);
      expect(initialStats.cancelled).toBe(0);

      await worker.start();

      // Create and process a successful job
      await repo.create({
        type: 'demo:slow-count',
        orgId: 'test-org',
        payload: { steps: 2 },
      });

      // Wait for job to complete
      let attempts = 0;
      while (attempts < 30) {
        const stats = worker.getStats();
        if (stats.processed > 0) {
          expect(stats.processed).toBe(1);
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
      }

      if (attempts >= 30) {
        throw new Error('Stats were not updated in time');
      }
    });
  });
});