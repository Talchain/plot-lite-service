import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatManager } from '../src/lib/sse-heartbeat.js';

describe('P1: HeartbeatManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not start when interval is 0', async () => {
    const manager = new HeartbeatManager();
    const onBeat = vi.fn();
    
    manager.start(0, onBeat);
    await vi.advanceTimersByTimeAsync(5000);
    
    expect(onBeat).not.toHaveBeenCalled();
  });

  it('sends heartbeats at configured interval', async () => {
    const manager = new HeartbeatManager();
    const onBeat = vi.fn().mockResolvedValue(undefined);
    
    manager.start(1000, onBeat);
    
    await vi.advanceTimersByTimeAsync(1000);
    expect(onBeat).toHaveBeenCalledTimes(1);
    expect(manager.getSeq()).toBe(1);
    
    await vi.advanceTimersByTimeAsync(1000);
    expect(onBeat).toHaveBeenCalledTimes(2);
    expect(manager.getSeq()).toBe(2);
    
    manager.stop();
  });

  it('stops sending heartbeats when stopped', async () => {
    const manager = new HeartbeatManager();
    const onBeat = vi.fn().mockResolvedValue(undefined);
    
    manager.start(1000, onBeat);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onBeat).toHaveBeenCalledTimes(1);
    
    manager.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(onBeat).toHaveBeenCalledTimes(1); // No additional calls
  });

  it('handles errors in onBeat gracefully', async () => {
    const manager = new HeartbeatManager();
    const onBeat = vi.fn().mockRejectedValue(new Error('Client disconnected'));
    
    manager.start(1000, onBeat);
    await vi.advanceTimersByTimeAsync(1000);
    
    // Should not throw
    expect(onBeat).toHaveBeenCalledTimes(1);
    expect(manager.getSeq()).toBe(1);
    
    manager.stop();
  });

  it('increments sequence number correctly', async () => {
    const manager = new HeartbeatManager();
    const onBeat = vi.fn().mockResolvedValue(undefined);
    
    manager.start(500, onBeat);
    
    await vi.advanceTimersByTimeAsync(500);
    expect(manager.getSeq()).toBe(1);
    
    await vi.advanceTimersByTimeAsync(500);
    expect(manager.getSeq()).toBe(2);
    
    await vi.advanceTimersByTimeAsync(500);
    expect(manager.getSeq()).toBe(3);
    
    manager.stop();
  });

  it('does not start multiple times', async () => {
    const manager = new HeartbeatManager();
    const onBeat = vi.fn().mockResolvedValue(undefined);
    
    manager.start(1000, onBeat);
    manager.start(1000, onBeat); // Second start should be ignored
    
    await vi.advanceTimersByTimeAsync(1000);
    expect(onBeat).toHaveBeenCalledTimes(1); // Not 2
    
    manager.stop();
  });
});
