/**
 * PR-2A: Sliding Window Counter
 * 
 * Fixed-size ring buffer for counting events in a time window.
 * Bounded memory: O(capacity), typically = failureThreshold.
 */

export class SlidingWindow {
  private readonly buf: number[];
  private i = 0;
  private size = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) throw new Error('capacity must be > 0');
    this.buf = new Array<number>(capacity);
  }

  /**
   * Add a timestamp to the window
   */
  add(ts: number): void {
    this.buf[this.i] = ts;
    this.i = (this.i + 1) % this.buf.length;
    this.size = Math.min(this.size + 1, this.buf.length);
  }

  /**
   * Count events strictly within (now - windowMs, now]
   * O(capacity) scan, but capacity is small (typically 50)
   * 
   * Note: Uses strict > for floor to exclude boundary (events exactly at now - windowMs don't count)
   */
  countSince(now: number, windowMs: number): number {
    if (this.size === 0) return 0;
    const floor = now - windowMs;
    let n = 0;
    // Scan only filled slots (size <= capacity)
    for (let k = 0; k < this.size; k++) {
      if (this.buf[k] > floor) n++;
    }
    return n;
  }

  /**
   * Get current size (for testing/debugging)
   */
  getSize(): number {
    return this.size;
  }
}
