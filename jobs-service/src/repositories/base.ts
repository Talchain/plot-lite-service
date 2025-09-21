import { Job, CreateJobData, JobQuery, JobUpdate, OrgBudget } from '../types/job.js';

export interface JobRepository {
  create(data: CreateJobData): Promise<Job>;
  get(id: string): Promise<Job | null>;
  updatePartial(id: string, update: JobUpdate): Promise<Job | null>;
  find(query: JobQuery): Promise<{jobs: Job[], nextCursor?: string}>;
  leaseNextEligible(options: {now: Date, orgBudget: OrgBudget}): Promise<Job | null>;
  pushToDLQ(job: Job): Promise<void>;
  prune(options: {status?: Job['status'], olderThan: Date}): Promise<number>;
  getStats(): Promise<{
    queueDepth: number;
    running: number;
    completedLast5m: number;
    failedLast5m: number;
    dlqDepth: number;
  }>;

  // Idempotency support
  findByIdempotencyKey(type: string, orgId: string, idempotencyKey: string, withinHours?: number): Promise<Job | null>;
}