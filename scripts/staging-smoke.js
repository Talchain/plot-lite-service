import process from 'node:process';
import crypto from 'node:crypto';
const DEFAULT_PLOT_URL = 'https://plot-lite-service-staging.onrender.com';
const DEFAULT_CEE_URL = 'https://cee-staging.onrender.com';
const TOTAL_TIMEOUT_MS = 120_000;
const plotBaseUrl = (process.env.SMOKE_PLOT_URL || DEFAULT_PLOT_URL).replace(/\/$/, '');
const ceeBaseUrl = (process.env.SMOKE_CEE_URL || DEFAULT_CEE_URL).replace(/\/$/, '');
const smokeApiKey = process.env.SMOKE_API_KEY?.trim();
if (!smokeApiKey) {
    console.error('FAIL: SMOKE_API_KEY is required');
    process.exit(1);
}
const overallController = new AbortController();
const deadlineMs = Date.now() + TOTAL_TIMEOUT_MS;
let overallTimedOut = false;
const overallTimeoutId = setTimeout(() => {
    overallTimedOut = true;
    overallController.abort();
}, TOTAL_TIMEOUT_MS);
overallTimeoutId.unref();
function remainingMs() {
    return deadlineMs - Date.now();
}
async function fetchWithDeadline(url, init) {
    const timeoutMs = remainingMs();
    if (timeoutMs <= 0) {
        throw new Error('Overall timeout exceeded');
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    timeoutId.unref();
    let signal = controller.signal;
    if (typeof AbortSignal.any === 'function') {
        signal = AbortSignal.any([overallController.signal, controller.signal]);
    }
    else {
        const onAbort = () => controller.abort();
        overallController.signal.addEventListener('abort', onAbort, { once: true });
    }
    try {
        return await fetch(url, { ...init, signal });
    }
    finally {
        clearTimeout(timeoutId);
    }
}
async function runCheck(name, run) {
    const requestId = crypto.randomUUID();
    try {
        const result = await run(requestId);
        return {
            name,
            ok: true,
            requestId: result?.requestId || requestId,
            note: result?.note,
        };
    }
    catch (err) {
        const note = err instanceof Error ? err.message : String(err);
        return { name, ok: false, requestId, note };
    }
}
function logResult(result) {
    const status = result.ok ? 'PASS' : 'FAIL';
    const suffix = result.note ? ` - ${result.note}` : '';
    console.log(`[${status}] ${result.name} (request_id=${result.requestId})${suffix}`);
}
function responseRequestId(res, fallback) {
    return res.headers.get('x-request-id') || fallback;
}
async function main() {
    console.log(`Staging smoke test: plot=${plotBaseUrl}, cee=${ceeBaseUrl}`);
    const results = [];
    results.push(await runCheck('PLOT /health returns 200', async (requestId) => {
        const res = await fetchWithDeadline(`${plotBaseUrl}/health`, {
            method: 'GET',
            headers: { 'X-Request-Id': requestId },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`status=${res.status} ${body}`.trim());
        }
        return { requestId: responseRequestId(res, requestId) };
    }));
    results.push(await runCheck('CEE /healthz returns 200', async (requestId) => {
        const res = await fetchWithDeadline(`${ceeBaseUrl}/healthz`, {
            method: 'GET',
            headers: { 'X-Request-Id': requestId },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`status=${res.status} ${body}`.trim());
        }
        return { requestId: responseRequestId(res, requestId) };
    }));
    results.push(await runCheck('PLOT /v1/cee/draft-graph?schema=v3 returns graph', async (requestId) => {
        const res = await fetchWithDeadline(`${plotBaseUrl}/v1/cee/draft-graph?schema=v3`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${smokeApiKey}`,
                'X-Request-Id': requestId,
            },
            body: JSON.stringify({
                brief: 'Should we increase our product price from £49 to £69 per month to improve revenue, given our current 3% monthly churn rate?',
            }),
        });
        const resolvedRequestId = responseRequestId(res, requestId);
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            throw new Error(`status=${res.status} ${body}`.trim());
        }
        const payload = await res.json().catch(() => null);
        if (!payload || typeof payload !== 'object') {
            throw new Error('response is not valid JSON');
        }
        const nodesOk = Array.isArray(payload.nodes) && payload.nodes.length > 0;
        const edgesOk = Array.isArray(payload.edges) && payload.edges.length > 0;
        const analysisReadyOk = payload.analysis_ready && typeof payload.analysis_ready === 'object';
        const optionsOk = Array.isArray(payload.options);
        if (!nodesOk) {
            throw new Error('nodes array missing or empty');
        }
        if (!edgesOk) {
            throw new Error('edges array missing or empty');
        }
        if (!analysisReadyOk) {
            throw new Error('analysis_ready missing');
        }
        if (!optionsOk) {
            throw new Error('options array missing');
        }
        return { requestId: resolvedRequestId };
    }));
    for (const result of results) {
        logResult(result);
    }
    const failed = results.filter((result) => !result.ok);
    if (overallTimedOut) {
        console.error('FAIL: overall timeout exceeded');
        process.exit(1);
    }
    if (failed.length > 0) {
        process.exit(1);
    }
    process.exit(0);
}
main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`FAIL: ${message}`);
    process.exit(1);
});
