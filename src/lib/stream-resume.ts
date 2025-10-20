/**
 * P2: Stream Resume Manager
 * Enables SSE reconnection with X-Resume-From header
 */

export interface StreamEvent {
  id: number;
  event: string;
  data: unknown;
}

export interface ResumeToken {
  streamId: string;
  lastEventId: number;
  issuedAt: number;
}

class RingBuffer<T> {
  private buffer: T[];
  private head = 0;
  private tail = 0;
  private count = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    
    if (this.count < this.capacity) {
      this.count++;
    } else {
      // Overwrite oldest
      this.head = (this.head + 1) % this.capacity;
    }
  }

  getAll(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head + i) % this.capacity;
      result.push(this.buffer[idx]);
    }
    return result;
  }

  getAfter(predicate: (item: T) => boolean): T[] {
    const all = this.getAll();
    const idx = all.findIndex(predicate);
    // If predicate not found, return all events (resume from beginning)
    return idx >= 0 ? all.slice(idx + 1) : all;
  }

  size(): number {
    return this.count;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }
}

export class StreamResumeManager {
  private buffers = new Map<string, RingBuffer<StreamEvent>>();
  private readonly bufferSize: number;
  private readonly ttlMs: number;
  private readonly enabled: boolean;
  private streamTimestamps = new Map<string, number>();

  constructor(bufferSize: number, ttlMs: number, enabled = false) {
    this.bufferSize = bufferSize;
    this.ttlMs = ttlMs;
    this.enabled = enabled;
  }

  /**
   * Create a new stream buffer
   */
  createStream(streamId: string): void {
    if (!this.enabled) return;
    this.buffers.set(streamId, new RingBuffer<StreamEvent>(this.bufferSize));
    this.streamTimestamps.set(streamId, Date.now());
  }

  /**
   * Add event to stream buffer
   */
  addEvent(streamId: string, event: StreamEvent): void {
    if (!this.enabled) return;
    const buffer = this.buffers.get(streamId);
    if (buffer) {
      buffer.push(event);
      this.streamTimestamps.set(streamId, Date.now());
    }
  }

  /**
   * Get events after a specific event ID
   * Returns null if stream not found or expired
   */
  getEventsAfter(streamId: string, lastEventId: number): StreamEvent[] | null {
    if (!this.enabled) return null;
    
    const buffer = this.buffers.get(streamId);
    const timestamp = this.streamTimestamps.get(streamId);
    
    if (!buffer || !timestamp) return null;
    
    // Check TTL
    if (Date.now() - timestamp > this.ttlMs) {
      this.deleteStream(streamId);
      return null;
    }
    
    return buffer.getAfter((event) => event.id === lastEventId);
  }

  /**
   * Generate resume token
   */
  generateToken(streamId: string, lastEventId: number): string {
    const token: ResumeToken = {
      streamId,
      lastEventId,
      issuedAt: Date.now()
    };
    return Buffer.from(JSON.stringify(token)).toString('base64');
  }

  /**
   * Parse resume token
   */
  parseToken(token: string): ResumeToken | null {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf-8');
      const parsed = JSON.parse(decoded) as ResumeToken;
      
      // Validate structure
      if (!parsed.streamId || typeof parsed.lastEventId !== 'number' || !parsed.issuedAt) {
        return null;
      }
      
      // Check token age
      if (Date.now() - parsed.issuedAt > this.ttlMs) {
        return null;
      }
      
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Delete stream buffer
   */
  deleteStream(streamId: string): void {
    this.buffers.delete(streamId);
    this.streamTimestamps.delete(streamId);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      activeStreams: this.buffers.size,
      enabled: this.enabled
    };
  }

  /**
   * Clear all buffers
   */
  clear(): void {
    this.buffers.clear();
    this.streamTimestamps.clear();
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
