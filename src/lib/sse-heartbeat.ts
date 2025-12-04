/**
 * Heartbeat manager for SSE streams
 * Sends periodic keep-alive events to detect stale connections
 */

export class HeartbeatManager {
  private timer: NodeJS.Timeout | null = null;
  private seq = 0;
  private stopped = false;

  /**
   * Start sending heartbeats at the specified interval
   * @param intervalMs Interval in milliseconds (0 = disabled)
   * @param onBeat Async callback to send heartbeat
   */
  start(intervalMs: number, onBeat: () => Promise<void>): void {
    if (intervalMs <= 0) return;
    if (this.timer) return; // Already started

    this.stopped = false;
    this.timer = setInterval(async () => {
      if (this.stopped) return;
      this.seq++;
      try {
        await onBeat();
      } catch {
        // Silently ignore errors (client may have disconnected)
      }
    }, intervalMs);

    // Allow process to exit if this is the only thing keeping it alive
    this.timer.unref();
  }

  /**
   * Stop sending heartbeats
   */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Get current heartbeat sequence number
   */
  getSeq(): number {
    return this.seq;
  }
}
