import { describe, it, expect } from "vitest";
import { ERR_MSG } from "../../src/lib/error-messages.js";
import { toPublicError } from "../../src/lib/error-normaliser.js";

function stable(o: any) {
  const { type, message, retryable, code } = o || {};
  return { type, message, retryable, code };
}

describe("Error Message Catalogue", () => {
  it("maps BAD_INPUT (generic schema) to legacy phrase", () => {
    const out = toPublicError({ type: "BAD_INPUT", http: 400 });
    expect(out.type).toBe("BAD_INPUT");
    expect(out.message).toBe(ERR_MSG.BAD_INPUT_SCHEMA);
  });

  it("maps BAD_INPUT with explicit key to that phrase", () => {
    const out = toPublicError({ type: "BAD_INPUT", http: 400, key: "BAD_QUERY_PARAMS" });
    expect(out.message).toBe(ERR_MSG.BAD_QUERY_PARAMS);
  });

  it("maps RATE_LIMIT to legacy RPM phrase", () => {
    const out = toPublicError({ type: "RATE_LIMIT", http: 429 });
    expect(out.message).toBe(ERR_MSG.RATE_LIMIT_RPM);
  });

  it("maps INVALID_TEMPLATE to 404 with the legacy phrase", () => {
    const out = toPublicError({ type: "BAD_INPUT", http: 404, key: "INVALID_TEMPLATE" as any });
    expect(out.type).toBe("BAD_INPUT");
    expect(out.message).toBe(ERR_MSG.INVALID_TEMPLATE);
  });

  it("preserves taxonomy and status expectations at call sites (example snapshot)", () => {
    const out = toPublicError({ type: "TIMEOUT", http: 504 });
    expect(stable(out)).toMatchInlineSnapshot(`
      {
        "code": undefined,
        "message": "The service took too long to respond",
        "retryable": true,
        "type": "TIMEOUT",
      }
    `);
  });
});
