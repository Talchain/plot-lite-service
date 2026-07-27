/**
 * INSTANCE A — a fabricated SCIENTIFIC VERDICT when ISL returned nothing.
 * ============================================================================
 * ROADMAP 1.240. Evidence: parallel-briefs/ISL-UNMOUNTED-ROUTES-LIVE-PROBE-2026-07-27.md
 * (live-probed against isl-staging @7d144c7f, deployed == pinned confirmed).
 *
 * THE DEFECT. ISL does not mount `causal_router`, so POST /api/v1/causal/validate
 * returns 404 (byte-identical to the negative control; `GET` on a mounted sibling
 * returns 405, so the 404 is genuinely an unmounted path). PLoT's validateCausal
 * catches that and returns `createFallbackValidation(...)`, which used
 * `status: 'uncertain'`. That status is indistinguishable from ISL's own
 * `partially_identifiable`, so routes/v1/run.ts pushed a user-facing critique:
 *
 *     source:  'isl'
 *     message: 'ISL validation reports partial identifiability; results may
 *               rely on stronger assumptions.'
 *
 * ISL computed NOTHING. The user was told a substantive scientific claim about
 * their own graph, attributed to a service that returned 404. The only honest
 * token — 'ISL validation unavailable' — was demoted into `suggested_action`,
 * where it reads as advice rather than as the retraction it actually is.
 *
 * THE RULE (A1 ruling): when upstream data is absent, PLoT degrades to a typed
 * refusal or an explicit unknown — never to a number and never to a verdict.
 *
 * WHY THE TIMEOUT CASE IS TESTED SEPARATELY AND IS THE LOAD-BEARING ONE.
 * Mounting causal_router would make the 404 critique stop appearing while
 * leaving the defect intact for the next timeout, 5xx or circuit-breaker trip.
 * The timeout case survives any future mounting decision, so it — not the 404 —
 * is what keeps this pin honest. Both are asserted below.
 *
 * SEAM. These drive the REAL ISLClient (global fetch stubbed at the wire), the
 * REAL error mapping, the REAL validateCausal catch, the REAL fallback and the
 * REAL /v1/run consumer. Nothing between the HTTP status and the response body
 * is mocked, so the pin cannot pass by testing a mock's idea of a 404.
 *
 * POSITIVE CONTROLS. A genuine ISL 200 must STILL produce the real
 * `source: 'isl'` critique for partially_identifiable and not_identifiable, and
 * must still populate the enrichment. Over-suppression is an equal failure: a
 * fix that silences ISL's real scientific verdicts is not a fix.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { createServer } from '../src/createServer.js';
import { resetISLService } from '../src/integrations/isl/index.js';

const ISL_VALIDATE_PATH = '/api/v1/causal/validate';

/** A graph with a confounder, so /v1/run has something to validate. */
const PAYLOAD = {
  graph: {
    nodes: [
      { id: 'A', label: 'Input' },
      { id: 'B', label: 'Output' },
      { id: 'C', label: 'Confounder' },
    ],
    edges: [
      { from: 'A', to: 'B', weight: 0.5 },
      { from: 'C', to: 'A', weight: 0.4 },
      { from: 'C', to: 'B', weight: 0.4 },
    ],
  },
  seed: 123,
  outcome_node: 'B',
  detail_level: 'standard',
};

/** ISL's real 404 body, copied from the live probe (§1 of the brief). */
const ISL_404_BODY = JSON.stringify({ detail: 'Not Found' });

type WireBehaviour =
  | { kind: 'http'; status: number; body: string }
  | { kind: 'abort' }
  | { kind: 'ok'; body: unknown };

/** What the stubbed wire does for /api/v1/causal/validate on the next call. */
let validateBehaviour: WireBehaviour = { kind: 'http', status: 404, body: ISL_404_BODY };

let realFetch: typeof globalThis.fetch;

function jsonResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Stub ONLY the ISL wire. Everything else (including the test's own requests,
 * which use app.inject and never touch fetch) is untouched.
 */
