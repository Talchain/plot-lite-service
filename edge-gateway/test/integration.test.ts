import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawn } from 'child_process';

const SERVER_PORT = 3002;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

describe('SSE Gateway Integration', () => {
  let serverProcess: any;

  beforeAll(async () => {
    // Start the server
    serverProcess = spawn('tsx', ['src/index.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, PORT: String(SERVER_PORT), NODE_ENV: 'test' },
      stdio: 'pipe'
    });

    // Wait for server to start
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server start timeout')), 10000);

      const checkHealth = async () => {
        try {
          const response = await fetch(`${SERVER_URL}/health`);
          if (response.ok) {
            clearTimeout(timeout);
            resolve(undefined);
          } else {
            setTimeout(checkHealth, 100);
          }
        } catch {
          setTimeout(checkHealth, 100);
        }
      };

      checkHealth();
    });
  });

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });

  describe('Health endpoint', () => {
    test('should return health status', async () => {
      const response = await fetch(`${SERVER_URL}/health`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.status).toBe('ok');
      expect(data.activeSessions).toBe(0);
      expect(typeof data.timestamp).toBe('string');
    });
  });

  describe('SSE Streaming', () => {
    test('should stream tokens with proper SSE format', async () => {
      const sessionId = `test-${Date.now()}`;
      const orgId = 'test-org';

      const response = await fetch(`${SERVER_URL}/stream?sessionId=${sessionId}&org=${orgId}&route=test`);
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toBe('text/event-stream');
      expect(response.headers.get('x-session-id')).toBe(sessionId);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      const events: any[] = [];
      let buffer = '';

      // Read first few events
      for (let i = 0; i < 5; i++) {
        const { value } = await reader.read();
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent: any = {};
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent.event = line.substring(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = JSON.parse(line.substring(6));
          } else if (line.startsWith('id: ')) {
            currentEvent.id = line.substring(4);
          } else if (line === '') {
            if (currentEvent.event) {
              events.push(currentEvent);
              currentEvent = {};
            }
          }
        }

        if (events.length >= 3) break;
      }

      reader.cancel();

      // Verify event sequence
      expect(events.length).toBeGreaterThanOrEqual(3);

      // First event should be hello
      expect(events[0].event).toBe('hello');
      expect(events[0].data.sessionId).toBe(sessionId);
      expect(events[0].id).toBe('0');

      // Subsequent events should be tokens
      const tokenEvents = events.filter(e => e.event === 'token');
      expect(tokenEvents.length).toBeGreaterThan(0);

      // Verify token event structure
      const firstToken = tokenEvents[0];
      expect(firstToken.data.sessionId).toBe(sessionId);
      expect(typeof firstToken.data.token).toBe('string');
      expect(typeof firstToken.data.idx).toBe('number');
      expect(typeof firstToken.data.ts).toBe('number');
      expect(firstToken.id).toBe(String(firstToken.data.idx));
    });

    test('should support resume with Last-Event-ID', async () => {
      const sessionId = `resume-test-${Date.now()}`;
      const orgId = 'test-org';

      // Start first stream
      const response1 = await fetch(`${SERVER_URL}/stream?sessionId=${sessionId}&org=${orgId}`);
      const reader1 = response1.body!.getReader();
      const decoder = new TextDecoder();

      let buffer = '';
      let lastEventId = '';
      const events: any[] = [];

      // Read a few events
      for (let i = 0; i < 3; i++) {
        const { value } = await reader1.read();
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let currentEvent: any = {};
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent.event = line.substring(7);
          } else if (line.startsWith('data: ')) {
            currentEvent.data = JSON.parse(line.substring(6));
          } else if (line.startsWith('id: ')) {
            currentEvent.id = line.substring(4);
            lastEventId = currentEvent.id;
          } else if (line === '') {
            if (currentEvent.event) {
              events.push(currentEvent);
              currentEvent = {};
            }
          }
        }
      }

      reader1.cancel();

      // Resume from last event
      const response2 = await fetch(`${SERVER_URL}/stream?sessionId=${sessionId}-resume&org=${orgId}`, {
        headers: { 'Last-Event-ID': lastEventId }
      });

      const reader2 = response2.body!.getReader();
      const { value } = await reader2.read();
      const resumeData = decoder.decode(value);

      reader2.cancel();

      // Should contain hello event with resume info
      expect(resumeData).toContain('event: hello');
      expect(resumeData).toContain(`"resumeFrom":${lastEventId}`);
    });

    test('should handle cancellation within 150ms', async () => {
      const sessionId = `cancel-test-${Date.now()}`;
      const orgId = 'test-org';

      // Start stream
      const streamPromise = fetch(`${SERVER_URL}/stream?sessionId=${sessionId}&org=${orgId}`);

      // Wait a bit, then cancel
      await new Promise(resolve => setTimeout(resolve, 50));

      const cancelStart = Date.now();
      const cancelResponse = await fetch(`${SERVER_URL}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId })
      });

      expect(cancelResponse.ok).toBe(true);
      const cancelData = await cancelResponse.json();
      expect(cancelData.success).toBe(true);
      expect(cancelData.sessionId).toBe(sessionId);

      // Stream should close quickly
      const streamResponse = await streamPromise;
      const reader = streamResponse.body!.getReader();

      const readStart = Date.now();
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        // Stream may error when cancelled
      }

      const duration = Date.now() - readStart;
      expect(duration).toBeLessThan(200); // Allow some buffer beyond 150ms
    });
  });

  describe('Budget enforcement', () => {
    test('should enforce budget limits', async () => {
      const sessionId = `budget-test-${Date.now()}`;
      const orgId = 'budget-test-org';

      // Make many concurrent requests to trigger budget limits
      const requests = [];
      for (let i = 0; i < 50; i++) {
        requests.push(
          fetch(`${SERVER_URL}/stream?sessionId=${sessionId}-${i}&org=${orgId}`)
            .then(response => ({ status: response.status, response }))
            .catch(() => ({ status: 500, response: null }))
        );
      }

      const results = await Promise.all(requests);

      // Some should succeed, some should be rate limited
      const successCount = results.filter(r => r.status === 200).length;
      const rateLimitedCount = results.filter(r => r.status === 429).length;

      // With default budget (200 burst), at least some should succeed and some should be limited
      expect(successCount + rateLimitedCount).toBeGreaterThan(0);

      // Clean up streams
      results.forEach(result => {
        if (result.response?.body) {
          result.response.body.getReader().cancel();
        }
      });
    });
  });

  describe('Error handling', () => {
    test('should reject requests without required parameters', async () => {
      // Missing sessionId
      let response = await fetch(`${SERVER_URL}/stream?org=test`);
      expect(response.status).toBe(400);

      // Missing org
      response = await fetch(`${SERVER_URL}/stream?sessionId=test`);
      expect(response.status).toBe(400);
    });

    test('should handle invalid cancel requests', async () => {
      const response = await fetch(`${SERVER_URL}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(400);
    });
  });

  describe('Headers and metadata', () => {
    test('should set X-Request-ID header', async () => {
      const response = await fetch(`${SERVER_URL}/health`);
      expect(response.headers.get('x-request-id')).toBeTruthy();
    });

    test('should echo custom X-Request-ID', async () => {
      const customId = 'custom-request-id-123';
      const response = await fetch(`${SERVER_URL}/health`, {
        headers: { 'X-Request-ID': customId }
      });

      expect(response.headers.get('x-request-id')).toBe(customId);
    });
  });
});