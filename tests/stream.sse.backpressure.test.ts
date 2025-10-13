import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import { __streamTest } from '../src/routes/v1/stream';

class FakeRaw extends EventEmitter {
  writes: string[] = [];
  writesAfterDrain: number = 0;
  shouldBackpressure = true;
  write(chunk: any): boolean {
    this.writes.push(String(chunk ?? ''));
    // First call returns false to simulate backpressure
    if (this.shouldBackpressure) {
      this.shouldBackpressure = false;
      return false;
    }
    this.writesAfterDrain++;
    return true;
  }
}

function makeReply(): FastifyReply & { raw: FakeRaw; log: any } {
  const raw = new FakeRaw();
  const log = { error: () => {}, warn: () => {}, info: () => {} };
  return { raw, log } as any;
}

describe('SSE backpressure write', () => {
  it('attaches drain listener when write returns false (no throw)', async () => {
    const reply = makeReply();

    const { writeSse } = __streamTest;
    // Schedule drain before awaiting to let writeSse resolve
    process.nextTick(() => reply.raw.emit('drain'));
    await writeSse(reply as any, 0, 'hello', { a: 1 });

    // After drain, additional writes should proceed normally
    await writeSse(reply as any, 1, 'token', { b: 2 });

    expect(reply.raw.writes.length).toBeGreaterThan(0);
  }, 15000);
});
