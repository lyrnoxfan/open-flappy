#!/usr/bin/env python3
"""Deploy the flappy-studio Worker via Cloudflare API.

Uploads with multipart/form-data (script + metadata with bindings in one
request). Verified 2026-10-10: multipart passes through this VM's egress
proxy intact (httpbin check: boundary and both parts arrive byte-accurate).
The earlier 401 was caused by a malformed multipart body in the first
version of this script, not by the proxy.

Usage:
    cd worker && ./deploy.py [--dry-run]

Inlines studio.html and game.html into the worker script.
Studio password lives in worker/.studio-pass (generated once, gitignored).
Never prints credential values.
"""
import sys, json, os, secrets
import urllib.request, urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, DynamicCredentialError

API = "https://api.cloudflare.com"
CRED = "custom.cloudflare"
SCRIPT_NAME = "flappy-studio"
ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "your-cloudflare-account-id")
KV_ID = "58037716eb554d34bf72641018ae3610"
PASS_FILE = ".studio-pass"


def api(method, path, body=None, content_type=None):
    url = API + path
    data = body.encode("utf-8") if isinstance(body, str) else body
    req = urllib.request.Request(url, data=data, method=method)
    if content_type and data is not None:
        req.add_header("Content-Type", content_type)
    try:
        add_surrogate_to_request(req, CRED, allowed_hosts=("api.cloudflare.com",))
    except DynamicCredentialError as e:
        print("credential error:", e, file=sys.stderr)
        sys.exit(2)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def get_password():
    if os.path.exists(PASS_FILE):
        with open(PASS_FILE) as f:
            pw = f.read().strip()
            if pw:
                return pw
    pw = secrets.token_urlsafe(12)
    with open(PASS_FILE, "w") as f:
        f.write(pw + "\n")
    os.chmod(PASS_FILE, 0o600)
    print("generated new studio password (saved to .studio-pass)")
    return pw


def build_script():
    with open("src/index.js", encoding="utf-8") as f:
        index_js = f.read()
    with open("studio.html", encoding="utf-8") as f:
        studio = f.read()
    with open("game.html", encoding="utf-8") as f:
        game = f.read()
    assert "__STUDIO_HTML__" not in index_js and "__GAME_HTML__" not in index_js
    script = "const STUDIO_HTML = " + json.dumps(studio, ensure_ascii=False) + ";\n"
    script += "const GAME_HTML = " + json.dumps(game, ensure_ascii=False) + ";\n"
    script += index_js
    return script


def build_multipart(script, metadata):
    boundary = "----flappy" + secrets.token_hex(8)
    body = b""
    body += ("--%s\r\nContent-Disposition: form-data; name=\"metadata\"\r\n"
             "Content-Type: application/json\r\n\r\n" % boundary).encode()
    body += json.dumps(metadata).encode() + b"\r\n"
    body += ("--%s\r\nContent-Disposition: form-data; name=\"script\"; filename=\"worker.js\"\r\n"
             "Content-Type: application/javascript\r\n\r\n" % boundary).encode()
    body += script.encode("utf-8") + b"\r\n"
    body += ("--%s--\r\n" % boundary).encode()
    return body, "multipart/form-data; boundary=" + boundary


def main():
    dry_run = "--dry-run" in sys.argv
    script = build_script()
    password = get_password()
    print("script size: %d bytes, password set: %s" % (len(script), "yes"))
    if dry_run:
        print("dry-run: not deploying")
        return

    # 单次 multipart 上传：脚本 + bindings（含密码变量）一次到位
    # service-worker 格式：metadata 必须用 body_part 指明脚本 part 的名字
    metadata = {
        "body_part": "script",
        "compatibility_date": "2026-10-01",
        "bindings": [
            {"type": "kv_namespace", "name": "KV", "namespace_id": KV_ID},
            {"type": "plain_text", "name": "STUDIO_PASSWORD", "text": password},
        ],
    }
    body, ctype = build_multipart(script, metadata)
    path = "/client/v4/accounts/%s/workers/scripts/%s" % (ACCOUNT, SCRIPT_NAME)
    status, resp = api("PUT", path, body, ctype)
    try:
        ok = json.loads(resp).get("success")
    except Exception:
        ok = False
    print("script PUT:", status, "success:", ok)
    if not ok:
        print(resp[:500])
        sys.exit(1)

    # 3. verify what is actually stored
    status, body = api("GET", path)
    clean = body.startswith("const STUDIO_HTML = ")
    print("stored script check:", status, "bytes:", len(body), "clean-js:", clean)
    if not clean:
        print("WARNING: stored script is not clean JS, first 120 chars:", repr(body[:120]))
        sys.exit(1)
    status, sbody = api("GET", path + "/settings")
    names = [b.get("name") for b in (json.loads(sbody).get("result") or {}).get("bindings", [])]
    print("live bindings:", names)
    if "STUDIO_PASSWORD" not in names or "KV" not in names:
        print("WARNING: expected bindings missing")
        sys.exit(1)
    print("deployed OK: https://your-studio.example.com")


if __name__ == "__main__":
    main()
