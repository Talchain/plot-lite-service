import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { RedisJobRepository } from './redis.js';

describe('RedisJobRepository Integration', () => {
  let repo: RedisJobRepository;
  const testUrl = process.env.UPSTASH_REDIS_REST_URL;
  const testToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  beforeAll(() => {
    if (!testUrl || !testToken) {
      console.log('Skipping Redis integration tests - no Redis credentials provided');
      return;
    }
  });

  beforeEach(() => {
    if (!testUrl || !testToken) {
      return;
    }
    repo = new RedisJobRepository(testUrl, testToken);
  });

  describe.skipIf(!testUrl || !testToken)('Redis operations', () => {
    it('should create and retrieve a job', async () => {
      const created = await repo.create({
        type: 'test',
        orgId: 'org1',
        payload: { data: 'test' },
      });

      expect(created.id).toBeDefined();
      expect(created.type).toBe('test');
      expect(created.orgId).toBe('org1');

      const retrieved = await repo.get(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.payload).toEqual({ data: 'test' });
    });

    it('should update job status', async () => {
      const job = await repo.create({ type: 'test', orgId: 'org1' });
      const now = new Date();

      const updated = await repo.updatePartial(job.id, {
        status: 'running',
        startedAt: now,
      });

      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('running');
      expect(updated!.startedAt).toEqual(now);
    });

    it('should find jobs with filters', async () => {
      await repo.create({ type: 'test1', orgId: 'org1' });
      await repo.create({ type: 'test2', orgId: 'org1' });
      await repo.create({ type: 'test1', orgId: 'org2' });

      const allJobs = await repo.find({});
      expect(allJobs.jobs.length).toBeGreaterThanOrEqual(3);

      const org1Jobs = await repo.find({ orgId: 'org1' });
      expect(org1Jobs.jobs.filter(job => job.orgId === 'org1').length).toBeGreaterThanOrEqual(2);

      const test1Jobs = await repo.find({ type: 'test1' });
      expect(test1Jobs.jobs.filter(job => job.type === 'test1').length).toBeGreaterThanOrEqual(2);
    });

    it('should lease eligible jobs', async () => {
      const job = await repo.create({ type: 'test', orgId: 'org1' });
      const now = new Date();

      const leased = await repo.leaseNextEligible({
        now,
        orgBudget: { org1: 1 },
      });

      expect(leased).not.toBeNull();
      expect(leased!.status).toBe('running');
      expect(leased!.startedAt).toEqual(now);
    });

    it('should manage DLQ operations', async () => {
      const job = await repo.create({ type: 'test', orgId: 'org1' });

      // Push to DLQ
      await repo.pushToDLQ(job);

      // Check DLQ
      const dlqJobs = await repo.getDLQJobs();
      expect(dlqJobs.some(j => j.id === job.id)).toBe(true);

      // Requeue from DLQ
      const requeued = await repo.requeueFromDLQ(job.id);
      expect(requeued).not.toBeNull();
      expect(requeued!.status).toBe('queued');

      // Verify removed from DLQ
      const dlqJobsAfter = await repo.getDLQJobs();
      expect(dlqJobsAfter.some(j => j.id === job.id)).toBe(false);
    });

    it('should get basic stats', async () => {
      const stats = await repo.getStats();

      expect(stats).toHaveProperty('queueDepth');
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('dlqDepth');
      expect(typeof stats.queueDepth).toBe('number');
      expect(typeof stats.running).toBe('number');
      expect(typeof stats.dlqDepth).toBe('number');
    });
  });
});