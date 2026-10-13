#!/usr/bin/env python3
"""Seed default game assets into KV (a:default:<name>).

Usage:
    cd worker && ./seed.py [assets_dir]
Default assets dir: ./default-assets (放你的默认素材)
"""
import sys, os
import urllib.request, urllib.error

CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "your-cloudflare-api-token")

API = "https://api.cloudflare.com"
CRED = "custom.cloudflare"
ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "your-cloudflare-account-id")
KV_ID = os.environ.get("CF_KV_NAMESPACE_ID", "your-kv-namespace-id")

NAMES = ["head.png", "hand-top.png", "hand-bottom.png", "grass.png", "phone.png", "flap.mp3"]


def kv_put(key, data):
    url = "%s/client/v4/accounts/%s/storage/kv/namespaces/%s/values/%s" % (
        API, ACCOUNT, KV_ID, key)
    req = urllib.request.Request(url, data=data, method="PUT")
    try:
        add_surrogate_to_request(req, CRED, allowed_hosts=("api.cloudflare.com",))
    except DynamicCredentialError as e:
        print("credential error:", e, file=sys.stderr)
        sys.exit(2)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        print("PUT %s -> %s %s" % (key, e.code, e.read()[:200]), file=sys.stderr)
        return e.code


def main():
    assets_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser("~/workspace/flappy-dot/assets")
    for name in NAMES:
        path = os.path.join(assets_dir, name)
        if not os.path.exists(path):
            print("skip (missing):", name)
            continue
        with open(path, "rb") as f:
            data = f.read()
        st = kv_put("a:default:" + name, data)
        print("a:default:%s %d bytes -> %s" % (name, len(data), st))


if __name__ == "__main__":
    main()
