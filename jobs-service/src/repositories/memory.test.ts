import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryJobRepository } from './memory.js';
import { Job } from '../types/job.js';

describe('InMemoryJobRepository', () => {
  let repo: InMemoryJobRepository;

  beforeEach(() => {
    repo = new InMemoryJobRepository();
  });

  describe('create', () => {
    it('should create a job with default values', async () => {
      const job = await repo.create({
        type: 'test',
        orgId: 'org1',
      });

      expect(job.id).toBeDefined();
      expect(job.type).toBe('test');
      expect(job.orgId).toBe('org1');
      expect(job.status).toBe('queued');
      expect(job.progress).toBe(0);
      expect(job.attempts).toBe(0);
      expect(job.maxAttempts).toBe(3);
      expect(job.payload).toEqual({});
      expect(job.idempotencyKey).toBeNull();
    });

    it('should create a job with custom values', async () => {
      const runAt = new Date('2023-01-01');
      const job = await repo.create({
        type: 'test',
        orgId: 'org1',
        payload: { data: 'test' },
        maxAttempts: 5,
        runAt,
        idempotencyKey: 'key1',
      });

      expect(job.maxAttempts).toBe(5);
      expect(job.runAt).toEqual(runAt);
      expect(job.payload).toEqual({ data: 'test' });
      expect(job.idempotencyKey).toBe('key1');
    });
  });

  describe('get', () => {
    it('should return null for non-existent job', async () => {
      const job = await repo.get('non-existent');
      expect(job).toBeNull();
    });

    it('should return existing job', async () => {
      const created = await repo.create({ type: 'test', orgId: 'org1' });
      const retrieved = await repo.get(created.id);

      expect(retrieved).toEqual(created);
    });
  });

  describe('updatePartial', () => {
    it('should update job fields', async () => {
      const job = await repo.create({ type: 'test', orgId: 'org1' });

      // Wait a bit to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 2));
      const now = new Date();

      const updated = await repo.updatePartial(job.id, {
        status: 'running',
        progress: 0.5,
        startedAt: now,
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('running');
      expect(updated!.progress).toBe(0.5);
      expect(updated!.startedAt).toEqual(now);
      expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(job.updatedAt.getTime());
    });

    it('should return null for non-existent job', async () => {
      const updated = await repo.updatePartial('non-existent', { status: 'running' });
      expect(updated).toBeNull();
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      // Create test jobs
      await repo.create({ type: 'type1', orgId: 'org1' });
      await repo.create({ type: 'type2', orgId: 'org1' });
      await repo.create({ type: 'type1', orgId: 'org2' });
    });

    it('should return all jobs when no filters', async () => {
      const result = await repo.find({});
      expect(result.jobs).toHaveLength(3);
    });

    it('should filter by orgId', async () => {
      const result = await repo.find({ orgId: 'org1' });
      expect(result.jobs).toHaveLength(2);
      expect(result.jobs.every(job => job.orgId === 'org1')).toBe(true);
    });

    it('should filter by type', async () => {
      const result = await repo.find({ type: 'type1' });
      expect(result.jobs).toHaveLength(2);
      expect(result.jobs.every(job => job.type === 'type1')).toBe(true);
    });

    it('should filter by status', async () => {
      const jobs = await repo.find({});
      await repo.updatePartial(jobs.jobs[0].id, { status: 'running' });

      const result = await repo.find({ status: 'running' });
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0].status).toBe('running');
    });

    it('should apply limit', async () => {
      const result = await repo.find({ limit: 2 });
      expect(result.jobs).toHaveLength(2);
      expect(result.nextCursor).toBeDefined();
    });

    it('should handle cursor pagination', async () => {
      const firstPage = await repo.find({ limit: 2 });
      expect(firstPage.jobs).toHaveLength(2);

      const secondPage = await repo.find({ cursor: firstPage.nextCursor!, limit: 2 });
      expect(secondPage.jobs).toHaveLength(1);
      expect(secondPage.nextCursor).toBeUndefined();
    });
  });

  describe('leaseNextEligible', () => {
    it('should return null when no eligible jobs', async () => {
      const job = await repo.leaseNextEligible({
        now: new Date(),
        orgBudget: { org1: 1 },
      });

      expect(job).toBeNull();
    });

    it('should lease next eligible job', async () => {
      const created = await repo.create({ type: 'test', orgId: 'org1' });
      const now = new Date();

      const leased = await repo.leaseNextEligible({
        now,
        orgBudget: { org1: 1 },
      });

      expect(leased).not.toBeNull();
      expect(leased!.id).toBe(created.id);
      expect(leased!.status).toBe('running');
      expect(leased!.startedAt).toEqual(now);
      expect(leased!.lastHeartbeatAt).toEqual(now);
    });

    it('should respect org budget', async () => {
      await repo.create({ type: 'test', orgId: 'org1' });

      const job = await repo.leaseNextEligible({
        now: new Date(),
        orgBudget: { org1: 0 }, // No budget
      });

      expect(job).toBeNull();
    });

    it('should respect runAt time', async () => {
      const future = new Date(Date.now() + 60000); // 1 minute in future
      await repo.create({
        type: 'test',
        orgId: 'org1',
        runAt: future,
      });

      const job = await repo.leaseNextEligible({
        now: new Date(),
        orgBudget: { org1: 1 },
      });

      expect(job).toBeNull();
    });

    it('should implement round-robin fairness', async () => {
      // Create jobs for different orgs
      const job1 = await repo.create({ type: 'test', orgId: 'org1' });
      await new Promise(resolve => setTimeout(resolve, 1)); // Ensure different timestamps
      const job2 = await repo.create({ type: 'test', orgId: 'org2' });

      // First lease should get org1 (older)
      const leased1 = await repo.leaseNextEligible({
        now: new Date(),
        orgBudget: { org1: 1, org2: 1 },
      });

      expect(leased1!.id).toBe(job1.id);
      expect(leased1!.orgId).toBe('org1');

      // Second lease should get org2
      const leased2 = await repo.leaseNextEligible({
        now: new Date(),
        orgBudget: { org1: 0, org2: 1 }, // org1 budget exhausted
      });

      expect(leased2!.id).toBe(job2.id);
      expect(leased2!.orgId).toBe('org2');
    });
  });

  describe('DLQ operations', () => {
    it('should push job to DLQ', async () => {
      const job = await repo.create({ type: 'test', orgId: 'org1' });
      await repo.pushToDLQ(job);

      // Job should be removed from main storage
      const retrieved = await repo.get(job.id);
      expect(retrieved).toBeNull();

      // Job should be in DLQ
      const dlqJobs = await repo.getDLQJobs();
      expect(dlqJobs).toHaveLength(1);
      expect(dlqJobs[0].id).toBe(job.id);
      expect(dlqJobs[0].status).toBe('failed');
    });

    it('should requeue job from DLQ', async () => {
      const job = await repo.create({ type: 'test', orgId: 'org1' });
      await repo.pushToDLQ(job);

      const requeued = await repo.requeueFromDLQ(job.id);
      expect(requeued).not.toBeNull();
      expect(requeued!.status).toBe('queued');
      expect(requeued!.attempts).toBe(0);
      expect(requeued!.error).toBeNull();

      // Should be back in main storage
      const retrieved = await repo.get(job.id);
      expect(retrieved).not.toBeNull();

      // Should be removed from DLQ
      const dlqJobs = await repo.getDLQJobs();
      expect(dlqJobs).toHaveLength(0);
    });

    it('should purge DLQ', async () => {
      const job1 = await repo.create({ type: 'test', orgId: 'org1' });
      const job2 = await repo.create({ type: 'test', orgId: 'org1' });

      await repo.pushToDLQ(job1);
      await repo.pushToDLQ(job2);

      const purged = await repo.purgeDLQ();
      expect(purged).toBe(2);

      const dlqJobs = await repo.getDLQJobs();
      expect(dlqJobs).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct stats', async () => {
      // Create various jobs
      const job1 = await repo.create({ type: 'test', orgId: 'org1' });
      const job2 = await repo.create({ type: 'test', orgId: 'org1' });
      const job3 = await repo.create({ type: 'test', orgId: 'org1' });

      // Update statuses
      await repo.updatePartial(job2.id, { status: 'running', startedAt: new Date() });
      await repo.updatePartial(job3.id, {
        status: 'completed',
        finishedAt: new Date(),
      });

      // Push one to DLQ
      await repo.pushToDLQ(job1);

      const stats = await repo.getStats();

      expect(stats.queueDepth).toBe(0); // job1 in DLQ, job2 running, job3 completed
      expect(stats.running).toBe(1);
      expect(stats.dlqDepth).toBe(1);
      expect(stats.completedLast5m).toBe(1);
      expect(stats.failedLast5m).toBe(0);
    });
  });

  describe('prune', () => {
    it('should prune old jobs', async () => {
      const oldDate = new Date('2023-01-01');

      // Create old job
      const oldJob = await repo.create({ type: 'test', orgId: 'org1' });
      // Manually set creation date by directly accessing the job
      const job = await repo.get(oldJob.id);
      if (job) {
        job.createdAt = oldDate;
        (repo as any).jobs.set(oldJob.id, job);
      }

      // Create new job
      await repo.create({ type: 'test', orgId: 'org1' });

      const cutoff = new Date('2023-06-01');
      const pruned = await repo.prune({ olderThan: cutoff });

      expect(pruned).toBe(1);

      const remaining = await repo.find({});
      expect(remaining.jobs).toHaveLength(1);
    });

    it('should prune by status', async () => {
      const job1 = await repo.create({ type: 'test', orgId: 'org1' });
      const job2 = await repo.create({ type: 'test', orgId: 'org1' });

      await repo.updatePartial(job2.id, { status: 'completed', finishedAt: new Date() });

      const cutoff = new Date(Date.now() + 60000); // Future date
      const pruned = await repo.prune({ status: 'completed', olderThan: cutoff });

      expect(pruned).toBe(1);

      const remaining = await repo.find({});
      expect(remaining.jobs).toHaveLength(1);
      expect(remaining.jobs[0].status).toBe('queued');
    });
  });
});