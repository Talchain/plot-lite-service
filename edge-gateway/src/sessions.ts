interface SessionInfo {
  sessionId: string;
  orgId: string;
  route: string;
  seed?: number;
  controller: AbortController;
  startTime: number;
  tokenCount: number;
}

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  createSession(sessionId: string, orgId: string, route: string, seed?: number): AbortController {
    // Cancel existing session if any
    this.cancelSession(sessionId);

    const controller = new AbortController();
    this.sessions.set(sessionId, {
      sessionId,
      orgId,
      route,
      seed,
      controller,
      startTime: Date.now(),
      tokenCount: 0
    });

    return controller;
  }

  cancelSession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.controller.abort();
      this.sessions.delete(sessionId);
      return true;
    }
    return false;
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  incrementTokenCount(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.tokenCount++;
    }
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  getAllSessions(): SessionInfo[] {
    return Array.from(this.sessions.values());
  }

  cleanup() {
    // Remove sessions older than 1 hour
    const now = Date.now();
    const maxAge = 60 * 60 * 1000;

    for (const [sessionId, session] of this.sessions) {
      if (now - session.startTime > maxAge) {
        session.controller.abort();
        this.sessions.delete(sessionId);
      }
    }
  }
}