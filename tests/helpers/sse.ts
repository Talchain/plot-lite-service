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

  const intervals = [];
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
