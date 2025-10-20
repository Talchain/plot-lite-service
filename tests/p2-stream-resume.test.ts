import { describe, it, expect, beforeEach } from 'vitest';
import { StreamResumeManager, type StreamEvent } from '../src/lib/stream-resume.js';

describe('P2: StreamResumeManager', () => {
  let manager: StreamResumeManager;

  beforeEach(() => {
    manager = new StreamResumeManager(100, 5000, true);
  });

  it('creates and tracks streams', () => {
    manager.createStream('stream-1');
    expect(manager.getStats().activeStreams).toBe(1);
  });

  it('adds events and retrieves after ID', () => {
    manager.createStream('stream-1');
    manager.addEvent('stream-1', { id: 0, event: 'init', data: 'a' });
    manager.addEvent('stream-1', { id: 1, event: 'token', data: 'b' });
    
    const events = manager.getEventsAfter('stream-1', 0);
    expect(events).toHaveLength(1);
    expect(events![0].id).toBe(1);
  });

  it('returns null for nonexistent stream', () => {
    expect(manager.getEventsAfter('none', 0)).toBeNull();
  });

  it('handles ring buffer overflow', () => {
    const small = new StreamResumeManager(3, 5000, true);
    small.createStream('s1');
    small.addEvent('s1', { id: 1, event: 'a', data: 'a' });
    small.addEvent('s1', { id: 2, event: 'b', data: 'b' });
    small.addEvent('s1', { id: 3, event: 'c', data: 'c' });
    small.addEvent('s1', { id: 4, event: 'd', data: 'd' });
    
    expect(small.getEventsAfter('s1', 1)).toHaveLength(0); // evicted
    expect(small.getEventsAfter('s1', 2)).toHaveLength(2); // valid
  });

  it('generates and parses tokens', () => {
    const token = manager.generateToken('s1', 42);
    const parsed = manager.parseToken(token);
    expect(parsed!.streamId).toBe('s1');
    expect(parsed!.lastEventId).toBe(42);
  });

  it('rejects invalid tokens', () => {
    expect(manager.parseToken('invalid')).toBeNull();
  });
});