function installWireStub(): void {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? input);

    if (url.includes(ISL_VALIDATE_PATH)) {
      const behaviour = validateBehaviour;
      if (behaviour.kind === 'abort') {
        // What a real per-attempt timeout looks like to ISLClient: an
        // AbortError, which client.ts maps to ISLTimeoutError.
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      if (behaviour.kind === 'http') {
        return jsonResponse(behaviour.status, behaviour.body);
      }
      return jsonResponse(200, JSON.stringify(behaviour.body));
    }

    // Every OTHER ISL endpoint (robustness/analyze/v2 etc.) fails closed with a
    // 404 so this suite isolates the validation path.
    return jsonResponse(404, ISL_404_BODY);
  }) as typeof globalThis.fetch;
}

/** A genuine ISL 200 validation response, in ISL's declared shape. */
function islValidationBody(status: 'identifiable' | 'partially_identifiable' | 'not_identifiable') {
  return {
    status,
    robustness: 'high',
    adjustment_sets: [['C']],
    minimal_adjustment_set: ['C'],
    suggestions: [],
  };
}

function critiqueItems(body: any): any[] {
  expect(Array.isArray(body.critique), 'response must carry a critique array').toBe(true);
  return body.critique as any[];
}

/** Every critique item attributed to ISL. */
function islAttributed(body: any): any[] {
  return critiqueItems(body).filter((c) => c.source === 'isl');
}

