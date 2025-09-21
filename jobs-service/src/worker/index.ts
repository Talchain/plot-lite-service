import { JobRepository } from '../repositories/base.js';
import { JobHandlerRegistry, JobContext } from '../handlers/index.js';
import { OrgBudget, Job } from '../types/job.js';

export interface WorkerConfig {
  globalMaxConcurrency: number;
  orgMaxConcurrency: number;
  jobMaxRunMs: number;
  pollIntervalMs: number;
}

export interface WorkerStats {
  running: number;
  processed: number;
  failed: number;
  cancelled: number;
}

export class JobWorker {
  private isRunning = false;
  private runningJobs = new Map<string, AbortController>();
  private orgConcurrency = new Map<string, number>();
  private stats: WorkerStats = {
    running: 0,
    processed: 0,
    failed: 0,
    cancelled: 0,
  };
  private pollTimer?: NodeJS.Timeout;

  constructor(
    private repo: JobRepository,
    private handlers: JobHandlerRegistry,
    private config: WorkerConfig
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.scheduleNextPoll();
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    this.isRunning = false;

    // Clear poll timer
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }

    // Cancel all running jobs
    for (const [jobId, controller] of this.runningJobs) {
      controller.abort();
    }

    // Wait for jobs to finish or timeout
    const gracePeriod = 5000; // 5 seconds
    const start = Date.now();

    while (this.runningJobs.size > 0 && Date.now() - start < gracePeriod) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Force cleanup any remaining jobs
    this.runningJobs.clear();
    this.orgConcurrency.clear();
  }

  getStats(): WorkerStats & { orgConcurrency: Record<string, number> } {
    return {
      ...this.stats,
      orgConcurrency: Object.fromEntries(this.orgConcurrency),
    };
  }

  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    this.pollTimer = setTimeout(() => {
      this.pollAndExecute().finally(() => {
        this.scheduleNextPoll();
      });
    }, this.config.pollIntervalMs);
  }

  private async pollAndExecute(): Promise<void> {
    try {
      // Check if we can lease more jobs
      if (this.stats.running >= this.config.globalMaxConcurrency) {
        return;
      }

      // Calculate per-org budget
      const orgBudget: OrgBudget = {};

      // Add budget for existing orgs
      for (const [orgId, currentCount] of this.orgConcurrency) {
        const remaining = this.config.orgMaxConcurrency - currentCount;
        if (remaining > 0) {
          orgBudget[orgId] = remaining;
        }
      }

      // For new orgs, give them budget if we have global capacity
      const availableSlots = this.config.globalMaxConcurrency - this.stats.running;
      if (availableSlots > 0) {
        orgBudget['*'] = Math.min(this.config.orgMaxConcurrency, availableSlots);
      }

      // Try to lease a job
      const job = await this.repo.leaseNextEligible({
        now: new Date(),
        orgBudget,
      });

      if (!job) {
        return;
      }

      // Execute the job
      await this.executeJob(job);
    } catch (error) {
      console.error('Error in poll and execute:', error);
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      await this.repo.updatePartial(job.id, {
        status: 'failed',
        error: { message: `No handler found for job type: ${job.type}` },
        finishedAt: new Date(),
      });
      return;
    }

    // Track running job
    const controller = new AbortController();
    this.runningJobs.set(job.id, controller);
    this.stats.running++;

    // Update org concurrency
    const currentOrgCount = this.orgConcurrency.get(job.orgId) || 0;
    this.orgConcurrency.set(job.orgId, currentOrgCount + 1);

    // Set timeout
    const timeoutMs = this.config.jobMaxRunMs;
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      // Create job context
      const context: JobContext = {
        job,
        updateProgress: async (progress: number) => {
          await this.repo.updatePartial(job.id, {
            progress: Math.min(Math.max(progress, 0), 1),
            lastHeartbeatAt: new Date(),
          });
        },
        heartbeat: async () => {
          await this.repo.updatePartial(job.id, {
            lastHeartbeatAt: new Date(),
          });
        },
        signal: controller.signal,
      };

      // Execute the job
      const result = await handler.execute(context);

      // Clear timeout
      clearTimeout(timeoutHandle);

      // Check if cancelled
      if (controller.signal.aborted) {
        await this.repo.updatePartial(job.id, {
          status: 'cancelled',
          finishedAt: new Date(),
        });
        this.stats.cancelled++;
      } else if (result.error) {
        // Job failed
        const newAttempts = job.attempts + 1;

        if (newAttempts >= job.maxAttempts) {
          // Max attempts reached, move to failed
          await this.repo.updatePartial(job.id, {
            status: 'failed',
            attempts: newAttempts,
            error: result.error,
            finishedAt: new Date(),
          });

          // Push to DLQ
          const failedJob = await this.repo.get(job.id);
          if (failedJob) {
            await this.repo.pushToDLQ(failedJob);
          }

          this.stats.failed++;
        } else {
          // Schedule retry with exponential backoff
          const backoffMs = Math.min(1000 * Math.pow(2, newAttempts), 60000);
          const jitter = Math.random() * 0.1 * backoffMs;
          const runAt = new Date(Date.now() + backoffMs + jitter);

          await this.repo.updatePartial(job.id, {
            status: 'queued',
            attempts: newAttempts,
            error: result.error,
            runAt,
            startedAt: null,
            lastHeartbeatAt: null,
          });
        }
      } else {
        // Job succeeded
        await this.repo.updatePartial(job.id, {
          status: 'completed',
          progress: 1,
          attempts: job.attempts + 1,
          result: result.result,
          finishedAt: new Date(),
        });
        this.stats.processed++;
      }
    } catch (error) {
      clearTimeout(timeoutHandle);

      // Unexpected error during execution
      await this.repo.updatePartial(job.id, {
        status: 'failed',
        error: { message: error instanceof Error ? error.message : String(error) },
        finishedAt: new Date(),
      });
      this.stats.failed++;
    } finally {
      // Clean up
      this.runningJobs.delete(job.id);
      this.stats.running--;

      // Update org concurrency
      const currentOrgCount = this.orgConcurrency.get(job.orgId) || 0;
      if (currentOrgCount <= 1) {
        this.orgConcurrency.delete(job.orgId);
      } else {
        this.orgConcurrency.set(job.orgId, currentOrgCount - 1);
      }
    }
  }

  // Method to manually cancel a job
  async cancelJob(jobId: string): Promise<boolean> {
    const controller = this.runningJobs.get(jobId);
    if (controller) {
      controller.abort();
      return true;
    }
    return false;
  }
}