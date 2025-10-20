import { describe, it, expect } from 'vitest';
import { BoundedEventQueue } from '../src/lib/sse-queue.js';

describe('P1: BoundedEventQueue', () => {
  it('pushes events within capacity', () => {
    const queue = new BoundedEventQueue(3);
    
    expect(queue.push({ id: 1, event: 'test', data: 'a' })).toBe('ok');
    expect(queue.push({ id: 2, event: 'test', data: 'b' })).toBe('ok');
    expect(queue.push({ id: 3, event: 'test', data: 'c' })).toBe('ok');
    expect(queue.size()).toBe(3);
  });

  it('drops oldest when exceeding capacity', () => {
    const queue = new BoundedEventQueue(2);
    
    queue.push({ id: 1, event: 'test', data: 'a' });
    queue.push({ id: 2, event: 'test', data: 'b' });
    
    const result = queue.push({ id: 3, event: 'test', data: 'c' });
    expect(result).toBe('dropped');
    expect(queue.size()).toBe(2);
    
    const drained = queue.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0].id).toBe(2); // First was dropped
    expect(drained[1].id).toBe(3);
  });

  it('drains all events', () => {
    const queue = new BoundedEventQueue(5);
    
    queue.push({ id: 1, event: 'test', data: 'a' });
    queue.push({ id: 2, event: 'test', data: 'b' });
    
    const drained = queue.drain();
    expect(drained).toHaveLength(2);
    expect(queue.size()).toBe(0);
  });

  it('clears queue', () => {
    const queue = new BoundedEventQueue(5);
    
    queue.push({ id: 1, event: 'test', data: 'a' });
    queue.push({ id: 2, event: 'test', data: 'b' });
    
    queue.clear();
    expect(queue.size()).toBe(0);
  });

  it('throws on invalid maxSize', () => {
    expect(() => new BoundedEventQueue(0)).toThrow('maxSize must be >= 1');
    expect(() => new BoundedEventQueue(-1)).toThrow('maxSize must be >= 1');
  });
});
