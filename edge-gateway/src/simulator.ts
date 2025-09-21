export interface TokenEvent {
  event: 'token' | 'cost' | 'hello' | 'cancelled' | 'limit' | 'heartbeat' | 'error';
  data: any;
  id?: string;
}

const FIXTURE_TEXT = `The quick brown fox jumps over the lazy dog. This is a longer text that will be tokenized and streamed token by token to simulate a real AI response. Each token will be sent with proper timing and metadata to test the streaming functionality. We include various punctuation marks, numbers like 123 and 456, and special characters to make the simulation more realistic. The streaming should handle all types of content gracefully.`;

export class TokenSimulator {
  private tokens: string[];

  constructor(private text: string = FIXTURE_TEXT) {
    // Simple word-based tokenization for simulation
    this.tokens = text.split(/(\s+|[^\w\s])/).filter(t => t.length > 0 && t.trim() !== '');
  }

  async *streamTokens(
    sessionId: string,
    startIdx: number = 0,
    signal?: AbortSignal
  ): AsyncGenerator<TokenEvent> {
    // Send hello event
    yield {
      event: 'hello',
      data: {
        sessionId,
        route: 'stream',
        startedAt: new Date().toISOString(),
        totalTokens: this.tokens.length,
        resumeFrom: startIdx
      },
      id: '0'
    };

    let idx = Math.max(0, startIdx);

    for (let i = idx; i < this.tokens.length; i++) {
      if (signal?.aborted) {
        yield {
          event: 'cancelled',
          data: {
            sessionId,
            reason: 'client_cancelled',
            finalIdx: i,
            tokensStreamed: i - startIdx,
            ts: Date.now()
          },
          id: String(i + 1)
        };
        return;
      }

      // Emit token
      yield {
        event: 'token',
        data: {
          sessionId,
          token: this.tokens[i],
          idx: i + 1,
          ts: Date.now(),
          remaining: this.tokens.length - (i + 1)
        },
        id: String(i + 1)
      };

      // Periodic cost events
      if ((i + 1) % 10 === 0) {
        yield {
          event: 'cost',
          data: {
            sessionId,
            tokens: i + 1,
            estimatedCost: ((i + 1) * 0.001).toFixed(4),
            ts: Date.now()
          },
          id: String(i + 1)
        };
      }

      // Wait 20-30ms between tokens to simulate real streaming
      await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 10));
    }

    // Final cost event
    yield {
      event: 'cost',
      data: {
        sessionId,
        tokens: this.tokens.length,
        finalCost: (this.tokens.length * 0.001).toFixed(4),
        completed: true,
        ts: Date.now()
      },
      id: String(this.tokens.length + 1)
    };
  }

  getTokenCount(): number {
    return this.tokens.length;
  }

  getTokens(): string[] {
    return [...this.tokens];
  }
}