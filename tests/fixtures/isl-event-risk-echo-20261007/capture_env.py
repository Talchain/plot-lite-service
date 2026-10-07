import asyncio, json, os, sys
sys.path.insert(0, '.')
os.environ.setdefault("ISL_AUTH_DISABLED", "true")
from httpx import ASGITransport, AsyncClient
from src.api.main import app
from src.services.analysis_pool import create_analysis_pool
from tests.unit.test_event_risk_v1 import supplier_request
async def main(out):
    req = supplier_request(event=True, n_samples=500)
    pool = create_analysis_pool(1); app.state.analysis_pool = pool
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post("/api/v1/robustness/analyze/v2?response_version=2", json=req)
        body = r.json()
        json.dump({"status": r.status_code, "request": req, "envelope": body}, open(out, "w"), indent=1, sort_keys=True)
        print(out, r.status_code, "echo" if body.get("event_risks_applied") else "NO-ECHO", [n["id"] for n in req["graph"]["nodes"] if n.get("event_risk")])
    finally:
        pool.shutdown(wait=True, cancel_futures=True)
if __name__ == '__main__':
    asyncio.run(main(sys.argv[1]))
