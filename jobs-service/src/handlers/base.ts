import { Job } from '../types/job.js';

export interface JobContext {
  job: Job;
  updateProgress: (progress: number) => Promise<void>;
  heartbeat: () => Promise<void>;
  signal: AbortSignal;
}

export interface JobResult {
  result?: unknown;
  error?: unknown;
}

export interface JobHandler {
  execute(context: JobContext): Promise<JobResult>;
}

export type JobHandlerRegistry = Map<string, JobHandler>;