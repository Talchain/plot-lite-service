import { describe, it, expect, beforeEach } from 'vitest';
import { StreamResumeManager, type StreamEvent } from '../src/lib/stream-resume.js';

describe('P2: StreamResumeManager', () => {
  let manager: StreamResumeManager;

  beforeEach(() => {
    manager = new StreamResumeManager(100, 5000, true); // 100 events, 5s TTL, enabled
  });

  it('creates and tracks streams', () => {
    manager.createStream('stream-1');
    
    const stats = manager.getStats();
    expect(stats.activeStreams).toBe(1);
    expect(stats.enabled).toBe(true);
  });

  it('adds events to stream buffer', () => {
    manager.createStream('stream-1');
    
    const event: StreamEvent = { id: 1, event: 'token', data: { text: 'hello' } };
    manager.addEvent('stream-1', event);
    
    // Get all events (no filter, pass id that doesn't exist to get all after)
    const events = manager.getEventsAfter('stream-1', 0);
    // Since id:0 doesn't exist in buffer, returns empty (per fix)
    // To get all events, we need to check from before first event or use different approach
    expect(events).toHaveLength(0); // id:0 not in buffer, so empty
    
    // Better test: add event 0, then get after it
    manager.addEvent('stream-1', { id: 0, event: 'init', data: { text: 'start' } });
    const eventsAfter0 = manager.getEventsAfter('stream-1', 0);
    expect(eventsAfter0).not.toBeNull();
    expect(eventsAfter0).toHaveLength(1);
    expect(eventsAfter0![0].id).toBe(1);
  });

  it('retrieves events after specific ID', () => {
    manager.createStream('stream-1');
    
    manager.addEvent('stream-1', { id: 1, event: 'token', data: { text: 'a' } });
    manager.addEvent('stream-1', { id: 2, event: 'token', data: { text: 'b' } });
    manager.addEvent('stream-1', { id: 3, event: 'token', data: { text: 'c' } });
    
    const events = manager.getEventsAfter('stream-1', 1);
    expect(events).toHaveLength(2);
    expect(events![0].id).toBe(2);
    expect(events![1].id).toBe(3);
  });

  it('returns null for nonexistent stream', () => {
    const events = manager.getEventsAfter('nonexistent', 0);
    expect(events).toBeNull();
  });

  it('generates and parses resume tokens', () => {
    const token = manager.generateToken('stream-1', 42);
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    
    const parsed = manager.parseToken(token);
    expect(parsed).not.toBeNull();
    expect(parsed!.streamId).toBe('stream-1');
    expect(parsed!.lastEventId).toBe(42);
    expect(parsed!.issuedAt).toBeGreaterThan(0);
  });

  it('rejects invalid tokens', () => {
    expect(manager.parseToken('invalid')).toBeNull();
    expect(manager.parseToken('')).toBeNull();
    expect(manager.parseToken('not-base64!')).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const shortTTLManager = new StreamResumeManager(100, 100, true); // 100ms TTL
    
    const token = shortTTLManager.generateToken('stream-1', 1);
    expect(shortTTLManager.parseToken(token)).not.toBeNull();
    
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(shortTTLManager.parseToken(token)).toBeNull();
  });

  it('handles ring buffer overflow (evicted token)', () => {
    const smallManager = new StreamResumeManager(3, 5000, true); // Only 3 events
    
    smallManager.createStream('stream-1');
    smallManager.addEvent('stream-1', { id: 1, event: 'token', data: 'a' });
    smallManager.addEvent('stream-1', { id: 2, event: 'token', data: 'b' });
    smallManager.addEvent('stream-1', { id: 3, event: 'token', data: 'c' });
    smallManager.addEvent('stream-1', { id: 4, event: 'token', data: 'd' }); // Overflow, evicts id:1
    
    // Try to resume from evicted event (id:1)
    const events = smallManager.getEventsAfter('stream-1', 1);
    // Event 1 was evicted, so return empty array (not full buffer)
    expect(events).toHaveLength(0);
    
    // Resume from valid event (id:2) should work
    const validEvents = smallManager.getEventsAfter('stream-1', 2);
    expect(validEvents).toHaveLength(2); // Events 3 and 4
    expect(validEvents[0].id).toBe(3);
    expect(validEvents[1].id).toBe(4);
  });

  it('deletes streams', () => {
    manager.createStream('stream-1');
    expect(manager.getStats().activeStreams).toBe(1);
    
    manager.deleteStream('stream-1');
    expect(manager.getStats().activeStreams).toBe(0);
  });

  it('clears all streams', () => {
    manager.createStream('stream-1');
    manager.createStream('stream-2');
    expect(manager.getStats().activeStreams).toBe(2);
    
    manager.clear();
    expect(manager.getStats().activeStreams).toBe(0);
  });

  it('does nothing when disabled', () => {
    const disabledManager = new StreamResumeManager(100, 5000, false);
    
    disabledManager.createStream('stream-1');
    disabledManager.addEvent('stream-1', { id: 1, event: 'token', data: 'test' });
    
    const events = disabledManager.getEventsAfter('stream-1', 0);
    expect(events).toBeNull();
    expect(disabledManager.getStats().activeStreams).toBe(0);
  });

  it('expires streams based on TTL', async () => {
    const shortTTLManager = new StreamResumeManager(100, 100, true); // 100ms TTL
    
    shortTTLManager.createStream('stream-1');
    shortTTLManager.addEvent('stream-1', { id: 1, event: 'token', data: 'test' });
    
    expect(shortTTLManager.getEventsAfter('stream-1', 0)).not.toBeNull();
    
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(shortTTLManager.getEventsAfter('stream-1', 0)).toBeNull();
  });
});
