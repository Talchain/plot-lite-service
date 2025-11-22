#!/usr/bin/env python3
import sys, json
from importlib.machinery import SourceFileLoader

BASE = f"http://127.0.0.1:{int(sys.argv[1])}" if len(sys.argv) > 1 else "http://127.0.0.1:31351"

mod = SourceFileLoader("plot_sdk", "sdk-py/plot_sdk.py").load_module()

def post_run_demo():
    js = mod.run({}, base_url=BASE, timeout=5, retries=0, query={"demo": 1})
    rh = js.get("model_card", {}).get("response_hash", "")
    return isinstance(rh, str) and len(rh) == 64 and all(c in "0123456789abcdef" for c in rh)

def stream_demo_sequence():
    events = []
    def on_ev(ev):
        if "event" in ev:
            events.append(ev["event"])    
    ok = mod.stream(base_url=BASE, params={"demo": 1, "latency_ms": 5}, timeout=4, on_event=on_ev)
    return ok and events[:3] == ["hello","token","done"]

if __name__ == "__main__":
    ok_run = post_run_demo()
    ok_stream = stream_demo_sequence()
    sys.stdout.write(json.dumps({"ok_run": ok_run, "ok_stream": ok_stream}))
    sys.stdout.flush()
