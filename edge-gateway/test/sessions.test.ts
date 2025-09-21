import { describe, test, expect, beforeEach } from 'vitest';
import { SessionManager } from '../src/sessions.js';

describe('SessionManager', () => {
  let sessionManager: SessionManager;

  beforeEach(() => {
    sessionManager = new SessionManager();
  });

  describe('Session creation and management', () => {
    test('should create new session', () => {
      const controller = sessionManager.createSession('sess1', 'org1', 'test', 42);

      expect(controller).toBeInstanceOf(AbortController);
      expect(controller.signal.aborted).toBe(false);
      expect(sessionManager.getActiveSessionCount()).toBe(1);

      const session = sessionManager.getSession('sess1');
      expect(session).toBeDefined();
      expect(session!.sessionId).toBe('sess1');
      expect(session!.orgId).toBe('org1');
      expect(session!.route).toBe('test');
      expect(session!.seed).toBe(42);
      expect(session!.tokenCount).toBe(0);
    });

    test('should replace existing session with same ID', () => {
      const controller1 = sessionManager.createSession('sess1', 'org1', 'test1');
      const controller2 = sessionManager.createSession('sess1', 'org2', 'test2');

      expect(controller1.signal.aborted).toBe(true);
      expect(controller2.signal.aborted).toBe(false);
      expect(sessionManager.getActiveSessionCount()).toBe(1);

      const session = sessionManager.getSession('sess1');
      expect(session!.orgId).toBe('org2');
      expect(session!.route).toBe('test2');
    });

    test('should handle multiple sessions', () => {
      sessionManager.createSession('sess1', 'org1', 'test');
      sessionManager.createSession('sess2', 'org2', 'test');
      sessionManager.createSession('sess3', 'org1', 'test');

      expect(sessionManager.getActiveSessionCount()).toBe(3);

      const sessions = sessionManager.getAllSessions();
      expect(sessions).toHaveLength(3);
      expect(sessions.map(s => s.sessionId).sort()).toEqual(['sess1', 'sess2', 'sess3']);
    });
  });

  describe('Session cancellation', () => {
    test('should cancel existing session', () => {
      const controller = sessionManager.createSession('sess1', 'org1', 'test');
      expect(controller.signal.aborted).toBe(false);

      const cancelled = sessionManager.cancelSession('sess1');
      expect(cancelled).toBe(true);
      expect(controller.signal.aborted).toBe(true);
      expect(sessionManager.getActiveSessionCount()).toBe(0);
      expect(sessionManager.getSession('sess1')).toBeUndefined();
    });

    test('should return false for non-existent session', () => {
      const cancelled = sessionManager.cancelSession('nonexistent');
      expect(cancelled).toBe(false);
    });

    test('should handle multiple cancellations', () => {
      sessionManager.createSession('sess1', 'org1', 'test');
      sessionManager.createSession('sess2', 'org2', 'test');

      expect(sessionManager.cancelSession('sess1')).toBe(true);
      expect(sessionManager.getActiveSessionCount()).toBe(1);

      expect(sessionManager.cancelSession('sess2')).toBe(true);
      expect(sessionManager.getActiveSessionCount()).toBe(0);

      // Second cancellation should return false
      expect(sessionManager.cancelSession('sess1')).toBe(false);
    });
  });

  describe('Token counting', () => {
    test('should increment token count', () => {
      sessionManager.createSession('sess1', 'org1', 'test');

      sessionManager.incrementTokenCount('sess1');
      sessionManager.incrementTokenCount('sess1');
      sessionManager.incrementTokenCount('sess1');

      const session = sessionManager.getSession('sess1');
      expect(session!.tokenCount).toBe(3);
    });

    test('should handle non-existent session gracefully', () => {
      // Should not throw
      sessionManager.incrementTokenCount('nonexistent');
    });

    test('should reset token count when session is recreated', () => {
      sessionManager.createSession('sess1', 'org1', 'test');
      sessionManager.incrementTokenCount('sess1');
      sessionManager.incrementTokenCount('sess1');

      // Recreate session
      sessionManager.createSession('sess1', 'org1', 'test');

      const session = sessionManager.getSession('sess1');
      expect(session!.tokenCount).toBe(0);
    });
  });

  describe('Session cleanup', () => {
    test('should cleanup old sessions', () => {
      const sessionManager = new SessionManager();

      // Create a session and manually set old timestamp
      sessionManager.createSession('sess1', 'org1', 'test');
      const session = sessionManager.getSession('sess1')!;
      session.startTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago

      expect(sessionManager.getActiveSessionCount()).toBe(1);

      sessionManager.cleanup();

      expect(sessionManager.getActiveSessionCount()).toBe(0);
    });

    test('should keep recent sessions during cleanup', () => {
      sessionManager.createSession('sess1', 'org1', 'test');
      sessionManager.createSession('sess2', 'org2', 'test');

      expect(sessionManager.getActiveSessionCount()).toBe(2);

      sessionManager.cleanup();

      expect(sessionManager.getActiveSessionCount()).toBe(2);
    });
  });

  describe('Session retrieval', () => {
    test('should return undefined for non-existent session', () => {
      expect(sessionManager.getSession('nonexistent')).toBeUndefined();
    });

    test('should return all sessions', () => {
      sessionManager.createSession('sess1', 'org1', 'test1');
      sessionManager.createSession('sess2', 'org2', 'test2', 123);

      const sessions = sessionManager.getAllSessions();
      expect(sessions).toHaveLength(2);

      const sess1 = sessions.find(s => s.sessionId === 'sess1')!;
      expect(sess1.orgId).toBe('org1');
      expect(sess1.route).toBe('test1');
      expect(sess1.seed).toBeUndefined();

      const sess2 = sessions.find(s => s.sessionId === 'sess2')!;
      expect(sess2.orgId).toBe('org2');
      expect(sess2.route).toBe('test2');
      expect(sess2.seed).toBe(123);
    });
  });
});