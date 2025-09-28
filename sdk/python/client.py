# Tiny Python SDK stub for PLoT-lite streaming (dev-only)
# Standard library only; no external deps. SSE parsing is minimal.

from http.client import HTTPConnection
from urllib.parse import urlparse
from typing import Callable, Optional, Dict, Any

EventHandler = Callable[[Dict[str, Any]], None]

class PlotLiteClient:
    def __init__(self, base_url: str):
        self.base_url = base_url

    def open_stream(self, path: str = "/stream", query: str = "", headers: Optional[Dict[str, str]] = None,
                    on_event: Optional[EventHandler] = None,
                    last_event_id: Optional[str] = None) -> None:
        u = urlparse(self.base_url)
        conn = HTTPConnection(u.hostname, u.port or 80, timeout=10)
        req_path = path + (f"?{query}" if query else "")
        hdrs = {"Accept": "text/event-stream"}
        if headers:
            hdrs.update(headers)
        if last_event_id:
            hdrs["Last-Event-ID"] = str(last_event_id)
        conn.request("GET", req_path, headers=hdrs)
        resp = conn.getresponse()
        if resp.status != 200:
            raise RuntimeError(f"HTTP {resp.status}")
        buf = ""
        while True:
            chunk = resp.read(1)
            if not chunk:
                break
            buf += chunk.decode("utf-8", errors="ignore")
            if "\n\n" in buf:
                block, buf = buf.split("\n\n", 1)
                ev = {}
                data = ""
                for line in block.split("\n"):
                    parts = line.split(":", 1)
                    k = parts[0].strip()
                    v = parts[1].strip() if len(parts) > 1 else ""
                    if k == "event":
                        ev["event"] = v
                    elif k == "id":
                        ev["id"] = v
                    elif k == "data":
                        data = (data + "\n" + v) if data else v
                ev["data"] = data
                if on_event:
                    try:
                        on_event(ev)
                    except Exception:
                        pass
        conn.close()
