export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string; // ULID
  type: string;
  orgId: string;
  status: JobStatus;
  progress: number; // 0..1
  attempts: number;
  maxAttempts: number; // default 3
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  result: unknown | null; // JSON
  error: unknown | null; // JSON
  idempotencyKey: string | null;
  payload: unknown; // JSON
  createdAt: Date;
  updatedAt: Date;
  lastHeartbeatAt: Date | null;
}

export interface CreateJobData {
  type: string;
  orgId: string;
  payload?: unknown;
  maxAttempts?: number;
  runAt?: Date;
  idempotencyKey?: string;
}

export interface JobQuery {
  orgId?: string;
  type?: string;
  status?: JobStatus;
  from?: Date;
  cursor?: string;
  limit?: number;
}

export interface JobUpdate {
  status?: JobStatus;
  progress?: number;
  attempts?: number;
  runAt?: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  result?: unknown | null;
  error?: unknown | null;
  lastHeartbeatAt?: Date | null;
  updatedAt?: Date;
}

export interface OrgBudget {
  [orgId: string]: number; // remaining concurrency slots
}