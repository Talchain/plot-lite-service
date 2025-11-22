#!/usr/bin/env node
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import http from "node:http";

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}` ;

function once(proc, sig) { return new Promise(r => proc.once(sig, r)); }
function req(method, path, { headers={}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request(`${BASE}${path}` , { method, headers, timeout: 3000 }, (res) => {
      let buf = ""; res.setEncoding("utf8");
      res.on("data", c => buf += c);
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on("error", () => resolve({ status: 0, headers: {}, body: "" }));
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    TEST_ROUTES: "1",
    AUTH_ENABLED: "1",
    AUTH_TOKEN: "test",              // ensure auth boot passes
    NODE_ENV: "test",
  };
  const srv = spawn("node", ["dist/main.js"], { env, stdio: "ignore" });
  let healthy = false;
  for (let i=0; i<40; i++) {         // wait up to ~2s
    // Use unversioned /health to avoid /v1 auth guard requirement
    const r = await req("GET","/health");
    if (r.status === 200) { healthy = true; break; }
    await sleep(50);
  }
  if (!healthy) {
    srv.kill("SIGKILL");
    console.log("GATES: FAIL — chaos-auth server did not start");
    process.exit(1);
  }

  // 1) Bad token → 403 error.v1
  const r403 = await req("POST","/v1/run", { headers: { Authorization: "Bearer nope", "Content-Type":"application/json" }, body: "{}" });
  const badIsErrorV1 = r403.status === 403 && /"schema"\s*:\s*"error\.v1"/.test(r403.body);

  // 2) Demo success without auth via stream (bypasses auth in demo) → <1s success
  const t0 = Date.now();
  const r200 = await req("GET","/v1/stream?demo=1");
  const okQuick = r200.status === 200 && (Date.now() - t0) < 1000;

  srv.kill("SIGKILL");
  await Promise.race([ once(srv, "exit"), sleep(150) ]);

  if (badIsErrorV1 && okQuick) {
    console.log("GATES: PASS — chaos-auth smoke OK (403→200 <1s)");
  } else {
    console.log("GATES: FAIL — chaos-auth expectations not met");
    process.exit(1);
  }
}
main().catch(() => {
  console.log("GATES: FAIL — chaos-auth unexpected error");
  process.exit(1);
});
