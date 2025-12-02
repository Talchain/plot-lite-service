# Minimal Python SDK helpers for PLoT Engine
# - run(input, base_url, token=None, timeout=5, retries=0, query=None)
# - stream(base_url, params=None, token=None, timeout=5, on_event=None)

import json, time

try:
    import requests  # type: ignore
except Exception:
    requests = None  # fallback to urllib

import http.client
import urllib.request
from urllib.parse import urlencode


def _do_post(url: str, data: dict, headers: dict, timeout: float):
    if requests:
        r = requests.post(url, json=data, headers=headers, timeout=timeout)
        return r.status_code, r.text
    req = urllib.request.Request(url, data=json.dumps(data).encode('utf-8'), method='POST')
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read().decode('utf-8')


def run(input, *, base_url, token=None, timeout=5, retries=0, query=None):
    q = f"?{urlencode(query)}" if query else ""
    url = f"{base_url}/v1/run{q}"
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f"Bearer {token}"
    last_err = None
    for attempt in range(0, max(0, retries) + 1):
        try:
            status, text = _do_post(url, input or {}, headers, timeout)
            if 200 <= status < 300:
                return json.loads(text)
            if status >= 500 and attempt < retries:
                continue
            raise RuntimeError(f"http_{status}")
        except Exception as e:
            last_err = e
            if attempt >= retries:
                break
    raise last_err or RuntimeError('run_failed')


def stream(*, base_url, params=None, token=None, timeout=5, on_event=None):
    path = '/v1/stream'
    if params:
        path += '?' + urlencode(params)
    host = base_url.replace('http://', '').replace('https://', '')
    if ':' in host:
        host, port = host.split(':', 1)
        port = int(port)
    else:
        port = 80
    conn = http.client.HTTPConnection(host, port=port, timeout=timeout)
    try:
        conn.putrequest('GET', path)
        if token:
            conn.putheader('Authorization', f'Bearer {token}')
        conn.endheaders()
        resp = conn.getresponse()
        if resp.status != 200:
            raise RuntimeError(f'stream_http_{resp.status}')
        buf = ''
        t0 = time.time()
        while time.time() - t0 < timeout:
            chunk = resp.read(256).decode('utf-8', errors='ignore')
            if not chunk:
                break
            buf += chunk
            while True:
                head = buf.find('event:')
                if head == -1:
                    break
                nl = buf.find('\n\n', head)
                if nl == -1:
                    break
                block = buf[head:nl]
                buf = buf[nl + 2:]
                ev = None
                data = None
                for line in block.split('\n'):
                    s = line.strip()
                    if s.startswith('event:'):
                        ev = s.split(':', 1)[1].strip()
                    elif s.startswith('data:'):
                        data = s.split(':', 1)[1].strip()
                if on_event:
                    try:
                        payload = json.loads(data) if data else None
                    except Exception:
                        payload = data
                    on_event({'event': ev, 'data': payload})
        return True
    finally:
        try:
            conn.close()
        except Exception:
            pass
