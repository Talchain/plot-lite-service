import { ulid } from 'ulid';
import { Job, CreateJobData, JobQuery, JobUpdate, OrgBudget } from '../types/job.js';
import { JobRepository } from './base.js';

interface UpstashResponse<T = unknown> {
  result: T;
  error?: string;
}

export class RedisJobRepository implements JobRepository {
  private baseUrl: string;
  private token: string;

  constructor(url: string, token: string) {
    this.baseUrl = url.replace(/\/$/, '');
    this.token = token;
  }

  private async redis(command: string[]): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) {
      throw new Error(`Redis request failed: ${response.status} ${response.statusText}`);
    }

    const data: UpstashResponse = await response.json();
    if (data.error) {
      throw new Error(`Redis error: ${data.error}`);
    }

    return data.result;
  }

  private jobKey(id: string): string {
    return `job:${id}`;
  }

  private queueKey(status: Job['status']): string {
    return `queue:${status}`;
  }

  private orgQueueKey(orgId: string): string {
    return `org:${orgId}:queue`;
  }

  private dlqKey(): string {
    return 'dlq:jobs';
  }

  private serializeJob(job: Job): string {
    return JSON.stringify({
      ...job,
      runAt: job.runAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      lastHeartbeatAt: job.lastHeartbeatAt?.toISOString() ?? null,
    });
  }

  private deserializeJob(data: string): Job {
    const parsed = JSON.parse(data);
    return {
      ...parsed,
      runAt: new Date(parsed.runAt),
      startedAt: parsed.startedAt ? new Date(parsed.startedAt) : null,
      finishedAt: parsed.finishedAt ? new Date(parsed.finishedAt) : null,
      createdAt: new Date(parsed.createdAt),
      updatedAt: new Date(parsed.updatedAt),
      lastHeartbeatAt: parsed.lastHeartbeatAt ? new Date(parsed.lastHeartbeatAt) : null,
    };
  }

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

    // Store job data
    await this.redis(['SET', this.jobKey(job.id), this.serializeJob(job)]);

    // Add to queued list with priority (ULID is time-sortable)
    await this.redis(['ZADD', this.queueKey('queued'), job.runAt.getTime().toString(), job.id]);

    // Add to org queue for fairness
    await this.redis(['LPUSH', this.orgQueueKey(job.orgId), job.id]);

    return job;
  }

  async get(id: string): Promise<Job | null> {
    const data = await this.redis(['GET', this.jobKey(id)]) as string | null;
    return data ? this.deserializeJob(data) : null;
  }

  async updatePartial(id: string, update: JobUpdate): Promise<Job | null> {
    const existing = await this.get(id);
    if (!existing) return null;

    const updatedJob = {
      ...existing,
      ...update,
      updatedAt: new Date(),
    };

    // Handle status changes - move between queues
    if (update.status && update.status !== existing.status) {
      // Remove from old queue
      await this.redis(['ZREM', this.queueKey(existing.status), id]);

      // Add to new queue
      const score = update.status === 'queued' ? updatedJob.runAt.getTime() : Date.now();
      await this.redis(['ZADD', this.queueKey(update.status), score.toString(), id]);
    }

    // Update job data
    await this.redis(['SET', this.jobKey(id), this.serializeJob(updatedJob)]);

    return updatedJob;
  }

  async find(query: JobQuery): Promise<{jobs: Job[], nextCursor?: string}> {
    // For simplicity, this implementation scans all jobs
    // In production, you'd want more sophisticated indexing
    const pattern = 'job:*';
    const keys = await this.redis(['KEYS', pattern]) as string[];

    if (keys.length === 0) {
      return { jobs: [] };
    }

    // Get all job data
    const jobData = await this.redis(['MGET', ...keys]) as (string | null)[];
    const jobs = jobData
      .filter((data): data is string => data !== null)
      .map(data => this.deserializeJob(data));

    // Apply filters
    let filteredJobs = jobs;

    if (query.orgId) {
      filteredJobs = filteredJobs.filter(job => job.orgId === query.orgId);
    }
    if (query.type) {
      filteredJobs = filteredJobs.filter(job => job.type === query.type);
    }
    if (query.status) {
      filteredJobs = filteredJobs.filter(job => job.status === query.status);
    }
    if (query.from) {
      filteredJobs = filteredJobs.filter(job => job.createdAt >= query.from!);
    }

    // Sort by creation time (newest first)
    filteredJobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    // Handle cursor pagination
    if (query.cursor) {
      const cursorIndex = filteredJobs.findIndex(job => job.id === query.cursor);
      if (cursorIndex >= 0) {
        filteredJobs = filteredJobs.slice(cursorIndex + 1);
      }
    }

    // Apply limit
    const limit = query.limit ?? 50;
    const hasMore = filteredJobs.length > limit;
    if (hasMore) {
      filteredJobs = filteredJobs.slice(0, limit);
    }

    return {
      jobs: filteredJobs,
      nextCursor: hasMore ? filteredJobs[filteredJobs.length - 1]?.id : undefined,
    };
  }

  async leaseNextEligible(options: {now: Date, orgBudget: OrgBudget}): Promise<Job | null> {
    // Get all orgs with available budget
    const eligibleOrgs = Object.keys(options.orgBudget).filter(orgId =>
      (options.orgBudget[orgId] ?? 0) > 0
    );

    if (eligibleOrgs.length === 0) return null;

    // Round-robin: find the org with the oldest queued job
    let selectedJob: Job | null = null;
    let earliestTime = Infinity;

    for (const orgId of eligibleOrgs) {
      // Get oldest job for this org
      const jobIds = await this.redis(['LRANGE', this.orgQueueKey(orgId), '-1', '-1']) as string[];
      if (jobIds.length === 0) continue;

      const jobId = jobIds[0];
      const job = await this.get(jobId);

      if (job &&
          job.status === 'queued' &&
          job.runAt <= options.now &&
          job.createdAt.getTime() < earliestTime) {
        selectedJob = job;
        earliestTime = job.createdAt.getTime();
      }
    }

    if (!selectedJob) return null;

    // Lease the job
    const leasedJob = await this.updatePartial(selectedJob.id, {
      status: 'running',
      startedAt: options.now,
      lastHeartbeatAt: options.now,
    });

    // Remove from org queue
    await this.redis(['LREM', this.orgQueueKey(selectedJob.orgId), '1', selectedJob.id]);

    return leasedJob;
  }

  async pushToDLQ(job: Job): Promise<void> {
    const dlqJob = { ...job, status: 'failed' as const };

    // Add to DLQ
    await this.redis(['ZADD', this.dlqKey(), Date.now().toString(), job.id]);

    // Update job status
    await this.redis(['SET', this.jobKey(job.id), this.serializeJob(dlqJob)]);

    // Remove from other queues
    await this.redis(['ZREM', this.queueKey(job.status), job.id]);
    await this.redis(['LREM', this.orgQueueKey(job.orgId), '1', job.id]);
  }

  async prune(options: {status?: Job['status'], olderThan: Date}): Promise<number> {
    let removed = 0;
    const cutoff = options.olderThan.getTime();

    if (options.status) {
      // Remove from specific status queue
      const jobIds = await this.redis(['ZRANGEBYSCORE', this.queueKey(options.status), '-inf', cutoff.toString()]) as string[];

      for (const jobId of jobIds) {
        await this.redis(['DEL', this.jobKey(jobId)]);
        await this.redis(['ZREM', this.queueKey(options.status), jobId]);
        removed++;
      }
    } else {
      // Prune all old jobs
      const pattern = 'job:*';
      const keys = await this.redis(['KEYS', pattern]) as string[];

      for (const key of keys) {
        const data = await this.redis(['GET', key]) as string | null;
        if (data) {
          const job = this.deserializeJob(data);
          if (job.createdAt.getTime() < cutoff) {
            await this.redis(['DEL', key]);
            await this.redis(['ZREM', this.queueKey(job.status), job.id]);
            await this.redis(['LREM', this.orgQueueKey(job.orgId), '1', job.id]);
            removed++;
          }
        }
      }
    }

    // Prune DLQ
    const dlqJobIds = await this.redis(['ZRANGEBYSCORE', this.dlqKey(), '-inf', cutoff.toString()]) as string[];
    for (const jobId of dlqJobIds) {
      await this.redis(['DEL', this.jobKey(jobId)]);
      await this.redis(['ZREM', this.dlqKey(), jobId]);
      removed++;
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
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    const [queueDepth, running, dlqDepth] = await Promise.all([
      this.redis(['ZCARD', this.queueKey('queued')]) as Promise<number>,
      this.redis(['ZCARD', this.queueKey('running')]) as Promise<number>,
      this.redis(['ZCARD', this.dlqKey()]) as Promise<number>,
    ]);

    // For completed/failed counts, we'd need to maintain time-based indices
    // For now, return 0 (would require additional data structures)
    return {
      queueDepth,
      running,
      completedLast5m: 0, // TODO: implement time-based tracking
      failedLast5m: 0,    // TODO: implement time-based tracking
      dlqDepth,
    };
  }

  // DLQ management methods
  async getDLQJobs(orgId?: string): Promise<Job[]> {
    const jobIds = await this.redis(['ZREVRANGE', this.dlqKey(), '0', '-1']) as string[];
    const jobs: Job[] = [];

    for (const jobId of jobIds) {
      const job = await this.get(jobId);
      if (job && (!orgId || job.orgId === orgId)) {
        jobs.push(job);
      }
    }

    return jobs;
  }

  async requeueFromDLQ(id: string): Promise<Job | null> {
    const job = await this.get(id);
    if (!job) return null;

    const requeuedJob = {
      ...job,
      status: 'queued' as const,
      attempts: 0,
      runAt: new Date(),
      error: null,
      updatedAt: new Date(),
    };

    // Remove from DLQ
    await this.redis(['ZREM', this.dlqKey(), id]);

    // Add back to queued
    await this.redis(['ZADD', this.queueKey('queued'), requeuedJob.runAt.getTime().toString(), id]);
    await this.redis(['LPUSH', this.orgQueueKey(job.orgId), id]);

    // Update job data
    await this.redis(['SET', this.jobKey(id), this.serializeJob(requeuedJob)]);

    return requeuedJob;
  }

  async purgeDLQ(olderThan?: Date): Promise<number> {
    if (!olderThan) {
      const jobIds = await this.redis(['ZRANGE', this.dlqKey(), '0', '-1']) as string[];

      // Delete all job data
      if (jobIds.length > 0) {
        const jobKeys = jobIds.map(id => this.jobKey(id));
        await this.redis(['DEL', ...jobKeys]);
      }

      // Clear DLQ
      await this.redis(['DEL', this.dlqKey()]);

      return jobIds.length;
    }

    const cutoff = olderThan.getTime();
    const jobIds = await this.redis(['ZRANGEBYSCORE', this.dlqKey(), '-inf', cutoff.toString()]) as string[];

    if (jobIds.length > 0) {
      const jobKeys = jobIds.map(id => this.jobKey(id));
      await this.redis(['DEL', ...jobKeys]);
      await this.redis(['ZREM', this.dlqKey(), ...jobIds]);
    }

    return jobIds.length;
  }

  async findByIdempotencyKey(type: string, orgId: string, idempotencyKey: string, withinHours = 24): Promise<Job | null> {
    const cutoff = new Date(Date.now() - withinHours * 60 * 60 * 1000);

    // Look through all jobs to find matching idempotency key
    // In a production system, you'd want an index for this
    const pattern = 'job:*';
    const keys = await this.redis(['KEYS', pattern]) as string[];

    for (const key of keys) {
      const data = await this.redis(['GET', key]) as string | null;
      if (data) {
        const job = this.deserializeJob(data);
        if (
          job.type === type &&
          job.orgId === orgId &&
          job.idempotencyKey === idempotencyKey &&
          job.createdAt >= cutoff
        ) {
          return job;
        }
      }
    }

    return null;
  }
}