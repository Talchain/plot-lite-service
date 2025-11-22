/**
 * SSE test helper with heartbeat tolerance
 */

export interface SSEEvent {
  id?: string;
  event?: string;
  data: string;
  timestamp: number;
}

export async function collectSSEEvents(
  baseUrl: string,
  route: string,
  maxEvents = 10,
  timeoutMs = 5000
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { 'Accept': 'text/event-stream' },
      signal: controller.signal
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (events.length < maxEvents) {
      const { done, value } = await reader!.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let currentEvent: Partial<SSEEvent> = { timestamp: Date.now() };
      
      for (const line of lines) {
        if (line.startsWith('id:')) {
          currentEvent.id = line.slice(3).trim();
        } else if (line.startsWith('event:')) {
          currentEvent.event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentEvent.data = line.slice(5).trim();
        } else if (line === '') {
          if (currentEvent.data) {
            events.push(currentEvent as SSEEvent);
            currentEvent = { timestamp: Date.now() };
          }
        }
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') throw err;
  }

  return events;
}

export function checkHeartbeatTiming(
  events: SSEEvent[],
  expectedMs: number,
  tolerance = 0.4
): { pass: boolean; intervals: number[]; message: string } {
  const heartbeats = events.filter(e => e.event === 'heartbeat');
  if (heartbeats.length < 2) {
    return { pass: false, intervals: [], message: 'Need ≥2 heartbeats' };
  }

  const intervals: number[] = [];
  for (let i = 1; i < heartbeats.length; i++) {
    intervals.push(heartbeats[i].timestamp - heartbeats[i - 1].timestamp);
  }

  const min = expectedMs * (1 - tolerance);
  const max = expectedMs * (1 + tolerance);
  const allInRange = intervals.every(i => i >= min && i <= max);

  return {
    pass: allInRange,
    intervals,
    message: allInRange
      ? `All intervals in range [${min}, ${max}]ms`
      : `Expected ${expectedMs}ms ±${tolerance * 100}%, got ${intervals.join(', ')}ms`
  };
}

/**
 * Connect to SSE stream with custom headers and timeout
 * P1-B: Enhanced connection helper
 */
export interface ConnectStreamOptions {
  baseUrl: string;
  route?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export async function connectStream(options: ConnectStreamOptions): Promise<{
  response: Response;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  controller: AbortController;
}> {
  const { baseUrl, route = '/v1/stream?demo=1', headers = {}, timeoutMs = 10000 } = options;
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      headers: { 'Accept': 'text/event-stream', ...headers },
      signal: controller.signal
    });
    
    if (!response.ok) {
      throw new Error(`SSE connection failed: ${response.status}`);
    }
    
    const reader = response.body!.getReader();
    clearTimeout(timeout);
    
    return { response, reader, controller };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Wait for specific heartbeat with tolerance
 * P1-B: Heartbeat validation with configurable tolerance
 */
export interface WaitForHeartbeatOptions {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  expectedMs: number;
  toleranceRatio?: [number, number]; // [min, max] e.g., [0.6, 1.6]
  maxWaitMs?: number;
}

export async function waitForHeartbeat(options: WaitForHeartbeatOptions): Promise<{
  found: boolean;
  actualMs?: number;
  withinTolerance: boolean;
}> {
  const { reader, expectedMs, toleranceRatio = [0.6, 1.6], maxWaitMs = 5000 } = options;
  
  const startTime = Date.now();
  const decoder = new TextDecoder();
  let buffer = '';
  let lastHeartbeat: number | null = null;
  
  const [minRatio, maxRatio] = toleranceRatio;
  const minMs = expectedMs * minRatio;
  const maxMs = expectedMs * maxRatio;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      for (const line of lines) {
        if (line.startsWith('event:') && line.includes('heartbeat')) {
          const now = Date.now();
          if (lastHeartbeat) {
            const actualMs = now - lastHeartbeat;
            const withinTolerance = actualMs >= minMs && actualMs <= maxMs;
            return { found: true, actualMs, withinTolerance };
          }
          lastHeartbeat = now;
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') break;
      throw err;
    }
  }
  
  return { found: false, withinTolerance: false };
}

/**
 * Collect events until predicate is met
 * P1-B: Flexible event collection
 */
export async function collectEventsUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (events: SSEEvent[]) => boolean,
  maxMs: number = 5000
): Promise<SSEEvent[]> {
  const events: SSEEvent[] = [];
  const startTime = Date.now();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (Date.now() - startTime < maxMs) {
    try {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      
      let currentEvent: Partial<SSEEvent> = { timestamp: Date.now() };
      
      for (const line of lines) {
        if (line.startsWith('id:')) {
          currentEvent.id = line.slice(3).trim();
        } else if (line.startsWith('event:')) {
          currentEvent.event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          currentEvent.data = line.slice(5).trim();
        } else if (line === '') {
          if (currentEvent.data) {
            events.push(currentEvent as SSEEvent);
            if (predicate(events)) {
              return events;
            }
            currentEvent = { timestamp: Date.now() };
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') break;
      throw err;
    }
  }
  
  return events;
}
