import { JobHandler, JobContext, JobResult } from './base.js';

export class SlowCountHandler implements JobHandler {
  async execute(context: JobContext): Promise<JobResult> {
    const { job, updateProgress, heartbeat, signal } = context;
    const payload = job.payload as { steps?: number } || {};
    const steps = payload.steps || 10;

    try {
      for (let i = 0; i < steps; i++) {
        // Check for cancellation
        if (signal.aborted) {
          throw new Error('Job was cancelled');
        }

        // Simulate work
        await new Promise(resolve => setTimeout(resolve, 300));

        // Update progress
        const progress = (i + 1) / steps;
        await updateProgress(progress);

        // Send heartbeat
        await heartbeat();
      }

      return {
        result: { count: steps, completed: true },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class FlakyHandler implements JobHandler {
  async execute(context: JobContext): Promise<JobResult> {
    const { job, updateProgress, heartbeat, signal } = context;

    try {
      // Check for cancellation
      if (signal.aborted) {
        throw new Error('Job was cancelled');
      }

      await heartbeat();

      // Fail on first attempt, succeed on retry
      if (job.attempts === 0) {
        throw new Error('Simulated failure on first attempt');
      }

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 100));
      await updateProgress(0.5);
      await heartbeat();

      if (signal.aborted) {
        throw new Error('Job was cancelled');
      }

      await new Promise(resolve => setTimeout(resolve, 100));
      await updateProgress(1.0);

      return {
        result: {
          message: 'Success after retry',
          attempts: job.attempts + 1,
        },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class BlobHandler implements JobHandler {
  async execute(context: JobContext): Promise<JobResult> {
    const { job, updateProgress, heartbeat, signal } = context;
    const payload = job.payload as { size?: number } || {};
    const size = Math.min(payload.size || 1000, 10000); // Cap at 10k

    try {
      if (signal.aborted) {
        throw new Error('Job was cancelled');
      }

      await updateProgress(0.1);
      await heartbeat();

      // Generate large result to test repo limits
      const largeData = Array.from({ length: size }, (_, i) => ({
        id: i,
        data: `Item ${i} with some content to make it larger`,
        timestamp: new Date().toISOString(),
        randomValue: Math.random(),
      }));

      await updateProgress(0.8);
      await heartbeat();

      if (signal.aborted) {
        throw new Error('Job was cancelled');
      }

      await updateProgress(1.0);

      return {
        result: {
          items: largeData,
          totalItems: size,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}