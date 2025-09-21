import { ulid } from 'ulid';
import { Job, CreateJobData, JobQuery, JobUpdate, OrgBudget } from '../types/job.js';
import { JobRepository } from './base.js';

export class InMemoryJobRepository implements JobRepository {
  private jobs = new Map<string, Job>();
  private dlq = new Map<string, Job>();

  async create(data: CreateJobData): Promise<Job> {
    const now = new Date();
    const job: Job = {
      id: ulid(),
      type: data.type,
      orgId: data.orgId,
      status: 'queued',
      progress: 0,
      attempts: 0,
      maxAttempts: data.maxAttempts ?? 3,
      runAt: data.runAt ?? now,
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      idempotencyKey: data.idempotencyKey ?? null,
      payload: data.payload ?? {},
      createdAt: now,
      updatedAt: now,
      lastHeartbeatAt: null,
    };

    this.jobs.set(job.id, job);
    return job;
  }

  async get(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  async updatePartial(id: string, update: JobUpdate): Promise<Job | null> {
    const job = this.jobs.get(id);
    if (!job) return null;

    const updatedJob = {
      ...job,
      ...update,
      updatedAt: new Date(),
    };

    this.jobs.set(id, updatedJob);
    return updatedJob;
  }

  async find(query: JobQuery): Promise<{jobs: Job[], nextCursor?: string}> {
    let jobs = Array.from(this.jobs.values());

    // Apply filters
    if (query.orgId) {
      jobs = jobs.filter(job => job.orgId === query.orgId);
    }
    if (query.type) {
      jobs = jobs.filter(job => job.type === query.type);
    }
    if (query.status) {
      jobs = jobs.filter(job => job.status === query.status);
    }
    if (query.from) {
      jobs = jobs.filter(job => job.createdAt >= query.from!);
    }

    // Sort by creation time (newest first)
    jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Handle cursor pagination
    if (query.cursor) {
      const cursorIndex = jobs.findIndex(job => job.id === query.cursor);
      if (cursorIndex >= 0) {
        jobs = jobs.slice(cursorIndex + 1);
      }
    }

    // Apply limit
    const limit = query.limit ?? 50;
    const hasMore = jobs.length > limit;
    if (hasMore) {
      jobs = jobs.slice(0, limit);
    }

    return {
      jobs,
      nextCursor: hasMore ? jobs[jobs.length - 1]?.id : undefined,
    };
  }

  async leaseNextEligible(options: {now: Date, orgBudget: OrgBudget}): Promise<Job | null> {
    const eligibleJobs = Array.from(this.jobs.values())
      .filter(job =>
        job.status === 'queued' &&
        job.runAt <= options.now
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()); // FIFO

    if (eligibleJobs.length === 0) return null;

    // Round-robin fairness: find org with oldest eligible job that has budget
    const orgJobs = new Map<string, Job[]>();
    for (const job of eligibleJobs) {
      // Check if this org has budget (explicit budget or wildcard budget)
      const orgBudget = options.orgBudget[job.orgId] ?? options.orgBudget['*'] ?? 0;
      if (orgBudget > 0) {
        if (!orgJobs.has(job.orgId)) orgJobs.set(job.orgId, []);
        orgJobs.get(job.orgId)!.push(job);
      }
    }

    if (orgJobs.size === 0) return null;

    // Pick the org with the earliest queued job
    let selectedJob: Job | null = null;
    let earliestTime = Infinity;

    for (const [orgId, jobs] of orgJobs) {
      if (jobs[0].createdAt.getTime() < earliestTime) {
        selectedJob = jobs[0];
        earliestTime = jobs[0].createdAt.getTime();
      }
    }

    if (!selectedJob) return null;

    // Lease the job (mark as running)
    const leasedJob = await this.updatePartial(selectedJob.id, {
      status: 'running',
      startedAt: options.now,
      lastHeartbeatAt: options.now,
    });

    return leasedJob;
  }

  async pushToDLQ(job: Job): Promise<void> {
    this.dlq.set(job.id, { ...job, status: 'failed' });
    this.jobs.delete(job.id);
  }

  async prune(options: {status?: Job['status'], olderThan: Date}): Promise<number> {
    let removed = 0;

    for (const [id, job] of this.jobs) {
      const matchesStatus = !options.status || job.status === options.status;
      const isOld = job.createdAt < options.olderThan;

      if (matchesStatus && isOld) {
        this.jobs.delete(id);
        removed++;
      }
    }

    // Also prune DLQ
    for (const [id, job] of this.dlq) {
      if (job.createdAt < options.olderThan) {
        this.dlq.delete(id);
        removed++;
      }
    }

    return removed;
  }

  async getStats(): Promise<{
    queueDepth: number;
    running: number;
    completedLast5m: number;
    failedLast5m: number;
    dlqDepth: number;
  }> {
    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    const allJobs = Array.from(this.jobs.values());

    return {
      queueDepth: allJobs.filter(job => job.status === 'queued').length,
      running: allJobs.filter(job => job.status === 'running').length,
      completedLast5m: allJobs.filter(job =>
        job.status === 'completed' &&
        job.finishedAt &&
        job.finishedAt >= fiveMinutesAgo
      ).length,
      failedLast5m: allJobs.filter(job =>
        job.status === 'failed' &&
        job.finishedAt &&
        job.finishedAt >= fiveMinutesAgo
      ).length,
      dlqDepth: this.dlq.size,
    };
  }

  // Additional methods for DLQ management
  async getDLQJobs(orgId?: string): Promise<Job[]> {
    let jobs = Array.from(this.dlq.values());

    if (orgId) {
      jobs = jobs.filter(job => job.orgId === orgId);
    }

    return jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async requeueFromDLQ(id: string): Promise<Job | null> {
    const job = this.dlq.get(id);
    if (!job) return null;

    const requeuedJob = {
      ...job,
      status: 'queued' as const,
      attempts: 0,
      runAt: new Date(),
      error: null,
      updatedAt: new Date(),
    };

    this.jobs.set(id, requeuedJob);
    this.dlq.delete(id);

    return requeuedJob;
  }

  async purgeDLQ(olderThan?: Date): Promise<number> {
    if (!olderThan) {
      const count = this.dlq.size;
      this.dlq.clear();
      return count;
    }

    let removed = 0;
    for (const [id, job] of this.dlq) {
      if (job.createdAt < olderThan) {
        this.dlq.delete(id);
        removed++;
      }
    }
    return removed;
  }

  async findByIdempotencyKey(type: string, orgId: string, idempotencyKey: string, withinHours = 24): Promise<Job | null> {
    const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);

    for (const job of this.jobs.values()) {
      if (
        job.type === type &&
        job.orgId === orgId &&
        job.idempotencyKey === idempotencyKey &&
        job.createdAt >= cutoff
      ) {
        return job;
      }
    }

    return null;
  }
}