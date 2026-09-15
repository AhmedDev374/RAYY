import os, sys, json, urllib.request

sys.stdout.reconfigure(encoding="utf-8")
API = os.environ.get("API_URL", "http://localhost:8000")

def get(path, token=None):
    url = f"{API}{path}"
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except Exception as e:
        return None, str(e)

tests = [
    "/health",
    "/api/v1/encyclopedia",
    "/api/v1/encyclopedia/Rose",
    "/api/v1/encyclopedia/Apple",
    "/api/v1/encyclopedia/Tomato",
    "/api/v1/encyclopedia/categories",
]

for p in tests:
    status, body = get(p)
    if isinstance(body, list):
        preview = f"{len(body)} items"
        if body and isinstance(body[0], dict):
            keys = list(body[0].keys())
            preview += " keys=" + str(keys)
            preview += " first=" + json.dumps({k: body[0][k] for k in keys[:6]}, ensure_ascii=False)
        print(f"{status} {p} -> {preview}")
    elif isinstance(body, dict):
        keys = list(body.keys())
        print(f"{status} {p} -> keys={keys} " + json.dumps({k: body[k] for k in keys[:8]}, ensure_ascii=False))
    else:
        print(f"{status} {p} -> {str(body)[:200]}")