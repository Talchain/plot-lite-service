#!/usr/bin/env python3
# Minimal Python example: connect to test stream, cancel, then resume once
# Requires Python 3.10+. Uses built-in http.client for zero deps.

import http.client
import json
import time
from urllib.parse import urlparse, urlencode

BASE = 'http://127.0.0.1:4311'
STREAM_PATH = '/stream'
CANCEL_PATH = '/stream/cancel'
ID = 'demo-4242'

# Assumes a test server is running with TEST_ROUTES=1

def sse_request(url: str, headers: dict | None = None):
    u = urlparse(url)
    conn = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=10)
    path = u.path + ('?' + (u.query or ''))
    conn.putrequest('GET', path)
    conn.putheader('Accept', 'text/event-stream')
    if headers:
        for k, v in headers.items():
            conn.putheader(k, v)
    conn.endheaders()
    resp = conn.getresponse()
    if resp.status != 200:
        raise RuntimeError(f"HTTP {resp.status}")
    return conn, resp


def demo():
    # Start stream
    url = f"{BASE}{STREAM_PATH}?" + urlencode({'id': ID, 'sleepMs': 15})
    conn, resp = sse_request(url)

    buf = ''
    first_id = None

    def read_chunk():
        nonlocal buf, first_id
        chunk = resp.read(256)
        if not chunk:
            return False
        buf += chunk.decode('utf-8', errors='ignore')
        while '\n\n' in buf:
            block, buf = buf.split('\n\n', 1)
            ev = ''
            eid = None
            data_raw = ''
            for line in block.split('\n'):
                line = line.strip()
                if not line:
                    continue
                if line.startswith('event:'):
                    ev = line.split(':', 1)[1].strip()
                elif line.startswith('id:'):
                    eid = line.split(':', 1)[1].strip()
                elif line.startswith('data:'):
                    data_raw = (data_raw + '\n' if data_raw else '') + line.split(':', 1)[1].strip()
            if first_id is None and eid is not None:
                first_id = eid
            # print(ev, data_raw)
        return True

    # Let a couple events arrive
    for _ in range(4):
        if not read_chunk():
            break
        time.sleep(0.01)

    # Cancel
    u = urlparse(BASE)
    c2 = http.client.HTTPConnection(u.hostname, u.port or 80, timeout=5)
    body = json.dumps({'id': ID}).encode('utf-8')
    c2.request('POST', CANCEL_PATH, body=body, headers={'Content-Type': 'application/json'})
    r2 = c2.getresponse()
    r2.read()
    c2.close()

    # Close first stream
    try:
        conn.close()
    except Exception:
        pass

    # Resume once using Last-Event-ID
    if first_id is not None:
        headers = {'Last-Event-ID': first_id}
        sse_request(f"{BASE}{STREAM_PATH}?id={ID}", headers=headers)


if __name__ == '__main__':
    demo()
