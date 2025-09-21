import assert from "node:assert/strict";

const base = process.env.BASE_URL || "http://localhost:4311";
const fetchJson = (u, o) => fetch(u, o).then(r => (r.ok ? r.json() : Promise.reject(new Error("HTTP "+r.status))));
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

const main = async () => {
  // ready
  let ok = false;
  for (let i=0;i<10;i++){ try { const r = await fetch(base+"/ready"); if (r.ok) { ok = true; break; } } catch{} await sleep(100); }
  assert(ok, "server not ready");

  // draft-flows (fixture_case)
  const body = { fixture_case: "price-rise-15pct-enGB", seed: 1 };
  const res = await fetchJson(base+"/draft-flows", { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
  assert(res && Array.isArray(res.drafts), "invalid drafts response");
  console.log("SMOKE OK:", { drafts: res.drafts.length });
};
main().catch(e=>{ console.error("SMOKE FAIL:", e?.message||e); process.exit(1); });