describe('INSTANCE A — ISL validation absent must not fabricate an identifiability verdict', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.RATE_LIMIT_ENABLED = '0';
    process.env.CEE_ORCHESTRATOR_ENABLED = '0';
    // Enable ISL so validateCausal actually reaches the (stubbed) wire, rather
    // than short-circuiting on `ISL not enabled` — which would make every
    // assertion below pass for the wrong reason.
    process.env.ISL_ENABLE = '1';
    process.env.ISL_BASE_URL = 'http://isl.invalid';
    process.env.ISL_API_KEY = 'test-key';
    // NOTE: `maxRetries` is really max ATTEMPTS — client.ts loops
    // `attempt <= maxRetries`, so 0 runs the body zero times and never reaches
    // fetch. 1 = exactly one attempt, no backoff.
    process.env.ISL_MAX_RETRIES = '1';
    resetISLService();

    installWireStub();
    app = await createServer();
  });

  afterAll(async () => {
    await app?.close();
    globalThis.fetch = realFetch;
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.CEE_ORCHESTRATOR_ENABLED;
    delete process.env.ISL_ENABLE;
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_API_KEY;
    delete process.env.ISL_MAX_RETRIES;
    resetISLService();
  });

  beforeEach(() => {
    validateBehaviour = { kind: 'http', status: 404, body: ISL_404_BODY };
  });

  afterEach(() => {
    delete process.env.TEST_ISL_MODE;
  });

  async function run(): Promise<any> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/run',
      headers: { 'Content-Type': 'application/json' },
      payload: PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  // =========================================================================
  // POSITIVE CONTROL FIRST — prove the harness can SEE the real critique.
  // Without this, every absence assertion below would be vacuous (trap 13).
  // =========================================================================

  describe('positive controls — a genuine ISL result still speaks for ISL', () => {
    it('a real partially_identifiable 200 STILL produces the source:isl partial-identifiability critique', async () => {
      validateBehaviour = { kind: 'ok', body: islValidationBody('partially_identifiable') };

      const body = await run();
      const isl = islAttributed(body);

      const partial = isl.find((c) =>
        String(c.message).includes('partial identifiability'),
      );
      expect(
        partial,
        'a genuine ISL partially_identifiable must still be reported as ISL\'s own finding — ' +
          'over-suppression is an equal failure to fabrication',
      ).toBeDefined();
      expect(partial.code).toBe('ISL_UNCERTAIN');
      expect(partial.source).toBe('isl');
    });

    it('a real not_identifiable 200 STILL produces the source:isl BLOCKER', async () => {
      validateBehaviour = { kind: 'ok', body: islValidationBody('not_identifiable') };

      const body = await run();
      const isl = islAttributed(body);

      const blocker = isl.find((c) => c.code === 'ISL_CANNOT_IDENTIFY');
      expect(blocker, 'a genuine ISL not_identifiable must still block').toBeDefined();
      expect(blocker.severity).toBe('BLOCKER');
      expect(blocker.source).toBe('isl');
    });

    it('a real identifiable 200 reaches the enrichment as identifiable:true', async () => {
      validateBehaviour = { kind: 'ok', body: islValidationBody('identifiable') };

      const body = await run();

      expect(body.enrichment?.causal_validation).toBeDefined();
      expect(body.enrichment.causal_validation.identifiable).toBe(true);
      expect(body.isl_validation?.source).toBe('isl');
    });
  });

  // =========================================================================
  // RED — the defect itself.
  // =========================================================================

  describe('RED: ISL 404 (unmounted causal_router) must not become a verdict', () => {
    it('emits NO source:isl critique at all', async () => {
      const body = await run();

      expect(
        islAttributed(body),
        'ISL returned 404 and computed nothing, so NOTHING may be attributed to it',
      ).toEqual([]);
    });

    it('never claims partial identifiability', async () => {
      const body = await run();

      const messages = critiqueItems(body).map((c) => String(c.message ?? ''));
      expect(
        messages.some((m) => m.includes('partial identifiability')),
        'a 404 must not manufacture an identifiability claim about the user\'s graph',
      ).toBe(false);
      expect(
        critiqueItems(body).some((c) => c.code === 'ISL_UNCERTAIN'),
      ).toBe(false);
      expect(
        critiqueItems(body).some((c) => c.code === 'ISL_CANNOT_IDENTIFY'),
      ).toBe(false);
    });

    it('carries a TYPED unavailable marker instead — an explicit unknown, not silence', async () => {
      const body = await run();

      // The status itself is the typed marker: a distinct value that cannot be
      // confused with any verdict ISL can return.
      expect(body.isl_validation?.status).toBe('unavailable');
      expect(body.isl_validation?.source).toBe('engine_fallback');

      const notice = critiqueItems(body).find(
        (c) => c.code === 'ISL_VALIDATION_UNAVAILABLE',
      );
      expect(
        notice,
        'the user must be told identifiability was NOT checked — silence is a different dishonesty',
      ).toBeDefined();
      expect(notice.source).not.toBe('isl');
      expect(notice.severity).toBe('OBSERVATION');
      expect(String(notice.message)).not.toContain('partial identifiability');
    });

    it('emits NO causal_validation enrichment block — never a fabricated identifiable:false', async () => {
      const body = await run();

      // transformValidationToEnrichment computed `identifiable: status === 'identifiable'`,
      // so an unavailable validation shipped `identifiable: false` into the
      // PLoT->CEE enrichment payload — which is an untyped z.record passthrough,
      // so nothing downstream would have caught it.
      expect(body.enrichment?.causal_validation).toBeUndefined();
    });
  });

  describe('RED: an ISL TIMEOUT must not become a verdict either (survives any mounting decision)', () => {
    beforeEach(() => {
      validateBehaviour = { kind: 'abort' };
    });

    it('emits NO source:isl critique', async () => {
      const body = await run();
      expect(islAttributed(body)).toEqual([]);
    });

    it('never claims partial identifiability, and marks the result unavailable', async () => {
      const body = await run();

      const messages = critiqueItems(body).map((c) => String(c.message ?? ''));
      expect(messages.some((m) => m.includes('partial identifiability'))).toBe(false);
      expect(body.isl_validation?.status).toBe('unavailable');
      expect(
        critiqueItems(body).some((c) => c.code === 'ISL_VALIDATION_UNAVAILABLE'),
      ).toBe(true);
      expect(body.enrichment?.causal_validation).toBeUndefined();
    });
  });

  describe('RED: an ISL 5xx must not become a verdict either', () => {
    beforeEach(() => {
      validateBehaviour = { kind: 'http', status: 503, body: '{"detail":"Service Unavailable"}' };
    });

    it('emits NO source:isl critique and marks the result unavailable', async () => {
      const body = await run();

      expect(islAttributed(body)).toEqual([]);
      expect(body.isl_validation?.status).toBe('unavailable');
      expect(body.enrichment?.causal_validation).toBeUndefined();
    });
  });
});
