import { z } from 'zod';

export const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);

export const CreateJobSchema = z.object({
  type: z.string().min(1),
  orgId: z.string().min(1),
  payload: z.unknown().optional(),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  runAt: z.string().datetime().optional(),
});

export const JobQuerySchema = z.object({
  orgId: z.string().optional(),
  type: z.string().optional(),
  status: JobStatusSchema.optional(),
  from: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.preprocess(
    (val) => val === undefined ? 50 : Number(val),
    z.number().int().min(1).max(100)
  ).default(50),
  includePayload: z.enum(['0', '1']).default('0'),
});

export const JobParamsSchema = z.object({
  jobId: z.string().min(1),
});

export const JobDetailsQuerySchema = z.object({
  includePayload: z.enum(['0', '1']).default('0'),
});

export type CreateJobRequest = z.infer<typeof CreateJobSchema>;
export type JobQuery = z.infer<typeof JobQuerySchema>;
export type JobParams = z.infer<typeof JobParamsSchema>;
export type JobDetailsQuery = z.infer<typeof JobDetailsQuerySchema>;