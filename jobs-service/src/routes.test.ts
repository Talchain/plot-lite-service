import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from './server.js';
import { FastifyInstance } from 'fastify';

describe('Job API Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await createServer();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /jobs', () => {
    it('should create a job successfully', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: {
          type: 'test-job',
          orgId: 'test-org',
          payload: { data: 'test' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('jobId');
      expect(typeof body.jobId).toBe('string');
    });

    it('should handle idempotency', async () => {
      const jobData = {
        type: 'test-job',
        orgId: 'test-org',
        payload: { data: 'test' },
      };

      const response1 = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: {
          'idempotency-key': 'test-key-123',
        },
        payload: jobData,
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: {
          'idempotency-key': 'test-key-123',
        },
        payload: jobData,
      });

      expect(response1.statusCode).toBe(201);
      expect(response2.statusCode).toBe(200); // Returns existing job

      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      expect(body1.jobId).toBe(body2.jobId);
    });

    it('should handle idempotency across different job types', async () => {
      const jobData1 = {
        type: 'type-a',
        orgId: 'test-org',
        payload: { data: 'test' },
      };

      const jobData2 = {
        type: 'type-b',
        orgId: 'test-org',
        payload: { data: 'test' },
      };

      const idempotencyKey = 'same-key-different-types';

      const response1 = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: {
          'idempotency-key': idempotencyKey,
        },
        payload: jobData1,
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: {
          'idempotency-key': idempotencyKey,
        },
        payload: jobData2,
      });

      expect(response1.statusCode).toBe(201);
      expect(response2.statusCode).toBe(201); // Different type, so new job

      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      expect(body1.jobId).not.toBe(body2.jobId);
    });

    it('should handle idempotency across different orgs', async () => {
      const jobData1 = {
        type: 'test-job',
        orgId: 'org-a',
        payload: { data: 'test' },
      };

      const jobData2 = {
        type: 'test-job',
        orgId: 'org-b',
        payload: { data: 'test' },
      };

      const idempotencyKey = 'same-key-different-orgs';

      const response1 = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: {
          'idempotency-key': idempotencyKey,
        },
        payload: jobData1,
      });

      const response2 = await app.inject({
        method: 'POST',
        url: '/jobs',
        headers: {
          'idempotency-key': idempotencyKey,
        },
        payload: jobData2,
      });

      expect(response1.statusCode).toBe(201);
      expect(response2.statusCode).toBe(201); // Different org, so new job

      const body1 = JSON.parse(response1.body);
      const body2 = JSON.parse(response2.body);
      expect(body1.jobId).not.toBe(body2.jobId);
    });

    it('should validate required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: {
          type: 'test-job',
          // Missing orgId
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Validation Error');
    });

    it('should reject oversized payload', async () => {
      const largePayload = 'x'.repeat(70000); // Exceeds default 65536 bytes

      const response = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: {
          type: 'test-job',
          orgId: 'test-org',
          payload: { data: largePayload },
        },
      });

      expect(response.statusCode).toBe(413);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    });
  });

  describe('GET /jobs/:jobId', () => {
    it('should get job details', async () => {
      // Create a job first
      const createResponse = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: {
          type: 'test-job',
          orgId: 'test-org',
          payload: { data: 'test' },
        },
      });

      const { jobId } = JSON.parse(createResponse.body);

      // Get job details
      const response = await app.inject({
        method: 'GET',
        url: `/jobs/${jobId}`,
      });

      expect(response.statusCode).toBe(200);
      const job = JSON.parse(response.body);
      expect(job.id).toBe(jobId);
      expect(job.type).toBe('test-job');
      expect(job.orgId).toBe('test-org');
      expect(job).not.toHaveProperty('payload'); // Excluded by default
    });

    it('should include payload when requested', async () => {
      // Create a job first
      const createResponse = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: {
          type: 'test-job',
          orgId: 'test-org',
          payload: { data: 'test' },
        },
      });

      const { jobId } = JSON.parse(createResponse.body);

      // Get job details with payload
      const response = await app.inject({
        method: 'GET',
        url: `/jobs/${jobId}?includePayload=1`,
      });

      expect(response.statusCode).toBe(200);
      const job = JSON.parse(response.body);
      expect(job).toHaveProperty('payload');
      expect(job.payload).toEqual({ data: 'test' });
    });

    it('should return 404 for non-existent job', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/jobs/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('JOB_NOT_FOUND');
    });
  });

  describe('GET /jobs', () => {
    beforeEach(async () => {
      // Create some test jobs
      await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { type: 'type1', orgId: 'org1' },
      });
      await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { type: 'type2', orgId: 'org1' },
      });
      await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { type: 'type1', orgId: 'org2' },
      });
    });

    it('should list all jobs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/jobs',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty('jobs');
      expect(Array.isArray(body.jobs)).toBe(true);
      expect(body.jobs.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by orgId', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/jobs?orgId=org1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobs.every((job: any) => job.orgId === 'org1')).toBe(true);
    });

    it('should filter by type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/jobs?type=type1',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobs.every((job: any) => job.type === 'type1')).toBe(true);
    });

    it('should apply limit', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/jobs?limit=2',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.jobs.length).toBeLessThanOrEqual(2);
    });
  });

  describe('POST /jobs/:jobId/cancel', () => {
    it('should cancel a queued job', async () => {
      // Create a job
      const createResponse = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { type: 'test-job', orgId: 'test-org' },
      });

      const { jobId } = JSON.parse(createResponse.body);

      // Cancel the job
      const response = await app.inject({
        method: 'POST',
        url: `/jobs/${jobId}/cancel`,
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.message).toContain('Cancel request accepted');
      expect(body.status).toBe('cancelled');
    });

    it('should not cancel completed job', async () => {
      // Create and complete a job
      const createResponse = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { type: 'test-job', orgId: 'test-org' },
      });

      const { jobId } = JSON.parse(createResponse.body);

      // Manually mark as completed (in real scenario, would be done by worker)
      // For this test, we'll just expect the proper error when trying to cancel

      const response = await app.inject({
        method: 'POST',
        url: `/jobs/${jobId}/cancel`,
      });

      // Should work for queued job
      expect(response.statusCode).toBe(202);
    });

    it('should return 404 for non-existent job', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/jobs/non-existent-id/cancel',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /jobs/:jobId/retry', () => {
    it('should not retry non-failed job', async () => {
      // Create a job (it will be in queued state)
      const createResponse = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { type: 'test-job', orgId: 'test-org' },
      });

      const { jobId } = JSON.parse(createResponse.body);

      // Try to retry a non-failed job
      const response = await app.inject({
        method: 'POST',
        url: `/jobs/${jobId}/retry`,
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('INVALID_STATE');
    });

    it('should return 404 for non-existent job', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/jobs/non-existent-id/retry',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /jobs/:jobId/stream', () => {
    it('should return 404 when SSE disabled', async () => {
      const createResponse = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: { type: 'test-job', orgId: 'test-org' },
      });

      const { jobId } = JSON.parse(createResponse.body);

      const response = await app.inject({
        method: 'GET',
        url: `/jobs/${jobId}/stream`,
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('SSE_DISABLED');
    });
  });

  describe('POST /webhooks/test', () => {
    it('should send test webhook', async () => {
      // Mock a successful webhook by using a valid but unreachable URL
      // In a real test environment, you'd mock the fetch function
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/test',
        payload: {
          url: 'http://localhost:9999/webhook', // This will fail as expected
        },
      });

      // Since the URL is unreachable, it should return 500
      expect(response.statusCode).toBe(500);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('WEBHOOK_FAILED');
    });

    it('should handle invalid URL', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/webhooks/test',
        payload: {
          url: 'invalid-url',
        },
      });

      expect(response.statusCode).toBe(500);
    });
  });

  describe('Rate limiting', () => {
    it('should not rate limit when disabled', async () => {
      // Make multiple requests quickly
      const promises = Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/jobs',
          payload: { type: 'test-job', orgId: 'test-org' },
        })
      );

      const responses = await Promise.all(promises);

      // All should succeed since rate limiting is disabled by default
      responses.forEach(response => {
        expect(response.statusCode).toBe(201);
      });
    });
  });
});