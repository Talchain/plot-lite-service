import { TokenEvent } from './simulator.js';

export interface ProxyOptions {
  targetUrl: string;
  timeout: number;
}

export class ProxyService {
  constructor(private options: ProxyOptions) {}

  async *streamFromUpstream(
    sessionId: string,
    route: string,
    payload: any,
    headers: Record<string, string>,
    signal?: AbortSignal
  ): AsyncGenerator<TokenEvent> {
    // Send hello event
    yield {
      event: 'hello',
      data: {
        sessionId,
        route: 'proxy',
        mode: 'proxy',
        startedAt: new Date().toISOString(),
        upstream: this.options.targetUrl
      },
      id: '0'
    };

    let tokenIndex = 0;

    try {
      // Forward request to upstream service
      const upstreamUrl = `${this.options.targetUrl}${route}`;
      const response = await fetch(upstreamUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        body: JSON.stringify(payload),
        signal
      });

      if (!response.ok) {
        throw new Error(`Upstream error: ${response.status} ${response.statusText}`);
      }

      // Get the response text
      const responseText = await response.text();

      // Tokenize the response and stream it back
      const tokens = this.tokenizeResponse(responseText);

      for (let i = 0; i < tokens.length; i++) {
        if (signal?.aborted) {
          yield {
            event: 'cancelled',
            data: {
              sessionId,
              reason: 'client_cancelled',
              finalIdx: tokenIndex,
              tokensStreamed: i,
              ts: Date.now()
            },
            id: String(tokenIndex + 1)
          };
          return;
        }

        tokenIndex++;

        // Emit token
        yield {
          event: 'token',
          data: {
            sessionId,
            token: tokens[i],
            idx: tokenIndex,
            ts: Date.now(),
            remaining: tokens.length - (i + 1)
          },
          id: String(tokenIndex)
        };

        // Periodic cost events
        if (tokenIndex % 10 === 0) {
          yield {
            event: 'cost',
            data: {
              sessionId,
              tokens: tokenIndex,
              estimatedCost: (tokenIndex * 0.001).toFixed(4),
              ts: Date.now()
            },
            id: String(tokenIndex)
          };
        }

        // Wait 20-30ms between tokens to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 20 + Math.random() * 10));
      }

      // Final cost event
      yield {
        event: 'cost',
        data: {
          sessionId,
          tokens: tokenIndex,
          finalCost: (tokenIndex * 0.001).toFixed(4),
          completed: true,
          ts: Date.now()
        },
        id: String(tokenIndex + 1)
      };

    } catch (error) {
      if (signal?.aborted) {
        yield {
          event: 'cancelled',
          data: {
            sessionId,
            reason: 'client_cancelled',
            finalIdx: tokenIndex,
            ts: Date.now()
          },
          id: String(tokenIndex + 1)
        };
      } else {
        yield {
          event: 'error',
          data: {
            sessionId,
            error: 'proxy_error',
            message: String(error),
            ts: Date.now()
          },
          id: String(tokenIndex + 1)
        };
      }
    }
  }

  private tokenizeResponse(text: string): string[] {
    // Try to parse as JSON first
    try {
      const parsed = JSON.parse(text);

      // If it's a critique response, extract the feedback text
      if (parsed.feedback && Array.isArray(parsed.feedback)) {
        const feedbackText = parsed.feedback
          .map((item: any) => {
            if (typeof item === 'string') return item;
            if (item.message) return item.message;
            if (item.text) return item.text;
            return JSON.stringify(item);
          })
          .join(' ');

        return this.splitIntoTokens(feedbackText);
      }

      // If it's any other JSON, stringify it nicely
      const prettyJson = JSON.stringify(parsed, null, 2);
      return this.splitIntoTokens(prettyJson);

    } catch {
      // Not JSON, treat as plain text
      return this.splitIntoTokens(text);
    }
  }

  private splitIntoTokens(text: string): string[] {
    // Split on word boundaries, whitespace, and punctuation
    return text
      .split(/(\s+|[^\w\s])/)
      .filter(token => token.length > 0 && token.trim() !== '');
  }
}