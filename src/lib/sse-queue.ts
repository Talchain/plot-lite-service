/**
 * Memory-bounded event queue for SSE streams
 * Prevents unbounded memory growth under slow clients
 */

export interface QueuedEvent {
  id: number;
  event: string;
  data: unknown;
}

export class BoundedEventQueue {
  private queue: QueuedEvent[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    if (maxSize < 1) throw new Error('maxSize must be >= 1');
    this.maxSize = maxSize;
  }

  /**
   * Push event to queue. If full, drops oldest event.
   * @returns 'ok' if added, 'dropped' if oldest was evicted
   */
  push(item: QueuedEvent): 'ok' | 'dropped' {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); // Drop oldest
      this.queue.push(item);
      return 'dropped';
    }
    this.queue.push(item);
    return 'ok';
  }

  /**
   * Drain all events from queue (empties it)
   */
  drain(): QueuedEvent[] {
    return this.queue.splice(0);
  }

  /**
   * Current queue size
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Clear queue without returning events
   */
  clear(): void {
    this.queue.length = 0;
  }
}
